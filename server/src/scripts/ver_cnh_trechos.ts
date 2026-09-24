import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const supabase = getSupabaseClient();
  const { data: doc } = await supabase.from('documentos').select('id, titulo, arquivo').eq('arquivo', 'CNH_DIGITAL.pdf').single();
  if (!doc) {
    console.log('CNH não encontrada');
    return;
  }

  const { data: trechos } = await supabase.from('trechos').select('pagina, conteudo').eq('documento_id', doc.id);
  console.log(`Documento: ${doc.titulo}`);
  trechos?.forEach((t, i) => {
    let masc = t.conteudo
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**')
      .replace(/\b\d{2}\.\d{3}\.\d{3}-[\dXx]\b/g, '**.***.***-*')
      .replace(/\b\d{11}\b/g, '***********');
    console.log(`\nTrecho ${i + 1} (Página ${t.pagina}):`);
    console.log(masc.slice(0, 300));
  });
}

main().catch(console.error);
