import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { getSupabaseClient } from '../db/supabaseClient.js';
import { sincronizarSupabaseNoStartup } from '../indexador/indexadorAutomatico.js';

export { sincronizarSupabaseNoStartup };

async function main() {
  console.log('================================================================');
  console.log('🔄 SINCRONIZAÇÃO E RECONCILIAÇÃO DA BASE DE CONHECIMENTO & COFRE');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();

  // 1. Inspecionar o que há atualmente em "documentos" com título "testes jg"
  const { data: antes } = await supabase
    .from('documentos')
    .select('id, titulo, arquivo, hash_arquivo, trechos(id, conteudo)')
    .ilike('titulo', 'testes jg');

  console.log('📋 Estado ANTES da reconciliação:');
  antes?.forEach((doc) => {
    console.log(`- Documento ID: ${doc.id} | Arquivo: ${doc.arquivo}`);
    (doc.trechos as any[])?.forEach((t) => {
      console.log(`  Trecho: "${t.conteudo}"`);
    });
  });

  // 2. Executar reconciliação geral
  console.log('\n⚡ Executando sincronização e limpeza de duplicatas...');
  const resultado = await sincronizarSupabaseNoStartup();
  console.log(`Resultado Conhecimento: ${resultado.conhecimento.removidos} removidos, ${resultado.conhecimento.indexados} indexados.`);
  console.log(`Resultado Documentos: ${resultado.documentos.removidos} removidos, ${resultado.documentos.indexados} indexados.`);

  // 3. Inspecionar o que ficou gravado no Supabase para "testes jg"
  const { data: depois } = await supabase
    .from('documentos')
    .select('id, titulo, tipo, arquivo, hash_arquivo, trechos(id, conteudo, pagina)')
    .ilike('titulo', 'testes jg');

  console.log('\n📋 Estado DEPOIS da reconciliação (O que ficou no Supabase):');
  depois?.forEach((doc) => {
    console.log(`- Documento ID: ${doc.id}`);
    console.log(`  Título: ${doc.titulo}`);
    console.log(`  Tipo: ${doc.tipo}`);
    console.log(`  Arquivo: ${doc.arquivo}`);
    console.log(`  Hash: ${doc.hash_arquivo}`);
    console.log(`  Quantidade de trechos: ${doc.trechos?.length || 0}`);
    (doc.trechos as any[])?.forEach((t, i) => {
      console.log(`  [Trecho ${i + 1}] Página ${t.pagina}: "${t.conteudo}"`);
    });
  });

  console.log('\n================================================================');
  console.log('✅ RECONCILIAÇÃO FINALIZADA COM SUCESSO!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Erro na reconciliação:', err);
  process.exit(1);
});
