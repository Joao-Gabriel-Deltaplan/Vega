import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ID_VERSAO_PADRAO_SISTEMA = 'versao_padrao_sistema';

export interface ConfiguracaoVega {
  id: string;
  promptPersona: string;
  temperaturaResposta: number;
  atualizadoPorNome?: string;
  atualizadoPorId?: string;
  atualizadoEm?: string;
}

export interface VersaoHistoricoVega {
  id: string;
  promptPersona: string;
  temperaturaResposta: number;
  autorNome: string;
  autorId: string;
  motivo?: string;
  criadoEm: string;
}

export interface ModelosEmUso {
  chat: string;
  embeddings: string;
  transcricao: string;
  regrasOficiais: string;
}

// Fallback de segurança em memória se o banco não responder
const PROMPT_PADRAO_FALLBACK = `Você é a assistente corporativa VEGA da Delta Plan.
Seu papel é localizar e fornecer informações de documentos arquivados no Cofre da Delta Plan com agilidade, clareza e precisão absoluta.`;

/**
 * Lê o arquivo prompts/assistente.md APENAS como semente inicial para o primeiro provisionamento.
 * Em tempo de execução e produção (Railway), o sistema nunca depende desse arquivo local.
 */
function obterPromptSementeDoArquivo(): string {
  try {
    const caminho = path.resolve(__dirname, '../../../prompts/assistente.md');
    if (fs.existsSync(caminho)) {
      const conteudo = fs.readFileSync(caminho, 'utf-8').trim();
      if (conteudo) return conteudo;
    }
  } catch (err) {
    console.warn('[Config VEGA ⚠️] prompts/assistente.md não encontrado no disco local. Usando fallback em memória.');
  }
  return PROMPT_PADRAO_FALLBACK;
}

// Caches em memória do processo Node.js (garante leitura em 0ms e efeito imediato)
let cacheConfiguracao: ConfiguracaoVega | null = null;
let cachePromptPadraoSistema: string | null = null;

/**
 * Retorna o prompt padrão gravado de forma permanente no Supabase.
 * Nunca lê arquivo local em tempo de execução, garantindo imunidade à perda de disco no Railway.
 */
export async function obterPromptPadraoSistema(): Promise<{ promptPersona: string; temperaturaResposta: number }> {
  if (cachePromptPadraoSistema) {
    return { promptPersona: cachePromptPadraoSistema, temperaturaResposta: 0.1 };
  }

  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('configuracoes_vega_historico')
      .select('prompt_persona, temperatura_resposta')
      .eq('id', ID_VERSAO_PADRAO_SISTEMA)
      .maybeSingle();

    if (data?.prompt_persona) {
      cachePromptPadraoSistema = data.prompt_persona;
      return {
        promptPersona: data.prompt_persona,
        temperaturaResposta: Number(data.temperatura_resposta ?? 0.1),
      };
    }
  } catch (err) {
    console.warn('[Config VEGA ⚠️] Falha ao consultar versao_padrao_sistema no Supabase:', err);
  }

  // Fallback para semente inicial caso o banco ainda não possua o registro
  const semente = obterPromptSementeDoArquivo();
  cachePromptPadraoSistema = semente;
  return { promptPersona: semente, temperaturaResposta: 0.1 };
}

/**
 * Retorna a configuração em cache de forma síncrona para chamadas de alta performance no chat.
 * Se o cache ainda não estiver pronto, retorna o fallback padrão sem tocar em disco.
 */
export function obterConfiguracoesVegaSync(): ConfiguracaoVega {
  if (cacheConfiguracao) {
    return cacheConfiguracao;
  }
  return {
    id: 'config_padrao',
    promptPersona: cachePromptPadraoSistema || PROMPT_PADRAO_FALLBACK,
    temperaturaResposta: 0.1,
    atualizadoPorNome: 'Sistema (Inicial)',
    atualizadoPorId: 'sistema',
  };
}

/**
 * Inicializa e aquece o cache de configurações na inicialização do servidor.
 * Semeia o Supabase se as tabelas estiverem sem a semente permanente.
 */
