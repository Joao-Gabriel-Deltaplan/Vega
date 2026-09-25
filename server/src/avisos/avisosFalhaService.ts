import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  TipoAviso,
  SeveridadeAviso,
  StatusAviso,
  AvisoSistemaRegistro,
  ConfiguracaoAvisos,
} from '../types.js';
import { enviarTextoEvolution } from '../whatsapp/evolutionSenderService.js';
import { obterAgoraIsoUtc } from '../utils/dataHoraUtils.js';

// ============================================================================
// CONSTANTES & ESTADOS EM MEMÓRIA
// ============================================================================
const CACHE_CONFIG_TTL_MS = 30000; // 30 segundos
let cacheConfiguracao: { dados: ConfiguracaoAvisos; timestamp: number } | null = null;

// Mapa para rastreamento de último envio de WhatsApp por chave de agrupamento (Anti-Spam)
// chaveAgrupamento -> { ultimoEnvioWhatsappMs: number, ocorrenciasDesdeUltimoAviso: number }
const mapaAntiSpam = new Map<string, { ultimoEnvioWhatsappMs: number; ocorrenciasDesdeUltimoAviso: number }>();

// Intervalo mínimo para resumo de erro recorrente: 1 hora (3600000 ms)
const INTERVALO_RESUMO_HORARIO_MS = 60 * 60 * 1000;

// Estado de saúde dos serviços para emitir alerta de recuperação
// servico -> boolean (true se está com falha ativa)
const servicosComFalha = new Map<string, boolean>();

/**
 * Formata data/hora para o padrão legível oficial de Brasília (DD/MM/AAAA HH:mm:ss)
 */
function formatarDataHoraBrasilia(data: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(data);
}

/**
 * Retorna a chave do mês atual no fuso de Brasília (ex: "2026-09")
 */
function obterMesAtualBrasilia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const ano = parts.find((p) => p.type === 'year')?.value || '2026';
  const mes = parts.find((p) => p.type === 'month')?.value || '09';
  return `${ano}-${mes}`;
}

// ============================================================================
// CONFIGURAÇÕES DE AVISOS (CRUD & CACHE)
// ============================================================================

export async function obterConfiguracoesAvisos(): Promise<ConfiguracaoAvisos> {
  const agora = Date.now();
  if (cacheConfiguracao && agora - cacheConfiguracao.timestamp < CACHE_CONFIG_TTL_MS) {
    return cacheConfiguracao.dados;
  }

  const configPadrao: ConfiguracaoAvisos = {
    id: 'config_padrao',
    destinatariosWhatsapp: [],
    limiteMensalUsd: 50.0,
    notificar50Porcento: true,
    notificar80Porcento: true,
    notificar100Porcento: true,
    tiposAtivos: [
      'openai_erro',
      'consumo_limite',
      'evolution_falha',
      'supabase_falha',
      'indexacao_falha',
      'transcricao_falha',
      'recuperacao',
    ],
    faixasNotificadasMesAtual: {},
  };

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('configuracoes_avisos')
      .select('*')
      .eq('id', 'config_padrao')
      .maybeSingle();

    if (error || !data) {
      cacheConfiguracao = { dados: configPadrao, timestamp: agora };
      return configPadrao;
    }

    const configLida: ConfiguracaoAvisos = {
      id: data.id,
      destinatariosWhatsapp: Array.isArray(data.destinatarios_whatsapp)
        ? data.destinatarios_whatsapp
        : [],
      limiteMensalUsd: Number(data.limite_mensal_usd ?? 50.0),
      notificar50Porcento: Boolean(data.notificar_50_porcento ?? true),
      notificar80Porcento: Boolean(data.notificar_80_porcento ?? true),
      notificar100Porcento: Boolean(data.notificar_100_porcento ?? true),
      tiposAtivos: Array.isArray(data.tipos_ativos)
        ? data.tipos_ativos
        : configPadrao.tiposAtivos,
      faixasNotificadasMesAtual:
        data.faixas_notificadas_mes_atual && typeof data.faixas_notificadas_mes_atual === 'object'
          ? data.faixas_notificadas_mes_atual
          : {},
      criadoEm: data.criado_em,
      atualizadoEm: data.atualizado_em,
    };

    cacheConfiguracao = { dados: configLida, timestamp: agora };
    return configLida;
  } catch (err) {
    console.warn('[Avisos Falha ⚠️] Erro ao carregar configurações de avisos:', err);
    return configPadrao;
  }
}

