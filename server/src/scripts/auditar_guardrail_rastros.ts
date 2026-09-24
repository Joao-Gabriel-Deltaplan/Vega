import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { getSupabaseClient } from '../db/supabaseClient.js';

async function main() {
  const supabase = getSupabaseClient();
  const { data: rastros, error } = await supabase
    .from('rastros')
    .select('*')
    .limit(100);

  if (error) {
    console.error('Erro ao consultar rastros:', error);
    return;
  }

  console.log(`Analisando os últimos ${rastros?.length} rastros gravados no Supabase...`);
  let totalInterceptados = 0;
  for (const r of rastros || []) {
    const etapas = r.etapas || [];
    const etapaGuardrail = etapas.find((e: any) =>
      e.nome?.toLowerCase().includes('guardrail de correspondência de campo') ||
      e.nome?.toLowerCase().includes('regra 17')
    );

    if (etapaGuardrail) {
      totalInterceptados++;
      console.log(`\n--------------------------------------------------`);
      console.log(`🚨 RASTRO INTERCEPTADO #${totalInterceptados}`);
      console.log(`ID: ${r.id} | Data: ${r.created_at}`);
      console.log(`Mensagem Usuário: "${r.mensagem_original}"`);
      console.log(`Resposta Final: "${r.resposta_final}"`);
      console.log(`Motivo Guardrail:`, etapaGuardrail.detalhes?.motivo || etapaGuardrail.descricao);
    }
  }

  console.log(`\n==================================================`);
  console.log(`TOTAL DE RESPOSTAS INTERCEPTADAS NO SUPABASE: ${totalInterceptados}`);
  console.log(`==================================================`);
}

main();
