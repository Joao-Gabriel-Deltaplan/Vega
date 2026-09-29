import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const supabase = getSupabaseClient();
  const { data: itens, error } = await supabase
    .from('conhecimento')
    .select('*');

  if (error) {
    console.error('Erro ao consultar conhecimento:', error);
    return;
  }

  console.log(`ITENS NA BASE DE CONHECIMENTO (${itens.length}):`);
  for (const item of itens) {
    console.log(`\nID: ${item.id}`);
    console.log(`Titulo: "${item.titulo}"`);
    console.log(`Categoria: "${item.categoria}"`);
    console.log(`Tipo: "${item.tipo}"`);
    console.log(`Conteudo: "${item.conteudo}"`);
    console.log(`Estruturado:`, item.dados_estruturados || item.conteudo_estruturado || item.metadados);
  }
}

main().catch(console.error);
