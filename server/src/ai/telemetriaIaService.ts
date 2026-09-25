import OpenAI from 'openai';
import { adicionarRegistroUsoIA, obterRegistrosUsoIA } from '../storage.js';
import { RegistroUsoIA } from '../types.js';
import {
  registrarAviso,
  notificarRecuperacaoServico,
  verificarLimitesConsumoMensal,
  obterConfiguracoesAvisos,
} from '../avisos/avisosFalhaService.js';

/**
 * Preços oficiais OpenAI homologados no projeto:
 * - gpt-5.4-mini: $0.15 / 1M entrada ($0.00000015/token), $0.60 / 1M saída ($0.00000060/token)
 * - text-embedding-3-small: $0.02 / 1M tokens ($0.00000002/token)
 * - gpt-transcribe: $0.006 / minuto
 */
export function calcularCustoChamada(
  modelo: string,
  tokensEntrada: number,
  tokensSaida: number = 0
): number {
  const mod = (modelo || '').toLowerCase();

  if (mod.includes('gpt-5.4-mini') || mod.includes('mini')) {
    const custoIn = (tokensEntrada / 1_000_000) * 0.15;
    const custoOut = (tokensSaida / 1_000_000) * 0.60;
    return Number((custoIn + custoOut).toFixed(6));
  }

  if (mod.includes('embedding') || mod.includes('text-embedding-3-small')) {
    return Number(((tokensEntrada / 1_000_000) * 0.02).toFixed(6));
  }

  // Fallback genérico para outros modelos
  const custoIn = (tokensEntrada / 1_000_000) * 0.15;
  const custoOut = (tokensSaida / 1_000_000) * 0.60;
  return Number((custoIn + custoOut).toFixed(6));
}

export interface MetadadosTelemetria {
  motivo: string;
  contatoId?: string;
  contatoNome?: string;
}

let ultimaChecagemConsumoTimestamp = 0;

/**
 * Checa o gasto acumulado no mês atual no fuso de Brasília e compara com o limite configurado.
 */
async function verificarConsumoMesAtual(): Promise<void> {
  const agora = Date.now();
  // Limita checagem a no máximo 1 vez a cada 30 segundos
  if (agora - ultimaChecagemConsumoTimestamp < 30_000) {
    return;
  }
  ultimaChecagemConsumoTimestamp = agora;

  try {
    const configAvisos = await obterConfiguracoesAvisos();
    const limiteUsd = configAvisos.limiteMensalUsd || 0;
    if (limiteUsd <= 0) return;

    const registros = await obterRegistrosUsoIA();
    const mesAtual = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());

    const registrosMes = registros.filter((r) => {
      try {
        const mesReg = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
          month: '2-digit',
        }).format(new Date(r.data));
        return mesReg === mesAtual;
      } catch {
        return false;
      }
    });

    const gastoMesUsd = Number(
      registrosMes.reduce((acc, r) => acc + (r.custoEstimado || 0), 0).toFixed(4)
    );

    await verificarLimitesConsumoMensal(gastoMesUsd);
  } catch (err) {
    console.warn('[Telemetria IA ⚠️] Erro ao checar consumo mensal:', err);
  }
}

/**
 * Registra uma chamada na tabela uso_ia do Supabase de forma assíncrona (não-bloqueante).
 */