export async function salvarConfiguracoesAvisos(
  dados: Partial<ConfiguracaoAvisos>
): Promise<ConfiguracaoAvisos> {
  const configAtual = await obterConfiguracoesAvisos();
  const agoraIso = obterAgoraIsoUtc();

  const payload: any = {
    atualizado_em: agoraIso,
  };

  if (dados.destinatariosWhatsapp !== undefined) {
    // Normaliza para strings limpas
    payload.destinatarios_whatsapp = dados.destinatariosWhatsapp.map((n) =>
      n.replace(/\D/g, '')
    ).filter(Boolean);
  }
  if (dados.limiteMensalUsd !== undefined) payload.limite_mensal_usd = dados.limiteMensalUsd;
  if (dados.notificar50Porcento !== undefined) payload.notificar_50_porcento = dados.notificar50Porcento;
  if (dados.notificar80Porcento !== undefined) payload.notificar_80_porcento = dados.notificar80Porcento;
  if (dados.notificar100Porcento !== undefined) payload.notificar_100_porcento = dados.notificar100Porcento;
  if (dados.tiposAtivos !== undefined) payload.tipos_ativos = dados.tiposAtivos;
  if (dados.faixasNotificadasMesAtual !== undefined) {
    payload.faixas_notificadas_mes_atual = dados.faixasNotificadasMesAtual;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('configuracoes_avisos')
      .upsert({ id: 'config_padrao', ...payload })
      .select()
      .single();

    if (error) {
      console.error('[Avisos Falha ❌] Erro ao salvar configurações no Supabase:', error);
      throw error;
    }

    cacheConfiguracao = null; // Invalida cache
    return await obterConfiguracoesAvisos();
  } catch (err) {
    console.error('[Avisos Falha ❌] Falha fatal ao salvar configurações de avisos:', err);
    throw err;
  }
}

// ============================================================================
// ENVIO SEGURO DE WHATSAPP PARA DESTINATÁRIOS
// ============================================================================

async function enviarAvisoParaDestinatariosWhatsApp(
  texto: string,
  destinatarios: string[]
): Promise<string[]> {
  if (!destinatarios || destinatarios.length === 0) return [];

  const enviadosSucesso: string[] = [];

  for (const numero of destinatarios) {
    try {
      const res = await enviarTextoEvolution(numero, texto);
      if (res.sucesso) {
        enviadosSucesso.push(numero);
      }
    } catch (err) {
      console.warn(`[Avisos WhatsApp ⚠️] Falha ao enviar aviso para ${numero}:`, err);
    }
  }

  return enviadosSucesso;
}

// ============================================================================
// REGISTRO DE AVISO COM ANTI-SPAM INTELIGENTE
// ============================================================================

export interface ParametrosRegistroAviso {
  tipo: TipoAviso;
  severidade: SeveridadeAviso;
  origem: string;
  titulo: string;
  mensagem?: string;
  mensagemTecnica?: string | null;
  detalheTecnico?: string | null;
  chaveAgrupamento?: string; // Se omitido, é derivado de tipo + origem
}

