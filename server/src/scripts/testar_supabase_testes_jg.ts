import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config(); // fallback local se houver

import { getSupabaseClient } from '../db/supabaseClient.js';
import { gerarEmbedding } from '../ai/openaiProvider.js';

async function main() {
  const supabase = getSupabaseClient();
  const { data: docs, error: errDocs } = await supabase
    .from('documentos')
    .select('id, titulo, tipo, corporativo, trechos(id, conteudo, pagina)')
    .ilike('titulo', '%testes jg%');

  console.log('Docs encontrados no Supabase:', JSON.stringify(docs, null, 2));

  // Testar buscar_trechos com "o que tem em testes jg"
  const emb1 = await gerarEmbedding('o que tem em testes jg');
  const { data: r1 } = await supabase.rpc('buscar_trechos', {
    query_embedding: emb1,
    p_pessoa_id: null,
    match_threshold: 0.3,
    match_count: 5,
  });
  console.log('\nBusca vetorial para "o que tem em testes jg":');
  r1?.forEach((t: any) => console.log(`- [${t.titulo_documento}] sim: ${(t.similaridade * 100).toFixed(2)}% | conteudo: ${t.conteudo}`));

  // Testar buscar_trechos sem citar o nome (sobre "nova versão teste")
  const emb2 = await gerarEmbedding('Qual documento ou texto menciona a nova versão teste?');
  const { data: r2 } = await supabase.rpc('buscar_trechos', {
    query_embedding: emb2,
    p_pessoa_id: null,
    match_threshold: 0.3,
    match_count: 5,
  });
  console.log('\nBusca vetorial para "Qual documento ou texto menciona a nova versão teste?":');
  r2?.forEach((t: any) => console.log(`- [${t.titulo_documento}] sim: ${(t.similaridade * 100).toFixed(2)}% | conteudo: ${t.conteudo}`));
}

main().catch(console.error);
