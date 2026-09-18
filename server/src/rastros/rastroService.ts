import { getSupabaseClient } from '../db/supabaseClient.js';
import { RastroRegistro } from '../types.js';

/**
 * Mapeia o objeto RastroRegistro (camelCase) para a estrutura do banco (snake_case)
 */
function serializarParaBanco(rastro: RastroRegistro) {
  return {
    mensagem_id: rastro.mensagemId,
    conversa_id: rastro.conversaId || null,
    usuario_nome: rastro.usuarioNome,
    usuario_id: rastro.usuarioId || null,
    mensagem_original: rastro.mensagemOriginal,
    pergunta_reescrita: rastro.perguntaReescrita,
    intencao_detectada: rastro.intencaoDetectada,
    tipo_busca: rastro.tipoBusca,
    documentos_encontrados: rastro.documentosEncontrados || [],
    documento_usado: rastro.documentoUsado || null,
    enviou_anexo: Boolean(rastro.enviouAnexo),
    anexos_detalhes: rastro.anexosDetalhes || [],
    resposta_final: rastro.respostaFinal,
    modelo_usado: rastro.modeloUsado,
    tokens_total: rastro.tokensTotal || 0,
    tokens_prompt: rastro.tokensPrompt || 0,
    tokens_completion: rastro.tokensCompletion || 0,
    custo_estimado_usd: rastro.custoEstimadoUsd || 0,
    tempo_total_ms: rastro.tempoTotalMs || 0,
    etapas: rastro.etapas || [],
  };
}

/**
 * Converte o registro retornado do Supabase (snake_case) para RastroRegistro (camelCase)
 */
function deserializarDoBanco(linha: any): RastroRegistro {
  return {
    id: linha.id,
    mensagemId: linha.mensagem_id,
    conversaId: linha.conversa_id || undefined,
    criadoEm: linha.criado_em,
    usuarioNome: linha.usuario_nome,
    usuarioId: linha.usuario_id || undefined,
    mensagemOriginal: linha.mensagem_original,
    perguntaReescrita: linha.pergunta_reescrita,
    intencaoDetectada: linha.intencao_detectada,
    tipoBusca: linha.tipo_busca,
    documentosEncontrados: linha.documentos_encontrados || [],
    documentoUsado: linha.documento_usado || undefined,
    enviouAnexo: Boolean(linha.enviou_anexo),
    anexosDetalhes: linha.anexos_detalhes || [],
    respostaFinal: linha.resposta_final,
    modeloUsado: linha.modelo_usado,
    tokensTotal: linha.tokens_total || 0,
    tokensPrompt: linha.tokens_prompt || 0,
    tokensCompletion: linha.tokens_completion || 0,
    custoEstimadoUsd: Number(linha.custo_estimado_usd) || 0,
    tempoTotalMs: linha.tempo_total_ms || 0,
    etapas: linha.etapas || [],
  };
}

/**
 * Salva um rastro de raciocínio no Supabase (com service_role)
 */
export async function salvarRastro(rastro: RastroRegistro): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const dados = serializarParaBanco(rastro);

    const { data, error } = await supabase
      .from('rastros')
      .insert(dados)
      .select('id')
      .single();

    if (error) {
      console.error('[RastroService] Erro ao gravar rastro no Supabase:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (err: any) {
    console.error('[RastroService] Exceção ao gravar rastro:', err.message || err);
    return null;
  }
}

/**
 * Obtém o rastro associado ao ID de uma mensagem
 */
export async function obterRastroPorMensagemId(mensagemId: string): Promise<RastroRegistro | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rastros')
      .select('*')
      .eq('mensagem_id', mensagemId)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return deserializarDoBanco(data);
  } catch (err: any) {
    console.error('[RastroService] Erro ao consultar rastro por mensagemId:', err.message || err);
    return null;
  }
}

/**
 * Obtém o rastro pelo seu ID primário
 */
export async function obterRastroPorId(id: string): Promise<RastroRegistro | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rastros')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return null;
    }

    return deserializarDoBanco(data);
  } catch (err: any) {
    console.error('[RastroService] Erro ao consultar rastro por ID:', err.message || err);
    return null;
  }
}

/**
 * Exclui automaticamente rastros com mais de 30 dias
 */
export async function limparRastrosAntigos(): Promise<number> {
  try {
    const supabase = getSupabaseClient();

    // 1. Tenta executar via RPC caso a função SQL já exista
    const { data: removidosRpc, error: rpcError } = await supabase.rpc('limpar_rastros_antigos');
    if (!rpcError && typeof removidosRpc === 'number') {
      if (removidosRpc > 0) {
        console.log(`[RastroService 🧹] ${removidosRpc} rastro(s) com mais de 30 dias removido(s) via RPC.`);
      }
      return removidosRpc;
    }

    // 2. Fallback direto via delete com timestamp (30 dias)
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 30);

    const { data, error } = await supabase
      .from('rastros')
      .delete()
      .lt('criado_em', dataLimite.toISOString())
      .select('id');

    if (error) {
      console.warn('[RastroService] Aviso ao limpar rastros antigos:', error.message);
      return 0;
    }

    const total = data ? data.length : 0;
    if (total > 0) {
      console.log(`[RastroService 🧹] ${total} rastro(s) com mais de 30 dias removido(s).`);
    }
    return total;
  } catch (err: any) {
    console.warn('[RastroService] Erro na limpeza automática de rastros:', err.message || err);
    return 0;
  }
}

// Alias de retrocompatibilidade
export const limparRastrosMaisDe30Dias = limparRastrosAntigos;
export const limparRastrosMaisDe90Dias = limparRastrosAntigos;
