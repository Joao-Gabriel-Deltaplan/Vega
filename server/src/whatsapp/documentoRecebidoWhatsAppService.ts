import path from 'path';
import { EvolutionConfig, obterConfigEvolution } from './evolutionSenderService.js';
import { uploadArquivoStorage } from '../utils/storageUtils.js';
import { adicionarDocumento } from '../storage.js';
import { enfileirarProcessamentoDocumento } from '../processadorSegundoPlanoService.js';
import { DocumentoRegistro } from '../types.js';
import { UsuarioWhatsApp } from './types.js';
import { normalizarNumeroCanonica } from './usuarioWhatsAppService.js';

export const RESPOSTA_DOCUMENTO_SEM_PERMISSAO =
  'Você não tem permissão para enviar documentos para o Cofre da VEGA. Apenas administradores podem realizar o envio.';

export interface InfoDocumentoMensagem {
  isDocumento: boolean;
  isImagem: boolean;
  isNaoSuportado: boolean;
  tipoDetectado: string;
  nomeArquivo?: string;
  mimetype?: string;
  tamanhoBytes?: number;
  base64Direto?: string;
  campoBase64?: string;
  legenda?: string;
}

// Flag para inspecionar no terminal a estrutura completa do primeiro documento/mídia recebido
let primeiroDocumentoInspecionado = false;

/**
 * Registra no terminal a estrutura completa de campos do primeiro documento recebido
 * (sanitizando strings longas de base64 para não poluir o terminal).
 */