export async function registrarAviso(
  params: ParametrosRegistroAviso
): Promise<AvisoSistemaRegistro | null> {
  const config = await obterConfiguracoesAvisos();

  // Verifica se o tipo de aviso está ativado nas configurações
  if (config.tiposAtivos && !config.tiposAtivos.includes(params.tipo)) {
    console.log(`[Avisos Falha ℹ️] Tipo de aviso "${params.tipo}" desativado nas configurações.`);
    return null;
  }

  const mensagemFinal = params.mensagem || params.mensagemTecnica || params.titulo;
  const detalheTecnicoFinal = params.detalheTecnico !== undefined ? params.detalheTecnico : (params.mensagemTecnica || null);

  const chaveAgrupamento =
    params.chaveAgrupamento ||
    `${params.tipo}:${params.origem}:${params.titulo.slice(0, 30).toLowerCase().replace(/\s+/g, '_')}`;

  const agoraDate = new Date();
  const agoraIso = agoraDate.toISOString();
  const dataHoraBrasilia = formatarDataHoraBrasilia(agoraDate);

  try {
    const supabase = getSupabaseClient();

    // 1. Busca se já existe um aviso 'ativo' com esta mesma chave
    const { data: avisoExistente, error: errBusca } = await supabase
      .from('avisos_sistema')
      .select('*')
      .eq('chave_agrupamento', chaveAgrupamento)
      .eq('status', 'ativo')
      .maybeSingle();

    if (errBusca) {
      console.warn('[Avisos Falha ⚠️] Erro ao buscar aviso existente:', errBusca);
    }

    const rastreamento = mapaAntiSpam.get(chaveAgrupamento) || {
      ultimoEnvioWhatsappMs: 0,
      ocorrenciasDesdeUltimoAviso: 0,
    };

    // MARCA O SERVIÇO COMO COM FALHA ATIVA PARA PERMITIR AVISO DE RECUPERAÇÃO DEPOIS
    const chaveServico = params.origem.toLowerCase().split(' ')[0];
    servicosComFalha.set(chaveServico, true);

    // ========================================================================
    // CASO A: O ERRO JÁ EXISTE E ESTÁ ATIVO (RECORRENTE)
    // ========================================================================
    if (avisoExistente) {
      const novaQtd = (avisoExistente.quantidade_ocorrencias || 1) + 1;
      rastreamento.ocorrenciasDesdeUltimoAviso += 1;

      await supabase
        .from('avisos_sistema')
        .update({
          quantidade_ocorrencias: novaQtd,
          ultima_ocorrencia: agoraIso,
          detalhe_tecnico: detalheTecnicoFinal || avisoExistente.detalhe_tecnico,
          atualizado_em: agoraIso,
        })
        .eq('id', avisoExistente.id);

      console.log(
        `[Avisos Falha 🔄] Erro recorrente (${novaQtd}x): "${params.titulo}" em "${params.origem}".`
      );

      // Checa se já se passou 1 hora desde o último envio para mandar resumo horário
      const tempoDecorridoMs = Date.now() - rastreamento.ultimoEnvioWhatsappMs;
      if (
        tempoDecorridoMs >= INTERVALO_RESUMO_HORARIO_MS &&
        params.tipo !== 'evolution_falha' &&
        config.destinatariosWhatsapp.length > 0
      ) {
        const textoResumo =
          `⚠️ *[VEGA Alerta — Resumo Horário]*\n\n` +
          `O erro em *${params.origem}* continuou se repetindo: ocorreram *${rastreamento.ocorrenciasDesdeUltimoAviso} novas falhas* na última hora (total acumulado: ${novaQtd}x).\n\n` +
          `*Aviso:* ${mensagemFinal}\n` +
          (detalheTecnicoFinal ? `*Detalhe:* _${detalheTecnicoFinal.slice(0, 160)}_\n\n` : '\n') +
          `🕒 ${dataHoraBrasilia}`;

        await enviarAvisoParaDestinatariosWhatsApp(textoResumo, config.destinatariosWhatsapp);
        rastreamento.ultimoEnvioWhatsappMs = Date.now();
        rastreamento.ocorrenciasDesdeUltimoAviso = 0;
        mapaAntiSpam.set(chaveAgrupamento, rastreamento);
      } else {
        mapaAntiSpam.set(chaveAgrupamento, rastreamento);
      }

      return {
        id: avisoExistente.id,
        tipo: avisoExistente.tipo as TipoAviso,
        severidade: avisoExistente.severidade as SeveridadeAviso,
        origem: avisoExistente.origem,
        titulo: avisoExistente.titulo,
        mensagem: avisoExistente.mensagem,
        detalheTecnico: detalheTecnicoFinal || avisoExistente.detalhe_tecnico,
        chaveAgrupamento: avisoExistente.chave_agrupamento,
        quantidadeOcorrencias: novaQtd,
        primeiraOcorrencia: avisoExistente.primeira_ocorrencia,
        ultimaOcorrencia: agoraIso,
        status: avisoExistente.status as StatusAviso,
        enviadoWhatsapp: avisoExistente.enviado_whatsapp,
        destinatariosWhatsapp: avisoExistente.destinatarios_whatsapp,
        criadoEm: avisoExistente.criado_em,
        atualizadoEm: agoraIso,
      };
    }

    // ========================================================================
    // CASO B: NOVO ERRO (PRIMEIRA OCORRÊNCIA)
    // ========================================================================
    const novoId = `aviso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let enviadoWhatsapp = false;
    let destinatariosEnviados: string[] = [];

    // Se NÃO for erro da Evolution API, envia mensagem no WhatsApp imediatamente
    if (params.tipo !== 'evolution_falha' && config.destinatariosWhatsapp.length > 0) {
      const icone =
        params.severidade === 'critico' || params.severidade === 'critica'
          ? '🚨'
          : params.severidade === 'alerta' || params.severidade === 'alta'
          ? '⚠️'
          : 'ℹ️';

      const textoMensagem =
        `${icone} *[VEGA Alerta — ${params.severidade.toUpperCase()}]*\n\n` +
        `*${params.titulo}*\n` +
        `*Origem:* ${params.origem}\n\n` +
        `${mensagemFinal}\n` +
        (detalheTecnicoFinal ? `\n_Detalhe técnico:_ ${detalheTecnicoFinal.slice(0, 220)}\n\n` : '\n') +
        `🕒 ${dataHoraBrasilia}`;

      destinatariosEnviados = await enviarAvisoParaDestinatariosWhatsApp(
        textoMensagem,
        config.destinatariosWhatsapp
      );
      enviadoWhatsapp = destinatariosEnviados.length > 0;
    }

    // Registra no banco
    const registro: AvisoSistemaRegistro = {
      id: novoId,
      tipo: params.tipo,
      severidade: params.severidade,
      origem: params.origem,
      titulo: params.titulo,
      mensagem: mensagemFinal,
      detalheTecnico: detalheTecnicoFinal || null,
      chaveAgrupamento,
      quantidadeOcorrencias: 1,
      primeiraOcorrencia: agoraIso,
      ultimaOcorrencia: agoraIso,
      status: 'ativo',
      enviadoWhatsapp,
      destinatariosWhatsapp: destinatariosEnviados,
      criadoEm: agoraIso,
      atualizadoEm: agoraIso,
    };

    await supabase.from('avisos_sistema').insert({
      id: registro.id,
      tipo: registro.tipo,
      severidade: registro.severidade,
      origem: registro.origem,
      titulo: registro.titulo,
      mensagem: registro.mensagem,
      detalhe_tecnico: registro.detalheTecnico,
      chave_agrupamento: registro.chaveAgrupamento,
      quantidade_ocorrencias: 1,
      primeira_ocorrencia: agoraIso,
      ultima_ocorrencia: agoraIso,
      status: 'ativo',
      enviado_whatsapp: enviadoWhatsapp,
      destinatarios_whatsapp: destinatariosEnviados,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    });

    mapaAntiSpam.set(chaveAgrupamento, {
      ultimoEnvioWhatsappMs: Date.now(),
      ocorrenciasDesdeUltimoAviso: 0,
    });

    console.log(
      `[Avisos Falha 📝] Novo aviso registrado [${params.severidade}]: "${params.titulo}" (${params.origem}). WhatsApp: ${enviadoWhatsapp ? 'Enviado' : 'Não enviado'}`
    );

    return registro;
  } catch (err) {
    console.error('[Avisos Falha ❌] Falha fatal ao registrar aviso no Supabase:', err);
    return null;
  }
}

// ============================================================================
// NOTIFICAÇÃO DE RECUPERAÇÃO DO SERVIÇO
// ============================================================================

export async function notificarRecuperacaoServico(
  servico: 'openai' | 'evolution' | 'supabase' | 'transcricao' | string,
  nomeServicoLegivel?: string
): Promise<void> {
  const chave = servico.toLowerCase().split(' ')[0];
  const estavaComFalha = servicosComFalha.get(chave);

  if (!estavaComFalha) {
    return; // Se não estava com falha registrada, não precisa notificar recuperação
  }

  servicosComFalha.set(chave, false);

  const agoraDate = new Date();
  const agoraIso = agoraDate.toISOString();
  const dataHoraBrasilia = formatarDataHoraBrasilia(agoraDate);
  const nomeExibicao =
    nomeServicoLegivel ||
    (chave === 'openai'
      ? 'OpenAI'
      : chave === 'evolution'
      ? 'WhatsApp (Evolution API)'
      : chave === 'supabase'
      ? 'Supabase'
      : chave === 'transcricao'
      ? 'Transcrição de Áudio'
      : servico);

  try {
    const supabase = getSupabaseClient();

    // 1. Marca avisos ativos desse serviço como 'resolvido'
    let query = supabase
      .from('avisos_sistema')
      .update({
        status: 'resolvido',
        atualizado_em: agoraIso,
      })
      .eq('status', 'ativo');

    if (chave === 'openai') {
      query = query.in('tipo', ['openai_erro']);
    } else if (chave === 'evolution') {
      query = query.in('tipo', ['evolution_falha']);
    } else if (chave === 'supabase') {
      query = query.in('tipo', ['supabase_falha']);
    } else if (chave === 'transcricao') {
      query = query.in('tipo', ['transcricao_falha']);
    }

    await query;

    // 2. Envia WhatsApp de recuperação aos administradores configurados
    const config = await obterConfiguracoesAvisos();
    if (config.destinatariosWhatsapp && config.destinatariosWhatsapp.length > 0) {
      const textoRecuperacao =
        `✅ *[VEGA Recuperação]*\n\n` +
        `O serviço *${nomeExibicao}* voltou a responder normalmente.\n\n` +
        `🕒 ${dataHoraBrasilia}`;

      await enviarAvisoParaDestinatariosWhatsApp(textoRecuperacao, config.destinatariosWhatsapp);
    }

    // 3. Registra evento de recuperação no histórico de avisos
    await supabase.from('avisos_sistema').insert({
      id: `recuperacao-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tipo: 'recuperacao',
      severidade: 'informativo',
      origem: nomeExibicao,
      titulo: `${nomeExibicao} Normalizado`,
      mensagem: `O serviço ${nomeExibicao} restabeleceu conexão e voltou a operar normalmente.`,
      chave_agrupamento: `recuperacao:${chave}`,
      quantidade_ocorrencias: 1,
      primeira_ocorrencia: agoraIso,
      ultima_ocorrencia: agoraIso,
      status: 'resolvido',
      enviado_whatsapp: config.destinatariosWhatsapp.length > 0,
      destinatarios_whatsapp: config.destinatariosWhatsapp,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    });

    console.log(`[Avisos Falha ✅] Serviço "${nomeExibicao}" normalizado e notificado.`);
  } catch (err) {
    console.warn('[Avisos Falha ⚠️] Erro ao registrar recuperação de serviço:', err);
  }
}

