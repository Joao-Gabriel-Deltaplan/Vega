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
  
  const { data: conversas, error } = await supabase
    .from('conversas')
    .select('id, contato, ultima_atualizacao, mensagens')
    .order('ultima_atualizacao', { ascending: false })
    .limit(3);

  if (error) {
    console.error('Erro:', error);
    return;
  }

  for (const c of conversas || []) {
    console.log(`\n======================================================`);
    console.log(`Conversa ID: ${c.id}`);
    console.log(`Contato:`, c.contato);
    console.log(`Última atualização: ${c.ultima_atualizacao}`);
    console.log(`Total de mensagens: ${c.mensagens?.length || 0}`);
    const ultimas = (c.mensagens || []).slice(-6);
    for (const m of ultimas) {
      console.log(`\n  [${m.horario || m.timestamp}] ${m.remetente}: "${m.texto}"`);
      if (m.rastro) {
        console.log(`    rastro.docUsado: ${m.rastro.documentoUsado}`);
        console.log(`    rastro.tipoBusca: ${m.rastro.tipoBusca}`);
      }
      if (m.documentoOferecidoId) {
        console.log(`    documentoOferecidoId: ${m.documentoOferecidoId}`);
      }
      if (m.anexos && m.anexos.length > 0) {
        console.log(`    anexos: ${m.anexos.map((a: any) => a.nome || a.titulo).join(', ')}`);
      }
    }
  }
}

main().catch(console.error);
