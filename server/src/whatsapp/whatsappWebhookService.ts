import { Request, Response } from 'express';
import {
  EvolutionWebhookPayload,
  ResultadoProcessamentoWebhook,
  UsuarioWhatsApp,
} from './types.js';
import { buscarUsuarioPorNumero, normalizarNumeroCanonica } from './usuarioWhatsAppService.js';
import {
  obterConversaPorId,
  salvarConversa,
  adicionarMensagem,
  obterDocumentosPorNivelAcesso,
} from '../storage.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { salvarRastro } from '../rastros/rastroService.js';
import { Contato, Mensagem, RastroRegistro, NivelAcesso, SetorUsuario } from '../types.js';
import { ASSISTENTE } from '../config/assistente.js';

// Cache em memória para deduplicação de mensagens recebidas
// Mapeia key.id -> timestamp de recebimento
const cacheMensagensProcessadas = new Map<string, number>();
const TTL_DEDUPLICACAO_MS = 10 * 60 * 1000; // 10 minutos

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
 * Resposta fixa para remetentes não autorizados
 */
export const RESPOSTA_NAO_AUTORIZADO = 'Este número não tem acesso à VEGA.';

/**
 * Processa um evento individual recebido do webhook da Evolution API
 */
export async function processarEventoEvolution(
  evento: any,
  ipOrigem: string = 'desconhecida'
): Promise<ResultadoProcessamentoWebhook> {
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

  // 2. EXTRAÇÃO DO REMETENTE E VERIFICAÇÃO DE GRUPO (@g.us)
  const isGrupo = remoteJid.endsWith('@g.us');
  const remetenteRaw = (isGrupo ? (key.participant || evento.participant) : remoteJid) || '';

  // A VEGA não deve responder em grupos quando RESPONDER_EM_GRUPOS não estiver ativo
  const responderEmGrupos = process.env.RESPONDER_EM_GRUPOS?.trim().toLowerCase() === 'true';
  if (isGrupo && !responderEmGrupos) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.log(
      `[Webhook WhatsApp 👥] Mensagem de grupo ignorada em ${dataHora} | Grupo: ${remoteJid} | Remetente: ${remetenteRaw || 'desconhecido'} | Motivo: RESPONDER_EM_GRUPOS=false`
    );
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'mensagens_de_grupo_desativadas',
      destinatario: remoteJid,
      mensagemId,
    };
  }

  if (!remetenteRaw) {
    return {
      sucesso: false,
      status: 'ignorado',
      motivo: 'remetente_indefinido',
      mensagemId,
    };
  }

  // 3. EXTRAÇÃO DO TEXTO DA MENSAGEM
  const textoMensagem = extrairTextoMensagem(evento.message);
  if (!textoMensagem) {
    return {
      sucesso: true,
      status: 'ignorado',
      motivo: 'mensagem_sem_texto_suportado',
      mensagemId,
    };
  }

  // 4. VERIFICAÇÃO DO NÚMERO AUTORIZADO
  const usuarioAutorizado = await buscarUsuarioPorNumero(remetenteRaw);

  if (!usuarioAutorizado) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.warn(
      `[Webhook WhatsApp 🚫] Mensagem recusada em ${dataHora} | Número não autorizado: ${remetenteRaw} | Origem: ${ipOrigem}`
    );

    // Resposta curta e fixa, SEM chamar a IA
    return {
      sucesso: false,
      status: 'recusado',
      motivo: 'numero_nao_autorizado',
      resposta: RESPOSTA_NAO_AUTORIZADO,
      destinatario: remoteJid,
      mensagemId,
    };
  }

  // 5. REMETENTE AUTORIZADO: PROCESSAMENTO COM A VEGA (IA E COFRE)
  const inicioProcessamento = Date.now();
  console.log(
    `[Webhook WhatsApp 💬] Mensagem autorizada de "${usuarioAutorizado.nome}" (${usuarioAutorizado.numero}) | Perfil: ${usuarioAutorizado.perfil} | Mensagem: "${textoMensagem}"`
  );

  const numeroCanonica = normalizarNumeroCanonica(usuarioAutorizado.numero);
  const conversaId = `wa-${numeroCanonica}`;

  const nivelAcesso: NivelAcesso = usuarioAutorizado.perfil === 'admin' ? 'diretoria' : 'geral';
  const setorUsuario: SetorUsuario = usuarioAutorizado.perfil === 'admin' ? 'Diretoria' : 'Administrativo';
  const cargoUsuario = usuarioAutorizado.perfil === 'admin' ? 'Administrador' : 'Colaborador';

  const contato: Contato = {
    id: `ct-${usuarioAutorizado.id}`,
    nome: usuarioAutorizado.nome || evento.pushName || 'Usuário WhatsApp',
    telefone: usuarioAutorizado.numero,
    avatarCor: '#25D366',
    cargo: cargoUsuario,
    setor: setorUsuario,
    nivelAcesso,
    titularVinculado: usuarioAutorizado.pessoa_id || undefined,
    ficha: {
      cargo: cargoUsuario,
      setor: setorUsuario,
      nivelAcesso,
      observacoes: `WhatsApp ${usuarioAutorizado.perfil} (ID: ${usuarioAutorizado.id})`,
    },
  };

  // Carrega ou inicializa a conversa do WhatsApp
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
  }

  // Registra mensagem do usuário no histórico
  const msgUsuario: Mensagem = {
    id: mensagemId || `wa-msg-${Date.now()}-user`,
    remetente: 'cliente',
    nomeRemetente: contato.nome,
    horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    texto: textoMensagem,
  };
  await adicionarMensagem(conversaId, msgUsuario);

  // Obtém os documentos disponíveis para o nível de acesso do usuário
  const docsDisponiveis = await obterDocumentosPorNivelAcesso(contato.nivelAcesso);

  // Executa o orquestrador da VEGA
  const resultadoChat = await processarMensagemChat({
    mensagemUsuario: textoMensagem,
    historicoRecente: conversa.mensagens,
    contato,
    documentosDisponiveis: docsDisponiveis,
  });

  const textoResposta = resultadoChat.textoResposta;
  const assistenteMsgId = `wa-msg-${Date.now()}-vega`;

  // Registra mensagem do assistente na conversa
  const msgAssistente: Mensagem = {
    id: assistenteMsgId,
    remetente: 'assistente',
    nomeRemetente: ASSISTENTE.nomeExibicao,
    horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    texto: textoResposta,
    origem: resultadoChat.origem,
    rastro: resultadoChat.rastro,
    documentoOferecidoId: resultadoChat.documentoOferecidoId,
  };
  await adicionarMensagem(conversaId, msgAssistente);

  // Se houver rastro, salva no Supabase (assíncrono resiliente)
  if (resultadoChat.rastro) {
    try {
      resultadoChat.rastro.mensagemId = assistenteMsgId;
      resultadoChat.rastro.conversaId = conversaId;
      await salvarRastro(resultadoChat.rastro);
    } catch (e: any) {
      console.warn('[Webhook WhatsApp ⚠️] Falha ao salvar rastro no Supabase:', e?.message || e);
    }
  }

  const tempoTotal = Date.now() - inicioProcessamento;
  console.log(`[Webhook WhatsApp 🤖] Resposta gerada pela VEGA em ${tempoTotal} ms para "${usuarioAutorizado.nome}".`);

  return {
    sucesso: true,
    status: 'processado',
    resposta: textoResposta,
    destinatario: remoteJid,
    mensagemId,
    usuario: usuarioAutorizado,
    tempoMs: tempoTotal,
  };
}

/**
 * Função reservada para envio futuro via Evolution API (atualmente apenas registra em log)
 */
export async function enviarMensagemWhatsApp(destinatario: string, texto: string): Promise<void> {
  // Conforme orientação do usuário: "Ainda NÃO conecte a Evolution API; primeiro a segurança."
  // Aqui deixamos a estrutura pronta para quando a URL e API Key da Evolution API forem configuradas.
  console.log(`[WhatsApp Sender 📱 (Simulação)] Para: ${destinatario} | Texto: "${texto.slice(0, 80)}${texto.length > 80 ? '...' : ''}"`);
}
