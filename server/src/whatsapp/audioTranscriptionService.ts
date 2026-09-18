import { OpenAI, toFile } from 'openai';
import { EvolutionConfig } from './evolutionSenderService.js';
import { adicionarRegistroUsoIA, obterPrecoMinutoAudio } from '../storage.js';

/**
 * Limites operacionais para mensagens de áudio
 */
export const LIMITE_AUDIO_DURACAO_SEGUNDOS = 120; // 2 minutos
export const LIMITE_AUDIO_TAMANHO_BYTES = 10 * 1024 * 1024; // 10 MB

export interface InfoAudioMensagem {
  isAudio: boolean;
  duracaoSegundos: number;
  mimetype: string;
  tamanhoBytes?: number;
  base64Direto?: string;
  campoBase64?: string;
}

export interface ResultadoDownloadAudio {
  buffer: Buffer;
  mimetype: string;
  duracaoSegundos: number;
  tamanhoBytes: number;
  metodo: 'base64_payload' | 'api_download';
}

export interface ResultadoTranscricaoAudio {
  texto: string;
  duracaoSegundos: number;
  custoUsd: number;
  modelo: string;
  tempoMs: number;
}

// Flag para registrar a estrutura do primeiro áudio no terminal
let primeiroAudioInspecionado = false;

/**
 * Registra no terminal a estrutura de campos do primeiro áudio recebido (sem imprimir os bytes de base64).
 * Permite ao operador auditar em qual campo exato o áudio está chegando.
 */
