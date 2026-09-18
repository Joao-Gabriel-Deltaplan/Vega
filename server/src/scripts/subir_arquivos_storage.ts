import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ROOT_DIR = path.resolve(__dirname, '../../../');
const ARQUIVOS_DIR = path.join(ROOT_DIR, 'arquivos');

export function sanitizarChaveStorage(nomeArquivo: string): string {
  // Remove acentos e caracteres especiais não-ASCII para compatibilidade total com S3/Supabase Storage
  return nomeArquivo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function subirRestantes() {
  const supabase = getSupabaseClient();
  const arquivosFisicos = fs.readdirSync(ARQUIVOS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));

  console.log('Verificando uploads no Supabase Storage com chaves sanitizadas...');

  for (const arquivo of arquivosFisicos) {
    const chaveStorage = sanitizarChaveStorage(arquivo);
    const caminhoFisico = path.join(ARQUIVOS_DIR, arquivo);
    const buffer = fs.readFileSync(caminhoFisico);

    console.log(`Subindo: "${arquivo}" -> chave: "${chaveStorage}"`);
    const { error } = await supabase.storage
      .from('documentos')
      .upload(chaveStorage, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) {
      console.error(`Erro ao subir ${chaveStorage}:`, error.message);
    } else {
      console.log(`✔ Sucesso: ${chaveStorage}`);
      // Atualiza o storage_path na tabela documentos correspondente ao arquivo
      const { error: errDoc } = await supabase
        .from('documentos')
        .update({ storage_path: chaveStorage })
        .eq('arquivo', arquivo);

      if (errDoc) {
        console.error(`Erro ao atualizar storage_path para ${arquivo}:`, errDoc);
      } else {
        console.log(`   storage_path atualizado no banco para "${arquivo}" -> "${chaveStorage}"`);
      }
    }
  }

  // Lista todos os arquivos presentes no bucket documentos
  const { data: listaBucket, error: errLista } = await supabase.storage
    .from('documentos')
    .list();

  if (errLista) {
    console.error('Erro ao listar bucket:', errLista);
  } else {
    console.log(`\n=== ARQUIVOS NO BUCKET 'documentos' (${listaBucket?.length || 0}) ===`);
    for (const item of listaBucket || []) {
      const tamanhoBytes = (item.metadata as any)?.size || 0;
      console.log(`- ${item.name} (${(tamanhoBytes / 1024).toFixed(1)} KB)`);
    }
  }
}

subirRestantes().catch(console.error);
