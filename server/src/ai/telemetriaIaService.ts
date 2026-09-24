import OpenAI from 'openai';
import { adicionarRegistroUsoIA } from '../storage.js';
import { RegistroUsoIA } from '../types.js';

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

  adicionarRegistroUsoIA(registro).catch((err) => {
    console.warn('[Telemetria IA ⚠️] Falha ao gravar uso_ia no Supabase:', err?.message || err);
  });
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
  const inicio = Date.now();

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

    return resposta;
  } catch (erro: any) {
    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: 0,
      tokensSaida: 0,
      custoEstimado: 0,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: false,
      erro: erro?.message || String(erro),
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

    return resposta;
  } catch (erro: any) {
    registrarUsoIaAsync({
      motivo: meta.motivo,
      modelo,
      tokensEntrada: 0,
      tokensSaida: 0,
      custoEstimado: 0,
      contatoId: meta.contatoId,
      contatoNome: meta.contatoNome,
      sucesso: false,
      erro: erro?.message || String(erro),
    });
    throw erro;
  }
}
