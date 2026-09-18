import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UsuarioWhatsApp } from './types.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USUARIOS_JSON_PATH = path.resolve(__dirname, '../../../data/usuarios.json');

/**
 * Normaliza um identificador @lid para comparação
 * Ex: "176948374462673@lid" ou "176948374462673:0@lid" -> "176948374462673"
 */
export function normalizarLid(lidRaw?: string | null): string {
  if (!lidRaw) return '';
  const semSufixo = String(lidRaw).split('@')[0].split(':')[0].trim();
  return semSufixo.replace(/\D/g, '');
}

/**
 * Lê os usuários configurados localmente em data/usuarios.json (se existir)
 */
export function obterUsuariosLocais(): UsuarioWhatsApp[] {
  try {
    if (fs.existsSync(USUARIOS_JSON_PATH)) {
      const conteudo = fs.readFileSync(USUARIOS_JSON_PATH, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista)) {
        return lista.map((u: any) => ({
          id: String(u.id || `usr-${Date.now()}`),
          numero: String(u.numero || '').replace(/\D/g, ''),
          lid: u.lid ? String(u.lid).trim() : null,
          nome: String(u.nome || ''),
          perfil: u.perfil === 'admin' ? 'admin' : 'comum',
          pessoa_id: u.pessoa_id || null,
          ativo: u.ativo !== false,
          dataCadastro: u.dataCadastro,
        }));
      }
    }
  } catch (err) {
    console.warn('[WhatsApp Usuários ⚠️] Não foi possível ler data/usuarios.json local:', err);
  }
  return [];
}

/**
 * Lê todos os usuários cadastrados no Supabase (tabela usuarios), mesclando
 * com mapeamentos locais de data/usuarios.json (como o campo "lid").
 */
export async function obterTodosUsuariosWhatsApp(): Promise<UsuarioWhatsApp[]> {
  const usuariosLocais = obterUsuariosLocais();
  let usuariosSupabase: UsuarioWhatsApp[] = [];

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      usuariosSupabase = data.map((u: any) => ({
        id: String(u.id),
        numero: String(u.numero || '').replace(/\D/g, ''),
        lid: u.lid ? String(u.lid).trim() : null,
        nome: String(u.nome || ''),
        perfil: u.perfil === 'admin' ? 'admin' : 'comum',
        pessoa_id: u.pessoa_id || null,
        ativo: u.ativo !== undefined ? u.ativo : true,
        dataCadastro: u.data_cadastro || u.created_at,
      }));
    } else if (error) {
      console.warn('[WhatsApp Usuários ⚠️] Erro ao consultar tabela usuarios no Supabase:', error.message);
    }
  } catch (erro) {
    console.warn('[WhatsApp Usuários ⚠️] Erro de conexão com Supabase:', erro);
  }

  // Se o Supabase estiver indisponível ou vazio, usa diretamente os usuários locais
  if (usuariosSupabase.length === 0) {
    return usuariosLocais;
  }

  // Mesclagem: aplica os campos do data/usuarios.json (especialmente o campo "lid") aos usuários do Supabase
  const resultado: UsuarioWhatsApp[] = [...usuariosSupabase];

  for (const local of usuariosLocais) {
    const idx = resultado.findIndex(
      (u) => u.id === local.id || (local.numero && u.numero === local.numero)
    );

    if (idx !== -1) {
      // Se houver "lid" no JSON local e não no Supabase (ou sobreposto localmente), aplica o lid
      if (local.lid) {
        resultado[idx].lid = local.lid;
      }
      if (local.nome && !resultado[idx].nome) {
        resultado[idx].nome = local.nome;
      }
    } else {
      // Usuário novo presente apenas no JSON local
      resultado.push(local);
    }
  }

  return resultado;
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
 * Busca e valida se um remetente (por número de telefone ou identificador @lid)
 * está autorizado na base de dados (Supabase ou data/usuarios.json).
 */
export async function buscarUsuarioPorNumero(
  identificadorRaw: string,
  lidOpcional?: string
): Promise<UsuarioWhatsApp | null> {
  if (!identificadorRaw && !lidOpcional) return null;

  const usuarios = await obterTodosUsuariosWhatsApp();
  const usuariosAtivos = usuarios.filter((u) => u.ativo !== false);

  // 1. Busca prioritária por LID (se o identificador terminar em @lid ou se lidOpcional foi informado)
  const lidCandidato = normalizarLid(identificadorRaw.endsWith('@lid') ? identificadorRaw : lidOpcional);

  if (lidCandidato) {
    for (const usuario of usuariosAtivos) {
      if (usuario.lid && normalizarLid(usuario.lid) === lidCandidato) {
        return usuario;
      }
    }
  }

  // 2. Se o identificador for um número de telefone (não @lid), busca por variantes do Brasil
  if (!identificadorRaw.endsWith('@lid')) {
    const variantesRecebidas = gerarVariantesNumeroBrasil(identificadorRaw);
    if (variantesRecebidas.length > 0) {
      for (const usuario of usuariosAtivos) {
        const variantesCadastradas = gerarVariantesNumeroBrasil(usuario.numero);
        const match = variantesRecebidas.some((vRec) => variantesCadastradas.includes(vRec));
        if (match) {
          return usuario;
        }
      }
    }
  }

  return null;
}
