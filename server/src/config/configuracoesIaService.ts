import { getSupabaseClient } from '../db/supabaseClient.js';

export interface ConfiguracaoIA {
  id: string;
  limiteMensalUsd: number;
  cotacaoDolar: number;
  atualizadoEm?: string;
}

const CONFIG_PADRAO: ConfiguracaoIA = {
  id: 'padrao',
  limiteMensalUsd: 10.0,
  cotacaoDolar: 5.60,
};

let cacheConfiguracaoIA: ConfiguracaoIA = { ...CONFIG_PADRAO };
let cacheInicializado = false;

/**
 * Inicializa e busca as configurações de IA salvas de forma permanente no Supabase.
 */
export async function obterConfiguracaoIA(): Promise<ConfiguracaoIA> {
  if (cacheInicializado) {
    return cacheConfiguracaoIA;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('configuracoes_ia')
      .select('*')
      .eq('id', 'padrao')
      .maybeSingle();

    if (!error && data) {
      cacheConfiguracaoIA = {
        id: data.id || 'padrao',
        limiteMensalUsd: Number(data.limite_mensal_usd) || CONFIG_PADRAO.limiteMensalUsd,
        cotacaoDolar: Number(data.cotacao_dolar) || CONFIG_PADRAO.cotacaoDolar,
        atualizadoEm: data.atualizado_em,
      };
      cacheInicializado = true;
      return cacheConfiguracaoIA;
    }
  } catch (err) {
    console.warn('[Config IA ⚠️] Erro ao obter configuracoes_ia do Supabase:', err);
  }

  cacheInicializado = true;
  return cacheConfiguracaoIA;
}

/**
 * Salva e persiste novas configurações de IA no Supabase e atualiza o cache em memória.
 */
export async function salvarConfiguracaoIA(novosDados: {
  limiteMensalUsd?: number;
  cotacaoDolar?: number;
}): Promise<ConfiguracaoIA> {
  const limiteAtualizado =
    novosDados.limiteMensalUsd !== undefined && novosDados.limiteMensalUsd > 0
      ? Number(novosDados.limiteMensalUsd)
      : cacheConfiguracaoIA.limiteMensalUsd;

  const cotacaoAtualizada =
    novosDados.cotacaoDolar !== undefined && novosDados.cotacaoDolar > 0
      ? Number(novosDados.cotacaoDolar)
      : cacheConfiguracaoIA.cotacaoDolar;

  const atualizadoEm = new Date().toISOString();

  cacheConfiguracaoIA = {
    id: 'padrao',
    limiteMensalUsd: limiteAtualizado,
    cotacaoDolar: cotacaoAtualizada,
    atualizadoEm,
  };
  cacheInicializado = true;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('configuracoes_ia')
      .upsert({
        id: 'padrao',
        limite_mensal_usd: limiteAtualizado,
        cotacao_dolar: cotacaoAtualizada,
        atualizado_em: atualizadoEm,
      });

    if (error) {
      console.error('[Config IA ⚠️] Erro ao persistir configuracoes_ia no Supabase:', error);
    }
  } catch (err) {
    console.error('[Config IA ⚠️] Falha de conexão ao salvar configuracoes_ia:', err);
  }

  return cacheConfiguracaoIA;
}
