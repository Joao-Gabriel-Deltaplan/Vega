import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  const supabase = getSupabaseClient();
  const { data: faltantes, error } = await supabase
    .from('documentos_faltantes')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('Erro ao buscar documentos faltantes:', error);
    return;
  }

  console.log(`Encontrados ${faltantes?.length || 0} registros em documentos_faltantes:\n`);
  for (const f of faltantes || []) {
    console.log(`- ID: ${f.id}`);
    console.log(`  Tipo: "${f.tipo_documento}"`);
    console.log(`  Titular: "${f.titular}"`);
    console.log(`  Pedidos: ${f.quantidade_pedidos}`);
    console.log(`  Status: ${f.status}`);
    console.log(`  Solicitante: "${f.solicitante_nome}"`);
    console.log(`  Criado em: ${f.criado_em}`);
    console.log('----------------------------------------------------');
  }
}

main().catch(console.error);
