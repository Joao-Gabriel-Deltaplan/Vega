import { Request, Response } from 'express';
import {
  EvolutionWebhookPayload,
  ResultadoProcessamentoWebhook,
  UsuarioWhatsApp,
} from './types.js';
import {
  buscarUsuarioPorNumero,
  buscarUsuarioPorTelefone,
  buscarUsuarioPorLid,
  normalizarNumeroCanonica,
  normalizarLid,
} from './usuarioWhatsAppService.js';
import { enviarRespostaCompletaWhatsApp, enviarTextoEvolution, obterConfigEvolution } from './evolutionSenderService.js';
import {
  extrairInfoAudio,
  obterAudioBufferEvolution,
  transcreverAudioOpenAI,
  validarLimitesAudio,
  registrarInspecaoPrimeiroAudio,
} from './audioTranscriptionService.js';
import { corrigirTranscricaoFonetica } from './correcaoTranscricaoService.js';
import {
  extrairInfoDocumentoWhatsApp,
  processarDocumentoRecebidoWhatsApp,
  registrarInspecaoPrimeiroDocumento,
  registrarLogMensagemNaoTexto,
} from './documentoRecebidoWhatsAppService.js';
import {
  buscarPendenciaAtivaWhatsApp,
  processarRespostaPendenciaWhatsApp,
} from './pendenciasWhatsAppService.js';
import {
  adicionarMensagemAoAgrupador,
  notificarPresencaUsuarioNoAgrupador,
  notificarMensagemEmPreparo,
  concluirMensagemEmPreparo,
} from './agrupadorMensagensService.js';
import {
  obterConversaPorId,
  salvarConversa,
  adicionarMensagem,
  obterDocumentosPorNivelAcesso,
} from '../storage.js';
import { processarMensagemChat, sanitizarRespostaTextoFinal } from '../chat/chatOrquestrador.js';
import { salvarRastro } from '../rastros/rastroService.js';
import { Contato, Mensagem, RastroRegistro, NivelAcesso, SetorUsuario, Anexo, Conversa } from '../types.js';
import { ASSISTENTE } from '../config/assistente.js';
import { eventosPainel } from '../eventos/eventosService.js';
import { salvarAudioOriginalStorage } from './audioStorageService.js';
import { formatarHorarioBrasilia, obterAgoraIsoUtc } from '../utils/dataHoraUtils.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

// Cache em memória para deduplicação de mensagens recebidas
// Mapeia key.id -> timestamp de recebimento
const cacheMensagensProcessadas = new Map<string, number>();
const TTL_DEDUPLICACAO_MS = 10 * 60 * 1000; // 10 minutos

// Flag para registrar no terminal a inspeção completa da 1ª mensagem recebida
let primeiraMensagemInspecionada = false;

/**
 * Registra a estrutura do evento recebido no terminal na primeira mensagem,
 * permitindo ao operador conferir em qual campo o número real do WhatsApp está chegando.
 */