export async function inicializarConfiguracoesVega(): Promise<ConfiguracaoVega> {
  try {
    const supabase = getSupabaseClient();

    // 1. Garante que a versão padrão permanente do sistema exista no histórico do Supabase
    const { data: registroPadraoSistema } = await supabase
      .from('configuracoes_vega_historico')
      .select('prompt_persona, temperatura_resposta')
      .eq('id', ID_VERSAO_PADRAO_SISTEMA)
      .maybeSingle();

    if (!registroPadraoSistema) {
      console.log('[Config VEGA ℹ️] Gravando semente permanente do prompt padrão no Supabase (id = versao_padrao_sistema)...');
      const promptSemente = obterPromptSementeDoArquivo();
      await supabase.from('configuracoes_vega_historico').upsert({
        id: ID_VERSAO_PADRAO_SISTEMA,
        prompt_persona: promptSemente,
        temperatura_resposta: 0.1,
        autor_nome: 'Sistema (Semente Oficial)',
        autor_id: 'sistema',
        motivo: 'padrao_sistema',
        criado_em: new Date().toISOString(),
      });
      cachePromptPadraoSistema = promptSemente;
    } else {
      cachePromptPadraoSistema = registroPadraoSistema.prompt_persona;
    }

    // 2. Consulta o registro ativo atual em configuracoes_vega
    const { data, error } = await supabase
      .from('configuracoes_vega')
      .select('*')
      .eq('id', 'config_padrao')
      .maybeSingle();

    if (error || !data) {
      console.log('[Config VEGA ℹ️] Registro de configuração não encontrado no Supabase. Criando registro ativo inicial...');
      const promptAtivo = cachePromptPadraoSistema || PROMPT_PADRAO_FALLBACK;
      const novoRegistro = {
        id: 'config_padrao',
        prompt_persona: promptAtivo,
        temperatura_resposta: 0.1,
        atualizado_por_nome: 'Sistema (Inicialização)',
        atualizado_por_id: 'sistema',
        atualizado_em: new Date().toISOString(),
      };

      await supabase.from('configuracoes_vega').upsert(novoRegistro);

      cacheConfiguracao = {
        id: 'config_padrao',
        promptPersona: promptAtivo,
        temperaturaResposta: 0.1,
        atualizadoPorNome: 'Sistema (Inicialização)',
        atualizadoPorId: 'sistema',
        atualizadoEm: novoRegistro.atualizado_em,
      };
      return cacheConfiguracao;
    }

    cacheConfiguracao = {
      id: data.id,
      promptPersona: data.prompt_persona,
      temperaturaResposta: Number(data.temperatura_resposta ?? 0.1),
      atualizadoPorNome: data.atualizado_por_nome || 'Sistema',
      atualizadoPorId: data.atualizado_por_id || 'sistema',
      atualizadoEm: data.atualizado_em,
    };

    console.log(
      `[Config VEGA ✔] Configurações carregadas do Supabase. Temp resposta: ${cacheConfiguracao.temperaturaResposta}, Última atualização: ${cacheConfiguracao.atualizadoEm || 'N/A'}`
    );
    return cacheConfiguracao;
  } catch (err) {
    console.error('[Config VEGA ❌] Erro ao carregar configurações do Supabase:', err);
    if (!cacheConfiguracao) {
      cacheConfiguracao = {
        id: 'config_padrao',
        promptPersona: cachePromptPadraoSistema || PROMPT_PADRAO_FALLBACK,
        temperaturaResposta: 0.1,
        atualizadoPorNome: 'Fallback Local',
        atualizadoPorId: 'local',
      };
    }
    return cacheConfiguracao;
  }
}

/**
 * Retorna as configurações ativas atuais
 */
export async function obterConfiguracoesVega(): Promise<ConfiguracaoVega> {
  if (cacheConfiguracao) {
    return cacheConfiguracao;
  }
  return inicializarConfiguracoesVega();
}

/**
 * Salva novas configurações no Supabase, adiciona ao histórico e atualiza o cache em memória.
 */
