import { OpenAI, toFile } from 'openai';
import { EvolutionConfig } from './evolutionSenderService.js';
import { adicionarRegistroUsoIA } from '../storage.js';

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

/**
 * Identifica se a mensagem recebida é um áudio (audioMessage / PTT) e extrai seus metadados.
 */
export function extrairInfoAudio(evento: any): InfoAudioMensagem {
  const message = evento?.message;
  const audioMsg = message?.audioMessage || (evento?.messageType === 'audioMessage' ? message : null);

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
  const base64Direto = typeof audioMsg.base64 === 'string' && audioMsg.base64.trim().length > 10
    ? audioMsg.base64.trim()
    : typeof evento?.base64 === 'string' && evento.base64.trim().length > 10
    ? evento.base64.trim()
    : undefined;

  return {
    isAudio: true,
    duracaoSegundos,
    mimetype,
    tamanhoBytes,
    base64Direto,
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

  // Caminho 1: Base64 presente no payload do webhook
  if (info.base64Direto) {
    try {
      const base64Limpo = info.base64Direto.replace(/^data:[^;]+;base64,/, '').trim();
      const buffer = Buffer.from(base64Limpo, 'base64');
      if (buffer.length > 0) {
        console.log(`[Evolution Áudio 🎙️] Áudio extraído diretamente do payload do webhook em memória (${buffer.length} bytes, ~${info.duracaoSegundos}s).`);
        return {
          buffer,
          mimetype: info.mimetype || 'audio/ogg',
          duracaoSegundos: info.duracaoSegundos,
          tamanhoBytes: buffer.length,
          metodo: 'base64_payload',
        };
      }
    } catch (err: any) {
      console.warn('[Evolution Áudio ⚠️] Falha ao decodificar base64 presente no payload, tentando rota da API:', err?.message || err);
    }
  }

  // Caminho 2: Baixar mídia via endpoint oficial da Evolution API
  const urlDownload = `${config.apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instance)}`;
  console.log(`[Evolution Áudio 🌐] Baixando áudio da Evolution via endpoint oficial: ${urlDownload}`);

  const resposta = await fetch(urlDownload, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      message: evento.message,
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

  const modelo = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'whisper-1';

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

  const resposta = await openai.audio.transcriptions.create({
    file,
    model: modelo,
    language: 'pt',
  });

  const tempoMs = Date.now() - inicio;
  const textoTranscrito = (resposta?.text || '').trim();

  // Cálculo de custo: whisper-1 custa $0.006 por minuto ($0.0001 por segundo de áudio)
  const duracaoCalculo = duracaoSegundos > 0 ? duracaoSegundos : Math.max(5, Math.ceil(audioBuffer.length / 32000));
  const custoUsd = Number(((duracaoCalculo / 60) * 0.006).toFixed(6));

  console.log(
    `[OpenAI Transcrição ✅] Sucesso (${tempoMs} ms) | Duração: ${duracaoCalculo}s | Custo: $${custoUsd} | Texto: "${textoTranscrito.slice(0, 80)}${textoTranscrito.length > 80 ? '...' : ''}"`
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