function registrarInspecaoPrimeiraMensagem(evento: any): void {
  if (primeiraMensagemInspecionada) return;
  primeiraMensagemInspecionada = true;

  try {
    const key = evento?.key || {};
    console.log('\n================================================================');
    console.log('🔍 [Evolution Webhook 🔬] PRIMEIRA MENSAGEM RECEBIDA (INSPEÇÃO DE CAMPOS)');
    console.log(`Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
    console.log('--- CAMPOS DE IDENTIFICAÇÃO DO REMETENTE ---');
    console.log(`- key.remoteJid: ${key.remoteJid || '(não informado)'}`);
    console.log(`- key.participant: ${key.participant || '(não informado)'}`);
    console.log(`- key.senderPn: ${key.senderPn || '(não informado)'}`);
    console.log(`- key.participantPn: ${key.participantPn || '(não informado)'}`);
    console.log(`- key.remoteJidAlt: ${key.remoteJidAlt || '(não informado)'}`);
    console.log(`- key.previousRemoteJid: ${key.previousRemoteJid || '(não informado)'}`);
    console.log(`- evento.senderPn: ${evento?.senderPn || '(não informado)'}`);
    console.log(`- evento.participantPn: ${evento?.participantPn || '(não informado)'}`);
    console.log(`- evento.sender: ${evento?.sender || '(não informado)'}`);
    console.log(`- evento.participant: ${evento?.participant || '(não informado)'}`);
    console.log(`- evento.owner: ${evento?.owner || '(não informado)'}`);
    console.log(`- evento.pushName: ${evento?.pushName || '(não informado)'}`);
    console.log(`- evento.messageType: ${evento?.messageType || '(não informado)'}`);
    console.log('--- ESTRUTURA DO EVENTO (RESUMO SEM DADOS SENSÍVEIS) ---');
    console.log(
      JSON.stringify(
        {
          event: evento?.event,
          instance: evento?.instance,
          key: evento?.key,
          pushName: evento?.pushName,
          senderPn: evento?.senderPn,
          participantPn: evento?.participantPn,
          sender: evento?.sender,
          remoteJidAlt: evento?.remoteJidAlt,
          messageType: evento?.messageType,
        },
        null,
        2
      )
    );
    console.log('================================================================\n');
  } catch (err) {
    console.warn('[Evolution Webhook ⚠️] Erro ao registrar inspeção do evento:', err);
  }
}

/**
 * Limpa periodicamente chaves expiradas do cache de deduplicação
 */
function limparCacheDeduplicacao(): void {
  const agora = Date.now();
  for (const [keyId, timestamp] of cacheMensagensProcessadas.entries()) {
    if (agora - timestamp > TTL_DEDUPLICACAO_MS) {
      cacheMensagensProcessadas.delete(keyId);
    }
  }
}

/**
 * Valida o token de segurança do webhook vindo da Evolution API
 * Retorna true se autenticado com sucesso, false caso contrário.
 * Se recusado, registra data/hora e origem no terminal sem expor o token.
 */
export function validarTokenWebhook(req: Request): boolean {
  const tokenEsperado = process.env.WEBHOOK_TOKEN?.trim();

  // Se não houver token configurado no .env, recusa preventivamente por segurança
  if (!tokenEsperado) {
    const dataHora = new Date().toLocaleString('pt-BR');
    const origem = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecida';
    console.warn(`[Webhook WhatsApp ⚠️] Tentativa recusada em ${dataHora} | Origem: ${origem} | Motivo: WEBHOOK_TOKEN não configurado no .env.`);
    return false;
  }

  // Busca o token em headers usuais da Evolution API ou query parameter
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim();
  const tokenRecebido =
    (req.headers['x-webhook-token'] as string) ||
    (req.headers['apikey'] as string) ||
    (req.headers['token'] as string) ||
    bearerToken ||
    (req.query.token as string);

  if (!tokenRecebido || tokenRecebido !== tokenEsperado) {
    const dataHora = new Date().toLocaleString('pt-BR');
    const origem = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecida';
    console.warn(`[Webhook WhatsApp ⚠️] Tentativa recusada em ${dataHora} | Origem: ${origem} | Motivo: Token ausente ou inválido.`);
    return false;
  }

  return true;
}

/**
 * Extrai a lista de dados de mensagens a partir do payload recebido da Evolution API
 */
export function extrairDadosEvento(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === 'object') return [payload.data];
  if (payload.key) return [payload]; // Payload direto sem wrapper data
  return [];
}

/**
 * Extrai o texto da mensagem a partir da estrutura da Evolution API / Baileys
 */
export function extrairTextoMensagem(mensagemObj: any): string {
  if (!mensagemObj) return '';
  if (typeof mensagemObj === 'string') return mensagemObj;

  return (
    mensagemObj.conversation ||
    mensagemObj.extendedTextMessage?.text ||
    mensagemObj.imageMessage?.caption ||
    mensagemObj.documentMessage?.caption ||
    mensagemObj.videoMessage?.caption ||
    ''
  ).trim();
}

/**
 * Extrai o texto da mensagem citada (reply) na estrutura da Evolution API / Baileys
 */
export function extrairMensagemCitada(mensagemObj: any): string | null {
  if (!mensagemObj) return null;
  const contextInfo =
    mensagemObj.extendedTextMessage?.contextInfo ||
    mensagemObj.imageMessage?.contextInfo ||
    mensagemObj.documentMessage?.contextInfo ||
    mensagemObj.videoMessage?.contextInfo ||
    mensagemObj.audioMessage?.contextInfo;

  if (!contextInfo || !contextInfo.quotedMessage) return null;
  const texto = extrairTextoMensagem(contextInfo.quotedMessage);
  return texto ? texto.trim() : null;
}

/**
 * Resposta fixa para remetentes não autorizados
 */
export const RESPOSTA_NAO_AUTORIZADO = 'Este número não tem acesso à VEGA.';

/**
 * Garante que a conversa do WhatsApp exista no Supabase
 */
export async function garantirConversaWhatsApp(conversaId: string, contato: Contato): Promise<Conversa> {
  let conversa = await obterConversaPorId(conversaId);
  if (!conversa) {
    conversa = {
      id: conversaId,
      contato,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    };
    await salvarConversa(conversa);
  } else {
    conversa.contato = contato;
  }
  return conversa;
}

/**
 * Adiciona mensagem à conversa e notifica o painel web em tempo real via SSE
 */
export async function registrarMensagemETransmitir(conversaId: string, msg: Mensagem): Promise<Conversa | null> {
  const conversaAtualizada = await adicionarMensagem(conversaId, msg);
  if (conversaAtualizada) {
    eventosPainel.emitirNovaMensagem(conversaId, msg, conversaAtualizada);
  }
  return conversaAtualizada;
}

/**
 * Processa um evento individual recebido do webhook da Evolution API
 */
export async function processarEventoEvolution(
  evento: any,
  ipOrigem: string = 'desconhecida'
): Promise<ResultadoProcessamentoWebhook> {
  const timestampRecebimentoWebhook = Date.now();
  limparCacheDeduplicacao();

  const key = evento?.key;
  if (!key) {
    return {
      sucesso: false,
      status: 'ignorado',
      motivo: 'evento_sem_chave_de_mensagem',
    };
  }

  const mensagemId = key.id;
  const fromMe = Boolean(key.fromMe);
  const remoteJid = key.remoteJid || '';

  // 1. DEDUPLICAÇÃO & FILTRO DE MENSAGENS PRÓPRIAS
  if (fromMe) {
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'mensagem_propria_from_me',
      mensagemId,
    };
  }

  if (mensagemId) {
    if (cacheMensagensProcessadas.has(mensagemId)) {
      console.log(`[Webhook WhatsApp 🔁] Evento duplicado ignorado (key.id: ${mensagemId})`);
      return {
        sucesso: true,
        status: 'ignorado',
        motivo: 'mensagem_duplicada',
        mensagemId,
      };
    }
    // Registra no cache de deduplicação
    cacheMensagensProcessadas.set(mensagemId, Date.now());
  }

  // 1.1 FILTRO SILENCIOSO DE EVENTOS TÉCNICOS / CONTROLE / SEM CONTEÚDO PARA O USUÁRIO
  const msgTypeBruto = String(evento?.messageType || '').trim();
  const eventosTecnicosIgnorados = [
    'protocolmessage',
    'senderkeydistributionmessage',
    'messagecontextinfo',
    'devicesentmessage',
    'keepinchatmessage',
    'pollupdatemessage',
    'pollcreationmessage',
    'reactionmessage',
    'ephemeralsetting',
  ];

  const temSubPropTecnica =
    Boolean(evento?.message?.protocolMessage) ||
    Boolean(evento?.message?.senderKeyDistributionMessage) ||
    Boolean(evento?.message?.reactionMessage) ||
    (Boolean(evento?.message?.messageContextInfo) &&
      !evento?.message?.conversation &&
      !evento?.message?.extendedTextMessage &&
      !evento?.message?.audioMessage &&
      !evento?.message?.documentMessage &&
      !evento?.message?.imageMessage &&
      !evento?.message?.videoMessage &&
      !evento?.message?.locationMessage &&
      !evento?.message?.liveLocationMessage);

  const isEventoTecnico =
    eventosTecnicosIgnorados.some((t) => msgTypeBruto.toLowerCase().includes(t)) ||
    temSubPropTecnica;

  if (isEventoTecnico) {
    console.log(
      `[Webhook WhatsApp ℹ️] Evento técnico/protocolo ignorado em silêncio (${msgTypeBruto || 'controle'}) para ${remoteJid}.`
    );
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'evento_tecnico_sem_conteudo',
      destinatario: remoteJid,
      mensagemId,
    };
  }

  // 2. EXTRAÇÃO DO REMETENTE E RESOLUÇÃO DE FORMATO @lid
  const isGrupo = remoteJid.endsWith('@g.us');
  const participantRaw = (key.participant || evento.participant || '') as string;
  const remetenteOrigem = (isGrupo ? participantRaw : remoteJid) || '';

  // Registra no terminal a estrutura completa na primeira mensagem
  registrarInspecaoPrimeiraMensagem(evento);

  // A VEGA não deve responder em grupos quando RESPONDER_EM_GRUPOS não estiver ativo
  const responderEmGrupos = process.env.RESPONDER_EM_GRUPOS?.trim().toLowerCase() === 'true';
  if (isGrupo && !responderEmGrupos) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.log(
      `[Webhook WhatsApp 👥] Mensagem de grupo ignorada em ${dataHora} | Grupo: ${remoteJid} | Remetente: ${remetenteOrigem || 'desconhecido'} | Motivo: RESPONDER_EM_GRUPOS=false`
    );
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'mensagens_de_grupo_desativadas',
      destinatario: remoteJid,
      mensagemId,
    };
  }

  if (!remetenteOrigem) {
    return {
      sucesso: false,
      status: 'ignorado',
      motivo: 'remetente_indefinido',
      mensagemId,
    };
  }

  // Identificação do formato @lid
  const isLid = remoteJid.endsWith('@lid') || participantRaw.endsWith('@lid');
  const lidCompleto = isLid ? (remoteJid.endsWith('@lid') ? remoteJid : participantRaw) : null;
  const lidLimpo = lidCompleto ? normalizarLid(lidCompleto) : '';

  // Procura pelo número real de telefone em outros campos do evento da Evolution API
  let numeroTelefoneReal: string | null = null;
  let campoOrigemNumero: string | null = null;

  const candidatosNumero: Array<{ campo: string; valor: any }> = [
    { campo: 'key.senderPn', valor: key.senderPn },
    { campo: 'evento.senderPn', valor: evento.senderPn },
    { campo: 'key.participantPn', valor: key.participantPn },
    { campo: 'evento.participantPn', valor: evento.participantPn },
    { campo: 'key.remoteJidAlt', valor: key.remoteJidAlt },
    { campo: 'evento.remoteJidAlt', valor: evento.remoteJidAlt },
    { campo: 'key.previousRemoteJid', valor: key.previousRemoteJid },
    { campo: 'evento.previousRemoteJid', valor: evento.previousRemoteJid },
    { campo: 'evento.sender', valor: evento.sender },
    { campo: 'evento.participant', valor: evento.participant },
    { campo: 'key.participant', valor: key.participant },
    { campo: 'evento.owner', valor: evento.owner },
  ];

  for (const c of candidatosNumero) {
    if (c.valor && typeof c.valor === 'string') {
      const v = c.valor.trim();
      // Não pode ser o próprio LID nem grupo
      if (!v.endsWith('@lid') && !v.endsWith('@g.us')) {
        const digitos = v.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (digitos.length >= 10 && digitos.length <= 15 && digitos !== lidLimpo) {
          numeroTelefoneReal = digitos;
          campoOrigemNumero = c.campo;
          break;
        }
      }
    }
  }

  // Se o JID não é @lid e não é grupo, o próprio remoteJid contém o número de telefone
  if (!isLid && !isGrupo && remetenteOrigem && !numeroTelefoneReal) {
    const digitos = remetenteOrigem.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (digitos.length >= 10 && digitos.length <= 15) {
      numeroTelefoneReal = digitos;
      campoOrigemNumero = 'key.remoteJid';
    }
  }

  // 3. VERIFICAÇÃO DO USUÁRIO AUTORIZADO (SEMPRE ANTES DE QUALQUER TRANSCRIÇÃO OU PROCESSAMENTO)
  let usuarioAutorizado: UsuarioWhatsApp | null = null;

  // 1ª Prioridade Absoluta: busca pelo número real encontrado em senderPn ou outros campos da Evolution
  if (numeroTelefoneReal) {
    usuarioAutorizado = await buscarUsuarioPorTelefone(numeroTelefoneReal);
    if (usuarioAutorizado) {
      console.log(
        `[Webhook WhatsApp 📱] Remetente autorizado pelo número real "${numeroTelefoneReal}" via campo [${campoOrigemNumero}].`
      );
    }
  }

  // 2ª Prioridade: busca por identificador @lid cadastrado no Supabase (coluna lid)
  if (!usuarioAutorizado && lidLimpo) {
    usuarioAutorizado = await buscarUsuarioPorLid(lidLimpo);
    if (usuarioAutorizado) {
      console.log(
        `[Webhook WhatsApp 🆔] Remetente autorizado pelo LID ("${lidLimpo}") cadastrado no Supabase para o usuário "${usuarioAutorizado.nome}".`
      );
    }
  }

  // 3ª Prioridade: busca direta por telefone caso seja JID numérico tradicional (@s.whatsapp.net)
  if (!usuarioAutorizado && remetenteOrigem && !isLid) {
    usuarioAutorizado = await buscarUsuarioPorTelefone(remetenteOrigem);
    if (usuarioAutorizado) {
      console.log(
        `[Webhook WhatsApp 📱] Remetente autorizado pelo JID tradicional "${remetenteOrigem}".`
      );
    }
  }

  // 3. IDENTIFICAÇÃO E RESOLUÇÃO DO REMETENTE E CONTATO
  const pushNameRecebido = evento?.pushName?.trim();
  const numeroIdentificado =
    numeroTelefoneReal ||
    (remetenteOrigem && !isLid ? remetenteOrigem.split('@')[0].split(':')[0].replace(/\D/g, '') : '') ||
    lidLimpo ||
    'desconhecido';
  const numeroFinal = usuarioAutorizado?.numero || numeroIdentificado;
  const numeroCanonica = normalizarNumeroCanonica(numeroFinal);
  const conversaId = `wa-${numeroCanonica}`;

  const nivelAcesso: NivelAcesso = usuarioAutorizado?.perfil === 'admin' ? 'diretoria' : 'geral';
  const setorUsuario: SetorUsuario = usuarioAutorizado?.perfil === 'admin' ? 'Diretoria' : 'Administrativo';
  const cargoUsuario = usuarioAutorizado?.perfil === 'admin' ? 'Administrador' : (usuarioAutorizado ? 'Colaborador' : 'Não Cadastrado');

  const contato: Contato = {
    id: usuarioAutorizado ? `ct-${usuarioAutorizado.id}` : `ct-nao-auth-${numeroCanonica}`,
    nome: usuarioAutorizado?.nome || pushNameRecebido || `WhatsApp ${numeroCanonica}`,
    telefone: usuarioAutorizado?.numero || numeroIdentificado,
    avatarCor: usuarioAutorizado ? '#25D366' : '#94a3b8',
    cargo: cargoUsuario,
    setor: setorUsuario,
    nivelAcesso,
    titularVinculado: usuarioAutorizado?.pessoa_id || undefined,
    ficha: {
      cargo: cargoUsuario,
      setor: setorUsuario,
      nivelAcesso,
      observacoes: usuarioAutorizado
        ? `WhatsApp ${usuarioAutorizado.perfil} (ID: ${usuarioAutorizado.id})`
        : 'Contato não autorizado que enviou mensagem pelo WhatsApp',
    },
  };

  if (!usuarioAutorizado) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.warn(
      `[Webhook WhatsApp 🚫] Mensagem recusada em ${dataHora} | Remetente não autorizado: ${remetenteOrigem} ${
        isLid ? `(LID: ${lidLimpo || 'desconhecido'})` : ''
      } | Origem: ${ipOrigem}`
    );

    // REGRA OFICIAL: Toda mensagem recebida ou enviada pelo WhatsApp DEVE ser gravada na conversa no Supabase!
    try {
      await garantirConversaWhatsApp(conversaId, contato);
      const textoRecebido = extrairTextoMensagem(evento.message) || '[Mídia ou mensagem sem texto recebida]';
      const msgUsuarioNaoAuth: Mensagem = {
        id: mensagemId || `wa-msg-${Date.now()}-user-nao-auth`,
        remetente: 'cliente',
        nomeRemetente: contato.nome,
        horario: formatarHorarioBrasilia(),
        timestamp: obterAgoraIsoUtc(),
        texto: textoRecebido,
        tipoMensagem: 'texto',
      };
      await registrarMensagemETransmitir(conversaId, msgUsuarioNaoAuth);

      const msgVegaRecusa: Mensagem = {
        id: `wa-msg-${Date.now()}-vega-recusa`,
        remetente: 'assistente',
        nomeRemetente: ASSISTENTE.nomeExibicao,
        horario: formatarHorarioBrasilia(),
        timestamp: obterAgoraIsoUtc(),
        texto: RESPOSTA_NAO_AUTORIZADO,
        origem: 'motor',
      };
      await registrarMensagemETransmitir(conversaId, msgVegaRecusa);
    } catch (errPersist) {
      console.warn('[Webhook WhatsApp ⚠️] Falha ao registrar mensagem não autorizada na conversa:', errPersist);
    }

    // Resposta curta e fixa para o mesmo identificador de onde veio a mensagem (remoteJid @lid)
    return {
      sucesso: false,
      status: 'recusado',
      motivo: 'numero_nao_autorizado',
      resposta: RESPOSTA_NAO_AUTORIZADO,
      destinatario: remoteJid,
      mensagemId,
    };
  }

  // 4. EXTRAÇÃO DO CONTEÚDO DA MENSAGEM (ÁUDIO OU TEXTO)
  let textoMensagem = '';
  let tipoMensagem: 'texto' | 'audio' = 'texto';
  let duracaoAudioSegundos: number | undefined;
  let custoTranscricaoUsd = 0;
  let modeloTranscricao = '';
  let tempoTranscricaoMs = 0;
  let metodoDownload: 'base64_payload' | 'api_download' | undefined;
  let audioOriginalBuffer: Buffer | undefined;
  let audioOriginalMimetype: string | undefined;
  let textoTranscritoOriginal: string | undefined;
  let correcoesTranscricao: Array<{ de: string; para: string; motivo: string }> = [];

  const infoAudio = extrairInfoAudio(evento);

  if (infoAudio.isAudio) {
    const audioPreparoId = mensagemId || `wa-msg-audio-${Date.now()}`;
    notificarMensagemEmPreparo(conversaId, audioPreparoId, remoteJid, contato, usuarioAutorizado);
    try {
      // Registra no terminal a estrutura completa do primeiro áudio recebido (sem imprimir bytes de base64)
      registrarInspecaoPrimeiroAudio(evento);

      console.log(
        `[Webhook WhatsApp 🎙️] Mensagem de áudio recebida de "${usuarioAutorizado.nome}" (~${infoAudio.duracaoSegundos}s).`
      );

    // Validação prévia de duração (se informada no payload da Evolution)
    if (infoAudio.duracaoSegundos > 0) {
      const validacaoPrevia = validarLimitesAudio(infoAudio.duracaoSegundos, infoAudio.tamanhoBytes || 0);
      if (!validacaoPrevia.valido) {
        console.warn(`[Webhook WhatsApp ⚠️] Áudio rejeitado por limites: ${validacaoPrevia.mensagemAviso}`);
        try {
          await garantirConversaWhatsApp(conversaId, contato);
          await registrarMensagemETransmitir(conversaId, {
            id: mensagemId || `wa-msg-${Date.now()}-user-audio`,
            remetente: 'cliente',
            nomeRemetente: contato.nome,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: `[Áudio recebido (~${infoAudio.duracaoSegundos || 0}s) - rejeitado por limite]`,
            tipoMensagem: 'audio',
            duracaoAudioSegundos: infoAudio.duracaoSegundos,
          });
          await registrarMensagemETransmitir(conversaId, {
            id: `wa-msg-${Date.now()}-vega-audio-limite`,
            remetente: 'assistente',
            nomeRemetente: ASSISTENTE.nomeExibicao,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: validacaoPrevia.mensagemAviso || 'Áudio não atende aos limites permitidos.',
            origem: 'motor',
          });
        } catch (errPersist) {
          console.warn('[Webhook WhatsApp ⚠️] Falha ao registrar áudio rejeitado na conversa:', errPersist);
        }
        return {
          sucesso: true,
          status: 'processado',
          resposta: validacaoPrevia.mensagemAviso,
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      }
    }

    const configEvolution = obterConfigEvolution();
    if (!configEvolution) {
      console.error('[Webhook WhatsApp ❌] Configuração da Evolution API não encontrada para baixar áudio.');
      const msgFalhaConfig = 'Não consegui processar o áudio, pode escrever ou gravar de novo?';
      try {
        await garantirConversaWhatsApp(conversaId, contato);
        await registrarMensagemETransmitir(conversaId, {
          id: mensagemId || `wa-msg-${Date.now()}-user-audio-err`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: '[Áudio recebido]',
          tipoMensagem: 'audio',
        });
        await registrarMensagemETransmitir(conversaId, {
          id: `wa-msg-${Date.now()}-vega-audio-err`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgFalhaConfig,
          origem: 'motor',
        });
      } catch {}
      return {
        sucesso: true,
        status: 'processado',
        resposta: msgFalhaConfig,
        destinatario: remoteJid,
        mensagemId,
        usuario: usuarioAutorizado,
      };
    }

    // Baixa o áudio 100% em memória RAM (priorizando base64 no evento, fallback rota API)
    let downloadAudio;
    try {
      downloadAudio = await obterAudioBufferEvolution(evento, configEvolution);
      audioOriginalBuffer = downloadAudio.buffer;
      audioOriginalMimetype = downloadAudio.mimetype;
    } catch (err: any) {
      console.error('[Webhook WhatsApp ❌] Falha ao obter áudio da Evolution API:', err?.message || err);
      const msgFalhaDl = 'Não consegui processar o áudio, pode escrever ou gravar de novo?';
      try {
        await garantirConversaWhatsApp(conversaId, contato);
        await registrarMensagemETransmitir(conversaId, {
          id: mensagemId || `wa-msg-${Date.now()}-user-audio-err`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: '[Áudio recebido - falha no download]',
          tipoMensagem: 'audio',
        });
        await registrarMensagemETransmitir(conversaId, {
          id: `wa-msg-${Date.now()}-vega-audio-err`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgFalhaDl,
          origem: 'motor',
        });
      } catch {}
      return {
        sucesso: true,
        status: 'processado',
        resposta: msgFalhaDl,
        destinatario: remoteJid,
        mensagemId,
        usuario: usuarioAutorizado,
      };
    }

    // Validação de limites com os dados reais do buffer baixado
    const validacaoBuffer = validarLimitesAudio(downloadAudio.duracaoSegundos, downloadAudio.tamanhoBytes);
    if (!validacaoBuffer.valido) {
      console.warn(`[Webhook WhatsApp ⚠️] Áudio rejeitado por limites reais: ${validacaoBuffer.mensagemAviso}`);
      try {
        await garantirConversaWhatsApp(conversaId, contato);
        await registrarMensagemETransmitir(conversaId, {
          id: mensagemId || `wa-msg-${Date.now()}-user-audio-lim`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: `[Áudio recebido (${downloadAudio.duracaoSegundos}s) - rejeitado por limite]`,
          tipoMensagem: 'audio',
          duracaoAudioSegundos: downloadAudio.duracaoSegundos,
        });
        await registrarMensagemETransmitir(conversaId, {
          id: `wa-msg-${Date.now()}-vega-audio-lim`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: validacaoBuffer.mensagemAviso || 'Áudio excede os limites permitidos.',
          origem: 'motor',
        });
      } catch {}
      return {
        sucesso: true,
        status: 'processado',
        resposta: validacaoBuffer.mensagemAviso,
        destinatario: remoteJid,
        mensagemId,
        usuario: usuarioAutorizado,
      };
    }

    // Transcrição via OpenAI Whisper em memória RAM
    try {
      const resultadoTranscricao = await transcreverAudioOpenAI(
        downloadAudio.buffer,
        downloadAudio.mimetype,
        downloadAudio.duracaoSegundos,
        `ct-${usuarioAutorizado.id}`,
        usuarioAutorizado.nome
      );

      if (!resultadoTranscricao.texto || resultadoTranscricao.texto.trim().length === 0) {
        console.warn('[Webhook WhatsApp ⚠️] Transcrição retornou texto vazio.');
        const msgVazio = 'Não consegui entender o áudio, pode escrever ou gravar de novo?';
        try {
          await garantirConversaWhatsApp(conversaId, contato);
          await registrarMensagemETransmitir(conversaId, {
            id: mensagemId || `wa-msg-${Date.now()}-user-audio-vazio`,
            remetente: 'cliente',
            nomeRemetente: contato.nome,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: '[Áudio inaudível ou vazio]',
            tipoMensagem: 'audio',
            duracaoAudioSegundos: downloadAudio.duracaoSegundos,
          });
          await registrarMensagemETransmitir(conversaId, {
            id: `wa-msg-${Date.now()}-vega-audio-vazio`,
            remetente: 'assistente',
            nomeRemetente: ASSISTENTE.nomeExibicao,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: msgVazio,
            origem: 'motor',
          });
        } catch {}
        return {
          sucesso: true,
          status: 'processado',
          resposta: msgVazio,
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      }

      textoTranscritoOriginal = resultadoTranscricao.texto;
      const resultadoCorrecao = await corrigirTranscricaoFonetica(textoTranscritoOriginal);
      textoMensagem = resultadoCorrecao.textoCorrigido;
      correcoesTranscricao = resultadoCorrecao.correcoes;
      tipoMensagem = 'audio';
      duracaoAudioSegundos = resultadoTranscricao.duracaoSegundos;
      custoTranscricaoUsd = resultadoTranscricao.custoUsd;
      modeloTranscricao = resultadoTranscricao.modelo;
      tempoTranscricaoMs = resultadoTranscricao.tempoMs;
      metodoDownload = downloadAudio.metodo;

      console.log(
        `[Webhook WhatsApp 🎙️] Áudio transcrito: "${textoTranscritoOriginal}" | Corrigido: "${textoMensagem}" (Correções: ${correcoesTranscricao.length}, Custo: $${custoTranscricaoUsd}, Método: ${metodoDownload})`
      );
    } catch (err: any) {
      const motivoExato = err?.motivoExato || err?.message || String(err);
      console.error(
        `[Webhook WhatsApp ❌] A OpenAI recusou o modelo ou falhou ao transcrever áudio (motivo exato): ${motivoExato}`
      );
      const msgErroTr = 'Não consegui processar o áudio, pode escrever ou gravar de novo?';
      try {
        await garantirConversaWhatsApp(conversaId, contato);
        await registrarMensagemETransmitir(conversaId, {
          id: mensagemId || `wa-msg-${Date.now()}-user-audio-err`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: '[Áudio recebido - falha na transcrição]',
          tipoMensagem: 'audio',
        });
        await registrarMensagemETransmitir(conversaId, {
          id: `wa-msg-${Date.now()}-vega-audio-err`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgErroTr,
          origem: 'motor',
        });
      } catch {}
      return {
        sucesso: true,
        status: 'processado',
        resposta: msgErroTr,
        destinatario: remoteJid,
        mensagemId,
        usuario: usuarioAutorizado,
      };
    }
  } finally {
    concluirMensagemEmPreparo(conversaId, audioPreparoId);
  }
} else {
    // Verifica se é um documento (PDF) ou imagem enviado pelo WhatsApp
    const infoDoc = extrairInfoDocumentoWhatsApp(evento);

    // 1. Registra no terminal a inspeção detalhada da primeira mídia recebida (sem despejar bytes de base64)
    if (infoDoc.isDocumento || infoDoc.isImagem || infoDoc.isNaoSuportado) {
      registrarInspecaoPrimeiroDocumento(evento, infoDoc);
    }

    if (infoDoc.isDocumento || infoDoc.isImagem) {
      await garantirConversaWhatsApp(conversaId, contato);

      // Ponto 5: Só perfil admin pode enviar documentos; para os demais, responder que não tem permissão
      if (usuarioAutorizado.perfil !== 'admin') {
        const msgSemPermissao =
          'Você não tem permissão para enviar documentos para o Cofre da VEGA. Apenas administradores podem realizar o envio.';
        registrarLogMensagemNaoTexto(
          evento,
          infoDoc,
          usuarioAutorizado.nome,
          false,
          'Recusado: perfil comum não tem permissão para enviar ao Cofre.'
        );

        const msgCliente: Mensagem = {
          id: mensagemId || `wa-msg-${Date.now()}-user-sem-perm`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: infoDoc.legenda || (infoDoc.isImagem ? '[Foto enviada pelo WhatsApp]' : `[Documento: ${infoDoc.nomeArquivo || 'arquivo'}]`),
          tipoMensagem: infoDoc.isImagem ? 'imagem' : 'documento',
        };
        await registrarMensagemETransmitir(conversaId, msgCliente);

        const msgAssistente: Mensagem = {
          id: `wa-msg-${Date.now()}-vega-sem-perm`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgSemPermissao,
          origem: 'motor',
        };
        await registrarMensagemETransmitir(conversaId, msgAssistente);

        return {
          sucesso: true,
          status: 'processado',
          resposta: msgSemPermissao,
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      }

      const configEvolution = obterConfigEvolution();

      // Se a Evolution API não estiver configurada no servidor E o base64 não veio direto no evento
      if (!configEvolution && !infoDoc.base64Direto) {
        const msgSemConfig =
          'Recebi seu documento, mas a conexão com o servidor da Evolution API não está configurada para download de mídia.';
        registrarLogMensagemNaoTexto(
          evento,
          infoDoc,
          usuarioAutorizado.nome,
          false,
          'Falha: EVOLUTION_API_URL / INSTANCE não configuradas e base64 ausente no payload.'
        );

        const msgCliente: Mensagem = {
          id: mensagemId || `wa-msg-${Date.now()}-user-sem-config`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: infoDoc.legenda || (infoDoc.isImagem ? '[Foto enviada]' : `[Documento: ${infoDoc.nomeArquivo || 'arquivo'}]`),
          tipoMensagem: infoDoc.isImagem ? 'imagem' : 'documento',
        };
        await registrarMensagemETransmitir(conversaId, msgCliente);

        const msgAssistente: Mensagem = {
          id: `wa-msg-${Date.now()}-vega-sem-config`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgSemConfig,
          origem: 'motor',
        };
        await registrarMensagemETransmitir(conversaId, msgAssistente);

        return {
          sucesso: true,
          status: 'processado',
          resposta: msgSemConfig,
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      }

      try {
        const resultadoDoc = await processarDocumentoRecebidoWhatsApp(
          evento,
          infoDoc,
          usuarioAutorizado,
          configEvolution
        );

        registrarLogMensagemNaoTexto(
          evento,
          infoDoc,
          usuarioAutorizado.nome,
          true,
          `Enfileirado com sucesso (${infoDoc.nomeArquivo || 'documento'}).`
        );

        // REGISTRA A MENSAGEM DO CLIENTE COM O ARQUIVO/IMAGEM ANEXADO
        const msgCliente: Mensagem = {
          id: mensagemId || `wa-msg-${Date.now()}-user-doc`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: resultadoDoc.legenda || (resultadoDoc.isImagem ? `Foto: ${resultadoDoc.anexo?.nome || 'imagem'}` : `Documento: ${resultadoDoc.anexo?.nome || 'arquivo'}`),
          tipoMensagem: resultadoDoc.isImagem ? 'imagem' : 'documento',
          anexos: resultadoDoc.anexo ? [resultadoDoc.anexo] : undefined,
        };
        await registrarMensagemETransmitir(conversaId, msgCliente);

        // ENTREGA A MÍDIA AO AGRUPADOR (Aguardará legenda/mensagem enviada em seguida se houver)
        await adicionarMensagemAoAgrupador({
          conversaId,
          destinatario: remoteJid,
          contato,
          usuarioAutorizado,
          item: {
            id: msgCliente.id,
            texto: resultadoDoc.legenda || '',
            tipoMensagem: resultadoDoc.isImagem ? 'imagem' : 'documento',
            documentoId: resultadoDoc.doc?.id,
            nomeArquivo: resultadoDoc.anexo?.nome || resultadoDoc.doc?.arquivo,
            anexo: resultadoDoc.anexo,
            mensagemRespostaPadraoDoc: resultadoDoc.mensagemResposta,
            timestampRecebimentoWebhook,
          },
        });

        return {
          sucesso: true,
          status: 'processado',
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      } catch (errDoc: any) {
        const msgErro = errDoc?.message || String(errDoc);
        console.error('[Webhook WhatsApp ❌] Erro ao processar documento recebido:', msgErro);
        registrarLogMensagemNaoTexto(
          evento,
          infoDoc,
          usuarioAutorizado.nome,
          false,
          `Erro no salvamento: ${msgErro}`
        );

        const msgErroResposta =
          'Recebi seu documento, mas ocorreu uma falha temporária ao salvá-lo no Cofre. Por favor, tente enviar novamente.';

        const msgCliente: Mensagem = {
          id: mensagemId || `wa-msg-${Date.now()}-user-doc-err`,
          remetente: 'cliente',
          nomeRemetente: contato.nome,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: infoDoc.legenda || `[Arquivo: ${infoDoc.nomeArquivo || 'documento'}]`,
          tipoMensagem: infoDoc.isImagem ? 'imagem' : 'documento',
        };
        await registrarMensagemETransmitir(conversaId, msgCliente);

        const msgAssistente: Mensagem = {
          id: `wa-msg-${Date.now()}-vega-doc-err`,
          remetente: 'assistente',
          nomeRemetente: ASSISTENTE.nomeExibicao,
          horario: formatarHorarioBrasilia(),
          timestamp: obterAgoraIsoUtc(),
          texto: msgErroResposta,
          origem: 'motor',
        };
        await registrarMensagemETransmitir(conversaId, msgAssistente);

        return {
          sucesso: true,
          status: 'processado',
          resposta: msgErroResposta,
          destinatario: remoteJid,
          mensagemId,
          usuario: usuarioAutorizado,
        };
      }
    } else if (infoDoc.isLocalizacao) {
      // Localização recebida nativamente ou encaminhada pelo WhatsApp
      const lat = infoDoc.latitude;
      const lng = infoDoc.longitude;
      const nomeLoc = infoDoc.nomeLocal ? `, nome: "${infoDoc.nomeLocal}"` : '';
      const endLoc = infoDoc.enderecoLocal ? `, endereço: "${infoDoc.enderecoLocal}"` : '';
      const linkMaps = infoDoc.linkMaps || `https://www.google.com/maps?q=${lat},${lng}`;

      const textoRegistroUsuario = `[Localização recebida: latitude ${lat}, longitude ${lng}${nomeLoc}${endLoc} | Link: ${linkMaps}]`;
      console.log(`[Webhook WhatsApp 📍] Localização recebida de "${usuarioAutorizado.nome}": ${lat}, ${lng}`);

      // Enfileira a localização no agrupador para resposta unificada com o lote
      textoMensagem = textoRegistroUsuario;
      tipoMensagem = 'texto';
    } else if (infoDoc.isNaoSuportado) {
      // Formato não suportado: NÃO envia direto no webhook! Encaminha ao agrupador para consolidar no lote
      registrarLogMensagemNaoTexto(
        evento,
        infoDoc,
        usuarioAutorizado.nome,
        false,
        `Formato não suportado (${infoDoc.tipoDetectado}). Encaminhado ao agrupador para resposta unificada.`
      );

      textoMensagem = `[Arquivo recebido em formato não suportado: ${infoDoc.tipoDetectado}]`;
      tipoMensagem = 'texto';
    } else {
      // Mensagem de texto tradicional
      textoMensagem = extrairTextoMensagem(evento.message);
      const textoCitado = extrairMensagemCitada(evento.message);
      if (textoCitado && textoMensagem) {
        textoMensagem = `[Em resposta à mensagem: "${textoCitado}"]\n${textoMensagem}`;
      }
      tipoMensagem = 'texto';
    }

    if (!textoMensagem || textoMensagem.trim().length === 0) {
      // Se não for texto, nem áudio, nem documento/imagem suportado
      const msgType = String(evento?.messageType || 'desconhecido');
      const isEventoSemConteudo =
        !evento.message ||
        Object.keys(evento.message).length === 0 ||
        msgType.toLowerCase().includes('reaction') ||
        msgType.toLowerCase().includes('protocol') ||
        msgType.toLowerCase().includes('context');

      if (isEventoSemConteudo) {
        console.log(`[Webhook WhatsApp ℹ️] Evento sem texto/conteúdo ignorado em silêncio (messageType: ${msgType}).`);
        return {
          sucesso: true,
          status: 'ignorado',
          motivo: 'evento_sem_conteudo',
          destinatario: remoteJid,
          mensagemId,
        };
      }

      console.warn(
        `[Webhook WhatsApp ⚠️] Mensagem sem texto ou formato não identificado de "${usuarioAutorizado.nome}" (messageType: ${msgType}). Encaminhando ao agrupador.`
      );

      // Repassa ao agrupador para que a resposta seja unificada no lote
      textoMensagem = `[Mensagem recebida em formato não compreendido: ${msgType}]`;
      tipoMensagem = 'texto';
    }
  }

  // 4.1 SALVA O ÁUDIO ORIGINAL NO SUPABASE STORAGE (BUCKET PRIVADO)
  let audioStoragePath: string | undefined;
  let audioMimeType: string | undefined;

  if (infoAudio.isAudio && audioOriginalBuffer && audioOriginalMimetype) {
    try {
      const caminhoSalvo = await salvarAudioOriginalStorage(
        audioOriginalBuffer,
        audioOriginalMimetype,
        normalizarNumeroCanonica(usuarioAutorizado.numero),
        mensagemId || `msg_${Date.now()}`
      );
      if (caminhoSalvo) {
        audioStoragePath = caminhoSalvo;
        audioMimeType = audioOriginalMimetype;
      }
    } catch (err) {
      console.warn('[Webhook WhatsApp ⚠️] Falha ao persistir áudio no Storage:', err);
    }
  }

  // 5. REMETENTE AUTORIZADO: PROCESSAMENTO COM A VEGA (IA E COFRE)
  // Atualiza automaticamente pushName (se o nome for provisório) e LID (se ainda não salvo)
  const nomeGenerico =
    !usuarioAutorizado.nome ||
    usuarioAutorizado.nome.startsWith('Contato ') ||
    usuarioAutorizado.nome.startsWith('Usuário ') ||
    usuarioAutorizado.nome.trim() === '';

  if (pushNameRecebido && nomeGenerico) {
    usuarioAutorizado.nome = pushNameRecebido;
    try {
      const supabase = getSupabaseClient();
      await supabase.from('usuarios').update({ nome: pushNameRecebido }).eq('id', usuarioAutorizado.id);
      console.log(`[Webhook WhatsApp 👤] Nome do usuário (${usuarioAutorizado.numero}) atualizado para "${pushNameRecebido}" via WhatsApp pushName.`);
    } catch (errNome) {
      console.warn('[Webhook WhatsApp ⚠️] Falha ao atualizar pushName no Supabase:', errNome);
    }
  }

  if (lidLimpo && !usuarioAutorizado.lid) {
    usuarioAutorizado.lid = lidLimpo;
    try {
      const supabase = getSupabaseClient();
      await supabase.from('usuarios').update({ lid: lidLimpo }).eq('id', usuarioAutorizado.id);
      console.log(`[Webhook WhatsApp 🆔] LID "${lidLimpo}" vinculado automaticamente ao usuário "${usuarioAutorizado.nome}".`);
    } catch (errLid) {
      console.warn('[Webhook WhatsApp ⚠️] Falha ao vincular LID no Supabase:', errLid);
    }
  }

  const inicioProcessamento = Date.now();
  console.log(
    `[Webhook WhatsApp 💬] Mensagem autorizada de "${usuarioAutorizado.nome}" (${usuarioAutorizado.numero}) | Perfil: ${usuarioAutorizado.perfil} | Mensagem: "${textoMensagem}"`
  );

  // Carrega ou inicializa a conversa do WhatsApp
  let conversa = await garantirConversaWhatsApp(conversaId, contato);

  // Idempotência adicional pelo histórico gravado no Supabase
  if (mensagemId && conversa?.mensagens?.some((m) => m.id === mensagemId)) {
    console.log(`[Webhook WhatsApp 🔁] Mensagem já existente no histórico da conversa (id: ${mensagemId}), ignorando.`);
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'mensagem_ja_gravada',
      mensagemId,
      usuario: usuarioAutorizado,
    };
  }

  // Registra mensagem do usuário no histórico com fuso de Brasília e timestamp ISO UTC
  const msgUsuario: Mensagem = {
    id: mensagemId || `wa-msg-${Date.now()}-user`,
    remetente: 'cliente',
    nomeRemetente: contato.nome,
    horario: formatarHorarioBrasilia(),
    timestamp: obterAgoraIsoUtc(),
    texto: textoMensagem,
    tipoMensagem,
    duracaoAudioSegundos,
    audioOriginal: tipoMensagem === 'audio',
    audioStoragePath,
    audioMimeType,
  };
  const conversaAtualizadaUsuario = await adicionarMensagem(conversaId, msgUsuario);
  if (conversaAtualizadaUsuario) {
    eventosPainel.emitirNovaMensagem(conversaId, msgUsuario, conversaAtualizadaUsuario);
  }

  // 5. ENFILEIRA NO AGRUPADOR DE MENSAGENS (DEBOUNCE / PROCESSAMENTO EM LOTE)
  // Aguarda mensagens subsequentes da mesma pessoa ou responde imediatamente se tempoEspera === 0
  await adicionarMensagemAoAgrupador({
    conversaId,
    destinatario: remoteJid,
    contato,
    usuarioAutorizado,
    item: {
      id: msgUsuario.id,
      texto: textoMensagem,
      tipoMensagem,
      duracaoAudioSegundos,
      custoTranscricaoUsd,
      modeloTranscricao,
      tempoTranscricaoMs,
      metodoDownloadAudio: metodoDownload,
      textoTranscritoOriginal,
      correcoesTranscricao,
      audioStoragePath,
      audioMimeType,
      timestampRecebimentoWebhook,
    },
  });

  return {
    sucesso: true,
    status: 'processado',
    destinatario: remoteJid,
    mensagemId,
    usuario: usuarioAutorizado,
  };
}

