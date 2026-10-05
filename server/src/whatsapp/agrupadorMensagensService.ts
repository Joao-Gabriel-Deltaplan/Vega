import { Contato, Mensagem, Anexo } from '../types.js';
import { UsuarioWhatsApp } from './types.js';
import { obterConfiguracoesVegaSync } from '../config/configuracoesVegaService.js';
import { adicionarMensagem, obterConversaPorId, obterDocumentosPorNivelAcesso, obterTodosTitulares, resolverTitularCadastrado } from '../storage.js';
import { processarMensagemChat, sanitizarRespostaTextoFinal } from '../chat/chatOrquestrador.js';
import { salvarRastro } from '../rastros/rastroService.js';
import {
  enviarRespostaCompletaWhatsApp,
  iniciarPresencaDigitando,
  pararPresencaDigitando,
  normalizarDestinatarioEvolution,
} from './evolutionSenderService.js';
import { formatarHorarioBrasilia, obterAgoraIsoUtc } from '../utils/dataHoraUtils.js';
import { eventosPainel } from '../eventos/eventosService.js';
import { ASSISTENTE } from '../config/assistente.js';
import { buscarPendenciaAtivaWhatsApp, processarRespostaPendenciaWhatsApp } from './pendenciasWhatsAppService.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import OpenAI from 'openai';
import { chamarChatComTelemetria } from '../ai/telemetriaIaService.js';

export interface ItemMensagemAgrupada {
  id: string;
  texto: string;
  tipoMensagem: 'texto' | 'audio' | 'documento' | 'imagem';
  duracaoAudioSegundos?: number;
  custoTranscricaoUsd?: number;
  modeloTranscricao?: string;
  tempoTranscricaoMs?: number;
  metodoDownloadAudio?: 'base64_payload' | 'api_download';
  textoTranscritoOriginal?: string;
  correcoesTranscricao?: Array<{ de: string; para: string; motivo: string }>;
  audioStoragePath?: string;
  audioMimeType?: string;
  // Metadados de documento/imagem se aplicável
  documentoId?: string;
  nomeArquivo?: string;
  anexo?: Anexo;
  mensagemRespostaPadraoDoc?: string;
  timestampRecebimentoWebhook?: number;
}

export interface EntradaAgrupador {
  conversaId: string;
  destinatario: string; // remoteJid
  contato: Contato;
  usuarioAutorizado: UsuarioWhatsApp;
  item: ItemMensagemAgrupada;
}

interface EstadoAgrupamentoConversa {
  conversaId: string;
  destinatario: string;
  contato: Contato;
  usuarioAutorizado: UsuarioWhatsApp;

  // Lote atualmente acumulando
  loteAtual: ItemMensagemAgrupada[];
  timerAgrupamento: NodeJS.Timeout | null;
  primeiroRecebidoEm: number;

  // Controle de cancelamento seguro e reprocessamento
  emProcessamento: boolean;
  loteEmProcessamento: ItemMensagemAgrupada[];
  abortController: AbortController | null;
  podeCancelar: boolean;
  motivoBloqueioCancelamento?: string;

  // Mensagens em preparo (áudio sendo baixado/transcrito)
  mensagensEmPreparo: Set<string>;

  // Fila de espera pós-processamento (para mensagens que chegaram enquanto tool de escrita rodava)
  filaEsperaAposProcessamento: ItemMensagemAgrupada[];

  // NOVO: Controle de presença em tempo real do usuário (composing / paused)
  usuarioDigitando: boolean;
  ultimoEventoPresencaEm: number;
}

// Limites de segurança
export const MAX_MENSAGENS_AGRUPADAS = 5;
export const MAX_TEMPO_ESPERA_TOTAL_MS = 20 * 1000; // 20 segundos teto máximo absoluto (conforme requisito)

// Map de conversas ativas em agrupamento: conversaId -> EstadoAgrupamentoConversa
const estadosAgrupamento = new Map<string, EstadoAgrupamentoConversa>();

/**
 * Retorna o estado de agrupamento de uma conversa ou cria um novo
 */
// Cache global de presença recente por número normalizado
const presencaRecentePorNumero = new Map<string, { estaDigitando: boolean; atualizadoEm: number }>();

/**
 * Obtém ou cria a estrutura de controle de agrupamento para uma conversa
 */
