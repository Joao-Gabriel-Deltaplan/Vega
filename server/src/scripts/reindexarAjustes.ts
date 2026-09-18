import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { rodarIndexacao } from './executarIndexacao.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function reindexar() {
  const supabase = getSupabaseClient();

  console.log('1. Removendo CNH e CREA antigos do Supabase para forçar reindexação com novas regras...');
  await supabase.from('documentos').delete().eq('arquivo', 'CNH DIGITAL THOMAZ.pdf');
  await supabase.from('documentos').delete().eq('arquivo', 'CREA - SP.pdf');

  console.log('2. Executando reindexação da CNH e do CREA...');
  const res = await rodarIndexacao(['doc-1789395047417', 'doc-1789498806900']);

  console.log('\n--- RESULTADO DOS AJUSTES ---');
  for (const r of res.relatorios) {
    console.log(`\nDocumento: "${r.titulo}" (${r.arquivo})`);
    console.log(`- Usou OCR: ${r.usouOCR ? 'SIM' : 'NÃO'}`);
    console.log(`- Caracteres extraídos: ${r.caracteresExtraidos}`);
    console.log(`- Quantidade de trechos gerados: ${r.quantidadeTrechos}`);
    console.log(`- Amostra (primeiros 300 caracteres):\n  "${r.amostra300}"`);
  }
}

reindexar().catch((err) => {
  console.error('Erro na reindexação:', err);
  process.exit(1);
});
