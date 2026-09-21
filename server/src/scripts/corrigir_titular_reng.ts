import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function corrigirReng() {
  const supabase = getSupabaseClient();

  console.log('--- 1. Buscando titular RENG na tabela titulares ---');
  const { data: titulares, error: titErr } = await supabase
    .from('titulares')
    .select('*')
    .ilike('nome', '%reng%');

  if (titErr) {
    console.error('Erro ao buscar titulares:', titErr);
    return;
  }

  console.log('Titulares encontrados:', titulares);

  for (const t of titulares || []) {
    if (t.nome.includes('ENGENHGARIA') || t.nome.includes('engenhgaria')) {
      const nomeCorrigido = 'RENG ENGENHARIA';
      console.log(`Atualizando titular ID ${t.id}: "${t.nome}" -> "${nomeCorrigido}"...`);
      
      // Atualizar também na ficha caso exista campo nome
      let fichaAtualizada = t.ficha;
      if (fichaAtualizada && typeof fichaAtualizada === 'object') {
        if (fichaAtualizada.nome) {
          fichaAtualizada.nome = nomeCorrigido;
        }
      }

      const { error: updErr } = await supabase
        .from('titulares')
        .update({
          nome: nomeCorrigido,
          ficha: fichaAtualizada,
        })
        .eq('id', t.id);

      if (updErr) {
        console.error(`Erro ao atualizar titular ${t.id}:`, updErr);
      } else {
        console.log(`✅ Titular ${t.id} atualizado com sucesso para "${nomeCorrigido}"!`);
      }
    }
  }

  console.log('\n--- 2. Buscando documentos vinculados na tabela documentos ---');
  const { data: docs, error: docErr } = await supabase
    .from('documentos')
    .select('id, titulo, titular')
    .ilike('titular', '%engenhgaria%');

  if (docErr) {
    console.error('Erro ao buscar documentos:', docErr);
  } else {
    console.log(`Documentos com engenhgaria encontrados: ${docs?.length || 0}`);
    for (const d of docs || []) {
      console.log(`Atualizando documento ${d.id} (${d.titulo})...`);
      const { error: updDocErr } = await supabase
        .from('documentos')
        .update({ titular: 'RENG ENGENHARIA' })
        .eq('id', d.id);
      if (updDocErr) {
        console.error(`Erro ao atualizar documento ${d.id}:`, updDocErr);
      } else {
        console.log(`✅ Documento ${d.id} atualizado!`);
      }
    }
  }

  console.log('\n--- 3. Buscando trechos vinculados com engenhgaria ---');
  const { data: trechos, error: trErr } = await supabase
    .from('trechos')
    .select('id, conteudo')
    .ilike('conteudo', '%engenhgaria%');

  if (trErr) {
    console.error('Erro ao buscar trechos:', trErr);
  } else {
    console.log(`Trechos com engenhgaria encontrados: ${trechos?.length || 0}`);
    for (const tr of trechos || []) {
      const conteudoCorrigido = tr.conteudo.replace(/engenhgaria/gi, 'engenharia').replace(/ENGENHGARIA/g, 'ENGENHARIA');
      await supabase
        .from('trechos')
        .update({ conteudo: conteudoCorrigido })
        .eq('id', tr.id);
      console.log(`Trecho ${tr.id} atualizado!`);
    }
  }

  console.log('\n--- 4. Verificando estado final na tabela titulares ---');
  const { data: todos } = await supabase.from('titulares').select('id, nome');
  console.log('Titulares agora no banco:');
  for (const t of todos || []) {
    console.log(`- ID: ${t.id} | Nome: "${t.nome}"`);
  }
}

corrigirReng().catch(console.error);
