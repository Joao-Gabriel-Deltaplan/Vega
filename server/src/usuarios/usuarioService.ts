import { getSupabaseClient } from '../db/supabaseClient.js';
import { normalizarNumeroCanonica, normalizarLid } from '../whatsapp/usuarioWhatsAppService.js';
import { obterTodosTitulares } from '../storage.js';

export interface UsuarioDTO {
  id: string;
  numero: string;
  lid?: string | null;
  nome: string;
  perfil: 'admin' | 'comum';
  pessoa_id?: string | null;
  nomeTitularVinculado?: string | null;
  ativo: boolean;
  dataCadastro?: string;
  createdAt?: string;
}

export async function listarUsuariosAutorizados(): Promise<UsuarioDTO[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Usuarios Service ❌] Erro ao listar usuarios:', error);
      return [];
    }

    const titulares = await obterTodosTitulares();
    const mapaTitulares = new Map(titulares.map((t) => [t.id, t.nome]));

    return (data || []).map((u: any) => {
      const nomeTitular = u.pessoa_id ? mapaTitulares.get(u.pessoa_id) || u.pessoa_id : null;
      return {
        id: String(u.id),
        numero: String(u.numero || '').replace(/\D/g, ''),
        lid: u.lid ? String(u.lid).trim() : null,
        nome: String(u.nome || ''),
        perfil: u.perfil === 'admin' ? 'admin' : 'comum',
        pessoa_id: u.pessoa_id || null,
        nomeTitularVinculado: nomeTitular,
        ativo: u.ativo !== false,
        dataCadastro: u.data_cadastro || (u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : undefined),
        createdAt: u.created_at,
      };
    });
  } catch (err) {
    console.error('[Usuarios Service ❌] Erro inesperado ao listar usuarios:', err);
    return [];
  }
}

export async function criarUsuarioAutorizado(dados: {
  numero: string;
  nome: string;
  perfil?: 'admin' | 'comum';
  pessoa_id?: string | null;
  lid?: string | null;
  ativo?: boolean;
}): Promise<UsuarioDTO | null> {
  try {
    const supabase = getSupabaseClient();
    const numeroLimpo = normalizarNumeroCanonica(dados.numero);
    const lidLimpo = dados.lid ? normalizarLid(dados.lid) : null;
    const perfil = dados.perfil === 'admin' ? 'admin' : 'comum';
    const agora = new Date();
    const dataCadastro = agora.toLocaleDateString('pt-BR');

    const id = `usr-${Date.now()}`;

    const registro = {
      id,
      numero: numeroLimpo,
      nome: dados.nome.trim(),
      perfil,
      pessoa_id: dados.pessoa_id ? String(dados.pessoa_id).trim() : null,
      lid: lidLimpo || null,
      ativo: dados.ativo !== false,
      data_cadastro: dataCadastro,
    };

    const { data, error } = await supabase
      .from('usuarios')
      .insert(registro)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[Usuarios Service ❌] Erro ao criar usuario:', error);
      return null;
    }

    const titulares = await obterTodosTitulares();
    const titularObj = titulares.find((t) => t.id === registro.pessoa_id);

    return {
      id: data.id,
      numero: data.numero,
      lid: data.lid,
      nome: data.nome,
      perfil: data.perfil,
      pessoa_id: data.pessoa_id,
      nomeTitularVinculado: titularObj ? titularObj.nome : data.pessoa_id,
      ativo: data.ativo,
      dataCadastro: data.data_cadastro,
      createdAt: data.created_at,
    };
  } catch (err) {
    console.error('[Usuarios Service ❌] Erro ao inserir usuario:', err);
    return null;
  }
}

export async function atualizarUsuarioAutorizado(
  id: string,
  dados: {
    numero?: string;
    nome?: string;
    perfil?: 'admin' | 'comum';
    pessoa_id?: string | null;
    lid?: string | null;
    ativo?: boolean;
  }
): Promise<UsuarioDTO | null> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = {};

    if (dados.nome !== undefined) payload.nome = dados.nome.trim();
    if (dados.numero !== undefined) payload.numero = normalizarNumeroCanonica(dados.numero);
    if (dados.perfil !== undefined) payload.perfil = dados.perfil === 'admin' ? 'admin' : 'comum';
    if (dados.pessoa_id !== undefined) payload.pessoa_id = dados.pessoa_id ? String(dados.pessoa_id).trim() : null;
    if (dados.lid !== undefined) payload.lid = dados.lid ? normalizarLid(dados.lid) : null;
    if (dados.ativo !== undefined) payload.ativo = Boolean(dados.ativo);

    const { data, error } = await supabase
      .from('usuarios')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('[Usuarios Service ❌] Erro ao atualizar usuario:', error);
      return null;
    }

    const titulares = await obterTodosTitulares();
    const titularObj = titulares.find((t) => t.id === data.pessoa_id);

    return {
      id: data.id,
      numero: data.numero,
      lid: data.lid,
      nome: data.nome,
      perfil: data.perfil,
      pessoa_id: data.pessoa_id,
      nomeTitularVinculado: titularObj ? titularObj.nome : data.pessoa_id,
      ativo: data.ativo,
      dataCadastro: data.data_cadastro,
      createdAt: data.created_at,
    };
  } catch (err) {
    console.error('[Usuarios Service ❌] Erro ao editar usuario:', err);
    return null;
  }
}

export async function removerUsuarioAutorizado(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('usuarios').delete().eq('id', id);

    if (error) {
      console.error('[Usuarios Service ❌] Erro ao remover usuario:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Usuarios Service ❌] Erro ao deletar usuario:', err);
    return false;
  }
}
