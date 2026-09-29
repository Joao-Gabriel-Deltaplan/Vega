import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Mensagem, Contato } from '../chat/types.js';
import { obterTodosTitulares } from '../storage.js';

async function rodar() {
  console.log('\n============================================================');
  console.log('🧪 TESTE: PONTO 13 (HERANÇA COM PRONOME) E PONTO 14 (CORPORATIVO)');
  console.log('============================================================\n');

  const titulares = await obterTodosTitulares();
  const titularThomaz = titulares.find((t) => t.nome.toLowerCase().includes('thomaz')) || titulares[0];
  const primeiroNome = titularThomaz.nome.split(' ')[0];

  const contatoTeste: Contato = {
    id: 'wa-123456',
    nome: titularThomaz.nome,
    telefone: '5511999999999',
  };

  // Histórico onde a mensagem anterior tratava do Thomaz
  const historicoComTitular: Mensagem[] = [
    {
      id: 'msg-1',
      remetente: 'cliente',
      texto: `qual o RG do ${primeiroNome}?`,
      timestamp: new Date().toISOString(),
    },
    {
      id: 'msg-2',
      remetente: 'assistente',
      texto: `O RG do ${primeiroNome} é ...`,
      timestamp: new Date().toISOString(),
      rastro: {
        intencaoDetectada: 'dado_pessoal',
        tipoBusca: 'ficha',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: `O RG do ${primeiroNome}...`,
        pessoa: titularThomaz.nome,
      },
    },
  ];

  let falhas = 0;

  // TESTE 1 (Ponto 13): Mensagem seguinte pergunta campo SEM titular e SEM pronome
  console.log('--- Teste 1: "qual o cpf?" após falar de Thomaz no histórico (SEM pronome) ---');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o cpf?',
    historicoRecente: historicoComTitular,
    contato: { id: 'wa-outro', nome: 'Outro Usuario', telefone: '5511888888888' },
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  const passou1 = res1.textoResposta.includes('De quem você precisa do CPF?') && !res1.textoResposta.includes('333.599.518-08');
  if (passou1) {
    console.log('✅ APROVADO: Bloqueou herança indevida do histórico e perguntou "De quem você precisa do CPF?".\n');
  } else {
    console.error('❌ FALHOU: Herdou indevidamente ou não perguntou o titular.\n');
    falhas++;
  }

  // TESTE 2 (Ponto 13): Mensagem seguinte usa pronome explícito "dele"
  console.log('--- Teste 2: "e o CPF dele?" após falar de Thomaz no histórico (COM pronome) ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'e o CPF dele?',
    historicoRecente: historicoComTitular,
    contato: { id: 'wa-outro', nome: 'Outro Usuario', telefone: '5511888888888' },
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  const passou2 = res2.textoResposta.includes('333.599.518-08') || res2.textoResposta.toLowerCase().includes(primeiroNome.toLowerCase());
  if (passou2) {
    console.log('✅ APROVADO: Reconheceu pronome explícito "dele" e recuperou o CPF do titular do histórico.\n');
  } else {
    console.error('❌ FALHOU: Deveria ter recuperado com pronome explícito.\n');
    falhas++;
  }

  // TESTE 3 (Ponto 14): Pergunta corporativa feita por contato cujo nome é o titular
  console.log('--- Teste 3: Pergunta corporativa "qual o endereço do escritório da Delta?" por contato = Thomaz ---');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'qual o endereço do escritório da Delta?',
    historicoRecente: [],
    contato: contatoTeste, // Nome do contato é Thomaz Brandini
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  console.log(`Rastro intencao: ${res3.intencaoDetectada}`);
  const passou3 = !res3.textoResposta.includes('De quem você precisa') && (res3.textoResposta.toLowerCase().includes('delta') || res3.textoResposta.toLowerCase().includes('escritório') || res3.textoResposta.toLowerCase().includes('alfredo schürig') || res3.textoResposta.toLowerCase().includes('alfredo'));
  if (passou3) {
    console.log('✅ APROVADO: Pergunta corporativa não foi restrita ao titular do contato.\n');
  } else {
    console.error('❌ FALHOU: Pergunta corporativa foi restrita ou bloqueada indevidamente.\n');
    falhas++;
  }

  console.log('============================================================');
  console.log(`RESULTADO: ${falhas === 0 ? 'TODOS OS TESTES APROVADOS' : `${falhas} FALHAS`}`);
  console.log('============================================================\n');

  if (falhas > 0) process.exit(1);
}

rodar().catch((err) => {
  console.error(err);
  process.exit(1);
});