export function registrarUsoIaAsync(dados: {
  motivo: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  custoEstimado?: number;
  contatoId?: string;
  contatoNome?: string;
  sucesso?: boolean;
  erro?: string;
}): void {
  const custo =
    dados.custoEstimado !== undefined
      ? dados.custoEstimado
      : calcularCustoChamada(dados.modelo, dados.tokensEntrada, dados.tokensSaida);

  const registro: RegistroUsoIA = {
    id: `uso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    data: new Date().toISOString(),
    provedor: 'openai',
    modelo: dados.modelo,
    contatoId: dados.contatoId,
    contatoNome: dados.contatoNome,
    motivo: dados.motivo as any,
    tokensEntrada: dados.tokensEntrada,
    tokensSaida: dados.tokensSaida,
    custoEstimado: custo,
    sucesso: dados.sucesso !== undefined ? dados.sucesso : true,
    erro: dados.erro,
  };

  adicionarRegistroUsoIA(registro)
    .then(() => {
      if (dados.sucesso) {
        verificarConsumoMesAtual().catch(() => {});
      }
    })
    .catch((err) => {
      console.warn('[Telemetria IA ⚠️] Falha ao gravar uso_ia no Supabase:', err?.message || err);
    });
}

function classificarErroOpenAI(erro: any): { titulo: string; severidade: 'baixa' | 'media' | 'alta' | 'critica'; chave: string } {
  const msg = erro?.message || String(erro);
  const msgLower = msg.toLowerCase();

  if (
    msgLower.includes('api key') ||
    msgLower.includes('incorrect api key') ||
    msgLower.includes('invalid_api_key') ||
    msgLower.includes('authentication')
  ) {
    return { titulo: 'Chave da OpenAI inválida ou ausente', severidade: 'critica', chave: 'openai_chave_invalida' };
  }

  if (
    msgLower.includes('quota') ||
    msgLower.includes('rate limit') ||
    msgLower.includes('insufficient_quota') ||
    msgLower.includes('exceeded your current quota')
  ) {
    return { titulo: 'Cota da OpenAI excedida ou limite de requisições atingido', severidade: 'critica', chave: 'openai_cota_excedida' };
  }

  if (
    msgLower.includes('model') &&
    (msgLower.includes('does not exist') || msgLower.includes('not permitted') || msgLower.includes('access'))
  ) {
    return { titulo: 'Modelo da OpenAI não permitido ou inacessível', severidade: 'alta', chave: 'openai_modelo_nao_permitido' };
  }

  if (msgLower.includes('timeout') || msgLower.includes('timed out') || msgLower.includes('etimedout')) {
    return { titulo: 'Timeout de comunicação com a OpenAI', severidade: 'alta', chave: 'openai_timeout' };
  }

  return { titulo: 'Instabilidade ou erro na OpenAI', severidade: 'alta', chave: 'openai_instabilidade' };
}

/**
 * Executa uma chamada Chat Completion da OpenAI registrando automaticamente na telemetria uso_ia.
 */
export async function chamarChatComTelemetria(
  openai: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  meta: MetadadosTelemetria
): Promise<OpenAI.Chat.ChatCompletion> {
  const modelo = params.model || 'gpt-5.4-mini';

  try {
    const resposta = await openai.chat.completions.create(params);
    const tokensIn = resposta.usage?.prompt_tokens || 0;
    const tokensOut = resposta.usage?.completion_tokens || 0;
    const custo = calcularCustoChamada(modelo, tokensIn, tokensOut);

    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: tokensIn,
      tokensSaida: tokensOut,
      custoEstimado: custo,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: true,
    });

    // Notifica recuperação se houver aviso de erro ativo para a OpenAI
    notificarRecuperacaoServico('openai').catch(() => {});

    return resposta;
  } catch (erro: any) {
    const msgErro = erro?.message || String(erro);
    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: 0,
      tokensSaida: 0,
      custoEstimado: 0,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: false,
      erro: msgErro,
    });

    const infoErro = classificarErroOpenAI(erro);
    registrarAviso({
      tipo: 'openai_erro',
      origem: `OpenAI Chat (${modelo})`,
      titulo: infoErro.titulo,
      mensagemTecnica: msgErro,
      severidade: infoErro.severidade,
      chaveAgrupamento: infoErro.chave,
    }).catch((errAviso) => {
      console.warn('[Avisos ⚠️] Falha ao registrar aviso de erro OpenAI:', errAviso);
    });

    throw erro;
  }
}

/**
 * Executa uma chamada Embeddings da OpenAI registrando automaticamente na telemetria uso_ia.
 */
export async function chamarEmbeddingsComTelemetria(
  openai: OpenAI,
  params: OpenAI.Embeddings.EmbeddingCreateParams,
  meta: MetadadosTelemetria
): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
  const modelo = params.model || 'text-embedding-3-small';

  try {
    const resposta = await openai.embeddings.create(params);
    const tokensIn = resposta.usage?.prompt_tokens || 0;
    const custo = calcularCustoChamada(modelo, tokensIn, 0);

    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: tokensIn,
      tokensSaida: 0,
      custoEstimado: custo,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: true,
    });

    // Notifica recuperação se houver aviso de erro ativo para a OpenAI
    notificarRecuperacaoServico('openai').catch(() => {});

    return resposta;
  } catch (erro: any) {
    const msgErro = erro?.message || String(erro);
    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: 0,
      tokensSaida: 0,
      custoEstimado: 0,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: false,
      erro: msgErro,
    });

    const infoErro = classificarErroOpenAI(erro);
    registrarAviso({
      tipo: 'openai_erro',
      origem: `OpenAI Embeddings (${modelo})`,
      titulo: infoErro.titulo,
      mensagemTecnica: msgErro,
      severidade: infoErro.severidade,
      chaveAgrupamento: infoErro.chave,
    }).catch((errAviso) => {
      console.warn('[Avisos ⚠️] Falha ao registrar aviso de erro OpenAI:', errAviso);
    });

    throw erro;
  }
}