function obterOuCriarEstado(
  conversaId: string,
  destinatario: string,
  contato: Contato,
  usuarioAutorizado: UsuarioWhatsApp
): EstadoAgrupamentoConversa {
  let estado = estadosAgrupamento.get(conversaId);
  const numeroLimpo = normalizarDestinatarioEvolution(destinatario);
  const presencaRecente = presencaRecentePorNumero.get(numeroLimpo);
  const jaEstaDigitando = Boolean(
    presencaRecente &&
    presencaRecente.estaDigitando &&
    Date.now() - presencaRecente.atualizadoEm < 15000
  );

  if (!estado) {
    estado = {
      conversaId,
      destinatario,
      contato,
      usuarioAutorizado,
      loteAtual: [],
      timerAgrupamento: null,
      primeiroRecebidoEm: 0,
      emProcessamento: false,
      loteEmProcessamento: [],
      abortController: null,
      podeCancelar: true,
      motivoBloqueioCancelamento: undefined,
      mensagensEmPreparo: new Set<string>(),
      filaEsperaAposProcessamento: [],
      usuarioDigitando: jaEstaDigitando,
      ultimoEventoPresencaEm: jaEstaDigitando ? (presencaRecente?.atualizadoEm || Date.now()) : 0,
    };
    estadosAgrupamento.set(conversaId, estado);
  } else {
    // Atualiza referências mais recentes
    estado.destinatario = destinatario;
    estado.contato = contato;
    estado.usuarioAutorizado = usuarioAutorizado;
    if (jaEstaDigitando && !estado.usuarioDigitando) {
      estado.usuarioDigitando = true;
      estado.ultimoEventoPresencaEm = presencaRecente?.atualizadoEm || Date.now();
    }
  }
  return estado;
}

/**
 * Notifica o agrupador sobre alteração de presença do usuário (composing / paused)
 * vinda do webhook da Evolution API.
 */
export function notificarPresencaUsuarioNoAgrupador(
  destinatarioOuConversaId: string,
  presence: 'composing' | 'paused' | string
): void {
  const limpo = normalizarDestinatarioEvolution(destinatarioOuConversaId);
  const agora = Date.now();
  const estaDigitando = presence === 'composing';

  // Guarda no cache global por número
  presencaRecentePorNumero.set(limpo, { estaDigitando, atualizadoEm: agora });

  let estado: EstadoAgrupamentoConversa | undefined = undefined;

  // 1. Busca direta por conversaId
  estado = estadosAgrupamento.get(destinatarioOuConversaId);
  if (!estado) {
    // 2. Busca por destinatário normalizado priorizando o que possui lote acumulado
    const candidatos: EstadoAgrupamentoConversa[] = [];
    for (const est of estadosAgrupamento.values()) {
      if (normalizarDestinatarioEvolution(est.destinatario) === limpo) {
        candidatos.push(est);
      }
    }
    estado = candidatos.find((e) => e.loteAtual.length > 0) || candidatos[candidatos.length - 1];
  }

  if (!estado) return;

  estado.usuarioDigitando = estaDigitando;
  estado.ultimoEventoPresencaEm = agora;

  console.log(
    `[Agrupador 🔔 Presença] ${estado.conversaId}: status="${presence}". Lote acumulado: ${estado.loteAtual.length} msgs. Em processamento: ${estado.emProcessamento}.`
  );

  if (estado.emProcessamento) {
    return;
  }

  if (estaDigitando && estado.loteAtual.length > 0) {
    // Usuário continua digitando: cancela timer de reserva curto
    if (estado.timerAgrupamento) {
      clearTimeout(estado.timerAgrupamento);
      estado.timerAgrupamento = null;
    }
    // Mantém timer de segurança para disparar se estourar o teto de 20s
    const tempoDecorrido = agora - estado.primeiroRecebidoEm;
    const tempoRestanteAteTeto = MAX_TEMPO_ESPERA_TOTAL_MS - tempoDecorrido;

    if (tempoRestanteAteTeto <= 0) {
      dispararLote(estado.conversaId).catch(() => {});
    } else {
      estado.timerAgrupamento = setTimeout(async () => {
        console.log(`[Agrupador 🚀] Teto de 20s atingido durante digitação para ${estado!.conversaId}. Disparando.`);
        await dispararLote(estado!.conversaId);
      }, tempoRestanteAteTeto);
    }
  } else if (!estaDigitando && estado.loteAtual.length > 0) {
    // Usuário parou de digitar (paused / unavailable): agenda disparo com a espera de reserva
    const tempoDecorrido = agora - estado.primeiroRecebidoEm;
    const tempoRestanteAteTeto = MAX_TEMPO_ESPERA_TOTAL_MS - tempoDecorrido;

    if (tempoRestanteAteTeto <= 0) {
      dispararLote(estado.conversaId).catch(() => {});
      return;
    }

    if (estado.timerAgrupamento) {
      clearTimeout(estado.timerAgrupamento);
      estado.timerAgrupamento = null;
    }

    const config = obterConfiguracoesVegaSync();
    const tempoReservaMs = Math.min((config.tempoEsperaAgrupamentoSegundos ?? 3) * 1000, tempoRestanteAteTeto);
    console.log(`[Agrupador ⏳] Usuário parou de digitar em ${estado.conversaId}. Disparando em ${tempoReservaMs / 1000}s de reserva.`);
    estado.timerAgrupamento = setTimeout(async () => {
      await dispararLote(estado!.conversaId);
    }, tempoReservaMs);
  }
}

