import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { montarPromptContextualTranscricao } from '../whatsapp/audioTranscriptionService.js';
import { resolverTitularCadastrado, resolverTitularComAmbiguidade, obterTodosTitulares } from '../storage.js';
import { nomesSaoEquivalentesComTolerancia, normalizarFoneticaNome } from '../utils/nomeUtils.js';
import { Contato } from '../types.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: TOLERÂNCIA DE GRAFIA, APELIDOS E TRANSCRIÇÃO');
  console.log('================================================================\n');

  let totalTestes = 0;
  let sucessos = 0;

  const contatoTeste: Contato = {
    id: 'ct-teste-auditoria',
    nome: 'Operador Teste',
    telefone: '5514999999999',
    avatarCor: '#25D366',
    cargo: 'Administrador',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Administrador',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: 'Auditoria de testes de tolerância',
    },
  };

  // -------------------------------------------------------------
  // TESTE 0: GERAÇÃO DO PROMPT CONTEXTUAL DE TRANSCRIÇÃO
  // -------------------------------------------------------------
  totalTestes++;
  console.log('--- TESTE 0: PROMPT CONTEXTUAL DE TRANSCRIÇÃO ---');
  const promptContextual = await montarPromptContextualTranscricao();
  console.log(`Prompt gerado (${promptContextual.length} chars): "${promptContextual}"`);
  
  const temSiglas = promptContextual.includes('CREA') && promptContextual.includes('CRT') && promptContextual.includes('DIRPF');
  const temEmpresa = promptContextual.includes('Delta Plan') && promptContextual.includes('VEGA');
  const abaixoLimite = promptContextual.length <= 850; // limite de 224 tokens da OpenAI

  if (temSiglas && temEmpresa && abaixoLimite) {
    console.log('✅ TESTE 0 PASSOU: Prompt dinâmico contém siglas, termos institucionais e respeita limite de tokens.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 0 FALHOU:', { temSiglas, temEmpresa, abaixoLimite });
  }

  // -------------------------------------------------------------
  // TESTE 1: TOLERÂNCIA FONÉTICA UNITÁRIA (S/Z, TH/T, APELIDOS)
  // -------------------------------------------------------------
  totalTestes++;
  console.log('--- TESTE 1: TOLERÂNCIA FONÉTICA E APELIDOS ---');
  const todosTitulares = await obterTodosTitulares();
  const titThomaz = todosTitulares.find(t => t.nome.toLowerCase().includes('thomaz'));

  console.log(`Titular localizado no Supabase: "${titThomaz?.nome}" (Apelidos: ${JSON.stringify(titThomaz?.apelidos)})`);

  const matchComS = resolverTitularCadastrado('thomas', todosTitulares);
  const matchComZ = resolverTitularCadastrado('thomaz', todosTitulares);
  const matchComT = resolverTitularCadastrado('tomas', todosTitulares);
  const matchInexistente = resolverTitularCadastrado('ricardo rocha silva', todosTitulares);

  const t1Ok = matchComS?.id === titThomaz?.id &&
               matchComZ?.id === titThomaz?.id &&
               matchComT?.id === titThomaz?.id &&
               matchInexistente === null;

  if (t1Ok) {
    console.log('✅ TESTE 1 PASSOU: "thomas", "thomaz" e "tomas" resolvem para o titular cadastrado, e nome diferente retorna null.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 1 FALHOU:', { matchComS: matchComS?.nome, matchComZ: matchComZ?.nome, matchComT: matchComT?.nome, matchInexistente });
  }

  // -------------------------------------------------------------
  // TESTE 2: PERGUNTA ESCRITA "thomas" COM "S"
  // -------------------------------------------------------------
  totalTestes++;
  console.log('--- TESTE 2: TEXTO ESCRITO "thomas" COM "S" ---');
  const resTextoComS = await processarMensagemChat({
    mensagemUsuario: 'qual o título eleitoral do thomas',
    historicoRecente: [],
    contato: contatoTeste,
  });

  console.log(`Resposta da VEGA: "${resTextoComS.textoResposta}"`);
  const t2Ok = resTextoComS.textoResposta.includes('308476780167') &&
               resTextoComS.textoResposta.toLowerCase().includes('imposto de renda');

  if (t2Ok) {
    console.log('✅ TESTE 2 PASSOU: Pergunta com "thomas" com S encontrou o Thomaz e respondeu o número 308476780167 do Imposto de Renda.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 2 FALHOU: Resposta não contém o número do título eleitoral esperado.');
  }

  // -------------------------------------------------------------
  // TESTE 3: TRANSCRIÇÃO DE ÁUDIO COM GRAFIA "Thomas"
  // -------------------------------------------------------------
  totalTestes++;
  console.log('--- TESTE 3: SIMULAÇÃO DE ÁUDIO COM "qual o título eleitoral do Thomaz" ---');
  // Simula o texto exatamente como transcrevia anteriormente ("do Thomas" com S)
  const resAudio = await processarMensagemChat({
    mensagemUsuario: 'qual o título eleitoral do Thomas',
    historicoRecente: [],
    contato: contatoTeste,
  });

  console.log(`Resposta da VEGA: "${resAudio.textoResposta}"`);
  const t3Ok = resAudio.textoResposta.includes('308476780167') &&
               resAudio.textoResposta.toLowerCase().includes('imposto de renda');

  if (t3Ok) {
    console.log('✅ TESTE 3 PASSOU: Áudio com "Thomas" respondeu com o número 308476780167 citando o Imposto de Renda.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 3 FALHOU: Resposta não contém o número do título eleitoral.');
  }

  // -------------------------------------------------------------
  // TESTE 4: NOME REALMENTE DIFERENTE (NÃO CADASTRADO)
  // -------------------------------------------------------------
  totalTestes++;
  console.log('--- TESTE 4: NOME REALMENTE DIFERENTE (NÃO CADASTRADO) ---');
  const resInexistente = await processarMensagemChat({
    mensagemUsuario: 'qual o número do título eleitoral do ricardo mendes',
    historicoRecente: [],
    contato: contatoTeste,
  });

  console.log(`Resposta da VEGA: "${resInexistente.textoResposta}"`);
  const t4Ok = resInexistente.textoResposta.toLowerCase().includes('não encontrei') &&
               !resInexistente.textoResposta.includes('308476780167');

  if (t4Ok) {
    console.log('✅ TESTE 4 PASSOU: Pessoa não cadastrada continua sendo tratada como não encontrada pela Regra 16, sem assumir o Thomaz.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 4 FALHOU: Resposta deveria dizer que não encontrou informações sobre Ricardo Mendes.');
  }

  console.log('================================================================');
  console.log(`🏁 RESULTADO FINAL: ${sucessos}/${totalTestes} TESTES APROVADOS (${Math.round((sucessos/totalTestes)*100)}%)`);
  console.log('================================================================');

  if (sucessos === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

rodarTestes().catch(e => {
  console.error('Erro fatal nos testes:', e);
  process.exit(1);
});
