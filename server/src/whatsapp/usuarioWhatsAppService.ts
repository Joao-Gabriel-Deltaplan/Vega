import { UsuarioWhatsApp } from './types.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

/**
 * Lê todos os usuários cadastrados no Supabase (tabela usuarios)
 */
export async function obterTodosUsuariosWhatsApp(): Promise<UsuarioWhatsApp[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, numero, nome, perfil, pessoa_id, ativo, data_cadastro')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[WhatsApp Usuários ⚠️] Erro ao carregar tabela usuarios no Supabase:', error);
      return [];
    }

    return (data || []).map((u) => ({
      id: u.id,
      numero: u.numero,
      nome: u.nome,
      perfil: u.perfil as 'admin' | 'comum',
      pessoa_id: u.pessoa_id,
      ativo: u.ativo !== undefined ? u.ativo : true,
      dataCadastro: u.data_cadastro,
    }));
  } catch (erro) {
    console.error('[WhatsApp Usuários ⚠️] Erro de conexão com Supabase:', erro);
    return [];
  }
}

/**
 * Salva a lista de usuários no Supabase (tabela usuarios)
 */
export async function salvarUsuariosWhatsApp(usuarios: UsuarioWhatsApp[]): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const registros = usuarios.map((u) => ({
      id: u.id,
      numero: u.numero,
      nome: u.nome,
      perfil: u.perfil,
      pessoa_id: u.pessoa_id || null,
      ativo: u.ativo !== undefined ? u.ativo : true,
      data_cadastro: u.dataCadastro || null,
    }));

    const { error } = await supabase
      .from('usuarios')
      .upsert(registros, { onConflict: 'id' });

    if (error) {
      console.error('[WhatsApp Usuários ⚠️] Erro ao salvar usuários no Supabase:', error);
    }
  } catch (erro) {
    console.error('[WhatsApp Usuários ⚠️] Erro ao persistir usuários no Supabase:', erro);
  }
}

/**
 * Gera as variantes normalizadas de um número de telefone brasileiro
 * Aceita números com ou sem o nono dígito (9), com ou sem DDI 55, e com sufixos do WhatsApp (@s.whatsapp.net, :1, etc).
 * 
 * Exemplo para (14) 99686-3115:
 * Retorna: ['5514996863115', '551496863115']
 */
export function gerarVariantesNumeroBrasil(numeroRaw: string): string[] {
  if (!numeroRaw) return [];

  // Remove sufixos do WhatsApp como @s.whatsapp.net, @g.us, :1, etc.
  let limpo = numeroRaw.split('@')[0].split(':')[0];
  // Mantém apenas dígitos numéricos
  limpo = limpo.replace(/\D/g, '');

  if (!limpo) return [];

  let ddd = '';
  let numeroLocal = '';

  if (limpo.startsWith('55') && (limpo.length === 12 || limpo.length === 13)) {
    // Ex: 5514996863115 (13) ou 551496863115 (12)
    ddd = limpo.slice(2, 4);
    numeroLocal = limpo.slice(4);
  } else if (!limpo.startsWith('55') && (limpo.length === 10 || limpo.length === 11)) {
    // Ex: 14996863115 (11) ou 1496863115 (10)
    ddd = limpo.slice(0, 2);
    numeroLocal = limpo.slice(2);
  } else {
    // Formato não padrão brasileiro ou internacional (ex: DDI estrangeiro)
    return [limpo];
  }

  // Celulares no Brasil: DDD >= 11 e números locais de 8 ou 9 dígitos
  if (numeroLocal.length === 9 && numeroLocal.startsWith('9')) {
    const com9 = `55${ddd}${numeroLocal}`;
    const sem9 = `55${ddd}${numeroLocal.slice(1)}`;
    return [com9, sem9];
  } else if (numeroLocal.length === 8) {
    const com9 = `55${ddd}9${numeroLocal}`;
    const sem9 = `55${ddd}${numeroLocal}`;
    return [com9, sem9];
  }

  return [`55${ddd}${numeroLocal}`];
}

/**
 * Normaliza um número para o formato internacional padrão com 9 dígitos (se aplicável)
 */
export function normalizarNumeroCanonica(numeroRaw: string): string {
  const variantes = gerarVariantesNumeroBrasil(numeroRaw);
  // Prefere a versão com 13 dígitos (com o 9º dígito se for celular BR)
  const versaoCom9 = variantes.find((v) => v.length === 13);
  return versaoCom9 || variantes[0] || numeroRaw.replace(/\D/g, '');
}

/**
 * Busca e valida se um número recebido está autorizado na base de dados (tabela usuarios no Supabase)
 */
export async function buscarUsuarioPorNumero(numeroRaw: string): Promise<UsuarioWhatsApp | null> {
  const variantesRecebidas = gerarVariantesNumeroBrasil(numeroRaw);
  if (variantesRecebidas.length === 0) return null;

  const usuarios = await obterTodosUsuariosWhatsApp();

  for (const usuario of usuarios) {
    if (usuario.ativo === false) continue;

    const variantesCadastradas = gerarVariantesNumeroBrasil(usuario.numero);
    // Verifica se há alguma correspondência entre as variantes (com ou sem 9)
    const match = variantesRecebidas.some((vRec) => variantesCadastradas.includes(vRec));
    if (match) {
      return usuario;
    }
  }

  return null;
}
