import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function investigar() {
  const supabase = getSupabaseClient();
  const { data: docs, error } = await supabase
    .from('documentos')
    .select('id, titulo, arquivo, storage_path, tipo, titular, visibilidade, created_at, metadata');

  if (error) {
    console.error('Erro ao buscar documentos:', error);
    return;
  }

  console.log(`\n=== TOTAL DE REGISTROS NA TABELA DOCUMENTOS: ${docs.length} ===\n`);

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const temEspacoArquivo = d.arquivo !== d.arquivo.trim();
    const temEspacoStorage = d.storage_path && d.storage_path !== d.storage_path.trim();
    const temEspacoTitulo = d.titulo !== d.titulo.trim();

    console.log(`[Registro #${i + 1}] ID: ${d.id}`);
    console.log(`  Título: "${d.titulo}" (aspas para ver espaços)`);
    console.log(`  Arquivo: "${d.arquivo}" (tamanho: ${d.arquivo.length}) -> Tem espaço nas pontas? ${temEspacoArquivo}`);
    console.log(`  Storage Path: "${d.storage_path}" -> Tem espaço nas pontas? ${temEspacoStorage}`);
    console.log(`  Tipo: ${d.tipo} | Titular: ${d.titular} | Visibilidade: ${d.visibilidade}`);
    console.log(`  Metadata: ${JSON.stringify(d.metadata)}`);
    console.log(`  Criado em: ${d.created_at}`);

    // Trechos associados
    const { count: qtdTrechos } = await supabase
      .from('trechos')
      .select('id', { count: 'exact', head: true })
      .eq('documento_id', d.id);
    console.log(`  Trechos vetoriais vinculados: ${qtdTrechos}\n`);
  }
}

investigar().catch(console.error);