/**
 * Envia mensagens para o WhatsApp usando a Evolution API.
 * Se houver anexos (ex: PDFs), envia o texto primeiro e depois os documentos em sequência.
 */
export async function enviarMensagemWhatsApp(
  destinatario: string,
  texto: string,
  anexos?: Anexo[]
): Promise<void> {
  await enviarRespostaCompletaWhatsApp(destinatario, texto, anexos);
}

/**
 * Processa eventos de presença recebidos da Evolution API (presence.update / PRESENCE_UPDATE)
 * e encaminha para o agrupador de mensagens.
 */
export function processarEventoPresencaWebhook(payload: any): boolean {
  if (!payload) return false;

  try {
    const rawData = payload.data || payload;
    const listaDados = Array.isArray(rawData) ? rawData : [rawData];
    let processouAlgum = false;

    for (const item of listaDados) {
      if (!item || typeof item !== 'object') continue;

      // 1. Identifica o JID / ID do contato
      let remoteJid = item.id || item.remoteJid || item.participant || '';

      // 2. Extrai o status da presença
      // Formato A: item.presence (string, ex: 'composing', 'paused', 'available')
      // Formato B: item.presences: { [jid]: { lastKnownPresence: 'composing' } }
      let presence = item.presence || '';

      if (!presence && item.presences && typeof item.presences === 'object') {
        const entries = Object.entries(item.presences);
        if (entries.length > 0) {
          const [jidFromKey, val] = entries[0];
          if (!remoteJid) remoteJid = jidFromKey;
          presence = (val as any)?.lastKnownPresence || (val as any)?.presence || '';
        }
      }

      if (remoteJid && presence) {
        notificarPresencaUsuarioNoAgrupador(remoteJid, presence);
        processouAlgum = true;
      }
    }

    return processouAlgum;
  } catch (err) {
    console.warn('[Webhook Presença ⚠️] Erro ao extrair e processar presença:', err);
    return false;
  }
}


