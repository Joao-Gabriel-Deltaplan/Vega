import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function limparConversasTeste() {
  const supabase = getSupabaseClient();

  console.log('Buscando conversas no Supabase...');
  const { data: conversas, error } = await supabase
    .from('conversas')
    .select('id, contato, ultima_atualizacao');

  if (error) {
    console.error('Erro ao consultar conversas:', error);
    process.exit(1);
  }

  const conversasTeste = (conversas || []).filter((c: any) => {
    const id = String(c.id || '').toLowerCase();
    const nome = String(c.contato?.nome || '').toLowerCase();
    const telefone = String(c.contato?.telefone || '');

    // Identifica registros de teste
    const ehIdTeste = id.startsWith('wa-teste-') || id.includes('teste');
    const ehNomeTeste = nome.includes('titular teste') || nome === 'teste';
    const ehTelefoneTeste = telefone.includes('999990001');

    return ehIdTeste || ehNomeTeste || ehTelefoneTeste;
  });

  console.log(`Encontradas ${conversasTeste.length} conversas de teste para remoção.`);

  if (conversasTeste.length === 0) {
    console.log('Nenhuma conversa de teste encontrada.');
    return;
  }

  for (const c of conversasTeste) {
    console.log(`- Removendo conversa: ID=${c.id} | Contato=${c.contato?.nome || '(sem nome)'}`);
    const { error: delError } = await supabase
      .from('conversas')
      .delete()
      .eq('id', c.id);

    if (delError) {
      console.error(`  ❌ Erro ao remover ${c.id}:`, delError);
    } else {
      console.log(`  ✅ Removida com sucesso.`);
    }
  }

  console.log('\nLimpeza concluída com sucesso!');
}

limparConversasTeste().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
