import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function main() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('titulares').select('*');
  if (error) {
    console.error('Erro ao buscar titulares:', error);
    return;
  }
  console.log('TITULARES NO SUPABASE (TOTAL:', data?.length || 0, '):');
  for (const t of data || []) {
    console.log(`- ID: ${t.id} | Nome: ${t.nome}`);
  }

  // Verificar se existe algum com "André" ou "Andre"
  const andres = (data || []).filter(t => t.nome.toLowerCase().includes('andré') || t.nome.toLowerCase().includes('andre'));
  if (andres.length > 0) {
    console.log('\n⚠️ ENCONTRADO TITULAR COM ANDRÉ:', andres);
    for (const a of andres) {
      console.log(`Excluindo titular ${a.id} (${a.nome})...`);
      const { error: delErr } = await supabase.from('titulares').delete().eq('id', a.id);
      if (delErr) {
        console.error('Erro ao excluir:', delErr);
      } else {
        console.log('Excluído com sucesso!');
      }
    }
  } else {
    console.log('\n✅ Nenhum titular "André" encontrado na tabela titulares do Supabase.');
  }

  // Verificar na tabela documentos se há algum documento com titular André
  const { data: docs, error: docErr } = await supabase.from('documentos').select('id, titulo, titular');
  const docsAndre = (docs || []).filter(d => (d.titular || '').toLowerCase().includes('andré') || (d.titular || '').toLowerCase().includes('andre'));
  if (docsAndre.length > 0) {
    console.log('\n⚠️ ENCONTRADOS DOCUMENTOS COM TITULAR ANDRÉ:', docsAndre);
    for (const d of docsAndre) {
      console.log(`Excluindo documento de teste ${d.id} (${d.titulo})...`);
      await supabase.from('trechos').delete().eq('documento_id', d.id);
      await supabase.from('documentos').delete().eq('id', d.id);
      console.log('Documento e trechos excluídos!');
    }
  } else {
    console.log('✅ Nenhum documento com titular "André" encontrado na tabela documentos do Supabase.');
  }

  // Verificar na tabela usuarios se há algum usuário com nome André
  const { data: usuarios, error: userErr } = await supabase.from('usuarios').select('id, nome');
  const usersAndre = (usuarios || []).filter(u => (u.nome || '').toLowerCase().includes('andré') || (u.nome || '').toLowerCase().includes('andre'));
  if (usersAndre.length > 0) {
    console.log('\n⚠️ ENCONTRADOS USUÁRIOS COM ANDRÉ:', usersAndre);
    for (const u of usersAndre) {
      console.log(`Excluindo usuário de teste ${u.id} (${u.nome})...`);
      await supabase.from('usuarios').delete().eq('id', u.id);
      console.log('Usuário excluído!');
    }
  } else {
    console.log('✅ Nenhum usuário com nome "André" encontrado na tabela usuarios do Supabase.');
  }
}

main().catch(console.error);
