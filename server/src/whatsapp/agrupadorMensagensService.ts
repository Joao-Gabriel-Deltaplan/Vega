import { Contato, Mensagem, Anexo } from '../types.js';
import { UsuarioWhatsApp } from './types.js';
import { obterConfiguracoesVegaSync } from '../config/configuracoesVegaService.js';
import { adicionarMensagem, obterConversaPorId, obterDocumentosPorNivelAcesso, obterTodosTitulares, resolverTitularCadastrado } from '../storage.js';
import { processarMensagemChat, sanitizarRespostaTextoFinal } from '../chat/chatOrquestrador.js';
import { salvarRastro } from '../rastros/rastroService.js';
import {
  enviarRespostaCompletaWhatsApp,
  iniciarPresencaDigitandoVega,
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

  // Controle de concorrência / fila
  emProcessamento: boolean;
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
 * Adiciona uma mensagem ao agrupador para ser processada em lote (debounce).
 * 
 * Regras aplicadas:
 * 1. Se tempoEspera === 0, processa imediatamente (ou enfileira se já estiver em processamento).
 * 2. Se a VEGA já estiver processando um lote anterior desta conversa (emProcessamento === true),
 *    a nova mensagem entra na fila de espera para o próximo lote (Requisito 7).
 * 3. Se o usuário estiver comprovadamente digitando (via presença da Evolution API), aguarda
 *    enquanto ele digita e processa logo que ele parar (com reserva de 3s).
 * 4. Se eventos de presença não chegarem, opera com a espera reduzida padrão de 3s (sliding window).
 * 5. Teto máximo inegociável de 20s total mesmo com evento preso.
 */
export async function adicionarMensagemAoAgrupador(entrada: EntradaAgrupador): Promise<void> {
  const { conversaId, destinatario, contato, usuarioAutorizado, item } = entrada;
  const config = obterConfiguracoesVegaSync();
  const tempoEsperaSegundos = Math.max(0, Math.min(20, config.tempoEsperaAgrupamentoSegundos ?? 3));
  const tempoEsperaMs = tempoEsperaSegundos * 1000;

  const estado = obterOuCriarEstado(conversaId, destinatario, contato, usuarioAutorizado);

  console.log(
    `[Agrupador ⏳] Mensagem recebida para conversa "${conversaId}" (Tipo: ${item.tipoMensagem}). Em processamento: ${estado.emProcessamento}. Usuário digitando: ${estado.usuarioDigitando}. Tempo reserva: ${tempoEsperaSegundos}s.`
  );

  // Se a VEGA já estiver ocupada processando um lote desta conversa:
  // a nova mensagem entra na fila pós-processamento (Requisito 7)
  if (estado.emProcessamento) {
    console.log(
      `[Agrupador 📥] VEGA ocupada processando lote anterior. Mensagem enfileirada para o próximo lote (${estado.filaEsperaAposProcessamento.length + 1} na fila).`
    );
    estado.filaEsperaAposProcessamento.push(item);
    return;
  }

  // Se o tempo configurado for 0 (debounce desativado): processa imediatamente
  if (tempoEsperaMs === 0) {
    estado.loteAtual = [item];
    await dispararLote(conversaId);
    return;
  }

  // Início de um novo lote ou continuação do lote existente
  if (estado.loteAtual.length === 0) {
    estado.primeiroRecebidoEm = Date.now();
  }

  estado.loteAtual.push(item);

  // Regra de segurança: se atingiu o máximo de 5 mensagens agrupadas, dispara imediatamente
  if (estado.loteAtual.length >= MAX_MENSAGENS_AGRUPADAS) {
    console.log(
      `[Agrupador 🚀] Limite máximo de ${MAX_MENSAGENS_AGRUPADAS} mensagens atingido para ${conversaId}. Disparando processamento imediatamente.`
    );
    if (estado.timerAgrupamento) {
      clearTimeout(estado.timerAgrupamento);
      estado.timerAgrupamento = null;
    }
    await dispararLote(conversaId);
    return;
  }

  // Calcula quanto tempo resta até o teto de 20 segundos
  const tempoDecorrido = Date.now() - estado.primeiroRecebidoEm;
  const tempoRestanteAteTeto = MAX_TEMPO_ESPERA_TOTAL_MS - tempoDecorrido;

  if (tempoRestanteAteTeto <= 0) {
    console.log(
      `[Agrupador 🚀] Teto máximo de 20s atingido para ${conversaId}. Disparando processamento imediatamente.`
    );
    if (estado.timerAgrupamento) {
      clearTimeout(estado.timerAgrupamento);
      estado.timerAgrupamento = null;
    }
    await dispararLote(conversaId);
    return;
  }

  // Cancela o timer anterior para reiniciar a contagem
  if (estado.timerAgrupamento) {
    clearTimeout(estado.timerAgrupamento);
    estado.timerAgrupamento = null;
  }

  // Se o usuário estiver comprovadamente digitando no momento da chegada da mensagem:
  if (estado.usuarioDigitando) {
    console.log(
      `[Agrupador ⌨️] Usuário "${usuarioAutorizado.nome}" está digitando. Aguardando pausa na digitação (respeitando teto de ${Math.round(tempoRestanteAteTeto / 1000)}s)...`
    );
    estado.timerAgrupamento = setTimeout(async () => {
      console.log(`[Agrupador 🚀] Teto de 20s atingido durante digitação para ${conversaId}. Disparando processamento.`);
      await dispararLote(conversaId);
    }, tempoRestanteAteTeto);
    return;
  }

  // Se o usuário não estiver digitando (ou eventos de presença não chegarem):
  // Utiliza a espera de reserva (padrão de 3s), respeitando o teto de 20s
  const proximoDelayMs = Math.min(tempoEsperaMs, tempoRestanteAteTeto);

  console.log(
    `[Agrupador ⏱️] Lote de "${conversaId}" possui ${estado.loteAtual.length} mensagem(ns). Aguardando ${proximoDelayMs / 1000}s sem novas mensagens...`
  );

  estado.timerAgrupamento = setTimeout(async () => {
    await dispararLote(conversaId);
  }, proximoDelayMs);
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

  if (estado.loteAtual.length === 0) {
    return;
  }

  // Prepara o lote para processamento e marca estado como em processamento
  const loteParaProcessar = [...estado.loteAtual];
  estado.loteAtual = [];
  estado.primeiroRecebidoEm = 0;
  estado.emProcessamento = true;

  console.log(
    `\n[Agrupador ⚡] Iniciando processamento de lote unificado para ${conversaId} (${loteParaProcessar.length} mensagens acumuladas)...`
  );

  try {
    await processarLoteUnificado(estado, loteParaProcessar);
  } catch (erro: any) {
    console.error(`[Agrupador ❌] Erro ao processar lote para ${conversaId}:`, erro);
  } finally {
    estado.emProcessamento = false;

    // Se novas mensagens chegaram durante o processamento do lote (Requisito 7):
    if (estado.filaEsperaAposProcessamento.length > 0) {
      const mensagensProximoLote = [...estado.filaEsperaAposProcessamento];
      estado.filaEsperaAposProcessamento = [];

      console.log(
        `[Agrupador 🔄] Promovendo ${mensagensProximoLote.length} mensagem(ns) da fila pós-processamento para novo lote em ${conversaId}.`
      );

      const config = obterConfiguracoesVegaSync();
      const tempoEsperaSegundos = Math.max(0, Math.min(20, config.tempoEsperaAgrupamentoSegundos ?? 3));
      const tempoEsperaMs = tempoEsperaSegundos * 1000;

      estado.loteAtual = mensagensProximoLote;
      estado.primeiroRecebidoEm = Date.now();

      if (tempoEsperaMs === 0 || estado.loteAtual.length >= MAX_MENSAGENS_AGRUPADAS) {
        // Dispara imediatamente
        setImmediate(async () => {
          await dispararLote(conversaId);
        });
      } else {
        // Agenda timer para as mensagens que estavam na fila
        estado.timerAgrupamento = setTimeout(async () => {
          await dispararLote(conversaId);
        }, tempoEsperaMs);
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
  itens: ItemMensagemAgrupada[]
): Promise<void> {
  const { conversaId, destinatario, contato, usuarioAutorizado } = estado;
  const inicioProcessamento = Date.now();

  // Inicia envio contínuo de status "digitando..." da VEGA para o WhatsApp
  const pararDigitando = iniciarPresencaDigitandoVega(destinatario);

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
    const resultadoChat = await processarMensagemChat({
      mensagemUsuario: textoConsolidado,
      historicoRecente,
      contato,
      documentosDisponiveis: docsDisponiveis,
    });

    const textoResposta = sanitizarRespostaTextoFinal(resultadoChat.textoResposta);
    const assistenteMsgId = `wa-msg-${Date.now()}-vega`;

    // 4. Se o lote conteve áudios, enriquece o rastro com transcrição e custos
    if (resultadoChat.rastro && itensAudio.length > 0) {
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

      resultadoChat.rastro.etapas.unshift({
        ordem: 0,
        nome: 'Transcrição de Áudio (Whisper) - Agrupamento',
        descricao: `Total de ${itensAudio.length} áudio(s) transcrito(s) (~${duracaoTotalAudio}s). Custo: $${custoTotalTranscricaoUsd}.`,
        tempoMs: tempoTotalTranscricaoMs,
        detalhes: {
          totalAudios: itensAudio.length,
          duracaoSegundos: duracaoTotalAudio,
          custoUsd: custoTotalTranscricaoUsd,
        },
      });

      resultadoChat.rastro.custoEstimadoUsd = Number(
        ((resultadoChat.rastro.custoEstimadoUsd || 0) + custoTotalTranscricaoUsd).toFixed(6)
      );
      resultadoChat.rastro.tempoTotalMs =
        (resultadoChat.rastro.tempoTotalMs || 0) + tempoTotalTranscricaoMs;
    }

    if (resultadoChat.rastro) {
      try {
        resultadoChat.rastro.mensagemId = assistenteMsgId;
        resultadoChat.rastro.conversaId = conversaId;
        resultadoChat.rastro.usuarioNome = usuarioAutorizado.nome;
        resultadoChat.rastro.usuarioId = usuarioAutorizado.id;
        await salvarRastro(resultadoChat.rastro);
      } catch (e: any) {
        console.warn('[Agrupador ⚠️] Falha ao salvar rastro no Supabase:', e?.message || e);
      }
    }

    // 5. Registra e transmite a resposta única da VEGA
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

    // 6. Envia resposta para o WhatsApp
    await enviarRespostaCompletaWhatsApp(destinatario, textoResposta, resultadoChat.anexos);

    const tempoTotal = Date.now() - inicioProcessamento;
    console.log(
      `[Agrupador 🤖] Resposta única enviada para "${usuarioAutorizado.nome}" em ${tempoTotal}ms (Lote de ${itens.length} mensagens).`
    );
  } finally {
    // Garante que o status digitando pare quando a resposta for enviada ou em caso de erro
    await pararDigitando();
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