export function registrarInspecaoPrimeiroAudio(evento: any): void {
  if (primeiroAudioInspecionado) return;
  primeiroAudioInspecionado = true;

  try {
    const info = extrairInfoAudio(evento);
    console.log('\n================================================================');
    console.log('🎙️ [Evolution Webhook 🔬] PRIMEIRA MENSAGEM DE ÁUDIO RECEBIDA (INSPEÇÃO)');
    console.log(`Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    console.log(`- messageType: ${evento?.messageType || '(não informado)'}`);
    console.log(`- Duração detectada: ${info.duracaoSegundos} segundos`);
    console.log(`- Mimetype: ${info.mimetype || '(não informado)'}`);
    console.log(
      `- Base64 no próprio evento: ${
        info.base64Direto
          ? `SIM (encontrado no campo: "${info.campoBase64}", tamanho: ${info.base64Direto.length} caracteres)`
          : 'NÃO (será necessário download via endpoint oficial)'
      }`
    );

    // Sanitizador recursivo para inspecionar hierarquia sem despejar base64 gigante no terminal
    function sanitizarEstrutura(obj: any, profundidade = 0): any {
      if (profundidade > 4) return '[...]';
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string') {
        if (obj.length > 80) {
          return `[STRING DE ${obj.length} CARACTERES - Ex: ${obj.slice(0, 25)}...]`;
        }
        return obj;
      }
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        return obj.map((it) => sanitizarEstrutura(it, profundidade + 1));
      }
      const resultado: Record<string, any> = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (k.toLowerCase().includes('base64') || k.toLowerCase().includes('media')) {
          resultado[k] =
            typeof v === 'string'
              ? `[BASE64 DE ${v.length} CARACTERES]`
              : (v ? `[OBJETO ${typeof v}]` : v);
        } else {
          resultado[k] = sanitizarEstrutura(v, profundidade + 1);
        }
      }
      return resultado;
    }

    console.log('--- ESTRUTURA DOS CAMPOS DO EVENTO (RESUMO SEM BYTES) ---');
    console.log(JSON.stringify(sanitizarEstrutura(evento), null, 2));
    console.log('================================================================\n');
  } catch (err) {
    console.warn('[Evolution Webhook ⚠️] Erro ao registrar inspeção do primeiro áudio:', err);
  }
}

/**
 * Busca exaustiva por Base64 de áudio em todos os campos possíveis gerados pela Evolution API
 * (com Webhook Base64 ativado).
 */
export function localizarBase64AudioNoEvento(evento: any): { base64: string; campoEncontrado: string } | null {
  if (!evento) return null;

  const candidatos: Array<{ campo: string; valor: any }> = [
    { campo: 'message.audioMessage.base64', valor: evento?.message?.audioMessage?.base64 },
    { campo: 'message.base64', valor: evento?.message?.base64 },
    { campo: 'base64 (raiz)', valor: evento?.base64 },
    { campo: 'data.message.audioMessage.base64', valor: evento?.data?.message?.audioMessage?.base64 },
    { campo: 'data.message.base64', valor: evento?.data?.message?.base64 },
    { campo: 'data.base64', valor: evento?.data?.base64 },
    { campo: 'audioMessage.base64', valor: evento?.audioMessage?.base64 },
    { campo: 'message.ephemeralMessage.message.audioMessage.base64', valor: evento?.message?.ephemeralMessage?.message?.audioMessage?.base64 },
    { campo: 'message.viewOnceMessage.message.audioMessage.base64', valor: evento?.message?.viewOnceMessage?.message?.audioMessage?.base64 },
    { campo: 'message.viewOnceMessageV2.message.audioMessage.base64', valor: evento?.message?.viewOnceMessageV2?.message?.audioMessage?.base64 },
    { campo: 'media', valor: evento?.media },
    { campo: 'message.media', valor: evento?.message?.media },
  ];

  for (const c of candidatos) {
    if (typeof c.valor === 'string' && c.valor.trim().length > 10) {
      return {
        base64: c.valor.trim(),
        campoEncontrado: c.campo,
      };
    }
  }

  return null;
}

/**
 * Identifica se a mensagem recebida é um áudio (audioMessage / PTT) e extrai seus metadados.
 */
export function extrairInfoAudio(evento: any): InfoAudioMensagem {
  const message = evento?.message;
  const audioMsg =
    message?.audioMessage ||
    message?.ephemeralMessage?.message?.audioMessage ||
    message?.viewOnceMessage?.message?.audioMessage ||
    message?.viewOnceMessageV2?.message?.audioMessage ||
    (evento?.messageType === 'audioMessage' ? message : null) ||
    evento?.audioMessage;

  if (!audioMsg) {
    return {
      isAudio: false,
      duracaoSegundos: 0,
      mimetype: '',
    };
  }

  const duracaoSegundos = Math.round(Number(audioMsg.seconds) || 0);
  const mimetype = (audioMsg.mimetype || 'audio/ogg; codecs=opus').split(';')[0].trim();
  const tamanhoBytes = Number(audioMsg.fileLength) || 0;

  const base64Localizado = localizarBase64AudioNoEvento(evento);

  return {
    isAudio: true,
    duracaoSegundos,
    mimetype,
    tamanhoBytes,
    base64Direto: base64Localizado?.base64,
    campoBase64: base64Localizado?.campoEncontrado,
  };
}

/**
 * Valida se o áudio está dentro dos limites aceitos de duração e tamanho.
 */
export function validarLimitesAudio(
  duracaoSegundos: number,
  tamanhoBytes: number
): { valido: boolean; motivo?: 'duracao_excedida' | 'tamanho_excedido'; mensagemAviso?: string } {
  if (duracaoSegundos > LIMITE_AUDIO_DURACAO_SEGUNDOS) {
    return {
      valido: false,
      motivo: 'duracao_excedida',
      mensagemAviso: `O áudio enviado é longo demais (${duracaoSegundos}s). O limite aceito é de ${LIMITE_AUDIO_DURACAO_SEGUNDOS} segundos (2 minutos). Por favor, envie um áudio mais curto ou digite sua mensagem.`,
    };
  }

  if (tamanhoBytes > LIMITE_AUDIO_TAMANHO_BYTES) {
    const tamanhoMb = (tamanhoBytes / (1024 * 1024)).toFixed(1);
    return {
      valido: false,
      motivo: 'tamanho_excedido',
      mensagemAviso: `O arquivo de áudio é grande demais (${tamanhoMb} MB). O limite aceito é de 10 MB. Por favor, envie um áudio mais curto ou digite sua mensagem.`,
    };
  }

  return { valido: true };
}

/**
 * Obtém o Buffer do áudio 100% em memória RAM:
 * 1. Primeiro caminho (preferencial): Se o base64 já veio no payload do webhook, decodifica diretamente.
 * 2. Segundo caminho (fallback): Faz requisição à rota oficial da Evolution API (/chat/getBase64FromMediaMessage/{instance}).
 */
export async function obterAudioBufferEvolution(
  evento: any,
  config: EvolutionConfig
): Promise<ResultadoDownloadAudio> {
  const info = extrairInfoAudio(evento);
  if (!info.isAudio) {
    throw new Error('O evento recebido não contém mensagem de áudio válida.');
  }

  // Caminho 1 (PRIORITÁRIO): Base64 presente no próprio evento do webhook (opção Webhook Base64 ativada)
  if (info.base64Direto) {
    try {
      const base64Limpo = info.base64Direto.replace(/^data:[^;]+;base64,/, '').trim();
      const buffer = Buffer.from(base64Limpo, 'base64');
      if (buffer.length > 0) {
        console.log(
          `[Evolution Áudio 🎙️] Áudio extraído diretamente do payload do webhook via campo "${info.campoBase64 || 'base64'}" (${buffer.length} bytes, ~${info.duracaoSegundos}s).`
        );
        return {
          buffer,
          mimetype: info.mimetype || 'audio/ogg',
          duracaoSegundos: info.duracaoSegundos,
          tamanhoBytes: buffer.length,
          metodo: 'base64_payload',
        };
      }
    } catch (err: any) {
      console.warn(
        `[Evolution Áudio ⚠️] Falha ao decodificar base64 presente no campo "${info.campoBase64}", tentando rota de download da API:`,
        err?.message || err
      );
    }
  }

  // Caminho 2 (FALLBACK): Baixar mídia via endpoint oficial da Evolution API v2
  // A Evolution API v2 espera o objeto completo da mensagem com key e message dentro de "message"
  const urlDownload = `${config.apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instance)}`;
  console.log(`[Evolution Áudio 🌐] Base64 não veio no webhook. Baixando da Evolution API via: ${urlDownload}`);

  const messagePayload = {
    key: evento.key,
    message: evento.message,
    messageTimestamp: evento.messageTimestamp || Math.floor(Date.now() / 1000),
    pushName: evento.pushName,
    status: evento.status,
  };

  const resposta = await fetch(urlDownload, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      message: messagePayload,
      convertToMp4: false,
    }),
  });

  if (!resposta.ok) {
    const textoErro = await resposta.text().catch(() => '');
    throw new Error(
      `Falha na requisição de download de áudio na Evolution (HTTP ${resposta.status}): ${textoErro.slice(0, 200)}`
    );
  }

  const dados = await resposta.json().catch(() => null);
  const base64Recebido =
    dados?.base64 ||
    dados?.media ||
    dados?.data ||
    (typeof dados === 'string' ? dados : null);

  if (!base64Recebido || typeof base64Recebido !== 'string') {
    throw new Error('A Evolution API não retornou o conteúdo em Base64 para a mensagem de áudio.');
  }

  const base64Limpo = base64Recebido.replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(base64Limpo, 'base64');

  if (buffer.length === 0) {
    throw new Error('O buffer do áudio baixado da Evolution API está vazio.');
  }

  console.log(
    `[Evolution Áudio 🎙️] Áudio baixado com sucesso da rota oficial da Evolution (${buffer.length} bytes, ~${info.duracaoSegundos}s).`
  );

  return {
    buffer,
    mimetype: dados?.mimetype || info.mimetype || 'audio/ogg',
    duracaoSegundos: info.duracaoSegundos,
    tamanhoBytes: buffer.length,
    metodo: 'api_download',
  };
}

/**
 * Transcreve um áudio em memória RAM utilizando a API da OpenAI (Whisper).
 * Não grava nada em disco.
 * Calcula o custo da transcrição ($0.006 por minuto) e registra na telemetria de uso da IA.
 */
export async function transcreverAudioOpenAI(
  audioBuffer: Buffer,
  mimetype: string,
  duracaoSegundos: number,
  contatoId: string = 'whatsapp',
  contatoNome?: string
): Promise<ResultadoTranscricaoAudio> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === 'sua_chave_aqui' || apiKey.length < 10) {
    throw new Error('OPENAI_API_KEY ausente ou inválida para transcrição de áudio.');
  }

  const modeloConfigurado = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim();
  if (!modeloConfigurado) {
    console.warn(
      '[OpenAI Transcrição ⚠️] Variável OPENAI_TRANSCRIPTION_MODEL não definida no .env/Railway. Utilizando fallback padrão "gpt-transcribe".'
    );
  }
  const modelo = modeloConfigurado || 'gpt-transcribe';

  // Determina nome de arquivo virtual e mimetype adequado
  let nomeArquivoVirtual = 'audio.ogg';
  let mimeNormalizado = mimetype || 'audio/ogg';

  if (mimeNormalizado.includes('mp4') || mimeNormalizado.includes('m4a')) {
    nomeArquivoVirtual = 'audio.mp4';
    mimeNormalizado = 'audio/mp4';
  } else if (mimeNormalizado.includes('mpeg') || mimeNormalizado.includes('mp3')) {
    nomeArquivoVirtual = 'audio.mp3';
    mimeNormalizado = 'audio/mpeg';
  } else if (mimeNormalizado.includes('wav')) {
    nomeArquivoVirtual = 'audio.wav';
    mimeNormalizado = 'audio/wav';
  } else {
    nomeArquivoVirtual = 'audio.ogg';
    mimeNormalizado = 'audio/ogg';
  }

  const openai = new OpenAI({ apiKey });
  const inicio = Date.now();

  // Converte o Buffer de memória para o formato aceito pelo SDK oficial da OpenAI sem salvar em disco
  const file = await toFile(audioBuffer, nomeArquivoVirtual, { type: mimeNormalizado });

  console.log(`[OpenAI Transcrição 🎙️] Enviando áudio em memória para o modelo "${modelo}" (tamanho: ${audioBuffer.length} bytes)...`);

  let resposta: any;
  try {
    resposta = await openai.audio.transcriptions.create({
      file,
      model: modelo,
      language: 'pt',
    });
  } catch (err: any) {
    const motivoExato =
      err?.message ||
      err?.error?.message ||
      (typeof err === 'object' ? JSON.stringify(err) : String(err));

    console.error(
      `[OpenAI Transcrição ❌] A OpenAI recusou o modelo ou falhou ao transcrever (modelo "${modelo}"):`,
      motivoExato
    );

    const erroRecusa = new Error(
      `A OpenAI recusou o modelo "${modelo}" ou não conseguiu processar o áudio: ${motivoExato}`
    );
    (erroRecusa as any).motivoExato = motivoExato;
    (erroRecusa as any).modeloRecusado = true;
    throw erroRecusa;
  }

  const tempoMs = Date.now() - inicio;
  const textoTranscrito = (resposta?.text || '').trim();

  // Cálculo de custo dinâmico via tabela de preços por modelo (ex: gpt-transcribe $0.0045/min, whisper-1 $0.006/min)
  const precoMinuto = await obterPrecoMinutoAudio(modelo);
  const duracaoCalculo = duracaoSegundos > 0 ? duracaoSegundos : Math.max(5, Math.ceil(audioBuffer.length / 32000));
  const custoUsd = Number(((duracaoCalculo / 60) * precoMinuto).toFixed(6));

  console.log(
    `[OpenAI Transcrição ✅] Sucesso (${tempoMs} ms) | Modelo: "${modelo}" ($${precoMinuto}/min) | Duração: ${duracaoCalculo}s | Custo: $${custoUsd} | Texto: "${textoTranscrito.slice(0, 80)}${textoTranscrito.length > 80 ? '...' : ''}"`
  );

  // Registra na telemetria de uso da IA
  try {
    await adicionarRegistroUsoIA({
      id: `ia-audio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      data: new Date().toISOString(),
      provedor: 'openai',
      modelo,
      contatoId,
      contatoNome,
      motivo: 'transcricao_audio',
      tokensEntrada: 0,
      tokensSaida: Math.ceil(textoTranscrito.length / 4),
      custoEstimado: custoUsd,
      sucesso: true,
      erro: null,
      estimado: false,
    });
  } catch (err: any) {
    console.warn('[OpenAI Transcrição ⚠️] Falha ao registrar telemetria de uso da IA:', err?.message || err);
  }

  return {
    texto: textoTranscrito,
    duracaoSegundos: duracaoCalculo,
    custoUsd,
    modelo,
    tempoMs,
  };
}
