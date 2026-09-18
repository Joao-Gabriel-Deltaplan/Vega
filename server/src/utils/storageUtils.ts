import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

/**
 * Normaliza o nome do arquivo para compatibilidade total com o Supabase Storage (S3)
 * Remove acentos e caracteres especiais não-ASCII.
 */
export function sanitizarChaveStorage(nomeArquivo: string): string {
  const base = path.basename(nomeArquivo).trim();
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Obtém o buffer de um arquivo PDF, buscando primeiro no Supabase Storage e,
 * se não encontrar ou falhar, no diretório local de arquivos como fallback.
 */
export async function obterBufferArquivo(nomeArquivo: string, storagePath?: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const supabase = getSupabaseClient();
  const nomeLimpo = path.basename(nomeArquivo).trim();
  const chave = storagePath ? storagePath.trim() : sanitizarChaveStorage(nomeLimpo);

  try {
    const { data: blob, error } = await supabase.storage
      .from('documentos')
      .download(chave);

    if (!error && blob) {
      const arrayBuffer = await blob.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: blob.type || 'application/pdf',
      };
    }
  } catch (err) {
    console.warn(`[StorageUtils] Aviso ao baixar do Supabase Storage (${chave}):`, err);
  }

  // Fallback local caso ainda exista em disco
  const caminhoLocal = path.join(ARQUIVOS_DIR, path.basename(nomeArquivo));
  if (fs.existsSync(caminhoLocal)) {
    try {
      const buffer = fs.readFileSync(caminhoLocal);
      return {
        buffer,
        contentType: 'application/pdf',
      };
    } catch (err) {
      console.error(`[StorageUtils] Erro ao ler arquivo local (${caminhoLocal}):`, err);
    }
  }

  return null;
}

/**
 * Faz upload de um buffer para o bucket privado 'documentos' no Supabase Storage
 */
export async function uploadArquivoStorage(
  nomeArquivo: string,
  buffer: Buffer,
  contentType: string = 'application/pdf'
): Promise<string> {
  const supabase = getSupabaseClient();
  const chave = sanitizarChaveStorage(nomeArquivo);

  const { error } = await supabase.storage
    .from('documentos')
    .upload(chave, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Falha no upload para Supabase Storage: ${error.message}`);
  }

  return chave;
}