export function registrarInspecaoPrimeiroDocumento(evento: any, info: InfoDocumentoMensagem): void {
  if (primeiroDocumentoInspecionado) return;
  primeiroDocumentoInspecionado = true;

  try {
    console.log('\n================================================================');
    console.log('📄 [Evolution Webhook 🔬] PRIMEIRA MENSAGEM DE DOCUMENTO / MÍDIA RECEBIDA');
    console.log(`Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    console.log(`- messageType: ${evento?.messageType || '(não informado)'}`);
    console.log(`- Tipo detectado pelo parser: ${info.tipoDetectado}`);
    console.log(`- Nome do arquivo: ${info.nomeArquivo || '(não informado)'}`);
    console.log(`- Mimetype: ${info.mimetype || '(não informado)'}`);
    console.log(`- Tamanho bytes: ${info.tamanhoBytes || 0}`);
    console.log(
      `- Base64 no próprio evento: ${
        info.base64Direto
          ? `SIM (encontrado no campo "${info.campoBase64}", tamanho: ${info.base64Direto.length} chars)`
          : 'NÃO (necessário download via rota /chat/getBase64FromMediaMessage)'
      }`
    );

    function sanitizarRecursivo(obj: any, prof = 0): any {
      if (prof > 4) return '[...]';
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string') {
        if (obj.length > 80) {
          return `[STRING DE ${obj.length} CARACTERES - Ex: ${obj.slice(0, 30)}...]`;
        }
        return obj;
      }
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        return obj.map((it) => sanitizarRecursivo(it, prof + 1));
      }
      const res: Record<string, any> = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (k.toLowerCase().includes('base64') || k.toLowerCase().includes('media')) {
          res[k] = typeof v === 'string' ? `[BASE64 DE ${v.length} CARACTERES]` : v;
        } else {
          res[k] = sanitizarRecursivo(v, prof + 1);
        }
      }
      return res;
    }

    console.log('--- ESTRUTURA DOS CAMPOS DO EVENTO (RESUMO SEM BYTES) ---');
    console.log(JSON.stringify(sanitizarRecursivo(evento), null, 2));
    console.log('================================================================\n');
  } catch (err) {
    console.warn('[Evolution Webhook ⚠️] Erro ao registrar inspeção do primeiro documento:', err);
  }
}

/**
 * Registra no terminal toda mensagem cujo tipo não seja texto nem áudio,
 * garantindo que nada passe em silêncio.
 */
export function registrarLogMensagemNaoTexto(
  evento: any,
  info: InfoDocumentoMensagem,
  usuarioNome: string,
  tratada: boolean,
  detalheAcao: string
): void {
  const dataHora = new Date().toLocaleString('pt-BR');
  const messageType = evento?.messageType || info.tipoDetectado || 'desconhecido';
  const prefixo = tratada ? '📥 [Webhook WhatsApp - Mídia]' : '⚠️ [Webhook WhatsApp - Não Suportado]';

  console.log(
    `${prefixo} ${dataHora} | Remetente: "${usuarioNome}" | messageType: "${messageType}" | Tipo: "${info.tipoDetectado}" | Tratada: ${tratada ? 'SIM' : 'NÃO'} | ${detalheAcao}`
  );
}

/**
 * Desembrulha recursivamente mensagens aninhadas do Baileys/WhatsApp
 * (ephemeralMessage, viewOnceMessage, viewOnceMessageV2, documentWithCaptionMessage, etc.)
 */
export function desembrulharMensagem(msg: any): any {
  if (!msg || typeof msg !== 'object') return msg;
  let atual = msg;

  for (let i = 0; i < 5; i++) {
    if (atual?.ephemeralMessage?.message) {
      atual = atual.ephemeralMessage.message;
    } else if (atual?.viewOnceMessage?.message) {
      atual = atual.viewOnceMessage.message;
    } else if (atual?.viewOnceMessageV2?.message) {
      atual = atual.viewOnceMessageV2.message;
    } else if (atual?.viewOnceMessageV2Extension?.message) {
      atual = atual.viewOnceMessageV2Extension.message;
    } else if (atual?.documentWithCaptionMessage?.message) {
      atual = atual.documentWithCaptionMessage.message;
    } else if (atual?.message && typeof atual.message === 'object') {
      atual = atual.message;
    } else {
      break;
    }
  }

  return atual;
}

/**
 * Busca exaustiva por Base64 de documento ou imagem em todos os campos possíveis do payload
 */
export function localizarBase64DocumentoNoEvento(evento: any): { base64: string; campoEncontrado: string } | null {
  if (!evento) return null;

  const candidatos: Array<{ campo: string; valor: any }> = [
    { campo: 'message.documentMessage.base64', valor: evento?.message?.documentMessage?.base64 },
    { campo: 'message.imageMessage.base64', valor: evento?.message?.imageMessage?.base64 },
    { campo: 'message.base64', valor: evento?.message?.base64 },
    { campo: 'base64 (raiz)', valor: evento?.base64 },
    { campo: 'data.message.documentMessage.base64', valor: evento?.data?.message?.documentMessage?.base64 },
    { campo: 'data.message.imageMessage.base64', valor: evento?.data?.message?.imageMessage?.base64 },
    { campo: 'data.message.base64', valor: evento?.data?.message?.base64 },
    { campo: 'data.base64', valor: evento?.data?.base64 },
    { campo: 'documentMessage.base64', valor: evento?.documentMessage?.base64 },
    { campo: 'imageMessage.base64', valor: evento?.imageMessage?.base64 },
    { campo: 'media', valor: evento?.media },
    { campo: 'message.media', valor: evento?.message?.media },
    { campo: 'data.media', valor: evento?.data?.media },
  ];

  for (const c of candidatos) {
    if (typeof c.valor === 'string' && c.valor.trim().length > 15) {
      return {
        base64: c.valor.trim(),
        campoEncontrado: c.campo,
      };
    }
  }

  return null;
}

/**
 * Extrai informações completas e normalizadas de documentos, imagens e mídias do WhatsApp.
 * Suporta nativamente: PDF, JPG, JPEG, PNG, WEBP.
 * Detecta tipos não suportados (vídeos, stickers, planilhas/word não homologados, etc.).
 */
export function extrairInfoDocumentoWhatsApp(evento: any): InfoDocumentoMensagem {
  const messageRaw = evento?.message || evento?.data?.message;
  const msg = desembrulharMensagem(messageRaw) || {};
  const messageType = String(evento?.messageType || '').trim();

  const docMsg = msg.documentMessage || (messageType === 'documentMessage' ? msg : null);
  const imgMsg = msg.imageMessage || (messageType === 'imageMessage' ? msg : null);
  const videoMsg = msg.videoMessage || (messageType === 'videoMessage' ? msg : null);
  const stickerMsg = msg.stickerMessage || (messageType === 'stickerMessage' ? msg : null);
  const contactMsg = msg.contactMessage || msg.contactsArrayMessage || (messageType.includes('contact') ? msg : null);
  const locationMsg = msg.locationMessage || msg.liveLocationMessage || (messageType.includes('location') ? msg : null);

  const base64Localizado = localizarBase64DocumentoNoEvento(evento);

  // 1. Mensagem de Documento (PDF ou outros)
  if (docMsg) {
    const rawNome = docMsg.fileName || docMsg.title || `documento_${Date.now()}.pdf`;
    const mimetype = (docMsg.mimetype || 'application/pdf').toLowerCase().split(';')[0].trim();
    const tamanhoBytes = Number(docMsg.fileLength) || 0;
    const legenda = docMsg.caption || '';
    const ext = path.extname(rawNome).toLowerCase();

    const isPdf = mimetype === 'application/pdf' || ext === '.pdf';
    const isImgDoc = mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);

    if (isPdf || isImgDoc) {
      return {
        isDocumento: isPdf,
        isImagem: isImgDoc,
        isNaoSuportado: false,
        tipoDetectado: isPdf ? 'documento_pdf' : 'imagem',
        nomeArquivo: rawNome,
        mimetype,
        tamanhoBytes,
        base64Direto: base64Localizado?.base64,
        campoBase64: base64Localizado?.campoEncontrado,
        legenda,
      };
    } else {
      // Documento de formato não suportado (ex: .docx, .xlsx, .zip)
      return {
        isDocumento: false,
        isImagem: false,
        isNaoSuportado: true,
        tipoDetectado: `arquivo ${ext ? ext.toUpperCase() : mimetype}`,
        nomeArquivo: rawNome,
        mimetype,
        tamanhoBytes,
        legenda,
      };
    }
  }

  // 2. Mensagem de Imagem direta (Foto da câmera ou galeria)
  if (imgMsg) {
    const mimetype = (imgMsg.mimetype || 'image/jpeg').toLowerCase().split(';')[0].trim();
    const ext = mimetype.includes('png') ? '.png' : mimetype.includes('webp') ? '.webp' : '.jpeg';
    const rawNome = `foto_${Date.now()}${ext}`;
    const tamanhoBytes = Number(imgMsg.fileLength) || 0;
    const legenda = imgMsg.caption || '';

    return {
      isDocumento: false,
      isImagem: true,
      isNaoSuportado: false,
      tipoDetectado: 'imagem',
      nomeArquivo: rawNome,
      mimetype,
      tamanhoBytes,
      base64Direto: base64Localizado?.base64,
      campoBase64: base64Localizado?.campoEncontrado,
      legenda,
    };
  }

  // 3. Tipos conhecidos do WhatsApp não suportados pelo Cofre
  if (videoMsg) {
    return {
      isDocumento: false,
      isImagem: false,
      isNaoSuportado: true,
      tipoDetectado: 'vídeo',
    };
  }

  if (stickerMsg) {
    return {
      isDocumento: false,
      isImagem: false,
      isNaoSuportado: true,
      tipoDetectado: 'figurinha (sticker)',
    };
  }

  if (contactMsg) {
    return {
      isDocumento: false,
      isImagem: false,
      isNaoSuportado: true,
      tipoDetectado: 'cartão de contato',
    };
  }

  if (locationMsg) {
    return {
      isDocumento: false,
      isImagem: false,
      isNaoSuportado: true,
      tipoDetectado: 'localização',
    };
  }

  return {
    isDocumento: false,
    isImagem: false,
    isNaoSuportado: false,
    tipoDetectado: 'outro',
  };
}

/**
 * Baixa o buffer do documento a partir do evento (base64) ou da rota oficial da Evolution API
 */
export async function obterBufferDocumentoWhatsApp(
  evento: any,
  info: InfoDocumentoMensagem,
  config: EvolutionConfig | null
): Promise<{ buffer: Buffer; metodo: 'base64_payload' | 'api_download' }> {
  // Caminho 1: Base64 veio diretamente no evento do webhook
  if (info.base64Direto && info.base64Direto.length > 50) {
    const base64Limpo = info.base64Direto.replace(/^data:[^;]+;base64,/, '').trim();
    const buffer = Buffer.from(base64Limpo, 'base64');
    if (buffer.length > 0) {
      console.log(
        `[WhatsApp Documento 📄] Buffer obtido diretamente do payload via "${info.campoBase64 || 'base64'}" (${buffer.length} bytes).`
      );
      return { buffer, metodo: 'base64_payload' };
    }
  }

  // Caminho 2: Baixar via Evolution API endpoint oficial
  if (!config) {
    throw new Error(
      'Configuração da Evolution API (EVOLUTION_API_URL / EVOLUTION_INSTANCE) não encontrada e o base64 não veio no webhook.'
    );
  }

  const urlDownload = `${config.apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instance)}`;
  console.log(`[WhatsApp Documento 🌐] Baixando mídia da Evolution API via: ${urlDownload}`);

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
    throw new Error(`Falha no download da mídia na Evolution API (${resposta.status}): ${textoErro.slice(0, 200)}`);
  }

  const dados = await resposta.json().catch(() => null);
  const base64Recebido =
    dados?.base64 ||
    dados?.media ||
    dados?.data?.base64 ||
    dados?.data ||
    dados?.response?.base64 ||
    (typeof dados === 'string' ? dados : null);

  if (!base64Recebido || typeof base64Recebido !== 'string') {
    throw new Error('Evolution API não retornou base64 para a mídia.');
  }

  const base64Limpo = String(base64Recebido).replace(/^data:[^;]+;base64,/, '').trim();
  const buffer = Buffer.from(base64Limpo, 'base64');

  if (buffer.length === 0) {
    throw new Error('Buffer de documento baixado da Evolution API está vazio.');
  }

  console.log(`[WhatsApp Documento 📄] Documento baixado da Evolution API com sucesso (${buffer.length} bytes).`);
  return { buffer, metodo: 'api_download' };
}

/**
 * Salva o documento recebido pelo WhatsApp no Cofre e enfileira para processamento em segundo plano.
 * Apenas usuários com perfil admin têm permissão para enviar documentos.
 */
export async function processarDocumentoRecebidoWhatsApp(
  evento: any,
  info: InfoDocumentoMensagem,
  usuario: UsuarioWhatsApp,
  config: EvolutionConfig | null
): Promise<{ doc?: DocumentoRegistro; mensagemResposta: string; autorizado: boolean }> {
  // Ponto 5: Só perfil admin pode enviar documentos
  if (usuario.perfil !== 'admin') {
    console.warn(
      `[WhatsApp Documento 🚫] Usuário "${usuario.nome}" (${usuario.numero}) tentou enviar documento, mas perfil é "${usuario.perfil}". Recusado.`
    );
    return {
      autorizado: false,
      mensagemResposta: RESPOSTA_DOCUMENTO_SEM_PERMISSAO,
    };
  }

  const { buffer, metodo } = await obterBufferDocumentoWhatsApp(evento, info, config);
  const nomeOriginal = info.nomeArquivo || `documento_whatsapp_${Date.now()}.pdf`;
  const nomeSanitizado = path.basename(nomeOriginal);
  const conversaId = `wa-${normalizarNumeroCanonica(usuario.numero)}`;
  const remetenteJid = evento?.key?.remoteJid || `${usuario.numero}@s.whatsapp.net`;

  // 1. Upload imediato para o Supabase Storage
  const storagePath = await uploadArquivoStorage(nomeSanitizado, buffer, info.mimetype || 'application/pdf');

  // 2. Registro imediato na tabela documentos com status 'processando' e metadados de origem
  const novoDoc: DocumentoRegistro = {
    id: `doc-${Date.now()}`,
    titulo: nomeSanitizado.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '),
    arquivo: nomeSanitizado,
    tipo: '',
    titular: '',
    descricao: `Documento recebido via WhatsApp de ${usuario.nome}.`,
    apelidos: [nomeSanitizado.toLowerCase()],
    visibilidade: 'diretoria',
    tamanho: `${(buffer.length / 1024).toFixed(1)} KB`,
    dataCadastro: new Date().toLocaleDateString('pt-BR'),
    storagePath,
    statusIndexacao: 'processando',
    metadata: {
      origem: 'whatsapp',
      conversaId,
      remetenteNumero: usuario.numero,
      remetenteJid,
      remetenteNome: usuario.nome,
      metodoDownload: metodo,
    },
  };

  await adicionarDocumento(novoDoc);

  // 3. Enfileira para processamento assíncrono em segundo plano
  enfileirarProcessamentoDocumento(novoDoc.id);

  console.log(
    `[WhatsApp Documento 📥] Documento "${novoDoc.arquivo}" recebido de ${usuario.nome} (Método: ${metodo}) e enfileirado para processamento em segundo plano.`
  );

  return {
    autorizado: true,
    doc: novoDoc,
    mensagemResposta: `Recebi seu documento *${nomeSanitizado}*! Já foi salvo no Cofre e estou analisando com IA em segundo plano. Assim que terminar, te aviso aqui.`,
  };
}
