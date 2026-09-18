import { getSupabaseClient } from '../db/supabaseClient.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabase = getSupabaseClient();

async function main() {
  const { data, error } = await supabase
    .from('rastros')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('Erro ao buscar rastros:', error);
    return;
  }

  console.log(`Total de rastros no Supabase: ${data?.length}`);
  for (const r of data || []) {
    console.log('\n=============================================');
    console.log('ID:', r.id);
    console.log('Mensagem:', r.mensagem_original);
    console.log('Resposta Final:', r.resposta_final);
    if (r.etapas) {
      for (const e of r.etapas) {
        if (e.detalhes?.camposConsultados) {
          console.log('  Campos Consultados:', JSON.stringify(e.detalhes.camposConsultados));
        }
      }
    }
  }
}

main();
