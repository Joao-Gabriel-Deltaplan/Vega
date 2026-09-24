import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat, classificarEReescreverMensagem, JANELA_CONTEXTO_MENSAGENS, JANELA_CLASSIFICADOR_MENSAGENS } from '../chat/chatOrquestrador.js';
import { Mensagem, Contato } from '../chat/types.js';
import { obterTodosTitulares, obterTodosDocumentos } from '../storage.js';
import OpenAI from 'openai';

async function executarTestes() {
  console.log('\n============================================================');
  console.log('🧪 TESTE AUTOMATIZADO: VALIDADE DE CONTEXTO POR MENSAGENS (JANELA 30)');
  console.log(`Constantes ativas: JANELA_CONTEXTO = ${JANELA_CONTEXTO_MENSAGENS}, JANELA_CLASSIFICADOR = ${JANELA_CLASSIFICADOR_MENSAGENS}`);
  console.log('============================================================\n');

  const titulares = await obterTodosTitulares();
  const todosDocs = await obterTodosDocumentos();
  const titularTeste = titulares.find((t) => t.campos?.cpf?.valor) || titulares[0];
  const primeiroNomeTitular = titularTeste.nome.split(' ')[0];

  const contatoTeste: Contato = {
    id: 'wa-5511999990001',
    nome: 'Contato Teste Janela Mensagens',
    telefone: '5511999990001',
    nivelAcesso: 'diretoria',
  };

  let sucessos = 0;
  let falhas = 0;

  // Função auxiliar para gerar N mensagens neutras (sem titular e sem documento)
  function gerarMensagensNeutras(quantidade: number, inicioId: number = 1): Mensagem[] {
    const msgs: Mensagem[] = [];
    for (let i = 0; i < quantidade; i++) {
      msgs.push({
        id: `msg-neutra-${inicioId + i}`,
        remetente: i % 2 === 0 ? 'cliente' : 'assistente',
        texto: i % 2 === 0 ? 'tudo bem, entendido' : 'Certo! Qualquer dúvida estou à disposição.',
        timestamp: new Date().toISOString(),
        rastro: {
          intencaoDetectada: 'saudacao_ou_vago',
          tipoBusca: 'motor',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: 'Certo!',
        },
      });
    }
    return msgs;
  }

  // -------------------------------------------------------------
  // TESTE 1: Titular citado 10 mensagens atrás (DENTRO da janela de 30) -> Contexto VÁLIDO
  // -------------------------------------------------------------
  console.log('--- Teste 1: Titular citado 10 mensagens atrás (dentro da janela de 30) ---');
  const msgTitular1: Mensagem = {
    id: 'msg-titular-1',
    remetente: 'cliente',
    texto: `Gostaria de ver o documento do ${primeiroNomeTitular}`,
    timestamp: new Date().toISOString(),
    rastro: {
      intencaoDetectada: 'pedir_arquivo',
      pessoa: titularTeste.nome,
      tipoBusca: 'motor',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: 'Aqui está...',
    },
  };

  const historico10Atras: Mensagem[] = [
    msgTitular1,
    ...gerarMensagensNeutras(9, 100), // 1 titular + 9 neutras = titular é a 10ª mensagem atrás
  ];

  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o cpf dele?',
    historicoRecente: historico10Atras,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  const cpfEsperado = titularTeste.campos?.cpf?.valor;
  const passou1 = cpfEsperado
    ? res1.textoResposta.includes(cpfEsperado)
    : res1.textoResposta.toLowerCase().includes(primeiroNomeTitular.toLowerCase());

  if (passou1) {
    console.log('✅ APROVADO: Titular dentro da janela (10 msgs atrás) foi mantido no contexto.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Titular dentro da janela deveria ter sido mantido.\n');
    falhas++;
  }

  // -------------------------------------------------------------
  // TESTE 2: Titular citado na 30ª mensagem atrás (LIMITE EXATO da janela) -> Contexto VÁLIDO
  // -------------------------------------------------------------
  console.log('--- Teste 2: Titular citado exatamente 30 mensagens atrás (borda da janela de 30) ---');
  const msgTitular2: Mensagem = {
    id: 'msg-titular-2',
    remetente: 'cliente',
    texto: `Gostaria de ver os dados do ${primeiroNomeTitular}`,
    timestamp: new Date().toISOString(),
    rastro: {
      intencaoDetectada: 'dado_pessoal',
      pessoa: titularTeste.nome,
      tipoBusca: 'motor',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: 'Aqui está...',
    },
  };

  // 1 mensagem de titular + 29 mensagens neutras = titular está na posição -30 do histórico
  const historico30Atras: Mensagem[] = [
    msgTitular2,
    ...gerarMensagensNeutras(29, 200),
  ];

  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual o cpf dele?',
    historicoRecente: historico30Atras,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  const passou2 = cpfEsperado
    ? res2.textoResposta.includes(cpfEsperado)
    : res2.textoResposta.toLowerCase().includes(primeiroNomeTitular.toLowerCase());

  if (passou2) {
    console.log('✅ APROVADO: Titular na borda exata da janela (30 msgs atrás) continua válido.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Titular na 30ª mensagem atrás deveria continuar válido.\n');
    falhas++;
  }

  // -------------------------------------------------------------
  // TESTE 3: Titular citado 31 mensagens atrás (FORA da janela de 30) -> Contexto NÃO DEVE valer
  // -------------------------------------------------------------
  console.log('--- Teste 3: Titular citado 31 mensagens atrás (fora da janela de 30) para "qual cpf?" ---');
  const msgTitular3: Mensagem = {
    id: 'msg-titular-3',
    remetente: 'cliente',
    texto: `Gostaria de ver os dados do ${primeiroNomeTitular}`,
    timestamp: new Date().toISOString(),
    rastro: {
      intencaoDetectada: 'dado_pessoal',
      pessoa: titularTeste.nome,
      tipoBusca: 'motor',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: 'Aqui está...',
    },
  };

  // 1 mensagem de titular + 30 mensagens neutras = titular é a 31ª mensagem atrás (fora da janela de slice(-30))
  const historico31Atras: Mensagem[] = [
    msgTitular3,
    ...gerarMensagensNeutras(30, 300),
  ];

  const res3 = await processarMensagemChat({
    mensagemUsuario: 'qual cpf?',
    historicoRecente: historico31Atras,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  const passou3 =
    res3.textoResposta.includes('De quem você precisa do CPF?') &&
    !res3.textoResposta.includes(cpfEsperado || 'xxx') &&
    !res3.textoResposta.toLowerCase().includes(primeiroNomeTitular.toLowerCase());

  if (passou3) {
    console.log('✅ APROVADO: Titular além de 30 mensagens expirou e VEGA perguntou "De quem você precisa do CPF?".\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: VEGA assumiu titular fora da janela de 30 mensagens.\n');
    falhas++;
  }

  // -------------------------------------------------------------
  // TESTE 4: Titular citado na mensagem atual -> Prevalece sobre o histórico
  // -------------------------------------------------------------
  console.log('--- Teste 4: Titular citado na mensagem atual substitui o histórico ---');
  const outroTitular = titulares.find((t) => t.id !== titularTeste.id) || titulares[1] || titularTeste;
  const res4 = await processarMensagemChat({
    mensagemUsuario: `qual o cpf de ${outroTitular.nome}?`,
    historicoRecente: historico10Atras, // tinha titularTeste 10 mensagens atrás
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res4.textoResposta}"`);
  const outroCpf = outroTitular.campos?.cpf?.valor;
  const passou4 = outroCpf
    ? res4.textoResposta.includes(outroCpf)
    : res4.textoResposta.toLowerCase().includes(outroTitular.nome.split(' ')[0].toLowerCase());

  if (passou4) {
    console.log('✅ APROVADO: Titular na mensagem atual substituiu perfeitamente o contexto.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: Titular na mensagem atual deveria ter prevalecido.\n');
    falhas++;
  }

  // -------------------------------------------------------------
  // TESTE 5: Documento oferecido há 31 mensagens atrás (FORA da janela de 30) -> "me envie o pdf"
  // -------------------------------------------------------------
  console.log('--- Teste 5: Documento fora da janela de 30 mensagens para "me envie o pdf" ---');
  const docExemplo = todosDocs[0];
  const msgDocAntigo: Mensagem = {
    id: 'msg-doc-antigo',
    remetente: 'assistente',
    texto: `De acordo com o documento ${docExemplo?.titulo || 'Contrato'}...`,
    timestamp: new Date().toISOString(),
    documentoOferecidoId: docExemplo?.id,
    rastro: {
      intencaoDetectada: 'pergunta_conteudo',
      documentoUsado: docExemplo?.titulo,
      tipoBusca: 'motor',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: 'De acordo...',
    },
  };

  const historicoDoc31Atras: Mensagem[] = [
    msgDocAntigo,
    ...gerarMensagensNeutras(30, 500),
  ];

  const res5 = await processarMensagemChat({
    mensagemUsuario: 'me envie o pdf',
    historicoRecente: historicoDoc31Atras,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log(`Resposta: "${res5.textoResposta}"`);
  const passou5 =
    res5.textoResposta.toLowerCase().includes('qual documento você gostaria que eu envie') ||
    res5.textoResposta.toLowerCase().includes('qual documento você deseja') ||
    res5.textoResposta.toLowerCase().includes('não encontrei');

  if (passou5) {
    console.log('✅ APROVADO: Documento além de 30 mensagens não é reenviado às cegas; VEGA pergunta qual documento deseja.\n');
    sucessos++;
  } else {
    console.error('❌ FALHOU: VEGA reenviou documento que estava fora da janela de 30 mensagens.\n');
    falhas++;
  }

  // -------------------------------------------------------------
  // TESTE 6: MEDIÇÃO DE CONSUMO DE TOKENS DO CLASSIFICADOR (gpt-5.4-mini)
  // -------------------------------------------------------------
  console.log('\n============================================================');
  console.log('📊 MEDIÇÃO DE CONSUMO DE TOKENS DO CLASSIFICADOR COM 12 MENSAGENS');
  console.log('============================================================\n');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ OPENAI_API_KEY não configurada para medição de tokens.');
  } else {
    const openai = new OpenAI({ apiKey });

    // Mensagens realistas de histórico de chat
    const historicoRealista: Mensagem[] = [
      { id: '1', remetente: 'cliente', texto: 'Bom dia, tudo bem?' },
      { id: '2', remetente: 'assistente', texto: 'Bom dia! Tudo bem e você? Como posso te ajudar hoje?' },
      { id: '3', remetente: 'cliente', texto: 'Preciso consultar alguns documentos da empresa.' },
      { id: '4', remetente: 'assistente', texto: 'Claro! Temos contratos, alvarás, certidões e dados dos titulares no Cofre. De qual você precisa?' },
      { id: '5', remetente: 'cliente', texto: 'Você tem a certidão de casamento do Thomaz?' },
      { id: '6', remetente: 'assistente', texto: 'Sim! Encontrei a Certidão de Casamento de Thomaz Brandini no Cofre. Deseja que eu envie o arquivo?' },
      { id: '7', remetente: 'cliente', texto: 'Por favor, me envia' },
      { id: '8', remetente: 'assistente', texto: 'Aqui está o documento solicitado: Certidão de Casamento.' },
      { id: '9', remetente: 'cliente', texto: 'Obrigado! E qual o endereço do escritório da Delta Plan?' },
      { id: '10', remetente: 'assistente', texto: 'O escritório da Delta Plan fica na Rua Exemplo, 123 - Sala 405.' },
      { id: '11', remetente: 'cliente', texto: 'Perfeito, obrigado pelas informações.' },
      { id: '12', remetente: 'assistente', texto: 'Disponha! Se precisar de mais alguma coisa, só chamar.' },
    ];

    console.log('Testando classificação com mensagem atual: "e o CPF dele?" com 12 mensagens no histórico...');
    const classif12 = await classificarEReescreverMensagem('e o CPF dele?', historicoRealista, openai);

    console.log(`\n--- RESULTADO DE CONSUMO (12 MENSAGENS NO HISTÓRICO) ---`);
    console.log(`Prompt Tokens:     ${classif12.tokensPrompt}`);
    console.log(`Completion Tokens: ${classif12.tokensCompletion}`);
    console.log(`Total Tokens:      ${classif12.tokensTotal}`);
    console.log(`Tempo de resposta: ${classif12.tempoMs} ms`);
    console.log(`Intenção:          ${classif12.intencao}`);
    console.log(`Pessoa resolvida:  ${classif12.pessoa}`);
    console.log(`Campos:            ${classif12.campos?.join(', ')}`);

    // Testando com 4 mensagens para comparação
    console.log('\nTestando com 4 mensagens para comparação...');
    const classif4 = await classificarEReescreverMensagem('e o CPF dele?', historicoRealista.slice(-4), openai);
    console.log(`--- RESULTADO DE CONSUMO (4 MENSAGENS NO HISTÓRICO) ---`);
    console.log(`Prompt Tokens:     ${classif4.tokensPrompt}`);
    console.log(`Completion Tokens: ${classif4.tokensCompletion}`);
    console.log(`Total Tokens:      ${classif4.tokensTotal}`);
    console.log(`Diferença de tokens de prompt (+8 msgs): +${classif12.tokensPrompt - classif4.tokensPrompt} tokens`);
  }

  console.log('\n============================================================');
  console.log(`RESUMO FINAL: ${sucessos} aprovados, ${falhas} falhas.`);
  console.log('============================================================\n');

  if (falhas > 0) {
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
