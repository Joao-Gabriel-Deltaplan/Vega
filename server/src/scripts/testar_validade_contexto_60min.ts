import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Mensagem, Contato } from '../chat/types.js';
import { obterTodosTitulares, obterTodosDocumentos } from '../storage.js';

async function executarTestes() {
  console.log('\n============================================================');
  console.log('🧪 TESTE AUTOMATIZADO: VALIDADE TEMPORAL DO CONTEXTO (60 MIN)');
  console.log('============================================================\n');

  const titulares = await obterTodosTitulares();
  const todosDocs = await obterTodosDocumentos();
  const titularTeste = titulares.find((t) => t.campos?.cpf?.valor) || titulares[0];
  const primeiroNomeTitular = titularTeste.nome.split(' ')[0];

  const contatoTeste: Contato = {
    id: 'wa-5511999990001',
    nome: 'Contato Teste TTL',
    telefone: '5511999990001',
    nivelAcesso: 'diretoria',
  };

  let sucessos = 0;
  let falhas = 0;

  // CASO 1: Histórico RECENTE (15 minutos atrás) -> Contexto DEVE valer
  console.log('--- Teste 1: Histórico recente (15 minutos atrás) ---');
  const data15MinAtras = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const historicoRecenteValido: Mensagem[] = [
    {
      id: 'msg-rec-1',
      remetente: 'cliente',
      texto: `Gostaria de ver o documento do ${primeiroNomeTitular}`,
      timestamp: data15MinAtras,
      rastro: {
        intencaoDetectada: 'pedir_arquivo',
        pessoa: titularTeste.nome,
        tipoBusca: 'motor',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: 'Aqui está...',
      },
    },
  ];

  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o cpf dele?',
    historicoRecente: historicoRecenteValido,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  const cpfEsperado = titularTeste.campos?.cpf?.valor;
  const passou1 = cpfEsperado
    ? res1.textoResposta.includes(cpfEsperado)
    : res1.textoResposta.toLowerCase().includes(primeiroNomeTitular.toLowerCase());

  if (passou1) {
    console.log('✅ APROVADO: Contexto recente (<60m) foi preservado corretamente.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Deveria ter herdado o titular recente.\n');
    falhas++;
  }

  // CASO 2: Histórico EXPIRADO (75 minutos atrás) para dado_pessoal -> Contexto NÃO DEVE valer
  console.log('--- Teste 2: Histórico expirado (75 minutos atrás) para "qual cpf?" ---');
  const data75MinAtras = new Date(Date.now() - 75 * 60 * 1000).toISOString();
  const historicoExpirado: Mensagem[] = [
    {
      id: 'msg-exp-1',
      remetente: 'cliente',
      texto: `Gostaria de ver o documento do ${primeiroNomeTitular}`,
      timestamp: data75MinAtras,
      rastro: {
        intencaoDetectada: 'pedir_arquivo',
        pessoa: titularTeste.nome,
        tipoBusca: 'motor',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: 'Aqui está...',
      },
    },
  ];

  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual cpf?',
    historicoRecente: historicoExpirado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  const passou2 =
    res2.textoResposta.includes('De quem você precisa do CPF?') &&
    !res2.textoResposta.includes(cpfEsperado || 'xxx') &&
    !res2.textoResposta.toLowerCase().includes(primeiroNomeTitular.toLowerCase());

  if (passou2) {
    console.log('✅ APROVADO: Contexto antigo (>60m) expirou e VEGA perguntou "De quem você precisa do CPF?".\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: VEGA assumiu titular expirado ou entregou CPF.\n');
    falhas++;
  }

  // CASO 3: Histórico EXPIRADO (90 minutos atrás) para comando genérico de envio "me envie o pdf"
  console.log('--- Teste 3: Histórico expirado (90 minutos atrás) para "me envie o pdf" ---');
  const data90MinAtras = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const docExemplo = todosDocs[0];
  const historicoDocExpirado: Mensagem[] = [
    {
      id: 'msg-doc-1',
      remetente: 'assistente',
      texto: `De acordo com o documento ${docExemplo?.titulo || 'Contrato'}...`,
      timestamp: data90MinAtras,
      documentoOferecidoId: docExemplo?.id,
      rastro: {
        intencaoDetectada: 'pergunta_conteudo',
        documentoUsado: docExemplo?.titulo,
        tipoBusca: 'motor',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: 'De acordo...',
      },
    },
  ];

  const res3 = await processarMensagemChat({
    mensagemUsuario: 'me envie o pdf',
    historicoRecente: historicoDocExpirado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  const passou3 =
    res3.textoResposta.toLowerCase().includes('qual documento você gostaria que eu envie') ||
    res3.textoResposta.toLowerCase().includes('qual documento você deseja');

  if (passou3) {
    console.log('✅ APROVADO: Documento do histórico antigo (>60m) expirou e VEGA perguntou qual documento enviar.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: VEGA reenviou documento de contexto expirado.\n');
    falhas++;
  }

  // CASO 4: Histórico EXPIRADO (120 minutos atrás) para pedido de documento com múltiplos titulares no cofre
  console.log('--- Teste 4: Histórico expirado (120 min atrás) para "me manda a CNH" com múltiplos titulares ---');
  const data120MinAtras = new Date(Date.now() - 120 * 60 * 1000).toISOString();
  const historicoCnhExpirado: Mensagem[] = [
    {
      id: 'msg-cnh-1',
      remetente: 'cliente',
      texto: `Gostaria de ver as informações do ${primeiroNomeTitular}`,
      timestamp: data120MinAtras,
      rastro: {
        intencaoDetectada: 'dado_pessoal',
        pessoa: titularTeste.nome,
        tipoBusca: 'motor',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: 'Informações...',
      },
    },
  ];

  const res4 = await processarMensagemChat({
    mensagemUsuario: 'me manda a CNH',
    historicoRecente: historicoCnhExpirado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res4.textoResposta}"`);
  // Como o titular expirou, se houver apenas 1 CNH envia (regra 6); se houver mais de 1, pergunta de quem é.
  // Em qualquer caso, se perguntar de quem é ou se enviar, valida se não assumiu cegamente como Thomaz quando ambíguo.
  const docsCnh = todosDocs.filter((d) => d.tipo?.toLowerCase().includes('cnh') || d.titulo.toLowerCase().includes('cnh'));
  const titularesDiferentes = new Set(docsCnh.map((d) => d.pessoaId || d.titular).filter(Boolean));

  let passou4 = false;
  if (titularesDiferentes.size > 1) {
    passou4 = res4.textoResposta.toLowerCase().includes('qual') || res4.textoResposta.toLowerCase().includes('encontrei');
  } else {
    passou4 = res4.anexos && res4.anexos.length === 1;
  }

  if (passou4) {
    console.log('✅ APROVADO: Tratamento correto de documento após expiração de titular no histórico.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Documento não tratado corretamente após expiração.\n');
    falhas++;
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
