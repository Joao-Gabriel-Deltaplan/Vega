import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { validarTipoDocumentoReconhecivel } from '../documentosFaltantesService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  console.log('================================================================');
  console.log(' LIMPEZA DE REGISTROS INVÁLIDOS EM DOCUMENTOS_FALTANTES');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  const { data: faltantes, error } = await supabase
    .from('documentos_faltantes')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('Erro ao buscar documentos faltantes:', error);
    process.exit(1);
  }

  const invalidos: any[] = [];
  const validos: any[] = [];

  for (const item of faltantes || []) {
    const ehValido = validarTipoDocumentoReconhecivel(item.tipo_documento);
    if (ehValido) {
      validos.push(item);
    } else {
      invalidos.push(item);
    }
  }

  console.log(`Total analisado: ${faltantes?.length || 0}`);
  console.log(`- Válidos preservados: ${validos.length}`);
  console.log(`- Inválidos a remover: ${invalidos.length}\n`);

  if (invalidos.length === 0) {
    console.log('Nenhum registro inválido encontrado na tabela.');
    return;
  }

  console.log('Removendo registros inválidos do Supabase:');
  for (const inv of invalidos) {
    console.log(`🗑️ Removendo ID: "${inv.id}" | Tipo: "${inv.tipo_documento}" | Solicitante: "${inv.solicitante_nome}"`);
    const { error: delError } = await supabase
      .from('documentos_faltantes')
      .delete()
      .eq('id', inv.id);

    if (delError) {
      console.error(`❌ Erro ao remover ${inv.id}:`, delError);
    } else {
      console.log(`   ✅ Registro "${inv.tipo_documento}" excluído com sucesso!`);
    }
  }

  console.log('\n--- Registros válidos mantidos na tabela: ---');
  for (const v of validos) {
    console.log(`- "${v.tipo_documento}" (${v.titular || 'Sem titular'}) [Status: ${v.status}, Pedidos: ${v.quantidade_pedidos}]`);
  }

  console.log('\n================================================================');
  console.log(' LIMPEZA CONCLUÍDA COM SUCESSO! ');
  console.log('================================================================');
}

main().catch(console.error);