// ============================================================================
// VERIFICAÇÃO DE GASTO E CONSUMO MENSAL
// ============================================================================

export async function verificarLimitesConsumoMensal(gastoTotalMesUsd: number): Promise<void> {
  const config = await obterConfiguracoesAvisos();
  const limiteUsd = config.limiteMensalUsd;

  if (!limiteUsd || limiteUsd <= 0) return;

  const mesAtual = obterMesAtualBrasilia();
  const faixasMes = config.faixasNotificadasMesAtual[mesAtual] || [];
  const percentual = Math.round((gastoTotalMesUsd / limiteUsd) * 100);

  const faixasParaChecar: Array<{ limite: number; ativo: boolean; severidade: SeveridadeAviso }> = [
    { limite: 100, ativo: config.notificar100Porcento, severidade: 'critico' },
    { limite: 80, ativo: config.notificar80Porcento, severidade: 'alerta' },
    { limite: 50, ativo: config.notificar50Porcento, severidade: 'informativo' },
  ];

  for (const f of faixasParaChecar) {
    if (!f.ativo) continue;

    // Se atingiu a faixa e ainda não notificou esta faixa neste mês
    if (percentual >= f.limite && !faixasMes.includes(f.limite)) {
      console.log(
        `[Avisos Consumo 💳] Limite de ${f.limite}% atingido: $${gastoTotalMesUsd.toFixed(2)} de $${limiteUsd.toFixed(2)} USD.`
      );

      // Marca a faixa no mês
      faixasMes.push(f.limite);
      config.faixasNotificadasMesAtual[mesAtual] = faixasMes;
      await salvarConfiguracoesAvisos({ faixasNotificadasMesAtual: config.faixasNotificadasMesAtual });

      // Registra aviso de consumo
      const titulo =
        f.limite === 100
          ? 'Limite Mensal de Consumo Esgotado (100%)'
          : `Gasto Mensal atingiu ${f.limite}% do limite configurado`;

      const mensagem =
        f.limite === 100
          ? `O gasto mensal com OpenAI atingiu 100% do limite ($${gastoTotalMesUsd.toFixed(2)} de $${limiteUsd.toFixed(2)} USD). O assistente foi temporariamente pausado para proteger o orçamento.`
          : `O gasto mensal com OpenAI atingiu ${f.limite}% do limite configurado ($${gastoTotalMesUsd.toFixed(2)} de $${limiteUsd.toFixed(2)} USD).`;

      await registrarAviso({
        tipo: 'consumo_limite',
        severidade: f.severidade,
        origem: 'Controle de Gastos',
        titulo,
        mensagem,
        detalheTecnico: `Gasto Atual: $${gastoTotalMesUsd.toFixed(4)} USD | Limite: $${limiteUsd.toFixed(2)} USD | Mês: ${mesAtual}`,
        chaveAgrupamento: `consumo:${mesAtual}:${f.limite}`,
      });

      break; // Notifica uma faixa por vez
    }
  }
}

