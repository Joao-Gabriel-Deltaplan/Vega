import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function consultarErro() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('documentos')
    .select('*')
    .eq('id', 'f7b0540e-e2c5-4752-9f54-df3b80342d3d');

  if (error) {
    console.error('Erro na consulta:', error);
    return;
  }

  console.log(`Encontrados ${data?.length || 0} documentos recentes:`);
  for (const doc of data || []) {
    console.log('----------------------------------------------------');
    console.log(`ID: ${doc.id}`);
    console.log(`Arquivo: ${doc.arquivo}`);
    console.log(`Título: ${doc.titulo}`);
    console.log(`Status Indexação: ${doc.status_indexacao}`);
    console.log(`Erro Indexação: ${doc.erro_indexacao}`);
    console.log(`Status Análise: ${doc.status_analise}`);
    console.log(`Erro Análise: ${doc.erro_analise}`);
    console.log(`Criado em: ${doc.created_at}`);
  }

  const msgOficial = 'Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.';
  const { data: updData, error: updErr } = await supabase
    .from('documentos')
    .update({
      status_indexacao: 'protegido_senha',
      erro_indexacao: msgOficial,
    })
    .eq('id', 'f7b0540e-e2c5-4752-9f54-df3b80342d3d')
    .select();

  if (updErr) {
    console.error('Erro ao atualizar doc para protegido_senha:', updErr);
  } else {
    console.log('✅ Documento f7b0540e-e2c5-4752-9f54-df3b80342d3d atualizado para protegido_senha:', updData);
  }
}

consultarErro().catch(console.error);
