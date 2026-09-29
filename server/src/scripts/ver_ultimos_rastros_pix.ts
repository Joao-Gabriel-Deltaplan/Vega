import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const supabase = getSupabaseClient();
  const { data: rastros, error } = await supabase
    .from('rastros')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Erro ao consultar rastros:', error);
    return;
  }

  console.log(`ÚLTIMOS ${rastros.length} RASTROS:`);
  for (const r of rastros) {
    console.log(`\n==================================================`);
    console.log(`ID: ${r.id} | Data: ${r.created_at}`);
    console.log(`Mensagem Original: "${r.mensagem_original}"`);
    console.log(`Pergunta Reescrita: "${r.pergunta_reescrita}"`);
    console.log(`Intenção Detectada: "${r.intencao_detectada}"`);
    console.log(`Pessoa: "${r.pessoa}" | Origem: "${r.origem_pessoa}"`);
    console.log(`Campos:`, r.campos);
    console.log(`Documento Citado: "${r.documento_citado}"`);
    console.log(`Tipo Busca: "${r.tipo_busca}"`);
    console.log(`Documento Usado: "${r.documento_usado}"`);
    console.log(`Resposta Final: "${r.resposta_final}"`);
    console.log(`Etapas:`);
    for (const e of r.etapas || []) {
      console.log(`  - [${e.ordem}] ${e.nome}: ${e.descricao}`);
      if (e.detalhes) {
        console.log(`    Detalhes:`, JSON.stringify(e.detalhes));
      }
    }
  }
}

main().catch(console.error);