/**
 * Retorna true se o limite de 100% do consumo mensal estiver excedido
 */
export async function checarSeLimiteConsumoEstourado(gastoTotalMesUsd?: number): Promise<boolean> {
  const config = await obterConfiguracoesAvisos();
  if (!config.limiteMensalUsd || config.limiteMensalUsd <= 0) return false;

  let gasto = gastoTotalMesUsd;
  if (gasto === undefined) {
    try {
      const supabase = getSupabaseClient();
      const mesAtual = obterMesAtualBrasilia(); // "2026-09"
      const inicioMes = `${mesAtual}-01T00:00:00.000Z`;
      const { data } = await supabase
        .from('uso_ia')
        .select('custo_estimado')
        .gte('data', inicioMes);
      gasto = (data || []).reduce((acc: number, r: any) => acc + (Number(r.custo_estimado) || 0), 0);
    } catch {
      gasto = 0;
    }
  }

  return (gasto || 0) >= config.limiteMensalUsd;
}

// ============================================================================
// CONSULTA, LIDO E LIMPEZA DE AVISOS
// ============================================================================

export async function listarAvisosSistema(filtros?: {
  status?: StatusAviso;
  tipo?: TipoAviso;
  apenasAtivos?: boolean;
  limite?: number;
}): Promise<AvisoSistemaRegistro[]> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('avisos_sistema')
      .select('*')
      .order('ultima_ocorrencia', { ascending: false })
      .limit(filtros?.limite || 100);

    if (filtros?.apenasAtivos) {
      query = query.eq('status', 'ativo');
    } else if (filtros?.status) {
      query = query.eq('status', filtros.status);
    }

    if (filtros?.tipo) {
      query = query.eq('tipo', filtros.tipo);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[Avisos Falha ⚠️] Erro ao listar avisos:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      tipo: row.tipo as TipoAviso,
      severidade: row.severidade as SeveridadeAviso,
      origem: row.origem,
      titulo: row.titulo,
      mensagem: row.mensagem,
      detalheTecnico: row.detalhe_tecnico,
      chaveAgrupamento: row.chave_agrupamento,
      quantidadeOcorrencias: Number(row.quantidade_ocorrencias || 1),
      primeiraOcorrencia: row.primeira_ocorrencia,
      ultimaOcorrencia: row.ultima_ocorrencia,
      status: row.status as StatusAviso,
      enviadoWhatsapp: Boolean(row.enviado_whatsapp),
      destinatariosWhatsapp: row.destinatarios_whatsapp,
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em,
    }));
  } catch (err) {
    console.error('[Avisos Falha ⚠️] Erro inesperado ao listar avisos:', err);
    return [];
  }
}

