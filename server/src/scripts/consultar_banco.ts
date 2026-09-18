import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const supabase = getSupabaseClient();
  const { data: docs, error: errDocs } = await supabase
    .from('documentos')
    .select('id, titulo, arquivo, hash_arquivo, pessoa_id, corporativo');

  if (errDocs) {
    console.error('Erro ao listar docs:', errDocs);
    return;
  }

  console.log(`=== DOCUMENTOS NO SUPABASE (${docs.length}) ===`);
  for (const d of docs) {
    const { count } = await supabase
      .from('trechos')
      .select('id', { count: 'exact', head: true })
      .eq('documento_id', d.id);

    console.log(`- [${d.id}] "${d.titulo}" (${d.arquivo}): ${count} trechos | pessoa_id: ${d.pessoa_id}`);

    // Pega o primeiro trecho para ver amostra
    const { data: primeiroTrecho } = await supabase
      .from('trechos')
      .select('pagina, conteudo')
      .eq('documento_id', d.id)
      .limit(1)
      .maybeSingle();

    if (primeiroTrecho) {
      console.log(`   Página: ${primeiroTrecho.pagina} | Amostra:\n   "${primeiroTrecho.conteudo.slice(0, 150)}..."`);
    }
  }
}

main().catch(console.error);