/**
 * Notifica o agrupador de que uma mensagem está sendo baixada/transcrita no webhook (mensagem em preparo).
 * Impede o fechamento ou disparo prematuro de lote e cancela qualquer processamento em andamento
 * para aguardar a nova mensagem ser consolidada.
 */
export function notificarMensagemEmPreparo(
  conversaId: string,
  mensagemId: string,
  destinatario?: string,
  contato?: Contato,
  usuarioAutorizado?: UsuarioWhatsApp
): void {
  const estado = obterOuCriarEstado(
    conversaId,
    destinatario || conversaId,
    contato || {
      id: 'anonimo',
      nome: 'Contato',
      telefone: '',
      avatarCor: '#25D366',
      ficha: { cargo: 'Colaborador', setor: 'Administrativo', nivelAcesso: 'geral', observacoes: '' },
    },
    usuarioAutorizado || { id: 'anonimo', numero: '', nome: 'Contato', perfil: 'comum', ativo: true, pessoa_id: null }
  );

  estado.mensagensEmPreparo.add(mensagemId);
  console.log(
    `[Agrupador 🎙️ Preparo] Mensagem "${mensagemId}" em preparo (download/transcrição). Total em preparo: ${estado.mensagensEmPreparo.size}.`
  );

  // Mantém presença "digitando..." única para a conversa
  iniciarPresencaDigitando(conversaId, estado.destinatario);

  // Cancela qualquer timer de espera ativo
  if (estado.timerAgrupamento) {
    clearTimeout(estado.timerAgrupamento);
    estado.timerAgrupamento = null;
  }

  // Se a VEGA estiver ocupada processando lote anterior:
  // CANCELA imediatamente sem enviar nada, para incluir o áudio no lote consolidado!
  if (estado.emProcessamento && estado.abortController) {
    console.log(
      `[Agrupador ⚡ CANCELAMENTO] Áudio em preparo chegou durante processamento de mensagem anterior! Cancelando para aguardar transcrição...`
    );
    estado.abortController.abort();
    estado.abortController = null;
    estado.loteAtual = [...estado.loteEmProcessamento, ...estado.loteAtual];
    estado.loteEmProcessamento = [];
    estado.emProcessamento = false;
  }
}

/**
 * Conclui o preparo de uma mensagem (áudio baixado/transcrito ou erro de download).
 * Se não houver mais mensagens em preparo e houver itens acumulados, dispara imediatamente o lote unificado.
 */
export function concluirMensagemEmPreparo(conversaId: string, mensagemId: string): void {
  const estado = estadosAgrupamento.get(conversaId);
  if (!estado) return;

  estado.mensagensEmPreparo.delete(mensagemId);
  console.log(
    `[Agrupador 🎙️ Preparo] Mensagem "${mensagemId}" concluiu preparo. Restantes em preparo: ${estado.mensagensEmPreparo.size}.`
  );

  // Se todas as mensagens em preparo terminaram e há itens no lote:
  if (estado.mensagensEmPreparo.size === 0 && estado.loteAtual.length > 0 && !estado.emProcessamento) {
    console.log(
      `[Agrupador 🚀] Todas as mensagens em preparo concluídas para ${conversaId}. Disparando lote completo (${estado.loteAtual.length} itens)...`
    );
    setImmediate(async () => {
      await dispararLote(conversaId);
    });
  } else if (estado.mensagensEmPreparo.size === 0 && estado.loteAtual.length === 0 && !estado.emProcessamento) {
    // Se não há mais mensagens em preparo nem no lote, encerra a presença
    pararPresencaDigitando(conversaId).catch(() => {});
  }
}

/**
 * Adiciona uma mensagem ao agrupador para ser processada imediatamente com cancelamento.
 *
 * Regras aplicadas (Requisitos 1 e 4a):
 * 1. Processamento imediato: ao chegar uma mensagem, começa a processar na hora (sem esperar 3s).
 * 2. Se chegar nova mensagem da mesma conversa antes do envio da resposta, cancela o processamento
 *    em andamento (sem enviar nada) e reprocessa com o lote completo consolidado.
 * 3. Se houver mensagem em preparo (áudio baixando/transcrevendo), não fecha o lote antes dela terminar.
 * 4. Mantém o status "digitando..." ativo.
 */