export async function contarAvisosAtivos(): Promise<{ totalAtivos: number; naoLidos: number }> {
  try {
    const supabase = getSupabaseClient();
    const { count: ativosCount } = await supabase
      .from('avisos_sistema')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ativo');

    const { count: naoLidosCount } = await supabase
      .from('avisos_sistema')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'lido');

    return {
      totalAtivos: ativosCount || 0,
      naoLidos: naoLidosCount || 0,
    };
  } catch {
    return { totalAtivos: 0, naoLidos: 0 };
  }
}

export async function marcarAvisoComoLido(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('avisos_sistema')
      .update({
        status: 'lido',
        atualizado_em: obterAgoraIsoUtc(),
      })
      .eq('id', id);

    return !error;
  } catch {
    return false;
  }
}

export async function marcarTodosAvisosLidos(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('avisos_sistema')
      .update({
        status: 'lido',
        atualizado_em: obterAgoraIsoUtc(),
      })
      .eq('status', 'ativo');

    return !error;
  } catch {
    return false;
  }
}

/**
 * Remove automaticamente registros com mais de 30 dias para não sobrecarregar o banco
 */
export async function limparAvisosAntigos30Dias(): Promise<number> {
  try {
    const supabase = getSupabaseClient();
    const limite30DiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('avisos_sistema')
      .delete()
      .lt('criado_em', limite30DiasAtras)
      .select('id');

    if (error) {
      console.warn('[Avisos Falha ⚠️] Erro ao limpar avisos antigos de 30 dias:', error);
      return 0;
    }

    const totalLimpos = data?.length || 0;
    if (totalLimpos > 0) {
      console.log(`[Avisos Falha 🧹] ${totalLimpos} avisos com mais de 30 dias foram expurgados.`);
    }
    return totalLimpos;
  } catch {
    return 0;
  }
}

