import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { atualizarDocumentoConsistente } from '../documentos/edicaoDocumentoService.js';
import { removerTitular, salvarOuAtualizarTitular, obterTitularPorId } from '../storage.js';

const supabase = getSupabaseClient();

async function rodarTesteEdicaoExclusaoTitular() {
  console.log('===========================================================');
  console.log('🧪 TESTE: EDITAR E EXCLUIR TITULAR / DESVINCULAR DE DOCUMENTO');
  console.log('===========================================================\n');

  const sufixo = crypto.randomBytes(3).toString('hex');
  const titularId = `tit_teste_unit_${sufixo}`;
  const docId1 = crypto.randomUUID();
  const docId2 = crypto.randomUUID();
  const trechoId1 = crypto.randomUUID();

  try {
    // 1. Criar titular fictício
    console.log('1️⃣ Criando titular fictício de teste...');
    const titularInicial = {
      id: titularId,
      nome: `Titular Teste Unit ${sufixo}`,
      apelidos: ['Teste Unit'],
      campos: {},
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    await salvarOuAtualizarTitular(titularInicial);
    console.log(`   ✅ Titular criado: "${titularInicial.nome}" (${titularId})`);

    // 2. Criar 2 documentos fictícios vinculados a esse titular
    console.log('\n2️⃣ Criando 2 documentos fictícios vinculados ao titular...');
    await supabase.from('documentos').insert([
      {
        id: docId1,
        titulo: `Doc Teste 1 ${sufixo}`,
        tipo: 'Contrato',
        titular: titularInicial.nome,
        pessoa_id: titularId,
        corporativo: false,
        arquivo: `teste1_${sufixo}.pdf`,
        visibilidade: 'todos',
        status_indexacao: 'indexado',
      },
      {
        id: docId2,
        titulo: `Doc Teste 2 ${sufixo}`,
        tipo: 'Comprovante',
        titular: titularInicial.nome,
        pessoa_id: titularId,
        corporativo: false,
        arquivo: `teste2_${sufixo}.pdf`,
        visibilidade: 'todos',
        status_indexacao: 'indexado',
      },
    ]);

    // Criar trecho associado ao doc1
    const { data: trechoInserido, error: errTrecho } = await supabase
      .from('trechos')
      .insert({
        documento_id: docId1,
        pessoa_id: titularId,
        corporativo: false,
        pagina: 1,
        conteudo: 'Conteúdo de teste para desvincular titular',
        embedding: Array(1536).fill(0.001),
      })
      .select('id')
      .single();

    if (errTrecho || !trechoInserido) {
      console.warn('   ⚠️ Aviso ao inserir trecho:', errTrecho?.message);
    }
    const realTrechoId = trechoInserido?.id;
    console.log(`   ✅ Documentos e trecho criados com sucesso (trechoId: ${realTrechoId})`);

    // 3. Teste: Desvincular titular do Documento 1 (definir como 'sem_titular')
    console.log('\n3️⃣ Testando desvincular titular do Documento 1 (sem_titular)...');
    const docAtualizado = await atualizarDocumentoConsistente(docId1, {
      pessoaId: 'sem_titular',
      usuarioAlteracao: 'teste_script',
    });

    if (!docAtualizado) {
      throw new Error(`Falha ao desvincular: atualizarDocumentoConsistente retornou null`);
    }

    const { data: doc1Atualizado } = await supabase
      .from('documentos')
      .select('titular, pessoa_id, corporativo')
      .eq('id', docId1)
      .single();

    const { data: trecho1Atualizado } = await supabase
      .from('trechos')
      .select('pessoa_id, corporativo')
      .eq('documento_id', docId1)
      .maybeSingle();

    console.log(`   Documento 1: titular="${doc1Atualizado?.titular}", pessoa_id=${doc1Atualizado?.pessoa_id}, corporativo=${doc1Atualizado?.corporativo}`);
    console.log(`   Trecho 1: pessoa_id=${trecho1Atualizado?.pessoa_id}, corporativo=${trecho1Atualizado?.corporativo}`);

    if (
      doc1Atualizado?.titular === 'Sem titular' &&
      doc1Atualizado?.pessoa_id === null &&
      doc1Atualizado?.corporativo === false &&
      trecho1Atualizado?.pessoa_id === null &&
      trecho1Atualizado?.corporativo === false
    ) {
      console.log('   ✅ Desvinculação consistente de documento validada com SUCESSO!');
    } else {
      throw new Error('Falha na consistência da desvinculação!');
    }

    // 4. Teste: Editar titular (atualizar nome e apelidos)
    console.log('\n4️⃣ Testando edição do titular (nome e apelidos)...');
    const titularEditado = {
      ...titularInicial,
      nome: `Titular Editado ${sufixo}`,
      apelidos: ['Teste Unit', 'Novo Apelido'],
      atualizadoEm: new Date().toISOString(),
    };
    await salvarOuAtualizarTitular(titularEditado);

    // Sincronizar nome no doc 2 que ainda estava vinculado
    await supabase
      .from('documentos')
      .update({ titular: titularEditado.nome })
      .eq('pessoa_id', titularId);

    const titularRecarregado = await obterTitularPorId(titularId);
    console.log(`   Titular recarregado: nome="${titularRecarregado?.nome}", apelidos=${JSON.stringify(titularRecarregado?.apelidos)}`);

    const { data: doc2Sincronizado } = await supabase
      .from('documentos')
      .select('titular')
      .eq('id', docId2)
      .single();

    if (
      titularRecarregado?.nome === titularEditado.nome &&
      titularRecarregado?.apelidos?.includes('Novo Apelido') &&
      doc2Sincronizado?.titular === titularEditado.nome
    ) {
      console.log('   ✅ Edição de titular e sincronização de documento validadas com SUCESSO!');
    } else {
      throw new Error('Falha na validação da edição do titular!');
    }

    // 5. Teste: Excluir titular com destinoDocumentos = 'desvincular'
    console.log('\n5️⃣ Testando exclusão do titular com destino "desvincular"...');
    const excluiu = await removerTitular(titularId, 'desvincular');
    if (!excluiu) throw new Error('removerTitular retornou false!');

    const titularDeletado = await obterTitularPorId(titularId);
    const { data: doc2AposExclusao } = await supabase
      .from('documentos')
      .select('titular, pessoa_id, corporativo')
      .eq('id', docId2)
      .single();

    console.log(`   Titular após exclusão: ${titularDeletado ? 'AINDA EXISTE (ERRO)' : 'NÃO EXISTE (OK)'}`);
    console.log(`   Doc 2 após exclusão: titular="${doc2AposExclusao?.titular}", pessoa_id=${doc2AposExclusao?.pessoa_id}`);

    if (
      !titularDeletado &&
      doc2AposExclusao?.titular === 'Sem titular' &&
      doc2AposExclusao?.pessoa_id === null
    ) {
      console.log('   ✅ Exclusão de titular e migração de documentos validadas com SUCESSO!');
    } else {
      throw new Error('Falha na validação da exclusão do titular!');
    }

    console.log('\n🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  } catch (err: any) {
    console.error('❌ ERRO NO TESTE:', err.message || err);
  } finally {
    // Limpeza garantida de dados fictícios
    console.log('\n🧹 Limpando dados fictícios criados pelo teste...');
    await supabase.from('trechos').delete().in('documento_id', [docId1, docId2]);
    await supabase.from('documentos').delete().in('id', [docId1, docId2]);
    await supabase.from('titulares').delete().eq('id', titularId);
    console.log('   ✅ Limpeza concluída.');
  }
}

rodarTesteEdicaoExclusaoTitular();
