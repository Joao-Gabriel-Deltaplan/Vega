import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function deduplicar() {
  const supabase = getSupabaseClient();
  const { data: docs } = await supabase.from('documentos').select('id, arquivo, created_at').order('created_at', { ascending: false });
  if (!docs) return;

  const vistos = new Set<string>();
  for (const d of docs) {
    if (vistos.has(d.arquivo)) {
      console.log(`Removendo duplicata de "${d.arquivo}" (id: ${d.id})...`);
      await supabase.from('trechos').delete().eq('documento_id', d.id);
      await supabase.from('documentos').delete().eq('id', d.id);
    } else {
      vistos.add(d.arquivo);
    }
  }

  console.log('Documentos únicos no banco:');
  const { data: docsRestantes } = await supabase.from('documentos').select('id, titulo, arquivo');
  for (const d of docsRestantes || []) {
    const { count } = await supabase.from('trechos').select('id', { count: 'exact', head: true }).eq('documento_id', d.id);
    console.log(`- ${d.titulo} (${d.arquivo}): ${count} trechos`);
  }
}

deduplicar().catch(console.error);