export async function adicionarMensagemAoAgrupador(entrada: EntradaAgrupador): Promise<void> {
  const { conversaId, destinatario, contato, usuarioAutorizado, item } = entrada;
  const estado = obterOuCriarEstado(conversaId, destinatario, contato, usuarioAutorizado);

  console.log(
    `[Agrupador ⏳] Mensagem recebida para conversa "${conversaId}" (Tipo: ${item.tipoMensagem}). Em processamento: ${estado.emProcessamento}. Mensagens em preparo: ${estado.mensagensEmPreparo.size}.`
  );

  // Mantém presença "digitando..." única para a conversa
  iniciarPresencaDigitando(conversaId, destinatario);

  // Cancela qualquer timer residual
  if (estado.timerAgrupamento) {
    clearTimeout(estado.timerAgrupamento);
    estado.timerAgrupamento = null;
  }

  // SE JÁ ESTIVER EM PROCESSAMENTO:
  // Requisito 2 (Cancelamento Seguro): se uma tool de escrita já tiver sido executada,
  // o processamento NÃO pode mais ser cancelado: termina e envia a resposta, e a mensagem nova entra como próximo lote.
  if (estado.emProcessamento) {
    if (!estado.podeCancelar) {
      console.log(
        `[Agrupador 🔒 CANCELAMENTO BLOQUEADO] Nova mensagem recebida para ${conversaId}, mas o lote em andamento já executou ação de escrita no sistema (${estado.motivoBloqueioCancelamento || 'tool de escrita'}). Mensagem enfileirada para o próximo lote.`
      );
      estado.filaEsperaAposProcessamento.push(item);
      return;
    }

    console.log(
      `[Agrupador ⚡ CANCELAMENTO SEGURO] Nova mensagem recebida antes do envio e sem tools de escrita! Cancelando processamento anterior para reprocessar com o lote completo...`
    );
    if (estado.abortController) {
      estado.abortController.abort();
      estado.abortController = null;
    }
    // Recombina os itens do lote anterior que foi abortado com o novo item recebido
    const itensRecombinados = [...estado.loteEmProcessamento, ...estado.loteAtual, item];
    estado.loteEmProcessamento = [];
    estado.loteAtual = itensRecombinados;
    estado.emProcessamento = false;

    // Se ainda houver áudio sendo baixado/transcrito, aguarda sua conclusão
    if (estado.mensagensEmPreparo.size > 0) {
      console.log(
        `[Agrupador ⏳] Aguardando ${estado.mensagensEmPreparo.size} mensagem(ns) em preparo antes de disparar novo lote para ${conversaId}...`
      );
      return;
    }

    // Dispara imediatamente o lote consolidado
    setImmediate(async () => {
      await dispararLote(conversaId);
    });
    return;
  }

  // Não estava em processamento: adiciona ao lote atual
  estado.loteAtual.push(item);

  // Se houver mensagens em preparo (áudio sendo baixado/transcrito), não fecha o lote antes dela terminar
  if (estado.mensagensEmPreparo.size > 0) {
    console.log(
      `[Agrupador ⏳] Mensagem adicionada ao lote de ${conversaId}, aguardando ${estado.mensagensEmPreparo.size} mensagem(ns) em preparo...`
    );
    return;
  }

  // Disparo imediato na hora, sem espera de 3s (Requisito 4a)
  setImmediate(async () => {
    await dispararLote(conversaId);
  });
}

/**
 * Dispara a execução do lote de mensagens acumuladas para uma conversa
 */
async function dispararLote(conversaId: string): Promise<void> {
  const estado = estadosAgrupamento.get(conversaId);
  if (!estado) return;

  if (estado.timerAgrupamento) {
    clearTimeout(estado.timerAgrupamento);
    estado.timerAgrupamento = null;
  }

  // Se houver mensagem em preparo, não fecha o lote antes dela terminar (Requisito 1)
  if (estado.mensagensEmPreparo.size > 0) {
    console.log(
      `[Agrupador ⏳] dispararLote retido para ${conversaId}: ainda há ${estado.mensagensEmPreparo.size} mensagem(ns) em preparo.`
    );
    return;
  }

  if (estado.loteAtual.length === 0) {
    if (estado.mensagensEmPreparo.size === 0) {
      await pararPresencaDigitando(conversaId);
    }
    return;
  }

  const loteParaProcessar = [...estado.loteAtual];
  estado.loteAtual = [];
  estado.loteEmProcessamento = [...loteParaProcessar];
  estado.primeiroRecebidoEm = 0;
  estado.emProcessamento = true;
  estado.podeCancelar = true;
  estado.motivoBloqueioCancelamento = undefined;

  const abortController = new AbortController();
  estado.abortController = abortController;

  const callbackBloquearCancelamento = (motivo: string) => {
    estado.podeCancelar = false;
    estado.motivoBloqueioCancelamento = motivo;
    console.log(`[Agrupador 🔒 BLOQUEIO DE CANCELAMENTO] Lote de ${conversaId} não pode mais ser cancelado: ${motivo}`);
  };

  console.log(
    `\n[Agrupador ⚡] Iniciando processamento imediato para ${conversaId} (${loteParaProcessar.length} mensagens no lote)...`
  );

  try {
    await processarLoteUnificado(estado, loteParaProcessar, abortController.signal, callbackBloquearCancelamento);
  } catch (erro: any) {
    if (abortController.signal.aborted || erro?.name === 'AbortError') {
      console.log(`[Agrupador 🛑] Processamento do lote para ${conversaId} cancelado com sucesso.`);
    } else {
      console.error(`[Agrupador ❌] Erro ao processar lote para ${conversaId}:`, erro);
      await pararPresencaDigitando(conversaId);
    }
  } finally {
    if (estado.abortController === abortController) {
      estado.emProcessamento = false;
      estado.loteEmProcessamento = [];
      estado.abortController = null;
      estado.podeCancelar = true;
      estado.motivoBloqueioCancelamento = undefined;

      // Se havia mensagens retidas enquanto o lote com escrita rodava, dispara o próximo lote:
      if (estado.filaEsperaAposProcessamento.length > 0) {
        console.log(
          `[Agrupador 📦 PRÓXIMO LOTE] Disparando próximo lote com ${estado.filaEsperaAposProcessamento.length} mensagem(ns) retida(s) para ${conversaId}...`
        );
        const pendentes = [...estado.filaEsperaAposProcessamento];
        estado.filaEsperaAposProcessamento = [];
        estado.loteAtual = [...pendentes, ...estado.loteAtual];
        setImmediate(async () => {
          await dispararLote(conversaId);
        });
      }
    }
  }
}