export async function salvarConfiguracoesVega(dados: {
  promptPersona: string;
  temperaturaResposta: number;
  autorNome: string;
  autorId: string;
  motivo?: string;
}): Promise<ConfiguracaoVega> {
  const { promptPersona, temperaturaResposta, autorNome, autorId, motivo } = dados;

  if (!promptPersona || typeof promptPersona !== 'string' || promptPersona.trim().length === 0) {
    throw new Error('O prompt da persona não pode estar em branco.');
  }

  const tempNum = Number(temperaturaResposta);
  if (isNaN(tempNum) || tempNum < 0 || tempNum > 1) {
    throw new Error('A temperatura deve ser um valor numérico entre 0.0 e 1.0.');
  }

  // Normaliza temperatura com 2 casas decimais
  const tempNormalizada = Math.round(tempNum * 100) / 100;
  const promptNormalizado = promptPersona.trim();
  const agoraIso = new Date().toISOString();

  const supabase = getSupabaseClient();

  // 1. Atualiza registro ativo
  const { error: erroUpdate } = await supabase.from('configuracoes_vega').upsert({
    id: 'config_padrao',
    prompt_persona: promptNormalizado,
    temperatura_resposta: tempNormalizada,
    atualizado_por_nome: autorNome || 'Administrador',
    atualizado_por_id: autorId || 'admin',
    atualizado_em: agoraIso,
  });

  if (erroUpdate) {
    throw new Error(`Falha ao salvar configurações no Supabase: ${erroUpdate.message}`);
  }

  // 2. Registra na tabela de histórico
  const idVersao = `ver-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const { error: erroHist } = await supabase.from('configuracoes_vega_historico').insert({
    id: idVersao,
    prompt_persona: promptNormalizado,
    temperatura_resposta: tempNormalizada,
    autor_nome: autorNome || 'Administrador',
    autor_id: autorId || 'admin',
    motivo: motivo || 'edicao_manual',
    criado_em: agoraIso,
  });

  if (erroHist) {
    console.warn('[Config VEGA ⚠️] Falha ao registrar versão no histórico:', erroHist.message);
  }

  // 3. Atualiza cache em memória imediatamente (efeito em tempo real sem reiniciar o servidor)
  cacheConfiguracao = {
    id: 'config_padrao',
    promptPersona: promptNormalizado,
    temperaturaResposta: tempNormalizada,
    atualizadoPorNome: autorNome || 'Administrador',
    atualizadoPorId: autorId || 'admin',
    atualizadoEm: agoraIso,
  };

  console.log(
    `[Config VEGA 💾] Configurações atualizadas por ${autorNome}. Temp: ${tempNormalizada}, Versão: ${idVersao}`
  );
  return cacheConfiguracao;
}

/**
 * Restaura o prompt padrão buscando a semente gravada no Supabase (id = versao_padrao_sistema).
 * NUNCA lê do disco local no Railway.
 */
export async function restaurarPadraoVega(autor: {
  autorNome: string;
  autorId: string;
}): Promise<ConfiguracaoVega> {
  const padrao = await obterPromptPadraoSistema();
  return salvarConfiguracoesVega({
    promptPersona: padrao.promptPersona,
    temperaturaResposta: padrao.temperaturaResposta,
    autorNome: autor.autorNome,
    autorId: autor.autorId,
    motivo: 'restauracao_padrao',
  });
}

/**
 * Retorna as versões anteriores para rollback e conferência de auditoria
 */
export async function obterHistoricoVersoes(limite = 30): Promise<VersaoHistoricoVega[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('configuracoes_vega_historico')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(limite);

    if (error || !data) {
      console.warn('[Config VEGA ⚠️] Falha ao consultar histórico no Supabase:', error?.message);
      return [];
    }

    return data.map((item) => ({
      id: item.id,
      promptPersona: item.prompt_persona,
      temperaturaResposta: Number(item.temperatura_resposta ?? 0.1),
      autorNome: item.autor_nome || 'Desconhecido',
      autorId: item.autor_id || '',
      motivo: item.motivo,
      criadoEm: item.criado_em,
    }));
  } catch (err) {
    console.error('[Config VEGA ❌] Erro ao buscar histórico de versões:', err);
    return [];
  }
}

/**
 * Restaura uma versão específica do histórico
 */
export async function restaurarVersaoHistorico(
  idVersao: string,
  autor: { autorNome: string; autorId: string }
): Promise<ConfiguracaoVega> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('configuracoes_vega_historico')
    .select('*')
    .eq('id', idVersao)
    .single();

  if (error || !data) {
    throw new Error(`Versão com ID "${idVersao}" não encontrada no histórico.`);
  }

  return salvarConfiguracoesVega({
    promptPersona: data.prompt_persona,
    temperaturaResposta: Number(data.temperatura_resposta ?? 0.1),
    autorNome: autor.autorNome,
    autorId: autor.autorId,
    motivo: `restauracao_versao_${idVersao}`,
  });
}

/**
 * Retorna os modelos homologados atualmente em uso (apenas leitura)
 */
export function obterModelosEmUso(): ModelosEmUso {
  return {
    chat: process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini',
    embeddings: process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    transcricao: process.env.OPENAI_AUDIO_MODEL?.trim() || 'gpt-transcribe',
    regrasOficiais: 'Regra 2 Oficial da VEGA: gpt-5.4-mini, text-embedding-3-small, gpt-transcribe',
  };
}