// ============================================================================
// SIMULAÇÃO DE TESTES PARA VALIDAÇÃO COMPLETA
// ============================================================================

export async function simularFalhaParaTeste(
  cenario:
    | 'openai'
    | 'openai_erro'
    | 'consumo_50'
    | 'consumo_80'
    | 'consumo_100'
    | 'consumo'
    | 'consumo_limite'
    | 'evolution'
    | 'evolution_falha'
    | 'supabase'
    | 'supabase_falha'
    | 'indexacao'
    | 'indexacao_falha'
    | 'transcricao'
    | 'transcricao_falha'
    | 'recuperacao'
    | string
): Promise<{ sucesso: boolean; mensagem: string; aviso?: AvisoSistemaRegistro }> {
  switch (cenario) {
    case 'openai':
    case 'openai_erro': {
      const aviso = await registrarAviso({
        tipo: 'openai_erro',
        severidade: 'critico',
        origem: 'OpenAI Chat (gpt-5.4-mini)',
        titulo: 'Simulação: Falha de Chamada à OpenAI',
        mensagem: 'Falha simulada na chamada à API da OpenAI (erro 429 - cota excedida ou timeout).',
        detalheTecnico: 'Error: Rate limit reached for model gpt-5.4-mini in organization org-test (simulado)',
        chaveAgrupamento: 'simulacao:openai:erro',
      });
      return { sucesso: true, mensagem: 'Simulação de erro da OpenAI executada com sucesso.', aviso: aviso || undefined };
    }

    case 'consumo_50':
    case 'consumo':
    case 'consumo_limite': {
      const aviso = await registrarAviso({
        tipo: 'consumo_limite',
        severidade: 'informativo',
        origem: 'Controle de Gastos',
        titulo: 'Simulação: Gasto Mensal atingiu 50%',
        mensagem: 'O gasto mensal atingiu 50% do limite estabelecido ($25.00 de $50.00 USD).',
        detalheTecnico: 'Simulação de gatilho de 50% de consumo mensal.',
        chaveAgrupamento: 'simulacao:consumo:50',
      });
      return { sucesso: true, mensagem: 'Simulação de 50% de consumo executada com sucesso.', aviso: aviso || undefined };
    }

    case 'consumo_80': {
      const aviso = await registrarAviso({
        tipo: 'consumo_limite',
        severidade: 'alerta',
        origem: 'Controle de Gastos',
        titulo: 'Simulação: Gasto Mensal atingiu 80%',
        mensagem: 'Atenção: o gasto mensal atingiu 80% do limite ($40.00 de $50.00 USD).',
        detalheTecnico: 'Simulação de gatilho de 80% de consumo mensal.',
        chaveAgrupamento: 'simulacao:consumo:80',
      });
      return { sucesso: true, mensagem: 'Simulação de 80% de consumo executada com sucesso.', aviso: aviso || undefined };
    }

    case 'consumo_100': {
      const aviso = await registrarAviso({
        tipo: 'consumo_limite',
        severidade: 'critico',
        origem: 'Controle de Gastos',
        titulo: 'Simulação: Limite Mensal Esgotado (100%)',
        mensagem: 'O limite mensal de 100% foi atingido ($50.00 de $50.00 USD). A VEGA responderá com aviso de indisponibilidade temporária.',
        detalheTecnico: 'Simulação de gatilho de 100% de consumo mensal.',
        chaveAgrupamento: 'simulacao:consumo:100',
      });
      return { sucesso: true, mensagem: 'Simulação de 100% de consumo executada com sucesso.', aviso: aviso || undefined };
    }

    case 'evolution':
    case 'evolution_falha': {
      const aviso = await registrarAviso({
        tipo: 'evolution_falha',
        severidade: 'critico',
        origem: 'Evolution API (WhatsApp)',
        titulo: 'Simulação: Desconexão da Evolution API',
        mensagem: 'Falha simulada de comunicação com a Evolution API. WhatsApp desconectado ou indisponível.',
        detalheTecnico: 'FetchError: connect ECONNREFUSED 127.0.0.1:8080 (simulado)',
        chaveAgrupamento: 'simulacao:evolution:falha',
      });
      return { sucesso: true, mensagem: 'Simulação de falha da Evolution API registrada.', aviso: aviso || undefined };
    }

    case 'supabase':
    case 'supabase_falha': {
      const aviso = await registrarAviso({
        tipo: 'supabase_falha',
        severidade: 'critico',
        origem: 'Supabase Database',
        titulo: 'Simulação: Falha de Conexão com Supabase',
        mensagem: 'Falha simulada de consulta ou conexão com o banco de dados Supabase.',
        detalheTecnico: 'PostgrestError: connection timeout / database unavailable (simulado)',
        chaveAgrupamento: 'simulacao:supabase:falha',
      });
      return { sucesso: true, mensagem: 'Simulação de falha do Supabase registrada.', aviso: aviso || undefined };
    }

    case 'indexacao':
    case 'indexacao_falha': {
      const aviso = await registrarAviso({
        tipo: 'indexacao_falha',
        severidade: 'alerta',
        origem: 'Indexador de Documentos',
        titulo: 'Simulação: Documento Finalizado com Zero Trechos',
        mensagem: 'O documento "Contrato_Teste.pdf" finalizou o processamento gerando 0 trechos vetoriais.',
        detalheTecnico: 'IndexacaoError: documento_id doc_teste gerou 0 trechos legíveis (simulado)',
        chaveAgrupamento: 'simulacao:indexacao:falha',
      });
      return { sucesso: true, mensagem: 'Simulação de falha de indexação registrada.', aviso: aviso || undefined };
    }

    case 'transcricao':
    case 'transcricao_falha': {
      const aviso = await registrarAviso({
        tipo: 'transcricao_falha',
        severidade: 'alerta',
        origem: 'Transcrição de Áudio (gpt-transcribe)',
        titulo: 'Simulação: Falha na Transcrição de Áudio',
        mensagem: 'Falha simulada ao tentar transcrever mensagem de voz via OpenAI Whisper/gpt-transcribe.',
        detalheTecnico: 'OpenAIError: Transcription engine failed to decode audio stream (simulado)',
        chaveAgrupamento: 'simulacao:transcricao:falha',
      });
      return { sucesso: true, mensagem: 'Simulação de falha de transcrição registrada.', aviso: aviso || undefined };
    }

    case 'recuperacao': {
      await notificarRecuperacaoServico('openai', 'OpenAI');
      return { sucesso: true, mensagem: 'Simulação de recuperação executada com sucesso.' };
    }

    default:
      return { sucesso: false, mensagem: `Cenário de teste desconhecido: "${cenario}"` };
  }
}
