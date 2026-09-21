import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  console.log('=== INVESTIGAÇÃO: DOCUMENTOS E STORAGE ===\n');
  const sb = getSupabaseClient();

  // 1. Tabela documentos
  const { data: docs, error: errDocs } = await sb
    .from('documentos')
    .select('*');

  if (errDocs) {
    console.error('Erro ao consultar tabela documentos:', errDocs);
  } else {
    console.log(`Total de documentos na tabela documentos: ${docs?.length}`);
    for (const d of docs || []) {
      console.log(`- [${d.id}] ${d.titulo} | Arquivo: "${d.arquivo}" | Tipo: "${d.tipo}" | Status: ${d.status_indexacao} | Cadastrado: ${d.data_cadastro} | StoragePath: ${d.storage_path}`);
    }
  }

  // 2. Storage bucket 'documentos'
  console.log('\n--- ARQUIVOS NO STORAGE (bucket: documentos) ---');
  const { data: files, error: errFiles } = await sb.storage.from('documentos').list('', { limit: 100 });
  if (errFiles) {
    console.error('Erro ao listar bucket documentos:', errFiles);
  } else {
    console.log(`Total de arquivos no bucket documentos: ${files?.length}`);
    for (const f of files || []) {
      console.log(`- "${f.name}" | Tamanho: ${f.metadata?.size || 'N/A'} bytes | Criado: ${f.created_at}`);
    }
  }

  // 3. Tabela trechos_documentos
  const { data: trechos, error: errTrechos } = await sb
    .from('trechos_documentos')
    .select('documento_id, titulo_documento')
    .limit(10);
  console.log('\nExemplos de trechos_documentos indexados:', trechos);
}

main().catch(console.error);
