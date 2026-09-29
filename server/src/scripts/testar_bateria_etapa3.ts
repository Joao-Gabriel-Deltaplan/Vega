import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const contatoTeste: Contato = {
  id: 'cont-teste-etapa3',
  nome: 'Titular Teste',
  telefone: '5500000000005',
  avatarCor: '#10b981',
  cargo: 'Diretor',
  setor: 'Diretoria',
  nivelAcesso: 'diretoria',
  ficha: {
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    observacoes: '',
  },
};

async function main() {
  console.log('===============================================================');
  console.log('BATERIA DE TESTES — ETAPA 3 (3 RESOLUTORES DE ENTIDADE & SUJEITO)');
  console.log('===============================================================\n');

  const documentosDisponiveis = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();
  const titularAlvo = todosTitulares.find(t => t.tipo !== 'PJ') || { id: 'tit_teste', nome: 'Thomaz' };

  let sucessos = 0;
  let falhas = 0;
  const tempos: number[] = [];

  // -------------------------------------------------------------------------
  // TESTE 1: Prevalência de Nome Citado (Regra 16) com titular cadastrado
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 1: Prevalência de Nome Citado (Titular Cadastrado)');
  const t1Inicio = Date.now();
  const res1 = await processarMensagemChat({
    mensagemUsuario: `qual o CPF de ${titularAlvo.nome}?`,
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });
  const t1Dur = Date.now() - t1Inicio;
  tempos.push(t1Dur);

  if (res1.intencaoDetectada === 'dado_pessoal' && res1.rastro?.pessoa?.toLowerCase().includes(titularAlvo.nome.toLowerCase())) {
    console.log(`[PASSOU] Teste 1: Intenção = dado_pessoal | Pessoa = ${res1.rastro?.pessoa} (${t1Dur}ms)\n`);
    sucessos++;
  } else {
    console.error(`[FALHOU] Teste 1: Intenção = ${res1.intencaoDetectada}, Pessoa = ${res1.rastro?.pessoa}\n`);
    falhas++;
  }

  // -------------------------------------------------------------------------
  // TESTE 2: Herança do Histórico quando não há sujeito (com pronome "dele")
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 2: Herança do Histórico com Pronome ("e o RG dele?")');
  const historicoComTitular: Mensagem[] = [
    { id: 'm1', remetente: 'cliente', nomeRemetente: 'Usuario', horario: '10:00', texto: `qual o CPF de ${titularAlvo.nome}?` },
    { id: 'm2', remetente: 'assistente', nomeRemetente: 'VEGA', horario: '10:00', texto: 'O CPF é 123.456.789-00' },
  ];
  const t2Inicio = Date.now();
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'e o RG dele?',
    historicoRecente: historicoComTitular,
    contato: contatoTeste,
    documentosDisponiveis,
  });
  const t2Dur = Date.now() - t2Inicio;
  tempos.push(t2Dur);

  if (res2.intencaoDetectada === 'dado_pessoal' && res2.rastro?.pessoa?.toLowerCase().includes(titularAlvo.nome.toLowerCase()) && res2.rastro?.origemPessoa === 'contexto') {
    console.log(`[PASSOU] Teste 2: Herdado com sucesso = ${res2.rastro?.pessoa} (origem: contexto) (${t2Dur}ms)\n`);
    sucessos++;
  } else {
    console.error(`[FALHOU] Teste 2: Intenção = ${res2.intencaoDetectada}, Pessoa = ${res2.rastro?.pessoa}, Origem = ${res2.rastro?.origemPessoa}\n`);
    falhas++;
  }

  // -------------------------------------------------------------------------
  // TESTE 3: Soberania Corporativa (Delta Plan zera titular e nunca anexa documento de pessoa)
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 3: Soberania Corporativa ("Me mande o endereço do escritório da Delta Plan")');
  const t3Inicio = Date.now();
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'Me mande o endereço do escritório da Delta Plan',
    historicoRecente: historicoComTitular, // histórico continha titular pessoal!
    contato: contatoTeste,
    documentosDisponiveis,
  });
  const t3Dur = Date.now() - t3Inicio;
  tempos.push(t3Dur);

  const bloqueouAnexo = !res3.anexos || res3.anexos.length === 0;
  const semPessoa = !res3.rastro?.pessoa;
  const intencaoConteudo = res3.intencaoDetectada === 'pergunta_conteudo';

  if (bloqueouAnexo && semPessoa && intencaoConteudo) {
    console.log(`[PASSOU] Teste 3: Soberania corporativa respeitada (sem pessoa, sem anexo de terceiro, pergunta_conteudo) (${t3Dur}ms)\n`);
    sucessos++;
  } else {
    console.error(`[FALHOU] Teste 3: bloqueouAnexo=${bloqueouAnexo}, semPessoa=${semPessoa}, intencao=${res3.intencaoDetectada}\n`);
    falhas++;
  }

  // -------------------------------------------------------------------------
  // TESTE 4: Blindagem sem sujeito e sem contexto (Regra 14)
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 4: Pergunta de dado pessoal sem titular e sem contexto ("qual o CPF?")');
  const t4Inicio = Date.now();
  const res4 = await processarMensagemChat({
    mensagemUsuario: 'qual o CPF?',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });
  const t4Dur = Date.now() - t4Inicio;
  tempos.push(t4Dur);

  if (res4.textoResposta.toLowerCase().includes('de quem você precisa do cpf') || res4.textoResposta.toLowerCase().includes('de quem voce precisa')) {
    console.log(`[PASSOU] Teste 4: VEGA perguntou de quem precisa do CPF (${t4Dur}ms)\n`);
    sucessos++;
  } else {
    console.error(`[FALHOU] Teste 4: Resposta obtida: "${res4.textoResposta}"\n`);
    falhas++;
  }

  // -------------------------------------------------------------------------
  // TESTE 5: Prevalência de Pessoa Não Cadastrada (Regra 16)
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 5: Pessoa não cadastrada ("qual o nome da mãe da Nilceia?")');
  const t5Inicio = Date.now();
  const res5 = await processarMensagemChat({
    mensagemUsuario: 'qual o nome da mãe da Nilceia?',
    historicoRecente: historicoComTitular, // histórico tinha titular diferente!
    contato: contatoTeste,
    documentosDisponiveis,
  });
  const t5Dur = Date.now() - t5Inicio;
  tempos.push(t5Dur);

  if (res5.rastro?.pessoa?.toLowerCase().includes('nilceia') && res5.rastro?.origemPessoa === 'mensagem_atual') {
    console.log(`[PASSOU] Teste 5: Pessoa não cadastrada prevaleceu sobre histórico = Nilceia (${t5Dur}ms)\n`);
    sucessos++;
  } else {
    console.error(`[FALHOU] Teste 5: Pessoa = ${res5.rastro?.pessoa}, Origem = ${res5.rastro?.origemPessoa}\n`);
    falhas++;
  }

  const tempoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
  console.log('===============================================================');
  console.log(`RESULTADO DA ETAPA 3: ${sucessos}/5 passaram (${falhas} falhas).`);
  console.log(`Tempo médio por mensagem: ${tempoMedio}ms`);
  console.log('===============================================================');

  if (falhas > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
