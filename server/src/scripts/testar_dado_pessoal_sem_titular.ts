import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Mensagem, Contato } from '../chat/types.js';
import { obterTodosTitulares } from '../storage.js';

async function executarTestes() {
  console.log('\n============================================================');
  console.log('🧪 TESTE AUTOMATIZADO: BLINDAGEM DE DADO PESSOAL SEM TITULAR');
  console.log('============================================================\n');

  const titulares = await obterTodosTitulares();
  console.log(`Titulares cadastrados no Supabase: ${titulares.length}`);
  const titularTeste = titulares.find((t) => t.campos?.cpf?.valor) || titulares[0];

  let falhas = 0;
  let sucessos = 0;

  // CASO 1: Contato NOVO, histórico VAZIO, perguntando "qual cpf?"
  console.log('--- Teste 1: Contato NOVO, histórico vazio, "qual cpf?" ---');
  const contatoNovo: Contato = {
    id: 'wa-5511999990001',
    nome: 'Contato Novo Sem Histórico',
    telefone: '5511999990001',
  };
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual cpf?',
    historicoRecente: [],
    contato: contatoNovo,
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  console.log(`Intenção: ${res1.intencaoDetectada} | Origem: ${res1.origem}`);

  const passou1 =
    res1.textoResposta.includes('De quem você precisa do CPF?') &&
    !res1.textoResposta.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/) &&
    !res1.textoResposta.toLowerCase().includes('thomaz');

  if (passou1) {
    console.log('✅ APROVADO: Perguntou "De quem você precisa do CPF?" sem entregar CPF de ninguém.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Resposta incorreta ou entregou dado indevido.\n');
    falhas++;
  }

  // CASO 2: Contato com histórico de saudação/boas-vindas da VEGA, perguntando "qual cpf?"
  console.log('--- Teste 2: Histórico com saudação da VEGA, "qual cpf?" ---');
  const historicoComSaudacao: Mensagem[] = [
    {
      id: 'msg-1',
      remetente: 'assistente',
      texto: 'Olá! Sou a VEGA, assistente corporativa da Delta Plan. Como posso te ajudar hoje?',
      timestamp: new Date().toISOString(),
      rastro: {
        intencaoDetectada: 'saudacao_ou_vago',
        tipoBusca: 'motor',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: 'Olá! Sou a VEGA...',
      },
    },
  ];
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual cpf?',
    historicoRecente: historicoComSaudacao,
    contato: contatoNovo,
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  const passou2 =
    res2.textoResposta.includes('De quem você precisa do CPF?') &&
    !res2.textoResposta.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/) &&
    !res2.textoResposta.toLowerCase().includes('thomaz');

  if (passou2) {
    console.log('✅ APROVADO: Não se contaminou com saudação da VEGA e perguntou o titular.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Histórico contaminou ou resposta não bateu.\n');
    falhas++;
  }

  // CASO 3: Pergunta de RG sem titular
  console.log('--- Teste 3: "qual rg?" sem titular ---');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'qual rg?',
    historicoRecente: [],
    contato: contatoNovo,
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  const passou3 = res3.textoResposta.includes('De quem você precisa do RG?');

  if (passou3) {
    console.log('✅ APROVADO: Perguntou "De quem você precisa do RG?".\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Não perguntou pelo RG adequadamente.\n');
    falhas++;
  }

  // CASO 4: Pergunta de endereço sem titular
  console.log('--- Teste 4: "qual o endereço?" sem titular ---');
  const res4 = await processarMensagemChat({
    mensagemUsuario: 'qual o endereço?',
    historicoRecente: [],
    contato: contatoNovo,
  });

  console.log(`Resposta: "${res4.textoResposta}"`);
  const passou4 = res4.textoResposta.includes('De quem você precisa do endereço?');

  if (passou4) {
    console.log('✅ APROVADO: Perguntou "De quem você precisa do endereço?".\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Não perguntou pelo endereço adequadamente.\n');
    falhas++;
  }

  // CASO 5: Pergunta com titular explícito
  if (titularTeste) {
    const primeiroNome = titularTeste.nome.split(' ')[0];
    console.log(`--- Teste 5: "qual cpf do ${primeiroNome}?" ---`);
    const res5 = await processarMensagemChat({
      mensagemUsuario: `qual cpf do ${primeiroNome}?`,
      historicoRecente: [],
      contato: contatoNovo,
    });

    console.log(`Resposta: "${res5.textoResposta}"`);
    const cpfEsperado = titularTeste.campos?.cpf?.valor;
    const passou5 = cpfEsperado ? res5.textoResposta.includes(cpfEsperado) : res5.textoResposta.length > 0;

    if (passou5) {
      console.log(`✅ APROVADO: Entregou corretamente o dado com titular explícito.\n`);
      sucessos++;
    } else {
      console.error(`❌ FALHOU: Não entregou o dado do titular explícito.\n`);
      falhas++;
    }
  }

  console.log('============================================================');
  console.log(`RESULTADO FINAL: ${sucessos} APROVADOS / ${falhas} FALHAS`);
  console.log('============================================================\n');

  if (falhas > 0) {
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
