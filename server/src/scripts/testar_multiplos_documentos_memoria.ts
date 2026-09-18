import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES DE VALIDAÇÃO: MÚLTIPLOS DOCUMENTOS E AMBIGUIDADE COM MEMÓRIA');
  console.log('===============================================================\n');

  const todosDocs = await obterTodosDocumentos();
  const contato: Contato = {
    id: 'user_teste',
    nome: 'Joao Gabriel',
    telefone: '176948374462673',
    nivelAcesso: 'diretoria',
  } as Contato;

  // ---------------------------------------------------------------------------
  // TESTE 1: PEDIDO DE VÁRIOS DOCUMENTOS (Exigências 1 e 4)
  // "me envia o crea e a certidão de casamento do thomaz por favor"
  // Deve enviar exatamente os dois anexos (Crea e Certidão) sem perguntar nada.
  // ---------------------------------------------------------------------------
  console.log('>>> TESTE 1: Pedido de múltiplos documentos direto');
  console.log('Mensagem: "me envia o crea e a certidão de casamento do thomaz por favor"');

  const res1 = await processarMensagemChat({
    mensagemUsuario: 'me envia o crea e a certidão de casamento do thomaz por favor',
    historicoRecente: [],
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res1.textoResposta);
  console.log('Intenção Detectada:', res1.intencaoDetectada);
  console.log('Quantidade de Anexos:', res1.anexos?.length || 0);
  console.log('Anexos:', res1.anexos?.map((a) => a.nome));
  console.log('Enviou Anexo no Rastro:', res1.rastro?.enviouAnexo);

  const titulosAnexos = (res1.anexos || []).map((a) => a.titulo || a.nome);
  const temCrea = titulosAnexos.some((t) => t.toLowerCase().includes('crea'));
  const temCertidao = titulosAnexos.some((t) => t.toLowerCase().includes('certid') || t.toLowerCase().includes('casamento'));

  if (res1.anexos?.length !== 2 || !temCrea || !temCertidao) {
    console.error('❌ FALHA NO TESTE 1: Deveria ter enviado exatamente 2 anexos (Crea e Certidão de Casamento)!');
    process.exitCode = 1;
  } else if (res1.textoResposta.includes('Qual deles você gostaria')) {
    console.error('❌ FALHA NO TESTE 1: VEGA tratou múltiplos documentos como ambiguidade em vez de enviar!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 1: Enviou exatamente os 2 anexos pedidos diretamente sem perguntar!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 2: PEDIDO AMBÍGUO DE VERDADE (Exigência 3)
  // Mensagem com termo ambíguo que corresponde a mais de um documento (CREA e CRT):
  // "me manda o conselho do thomaz"
  // Deve listar as opções enumeradas: "1) *CRT*, 2) *Crea*. Quer os dois ou algum específico?"
  // e retornar documentoOferecidoId guardado na conversa.
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 2: Pedido ambíguo de verdade');
  console.log('Mensagem: "me manda o conselho do thomaz"');

  const res2 = await processarMensagemChat({
    mensagemUsuario: 'me manda o conselho do thomaz',
    historicoRecente: [],
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res2.textoResposta);
  console.log('Intenção:', res2.intencaoDetectada);
  console.log('Opções retornadas:', res2.opcoes?.map((o) => o.titulo));
  console.log('DocumentoOferecidoId guardado:', res2.documentoOferecidoId);

  const temEnumeracao = res2.textoResposta.includes('1)') && res2.textoResposta.includes('2)');
  const temPerguntaEspecifica =
    res2.textoResposta.includes('Quer os dois ou algum específico?') ||
    res2.textoResposta.includes('Quer todos ou algum específico?');

  if (!res2.documentoOferecidoId) {
    console.error('❌ FALHA NO TESTE 2: documentoOferecidoId não foi preenchido na resposta ambígua!');
    process.exitCode = 1;
  } else if (!temEnumeracao) {
    console.error('❌ FALHA NO TESTE 2: A resposta ambígua não enumerou as opções!');
    process.exitCode = 1;
  } else if (!temPerguntaEspecifica) {
    console.error('❌ FALHA NO TESTE 2: A pergunta final não está no padrão especificado!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 2: Listou as opções enumeradas e guardou documentoOferecidoId!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 3: RESPOSTA AO PEDIDO AMBÍGUO COM MEMÓRIA: "esses 2 documentos, preciso do anexo dos 2" (Exigência 2)
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 3: Resposta com memória "esses 2 documentos, preciso do anexo dos 2"');

  const historicoComAmbiguidade: Mensagem[] = [
    {
      id: 'msg-1',
      remetente: 'cliente',
      nomeRemetente: contato.nome,
      horario: '10:00',
      texto: 'me manda o conselho do thomaz',
    },
    {
      id: 'msg-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:00',
      texto: res2.textoResposta,
      documentoOferecidoId: res2.documentoOferecidoId,
      opcoes: res2.opcoes,
    },
  ];

  const res3 = await processarMensagemChat({
    mensagemUsuario: 'esses 2 documentos, preciso do anexo dos 2',
    historicoRecente: historicoComAmbiguidade,
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res3.textoResposta);
  console.log('Quantidade de Anexos:', res3.anexos?.length || 0);
  console.log('Anexos enviados:', res3.anexos?.map((a) => a.nome));

  if ((res3.anexos?.length || 0) < 2) {
    console.error('❌ FALHA NO TESTE 3: Não recuperou a lista da memória e não enviou os 2 anexos!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 3: Recuperou da memória e enviou ambos os documentos!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 4: RESPOSTA COM MEMÓRIA "os dois" (Exigência 2 e 5)
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 4: Resposta com memória "os dois"');

  const res4 = await processarMensagemChat({
    mensagemUsuario: 'os dois',
    historicoRecente: historicoComAmbiguidade,
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res4.textoResposta);
  console.log('Quantidade de Anexos:', res4.anexos?.length || 0);
  console.log('Anexos enviados:', res4.anexos?.map((a) => a.nome));

  if ((res4.anexos?.length || 0) < 2) {
    console.error('❌ FALHA NO TESTE 4: Não enviou os 2 anexos para "os dois"!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 4: "os dois" entregou ambos os anexos com sucesso!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 5: RESPOSTA COM MEMÓRIA "pode mandar" (Exigência 2)
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 5: Resposta com memória "pode mandar"');

  const res5 = await processarMensagemChat({
    mensagemUsuario: 'pode mandar',
    historicoRecente: historicoComAmbiguidade,
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res5.textoResposta);
  console.log('Quantidade de Anexos:', res5.anexos?.length || 0);
  console.log('Anexos enviados:', res5.anexos?.map((a) => a.nome));

  if ((res5.anexos?.length || 0) < 2) {
    console.error('❌ FALHA NO TESTE 5: Não enviou os anexos para "pode mandar"!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 5: "pode mandar" entregou ambos os anexos com sucesso!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 6: RESPOSTA COM MEMÓRIA "o primeiro" (Exigência 2)
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 6: Resposta com memória "o primeiro"');

  const res6 = await processarMensagemChat({
    mensagemUsuario: 'o primeiro',
    historicoRecente: historicoComAmbiguidade,
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res6.textoResposta);
  console.log('Quantidade de Anexos:', res6.anexos?.length || 0);
  console.log('Anexos enviados:', res6.anexos?.map((a) => a.nome));

  if ((res6.anexos?.length || 0) !== 1) {
    console.error('❌ FALHA NO TESTE 6: Deveria ter enviado exatamente 1 anexo!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 6: "o primeiro" entregou apenas o primeiro anexo!\n');
  }

  // ---------------------------------------------------------------------------
  // TESTE 7: RESPOSTA COM MEMÓRIA ESPECIFICANDO NOME ("o crea")
  // ---------------------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('>>> TESTE 7: Resposta com memória escolhendo por nome "o crea"');

  const res7 = await processarMensagemChat({
    mensagemUsuario: 'o crea',
    historicoRecente: historicoComAmbiguidade,
    contato,
    documentosDisponiveis: todosDocs,
  });

  console.log('Texto Resposta:', res7.textoResposta);
  console.log('Quantidade de Anexos:', res7.anexos?.length || 0);
  console.log('Anexos enviados:', res7.anexos?.map((a) => a.nome));

  if ((res7.anexos?.length || 0) !== 1 || !res7.textoResposta.toLowerCase().includes('crea')) {
    console.error('❌ FALHA NO TESTE 7: Deveria ter enviado apenas o Crea!');
    process.exitCode = 1;
  } else {
    console.log('✅ SUCESSO NO TESTE 7: Escolheu por nome "o crea" e enviou com sucesso!\n');
  }

  console.log('===============================================================');
  console.log('TODOS OS 7 TESTES CONCLUÍDOS COM 100% DE SUCESSO!');
  console.log('===============================================================');
}

rodarTestes().catch((e) => {
  console.error(e);
  process.exit(1);
});
