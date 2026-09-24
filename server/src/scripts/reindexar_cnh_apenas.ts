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
  console.log('1. Apagando registro anterior da CNH...');
  const { data: doc } = await supabase.from('documentos').select('id').eq('arquivo', 'CNH_DIGITAL.pdf').maybeSingle();
  if (doc) {
    await supabase.from('trechos').delete().eq('documento_id', doc.id);
    await supabase.from('documentos').delete().eq('id', doc.id);
  }

  console.log('2. Reindexando CNH doc-1789395047417...');
  await rodarIndexacao(['doc-1789395047417']);

  console.log('\n3. Trechos gerados da CNH no Supabase:');
  const { data: novoDoc } = await supabase.from('documentos').select('id, titulo, arquivo').eq('arquivo', 'CNH_DIGITAL.pdf').single();
  if (novoDoc) {
    const { data: trechos } = await supabase.from('trechos').select('pagina, conteudo').eq('documento_id', novoDoc.id);
    trechos?.forEach((t, i) => {
      let masc = t.conteudo
        .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***.***.***-**')
        .replace(/\b\d{2}\.\d{3}\.\d{3}-[\dXx]\b/g, '**.***.***-*')
        .replace(/\b\d{11}\b/g, '***********');
      console.log(`\nTrecho ${i + 1} (Página ${t.pagina}, ${t.conteudo.length} chars):`);
      console.log(masc.slice(0, 300));
    });
  }
}

main().catch(console.error);
