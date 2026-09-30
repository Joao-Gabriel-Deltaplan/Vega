import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { obterTodosDocumentos, atualizarDocumento } from '../storage.js';
import { extrairDataEmissaoDocumento } from '../chat/chatOrquestrador.js';

async function main() {
  console.log('\n======================================================');
  console.log('🔄 REPROCESSAMENTO DE DATAS DE EMISSÃO DOS DOCUMENTOS NO COFRE');
  console.log('======================================================\n');

  const sb = getSupabaseClient();
  const todosDocs = await obterTodosDocumentos();

  console.log(`Encontrados ${todosDocs.length} documentos no Cofre.`);
  let atualizados = 0;

  for (const doc of todosDocs) {
    // 1. Busca trechos do documento no Supabase
    let trechosDoc: string[] = [];
    try {
      const { data: tb } = await sb
        .from('trechos')
        .select('conteudo')
        .eq('documento_id', doc.id);
      if (tb && Array.isArray(tb)) {
        trechosDoc = tb.map((t: any) => t.conteudo).filter(Boolean);
      }
    } catch (e) {
      console.warn(`Erro ao buscar trechos de ${doc.titulo}:`, e);
    }

    if (doc.descricao) {
      trechosDoc.push(doc.descricao);
    }

    // 2. Extrai data de emissão usando o novo algoritmo com descarte de nascimento e validade
    const novaDataEmissao = extrairDataEmissaoDocumento(
      {
        ...doc,
        // Limpa metadados antigos para reavaliar a partir do conteúdo
        dataEmissao: undefined,
        metadata: { ...doc.metadata, data_emissao: undefined },
      },
      trechosDoc
    );

    const dataAnterior = doc.dataEmissao || doc.metadata?.data_emissao || 'não identificada';
    const dataFinal = novaDataEmissao || 'não identificada';

    console.log(`📄 [${doc.tipo || 'Doc'}] ${doc.titulo}`);
    console.log(`   Titular: ${doc.titular || 'N/A'}`);
    console.log(`   Data anterior: ${dataAnterior} -> Nova data: ${dataFinal}`);

    if (novaDataEmissao !== doc.dataEmissao && novaDataEmissao !== doc.metadata?.data_emissao) {
      await atualizarDocumento(doc.id, {
        dataEmissao: novaDataEmissao || undefined,
      });
      atualizados++;
      console.log(`   ✅ Atualizado no banco com sucesso.`);
    } else {
      console.log(`   ℹ️ Data inalterada.`);
    }
    console.log('------------------------------------------------------');
  }

  console.log(`\n🎉 Reprocessamento concluído! Total de documentos atualizados: ${atualizados}/${todosDocs.length}.\n`);
}

main().catch((err) => {
  console.error('Erro fatal no reprocessamento:', err);
  process.exit(1);
});