/**
 * Tenta identificar titular e tipo documental mencionados pelo usuário em texto associado a documento
 */
async function tentarIdentificarTitularETipoViaTexto(
  texto: string
): Promise<{ titular?: string; tipo?: string }> {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return {};
    const openai = new OpenAI({ apiKey });

    const titularesCadastrados = await obterTodosTitulares();
    const listaNomes = titularesCadastrados.map((t) => t.nome).join(', ');

    const resposta = await chamarChatComTelemetria(
      openai,
      {
        model: 'gpt-5.4-mini',
        messages: [
          {
            role: 'system',
            content: `Você extrai o tipo de documento e o titular citado na mensagem enviada pelo usuário junto com um documento recém-enviado.
Lista de titulares oficialmente cadastrados na empresa:
${listaNomes}

Retorne ESTRITAMENTE um objeto JSON:
{
  "titular": "Nome exato do titular se identificado na mensagem, ou null",
  "tipo": "Tipo documental citado (ex: CNH, RG, Contrato, Certidão de Casamento, Alvará), ou null"
}`,
          },
          { role: 'user', content: texto },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      },
      { motivo: 'agrupador_extracao_doc_legenda' }
    );

    const parsed = JSON.parse(resposta.choices[0]?.message?.content || '{}');
    const resultado: { titular?: string; tipo?: string } = {};

    if (parsed.titular) {
      const match = resolverTitularCadastrado(parsed.titular, titularesCadastrados);
      if (match) {
        resultado.titular = match.nome;
      }
    }

    if (parsed.tipo && typeof parsed.tipo === 'string' && parsed.tipo.trim().length > 1) {
      resultado.tipo = parsed.tipo.trim();
    }

    return resultado;
  } catch (err) {
    console.warn('[Agrupador ⚠️] Falha ao extrair titular/tipo de texto do usuário via IA:', err);
    return {};
  }
}

/**
 * Processa o conjunto de mensagens unificadas do lote
 */
