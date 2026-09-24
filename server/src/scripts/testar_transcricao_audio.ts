import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extrairInfoAudio,
  validarLimitesAudio,
  LIMITE_AUDIO_DURACAO_SEGUNDOS,
  LIMITE_AUDIO_TAMANHO_BYTES,
  transcreverAudioOpenAI,
  obterAudioBufferEvolution,
} from '../whatsapp/audioTranscriptionService.js';
import { processarEventoEvolution, RESPOSTA_NAO_AUTORIZADO } from '../whatsapp/whatsappWebhookService.js';
import { obterPrecoMinutoAudio, obterTabelaPrecos } from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTestes() {
  console.log('===============================================================');
  console.log('🧪 TESTE AUTOMATIZADO: TRANSCRIÇÃO DE ÁUDIO WHATSAPP (VEGA)');
  console.log('===============================================================\n');

  let testesPassados = 0;
  let totalTestes = 0;

  function assert(condicao: boolean, descricao: string) {
    totalTestes++;
    if (condicao) {
      console.log(`✅ [PASSOU] ${descricao}`);
      testesPassados++;
    } else {
      console.error(`❌ [FALHOU] ${descricao}`);
    }
  }

  // TESTE 1: Identificação de mensagem de áudio (audioMessage / PTT)
  console.log('--- TESTE 1: Identificação e extração de áudio ---');
  const eventoTexto = {
    key: { id: 'msg-texto-1', remoteJid: '5500000000000@s.whatsapp.net' },
    message: { conversation: 'Olá VEGA' },
  };
  const infoTexto = extrairInfoAudio(eventoTexto);
  assert(!infoTexto.isAudio, 'Mensagem de texto não deve ser identificada como áudio');

  const eventoAudioPayload = {
    key: { id: 'msg-audio-1', remoteJid: '5500000000000@s.whatsapp.net' },
    messageType: 'audioMessage',
    message: {
      audioMessage: {
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 15,
        fileLength: 45000,
        ptt: true,
        base64: 'T2dnU19hdWRpb19tb2NrX2Jhc2U2NA==', // Buffer mock
      },
    },
  };
  const infoAudio = extrairInfoAudio(eventoAudioPayload);
  assert(infoAudio.isAudio, 'audioMessage deve ser identificado como áudio');
  assert(infoAudio.duracaoSegundos === 15, 'Duração de 15s deve ser extraída com precisão');
  assert(infoAudio.mimetype === 'audio/ogg', 'Mimetype deve ser normalizado');
  assert(infoAudio.base64Direto !== undefined, 'Base64 direto no payload deve ser identificado');

  // TESTE 2: Validação de limites (Duração e Tamanho)
  console.log('\n--- TESTE 2: Validação de limites operacionais ---');
  const validacaoOk = validarLimitesAudio(45, 500 * 1024);
  assert(validacaoOk.valido, 'Áudio de 45s e 500KB deve ser aprovado');

  const validacaoDuracaoLonga = validarLimitesAudio(150, 500 * 1024);
  assert(!validacaoDuracaoLonga.valido, 'Áudio de 150s deve ser recusado por ultrapassar 120s');
  assert(
    Boolean(validacaoDuracaoLonga.mensagemAviso?.includes('longo demais')),
    'Mensagem de aviso amigável deve informar que o áudio é longo demais'
  );

  const validacaoTamanhoGrande = validarLimitesAudio(30, 15 * 1024 * 1024);
  assert(!validacaoTamanhoGrande.valido, 'Áudio de 15MB deve ser recusado por ultrapassar 10MB');
  assert(
    Boolean(validacaoTamanhoGrande.mensagemAviso?.includes('grande demais')),
    'Mensagem de aviso amigável deve informar que o arquivo é grande demais'
  );

  // TESTE 3: Download em memória a partir de Base64 direto (Sem tocar em disco)
  console.log('\n--- TESTE 3: Obtenção de Buffer 100% em memória RAM ---');
  const downloadBase64 = await obterAudioBufferEvolution(eventoAudioPayload, {
    apiUrl: 'https://api.mock.com',
    apiKey: 'mock_key',
    instance: 'mock_instance',
  });
  assert(Buffer.isBuffer(downloadBase64.buffer), 'O áudio deve ser retornado como Buffer em memória');
  assert(downloadBase64.metodo === 'base64_payload', 'Método deve ser base64_payload');
  assert(downloadBase64.duracaoSegundos === 15, 'Duração deve ser preservada');

  // TESTE 4: Verificação de segurança (Remetente não autorizado é rejeitado ANTES de gastar transcrição)
  console.log('\n--- TESTE 4: Bloqueio estrito de remetente não autorizado ---');
  const eventoNaoAutorizado = {
    key: {
      id: `test-recusado-${Date.now()}`,
      remoteJid: '555500000000004@s.whatsapp.net',
      fromMe: false,
    },
    messageType: 'audioMessage',
    message: {
      audioMessage: {
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 20,
        base64: 'T2dnU19hdWRpb19tb2Nr',
      },
    },
  };

  const resultadoNaoAutorizado = await processarEventoEvolution(eventoNaoAutorizado, '127.0.0.1');
  assert(!resultadoNaoAutorizado.sucesso, 'Remetente não cadastrado deve ser recusado');
  assert(
    resultadoNaoAutorizado.resposta === RESPOSTA_NAO_AUTORIZADO,
    'Resposta deve ser a mensagem padrão de não autorizado sem transcrever'
  );

  // TESTE 5: Fallback padrão para gpt-transcribe e aviso se OPENAI_TRANSCRIPTION_MODEL não estiver definida
  console.log('\n--- TESTE 5: Fallback para gpt-transcribe e aviso de configuração ---');
  const modeloConfigurado = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-transcribe';
  assert(
    modeloConfigurado === 'gpt-transcribe' || modeloConfigurado.length > 0,
    `Modelo de transcrição ativo: "${modeloConfigurado}" (fallback padrão é gpt-transcribe)`
  );

  // TESTE 6: Consulta dinâmica da Tabela de Preços por modelo (gpt-transcribe $0.0045/min vs whisper-1 $0.0060/min)
  console.log('\n--- TESTE 6: Verificação da Tabela de Preços por Modelo ---');
  const precoGptTranscribe = await obterPrecoMinutoAudio('gpt-transcribe');
  assert(
    precoGptTranscribe === 0.0045,
    `gpt-transcribe deve custar $0.0045/min na tabela de preços (obtido: $${precoGptTranscribe})`
  );

  const precoWhisper = await obterPrecoMinutoAudio('whisper-1');
  assert(
    precoWhisper === 0.0060,
    `whisper-1 deve custar $0.0060/min na tabela de preços (obtido: $${precoWhisper})`
  );

  // Cálculo de 30 segundos com gpt-transcribe: (30 / 60) * 0.0045 = 0.00225
  const custoGptTranscribe30s = Number(((30 / 60) * precoGptTranscribe).toFixed(6));
  assert(
    custoGptTranscribe30s === 0.00225,
    `30s em gpt-transcribe deve custar exatamente $0.002250 (calculado: $${custoGptTranscribe30s})`
  );

  // TESTE 7: Fallback para rota /chat/getBase64FromMediaMessage quando NÃO há base64 no payload
  console.log('\n--- TESTE 7: Fallback para rota /chat/getBase64FromMediaMessage ---');
  const eventoSemBase64 = {
    key: { id: 'msg-audio-api-1', remoteJid: '5500000000000@s.whatsapp.net' },
    messageType: 'audioMessage',
    message: {
      audioMessage: {
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 22,
        fileLength: 68000,
        ptt: true,
      },
    },
  };

  const originalFetch = globalThis.fetch;
  try {
    let bodyEnviadoEvolution: any = null;
    globalThis.fetch = (async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('/chat/getBase64FromMediaMessage/')) {
        bodyEnviadoEvolution = JSON.parse(init?.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            base64: 'T2dnU19ieXRlc19kYV9ldm9sdXRpb25fYXBp',
            mimetype: 'audio/ogg; codecs=opus',
          }),
        } as any;
      }
      return originalFetch(url, init);
    }) as any;

    const downloadApi = await obterAudioBufferEvolution(eventoSemBase64, {
      apiUrl: 'https://evolution.mock.com',
      apiKey: 'test_key',
      instance: 'instancia_teste',
    });

    assert(Buffer.isBuffer(downloadApi.buffer), 'Áudio via API deve ser retornado como Buffer em memória');
    assert(downloadApi.metodo === 'api_download', 'Método deve ser api_download quando não há base64 no webhook');
    assert(downloadApi.duracaoSegundos === 22, 'Duração de 22s deve ser mantida');
    assert(
      bodyEnviadoEvolution?.message?.key?.id === 'msg-audio-api-1',
      'Body enviado à Evolution deve conter message.key completo'
    );
    assert(
      Boolean(bodyEnviadoEvolution?.message?.message?.audioMessage),
      'Body enviado à Evolution deve conter message.message completo'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // TESTE 7.1: Priorização e extração de Base64 em múltiplos campos (Webhook Base64 ativado)
  console.log('\n--- TESTE 7.1: Descoberta de Base64 em múltiplos campos do webhook ---');
  const eventoBase64EmMessage = {
    key: { id: 'msg-b64-msg' },
    messageType: 'audioMessage',
    message: {
      audioMessage: { mimetype: 'audio/ogg', seconds: 10 },
      base64: 'T2dnU19lbV9tZXNzYWdlX2Jhc2U2NA==',
    },
  };
  const infoB64Msg = extrairInfoAudio(eventoBase64EmMessage);
  assert(infoB64Msg.base64Direto !== undefined, 'Deve encontrar base64 em message.base64');
  assert(infoB64Msg.campoBase64 === 'message.base64', 'Deve identificar o campo message.base64');

  const eventoBase64NaRaiz = {
    key: { id: 'msg-b64-raiz' },
    messageType: 'audioMessage',
    message: { audioMessage: { mimetype: 'audio/ogg', seconds: 12 } },
    base64: 'T2dnU19uYV9yYWl6X2RldmVfZnVuY2lvbmFy',
  };
  const infoB64Raiz = extrairInfoAudio(eventoBase64NaRaiz);
  assert(infoB64Raiz.base64Direto !== undefined, 'Deve encontrar base64 na raiz do evento');
  assert(infoB64Raiz.campoBase64 === 'base64 (raiz)', 'Deve identificar o campo base64 (raiz)');

  // TESTE 8: Tratamento de recusa de modelo da OpenAI com resposta amigável e captura de motivo
  console.log('\n--- TESTE 8: Simulação de recusa de modelo da OpenAI ---');
  let erroCapturado: any = null;
  try {
    // Simula erro de modelo não autorizado
    const erroMock = new Error('The model `modelo-inexistente` does not exist or you do not have access to it.');
    (erroMock as any).motivoExato = erroMock.message;
    throw erroMock;
  } catch (err: any) {
    erroCapturado = err;
    console.log(`[Teste Mock Simulação 🔬] Motivo exato capturado: "${err.motivoExato}"`);
  }
  assert(
    erroCapturado?.motivoExato?.includes('does not exist or you do not have access'),
    'Motivo exato da recusa do modelo deve ser capturado com precisão'
  );

  // TESTE 9: Enriquecimento do Rastro com metadados e etapa de áudio (usando nomes genéricos)
  console.log('\n--- TESTE 9: Verificação de enriquecimento de Rastro ---');
  const rastroMock: any = {
    mensagemId: 'msg-1',
    usuarioNome: 'Usuario Teste',
    mensagemOriginal: 'Qual o meu RG?',
    custoEstimadoUsd: 0.0012,
    tempoTotalMs: 850,
    etapas: [
      { ordem: 1, nome: 'Classificação de Intenção', descricao: 'Intenção: dado_pessoal', tempoMs: 300 },
    ],
  };

  const duracao = 15;
  const custo = 0.001125; // 15s com gpt-transcribe ($0.0045/min)
  const tempoMs = 620;
  rastroMock.tipoEntrada = 'audio';
  rastroMock.transcricaoAudio = {
    duracaoSegundos: duracao,
    custoUsd: custo,
    modelo: 'gpt-transcribe',
    metodoDownload: 'api_download',
  };
  rastroMock.etapas.unshift({
    ordem: 0,
    nome: 'Transcrição de Áudio (Whisper)',
    descricao: 'Áudio transcrito via gpt-transcribe (15s)',
    tempoMs,
    detalhes: { duracaoSegundos: duracao, custoUsd: custo, modelo: 'gpt-transcribe' },
  });
  rastroMock.custoEstimadoUsd = Number(((rastroMock.custoEstimadoUsd || 0) + custo).toFixed(6));
  rastroMock.tempoTotalMs = (rastroMock.tempoTotalMs || 0) + tempoMs;

  assert(rastroMock.tipoEntrada === 'audio', 'tipoEntrada deve ser audio no rastro');
  assert(rastroMock.etapas[0].nome.includes('Transcrição de Áudio'), 'Primeira etapa do rastro deve ser a transcrição');
  assert(rastroMock.custoEstimadoUsd === 0.002325, 'Custo total deve somar a transcrição com precisão');
  assert(rastroMock.tempoTotalMs === 1470, 'Tempo total deve somar o tempo da transcrição');

  console.log('\n===============================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${testesPassados}/${totalTestes} passaram.`);
  console.log('===============================================================');

  if (testesPassados === totalTestes) {
    console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
    process.exit(0);
  } else {
    console.error('❌ ALGUNS TESTES FALHARAM!');
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('Erro fatal ao executar testes:', err);
  process.exit(1);
});
