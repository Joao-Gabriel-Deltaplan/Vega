import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { rodarIndexacao } from './executarIndexacao.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const supabase = getSupabaseClient();
  console.log('1. Removendo duplicatas e limpando documentos CNH e CREA...');
  await supabase.from('documentos').delete().eq('arquivo', 'CNH DIGITAL THOMAZ.pdf');
  await supabase.from('documentos').delete().eq('arquivo', 'CREA - SP.pdf');

  console.log('2. Reindexando CNH e CREA...');
  const res = await rodarIndexacao(['doc-1789395047417', 'doc-1789498806900']);

  console.log('\n3. Verificando estado no Supabase:');
  const { data: docs } = await supabase.from('documentos').select('id, titulo, arquivo');
  for (const d of docs || []) {
    const { count } = await supabase
      .from('trechos')
      .select('id', { count: 'exact', head: true })
      .eq('documento_id', d.id);
    console.log(`- "${d.titulo}" (${d.arquivo}): ${count} trechos`);
  }
}

main().catch(console.error);