async function processarLoteUnificado(
  estado: EstadoAgrupamentoConversa,
  itens: ItemMensagemAgrupada[],
  abortSignal?: AbortSignal,
  bloquearCancelamento?: (motivo: string) => void
): Promise<void> {
  const { conversaId, destinatario, contato, usuarioAutorizado } = estado;
  const agoraInicioProcessamento = Date.now();

  // Inicia envio contínuo de status "digitando..." da VEGA para o WhatsApp
  iniciarPresencaDigitando(conversaId, destinatario);

  try {
    // 1. Identifica se há documentos/imagens no lote
    const itensDocumentos = itens.filter((i) => i.tipoMensagem === 'documento' || i.tipoMensagem === 'imagem');
    const itensTextoOuAudio = itens.filter((i) => i.tipoMensagem === 'texto' || i.tipoMensagem === 'audio');

    // 2. Unificação dos textos das mensagens
    // Une mensagens de texto e áudio por quebra de linha
    const partesTexto = itensTextoOuAudio
      .map((i) => i.texto?.trim())
      .filter((t) => t && t.length > 0);

    const textoConsolidado = partesTexto.join('\n');

    // Coleta de métricas e áudios do lote
    const itensAudio = itens.filter((i) => i.tipoMensagem === 'audio');
    const duracaoTotalAudio = itensAudio.reduce((acc, a) => acc + (a.duracaoAudioSegundos || 0), 0);
    const custoTotalTranscricaoUsd = itensAudio.reduce((acc, a) => acc + (a.custoTranscricaoUsd || 0), 0);
    const tempoTotalTranscricaoMs = itensAudio.reduce((acc, a) => acc + (a.tempoTranscricaoMs || 0), 0);

    // =========================================================================
    // CASO A: Documento/Imagem enviado com mensagem/legenda logo em seguida (Requisito 4)
    // =========================================================================
    if (itensDocumentos.length > 0) {
      const docItem = itensDocumentos[0]; // Considera o documento principal do lote
      const docId = docItem.documentoId;

      if (textoConsolidado && docId) {
        console.log(
          `[Agrupador 📄+💬] Documento "${docItem.nomeArquivo}" acompanhado de texto em sequência: "${textoConsolidado}". Aplicando ao documento.`
        );

        // 1. Verifica se já existe pendência ativa
        const pendenciaAtiva = await buscarPendenciaAtivaWhatsApp(conversaId);
        if (pendenciaAtiva) {
          const respostaPendencia = await processarRespostaPendenciaWhatsApp(
            pendenciaAtiva,
            textoConsolidado,
            usuarioAutorizado.nome,
            usuarioAutorizado.perfil
          );

          if (respostaPendencia) {
            await registrarEEnviarResposta(conversaId, destinatario, respostaPendencia, undefined);
            return;
          }
        }

        // 2. Se não houver pendência ativa ainda, tenta extrair titular e tipo da mensagem do usuário
        const extracao = await tentarIdentificarTitularETipoViaTexto(textoConsolidado);
        const supabase = getSupabaseClient();

        if (extracao.titular || extracao.tipo) {
          const updates: Record<string, any> = {};
          if (extracao.titular) updates.titular = extracao.titular;
          if (extracao.tipo) updates.tipo = extracao.tipo;

          // Atualiza metadata com a instrução do usuário
          const { data: docAtual } = await supabase
            .from('documentos')
            .select('id, metadata')
            .or(`id.eq.${docId},metadata->>id_legado.eq.${docId}`)
            .maybeSingle();

          const idReal = docAtual?.id || docId;
          updates.metadata = {
            ...(docAtual?.metadata || {}),
            instrucaoUsuario: textoConsolidado,
            titularIdentificadoPorTexto: extracao.titular,
            tipoIdentificadoPorTexto: extracao.tipo,
          };

          await supabase.from('documentos').update(updates).eq('id', idReal);

          let msgConfirmacao = `Recebi seu documento *${docItem.nomeArquivo}*!`;
          if (extracao.tipo && extracao.titular) {
            msgConfirmacao = `Recebi seu documento *${docItem.nomeArquivo}* e registrei como *${extracao.tipo}* d[prep] *${extracao.titular}*. Salvo com sucesso no Cofre!`.replace(
              'd[prep]',
              extracao.titular.endsWith('a') ? 'da' : 'do'
            );
          } else if (extracao.tipo) {
            msgConfirmacao = `Recebi seu documento *${docItem.nomeArquivo}* e registrei como *${extracao.tipo}*. Salvo com sucesso no Cofre!`;
          } else if (extracao.titular) {
            msgConfirmacao = `Recebi seu documento *${docItem.nomeArquivo}* vinculado a *${extracao.titular}*. Salvo com sucesso no Cofre!`;
          }

          await registrarEEnviarResposta(conversaId, destinatario, msgConfirmacao, undefined);
          return;
        } else {
          // Registra a instrução do usuário no metadata do documento para o worker considerar
          const { data: docAtual } = await supabase
            .from('documentos')
            .select('id, metadata')
            .or(`id.eq.${docId},metadata->>id_legado.eq.${docId}`)
            .maybeSingle();
          const idReal = docAtual?.id || docId;
          await supabase
            .from('documentos')
            .update({
              metadata: {
                ...(docAtual?.metadata || {}),
                instrucaoUsuario: textoConsolidado,
              },
            })
            .eq('id', idReal);
        }
      }

      // Se não houve texto complementar que resolvesse ou se foi apenas o documento sozinho:
      // Responde a mensagem padrão do documento
      const respostaDoc =
        docItem.mensagemRespostaPadraoDoc ||
        `Recebi seu documento *${docItem.nomeArquivo || 'arquivo'}*! Já foi salvo no Cofre e estou analisando com IA em segundo plano.`;
      await registrarEEnviarResposta(conversaId, destinatario, respostaDoc, undefined);
      return;
    }

    // =========================================================================
    // CASO B: Apenas mensagens de texto e/ou áudio acumuladas (Requisitos 2 e 3)
    // =========================================================================
    if (!textoConsolidado || textoConsolidado.trim().length === 0) {
      console.warn(`[Agrupador ⚠️] Lote sem texto consolidado para ${conversaId}. Encerrando.`);
      return;
    }

    console.log(
      `[Agrupador 🧠] Processando pedido unificado para "${usuarioAutorizado.nome}":\n"${textoConsolidado}"\n(Itens no lote: ${itens.length})`
    );

    // 1. Verifica se há pendência de documento ativa para responder
    const pendenciaAtiva = await buscarPendenciaAtivaWhatsApp(conversaId);
    if (pendenciaAtiva) {
      const respostaPendencia = await processarRespostaPendenciaWhatsApp(
        pendenciaAtiva,
        textoConsolidado,
        usuarioAutorizado.nome,
        usuarioAutorizado.perfil
      );

      if (respostaPendencia) {
        await registrarEEnviarResposta(conversaId, destinatario, respostaPendencia, undefined);
        return;
      }
    }

    // 2. Consulta de documentos disponíveis e histórico recente
    const docsDisponiveis = await obterDocumentosPorNivelAcesso(contato.nivelAcesso);
    const conversa = await obterConversaPorId(conversaId);
    const historicoRecente = conversa ? conversa.mensagens : [];

    // 3. Executa o orquestrador da VEGA com o texto unificado
    const origemMensagem: 'audio' | 'texto' = itensAudio.length > 0 ? 'audio' : 'texto';
    const idsMensagensLote = itens.map((i) => i.id).filter(Boolean);
    const resultadoChat = await processarMensagemChat({
      mensagemUsuario: textoConsolidado,
      historicoRecente,
      contato,
      documentosDisponiveis: docsDisponiveis,
      origemMensagem,
      idsMensagensLoteAtual: idsMensagensLote,
      abortSignal,
      bloquearCancelamento,
    });

    // Se o lote foi cancelado durante o raciocínio da IA, encerra sem enviar nada
    if (abortSignal?.aborted) {
      console.log(`[Agrupador 🛑] Processamento de ${conversaId} interrompido antes do envio (abortado).`);
      return;
    }

    const textoResposta = sanitizarRespostaTextoFinal(resultadoChat.textoResposta);
    const assistenteMsgId = `wa-msg-${Date.now()}-vega`;

    // Checagem final de cancelamento antes de enviar mensagem ao WhatsApp
    if (abortSignal?.aborted) {
      console.log(`[Agrupador 🛑] Processamento de ${conversaId} interrompido antes do envio ao WhatsApp.`);
      return;
    }

    // 4. Envia resposta para o WhatsApp (texto, anexos e localização se houver) e mede o tempo de envio
    const inicioEnvio = Date.now();
    await enviarRespostaCompletaWhatsApp(destinatario, textoResposta, resultadoChat.anexos, resultadoChat.localizacao);
    const tempoEnvioMs = Date.now() - inicioEnvio;

    // 5. MEDIÇÃO DE PONTA A PONTA (Requisito 1):
    // Calcula o tempo exato desde o recebimento do primeiro webhook até o envio confirmado pela Evolution
    const timestampsRecebimento = itens
      .map((i) => i.timestampRecebimentoWebhook)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    const menorTimestampWebhook = timestampsRecebimento.length > 0
      ? Math.min(...timestampsRecebimento)
      : agoraInicioProcessamento;

    const tempoEsperaAgrupadorMs = Math.max(
      0,
      agoraInicioProcessamento - menorTimestampWebhook - tempoTotalTranscricaoMs
    );
    const tempoTotalPontaAPontaMs = Date.now() - menorTimestampWebhook;

    // 6. Registra e consolida todas as etapas no rastro
    if (resultadoChat.rastro) {
      const etapasIniciais: any[] = [];

      // Etapa: Transcrição de Áudio (se houve)
      if (itensAudio.length > 0) {
        resultadoChat.rastro.tipoEntrada = 'audio';
        const primeiroAudio = itensAudio[0];
        resultadoChat.rastro.transcricaoAudio = {
          duracaoSegundos: duracaoTotalAudio,
          custoUsd: custoTotalTranscricaoUsd,
          modelo: primeiroAudio.modeloTranscricao || 'gpt-transcribe',
          metodoDownload: primeiroAudio.metodoDownloadAudio,
          textoOriginal: itensAudio.map((a) => a.textoTranscritoOriginal || a.texto).join('\n'),
          textoCorrigido: textoConsolidado,
          correcoesAplicadas: itensAudio.flatMap((a) => a.correcoesTranscricao || []),
        };

        etapasIniciais.push({
          ordem: 0,
          nome: 'Transcrição de Áudio (Whisper)',
          descricao: `Download e transcrição de ${itensAudio.length} áudio(s) (~${duracaoTotalAudio}s) finalizada em ${tempoTotalTranscricaoMs}ms. Custo: $${custoTotalTranscricaoUsd}.`,
          tempoMs: tempoTotalTranscricaoMs,
          detalhes: {
            totalAudios: itensAudio.length,
            duracaoSegundos: duracaoTotalAudio,
            custoUsd: custoTotalTranscricaoUsd,
            tempoMs: tempoTotalTranscricaoMs,
          },
        });

        resultadoChat.rastro.custoEstimadoUsd = Number(
          ((resultadoChat.rastro.custoEstimadoUsd || 0) + custoTotalTranscricaoUsd).toFixed(6)
        );
      }

      // Etapa: Espera no Agrupador / Fila (se relevante, > 10ms)
      if (tempoEsperaAgrupadorMs > 10) {
        etapasIniciais.push({
          ordem: 0,
          nome: 'Espera no Agrupador / Fila',
          descricao: `Mensagem aguardou ${tempoEsperaAgrupadorMs}ms na fila do agrupador (preparo de áudio / debounce / lote anterior).`,
          tempoMs: tempoEsperaAgrupadorMs,
          detalhes: {
            tempoEsperaAgrupadorMs,
            totalMensagensNoLote: itens.length,
          },
        });
      }

      // Consolida: [Etapas Iniciais] + [Etapas Orquestrador (OpenAI / Tools)] + [Envio Evolution]
      resultadoChat.rastro.etapas = [...etapasIniciais, ...(resultadoChat.rastro.etapas || [])];

      resultadoChat.rastro.etapas.push({
        ordem: 0,
        nome: 'Envio WhatsApp (Evolution API)',
        descricao: `Mensagem entregue e confirmada via Evolution API em ${tempoEnvioMs}ms.`,
        tempoMs: tempoEnvioMs,
        detalhes: {
          destinatario,
          tempoEnvioMs,
          temAnexo: Boolean(resultadoChat.anexos && resultadoChat.anexos.length > 0),
          temLocalizacao: Boolean(resultadoChat.localizacao),
        },
      });

      // Reordena sequencialmente
      resultadoChat.rastro.etapas.forEach((etapa, idx) => {
        etapa.ordem = idx + 1;
      });

      // Define o tempo total real de ponta a ponta
      resultadoChat.rastro.tempoTotalMs = tempoTotalPontaAPontaMs;
      resultadoChat.rastro.mensagemId = assistenteMsgId;
      resultadoChat.rastro.conversaId = conversaId;
      resultadoChat.rastro.usuarioNome = usuarioAutorizado.nome;
      resultadoChat.rastro.usuarioId = usuarioAutorizado.id;

      try {
        await salvarRastro(resultadoChat.rastro);
      } catch (e: any) {
        console.warn('[Agrupador ⚠️] Falha ao salvar rastro no Supabase:', e?.message || e);
      }

      console.log(
        `\n[Agrupador ⏱️ PONTA A PONTA] Total: ${(tempoTotalPontaAPontaMs / 1000).toFixed(2)}s (${tempoTotalPontaAPontaMs}ms) para "${usuarioAutorizado.nome}":`
      );
      for (const e of resultadoChat.rastro.etapas) {
        console.log(`   - ${e.nome.padEnd(35)}: ${e.tempoMs}ms`);
      }
      console.log('');
    }

    // 7. Registra e transmite a resposta única da VEGA na conversa
    const msgAssistente: Mensagem = {
      id: assistenteMsgId,
      remetente: 'assistente',
      nomeRemetente: ASSISTENTE.nomeExibicao,
      horario: formatarHorarioBrasilia(),
      timestamp: obterAgoraIsoUtc(),
      texto: textoResposta,
      origem: resultadoChat.origem,
      rastro: resultadoChat.rastro,
      documentoOferecidoId: resultadoChat.documentoOferecidoId,
      opcoes: resultadoChat.opcoes && resultadoChat.opcoes.length > 0 ? resultadoChat.opcoes : undefined,
      anexos: resultadoChat.anexos,
      dadosEstruturados: resultadoChat.dadosEstruturados,
    };

    const conversaAtualizada = await adicionarMensagem(conversaId, msgAssistente);
    if (conversaAtualizada) {
      eventosPainel.emitirNovaMensagem(conversaId, msgAssistente, conversaAtualizada);
    }

    const tempoTotal = Date.now() - agoraInicioProcessamento;
    console.log(
      `[Agrupador 🤖] Resposta única enviada para "${usuarioAutorizado.nome}" em ${tempoTotal}ms (Lote de ${itens.length} mensagens, envio WhatsApp: ${tempoEnvioMs}ms).`
    );
  } finally {
    // Garante que o status digitando pare quando a resposta for enviada ou em caso de erro
    await pararPresencaDigitando(conversaId);
  }
}

/**
 * Helper para registrar mensagem do assistente na conversa, transmitir ao painel e enviar ao WhatsApp
 */
async function registrarEEnviarResposta(
  conversaId: string,
  destinatario: string,
  textoResposta: string,
  anexos?: Anexo[]
): Promise<void> {
  const msgAssistente: Mensagem = {
    id: `wa-msg-${Date.now()}-vega`,
    remetente: 'assistente',
    nomeRemetente: ASSISTENTE.nomeExibicao,
    horario: formatarHorarioBrasilia(),
    timestamp: obterAgoraIsoUtc(),
    texto: textoResposta,
    origem: 'motor',
    anexos,
  };

  const conversaAtualizada = await adicionarMensagem(conversaId, msgAssistente);
  if (conversaAtualizada) {
    eventosPainel.emitirNovaMensagem(conversaId, msgAssistente, conversaAtualizada);
  }

  await enviarRespostaCompletaWhatsApp(destinatario, textoResposta, anexos);
}
