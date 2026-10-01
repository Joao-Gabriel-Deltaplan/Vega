import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { atualizarDocumentoConsistente, obterCamposAlimentadosPorDocumento } from '../documentos/edicaoDocumentoService.js';

const supabase = getSupabaseClient();

async function rodarTesteMoverDocumento() {
  console.log('====================================================');
  console.log('🧪 INICIANDO TESTE DE CONSISTÊNCIA DE MOVER DOCUMENTO');
  console.log('====================================================\n');

  let titularOrigemId = 'tit_teste_origem_aaa';
  let titularDestinoId = 'tit_teste_destino_bbb';
  let documentoId = crypto.randomUUID();
  let trechoId: string | null = null;

  try {
    // 1. Criar Titulares Fictícios
    console.log('1️⃣ Criando titulares fictícios de teste...');
    const { data: titOrigem, error: errOrigem } = await supabase
      .from('titulares')
      .insert({
        id: titularOrigemId,
        nome: 'Titular Teste Origem AAA',
        apelidos: ['Teste AAA'],
        campos: {},
      })
      .select('id, nome')
      .single();

    if (errOrigem || !titOrigem) throw new Error(`Falha ao criar titular origem: ${errOrigem?.message}`);

    const { data: titDestino, error: errDestino } = await supabase
      .from('titulares')
      .insert({
        id: titularDestinoId,
        nome: 'Titular Teste Destino BBB',
        apelidos: ['Teste BBB'],
        campos: {},
      })
      .select('id, nome')
      .single();

    if (errDestino || !titDestino) throw new Error(`Falha ao criar titular destino: ${errDestino?.message}`);

    console.log(`   ✅ Origem criada: "${titOrigem.nome}" (${titularOrigemId})`);
    console.log(`   ✅ Destino criado: "${titDestino.nome}" (${titularDestinoId})`);

    // 2. Criar Documento Fictício no Titular Origem
    console.log('\n2️⃣ Criando documento fictício vinculado ao Titular Origem...');
    const { data: docCriado, error: errDoc } = await supabase
      .from('documentos')
      .insert({
        id: documentoId,
        titulo: 'Certificado Fictício Alpha',
        arquivo: 'certificado_ficticio_alpha.pdf',
        tipo: 'Certificado',
        titular: 'Titular Teste Origem AAA',
        pessoa_id: titularOrigemId,
        corporativo: false,
        status_indexacao: 'indexado',
        metadata: {
          alertaTitular: 'titular_a_revisar',
          donoProvavel: 'Titular Teste Destino BBB',
        },
      })
      .select('id, titulo')
      .single();

    if (errDoc || !docCriado) throw new Error(`Falha ao criar documento fictício: ${errDoc?.message}`);
    documentoId = docCriado.id;
    console.log(`   ✅ Documento criado: "${docCriado.titulo}" (${documentoId}) com selo "titular_a_revisar"`);

    // 3. Criar Trecho Fictício na tabela trechos
    console.log('\n3️⃣ Criando trecho indexado do documento...');
    // Criando vetor dummy de 1536 dimensões para satisfazer a coluna vector(1536)
    const vetorDummy = new Array(1536).fill(0.001);
    const { data: trechoCriado, error: errTrecho } = await supabase
      .from('trechos')
      .insert({
        documento_id: documentoId,
        pessoa_id: titularOrigemId,
        corporativo: false,
        pagina: 1,
        conteudo: 'Certificado de conclusão de curso fictício do aluno Alpha emitido para Titular Teste Origem AAA.',
        embedding: vetorDummy,
      })
      .select('id')
      .single();

    if (errTrecho || !trechoCriado) {
      console.warn('   ⚠️ Não foi possível inserir trecho com embedding dummy:', errTrecho?.message);
    } else {
      trechoId = trechoCriado.id;
      console.log(`   ✅ Trecho criado (${trechoId}) com pessoa_id = ${titularOrigemId}`);
    }

    // 4. Vincular um campo da ficha ao documento (origem = documentoId)
    console.log('\n4️⃣ Simulando preenchimento automático de campo na ficha do titular antigo...');
    const { error: errFicha } = await supabase
      .from('titulares')
      .update({
        campos: {
          rg: {
            valor: '12.345.678-9',
            origem: documentoId,
            manual: false,
            conferido: false,
          },
        },
      })
      .eq('id', titularOrigemId);

    if (errFicha) throw new Error(`Falha ao vincular campo da ficha: ${errFicha.message}`);
    console.log('   ✅ Campo RG (12.345.678-9) vinculado ao documento na ficha de Origem');

    // 5. Testar detecção de campos vinculados
    const infoCampos = await obterCamposAlimentadosPorDocumento(documentoId);
    console.log(`   🔍 Campos detectados pelo serviço: temCampos=${infoCampos.temCampos}, afetados=${infoCampos.titularesAfetados.length}`);
    console.log(`      Resumo: "${infoCampos.mensagemResumo}"`);
    if (!infoCampos.temCampos || infoCampos.titularesAfetados.length !== 1 || infoCampos.titularesAfetados[0].campos[0].chave !== 'rg') {
      throw new Error(`Esperado detectar campo 'rg', obteve: ${JSON.stringify(infoCampos)}`);
    }

    // 6. Executar a migração consistente para o Titular Destino com 'mover'
    console.log('\n5️⃣ Executando atualizarDocumentoConsistente para mover ao Titular Destino...');
    const resultadoEdicao = await atualizarDocumentoConsistente(documentoId, {
      titular: 'Titular Teste Destino BBB',
      pessoaId: titularDestinoId,
      tipo: 'Certificado Especial',
      usuarioNome: 'Teste Automatizado Painel',
      acaoCamposFicha: 'mover',
    });

    console.log('   ✅ Documento atualizado pelo serviço consistente:');
    console.log(`      Novo Titular: ${resultadoEdicao.titular} (pessoa_id: ${resultadoEdicao.pessoaId})`);
    console.log(`      Novo Tipo: ${resultadoEdicao.tipo}`);

    // 7. Validação no Banco de Dados
    console.log('\n6️⃣ Validando integridade no Supabase...');

    // Validação 1: Documento
    const { data: docValidar } = await supabase
      .from('documentos')
      .select('titular, pessoa_id, metadata')
      .eq('id', documentoId)
      .single();

    if (docValidar?.pessoa_id !== titularDestinoId) {
      throw new Error(`Validação falhou: pessoa_id esperado ${titularDestinoId}, obtido ${docValidar?.pessoa_id}`);
    }
    if (docValidar?.metadata?.alertaTitular) {
      throw new Error(`Validação falhou: alertaTitular ainda presente em metadata: ${JSON.stringify(docValidar.metadata)}`);
    }
    if (!docValidar?.metadata?.historicoAlteracoes?.length) {
      throw new Error('Validação falhou: histórico de alterações não registrado em metadata');
    }
    console.log('   ✅ Documento: pessoa_id atualizado, selo "alertaTitular" removido e histórico gravado!');

    // Validação 2: Trechos
    if (trechoId) {
      const { data: trechoValidar } = await supabase
        .from('trechos')
        .select('pessoa_id, corporativo')
        .eq('id', trechoId)
        .single();

      if (trechoValidar?.pessoa_id !== titularDestinoId) {
        throw new Error(`Validação falhou: trecho pessoa_id esperado ${titularDestinoId}, obtido ${trechoValidar?.pessoa_id}`);
      }
      console.log('   ✅ Trechos: pessoa_id atualizado na hora para o novo titular!');
    }

    // Validação 3: Ficha Cadastral (Origem removido, Destino movido)
    const { data: titOrigemPos } = await supabase
      .from('titulares')
      .select('campos')
      .eq('id', titularOrigemId)
      .single();

    if (titOrigemPos?.campos?.rg) {
      throw new Error(`Validação falhou: campo rg ainda presente no titular antigo: ${JSON.stringify(titOrigemPos.campos)}`);
    }

    const { data: titDestinoPos } = await supabase
      .from('titulares')
      .select('campos')
      .eq('id', titularDestinoId)
      .single();

    if (titDestinoPos?.campos?.rg?.valor !== '12.345.678-9') {
      throw new Error(`Validação falhou: campo rg não foi movido para o titular destino: ${JSON.stringify(titDestinoPos?.campos)}`);
    }
    console.log('   ✅ Fichas Cadastrais: RG removido da Origem e movido com sucesso para o Destino!');

    // Validação 4: Busca de trechos restrita ao novo titular
    if (trechoId) {
      const { data: trechosNovoTitular } = await supabase
        .from('trechos')
        .select('id, documento_id, pessoa_id')
        .eq('pessoa_id', titularDestinoId);

      const achouNovo = (trechosNovoTitular || []).some((t) => t.documento_id === documentoId);
      console.log(`   🔍 Busca da VEGA filtrando pelo novo titular: ${achouNovo ? 'ENCONTRADO COM SUCESSO! 🎯' : 'Não encontrado'}`);

      const { data: trechosAntigoTitular } = await supabase
        .from('trechos')
        .select('id, documento_id, pessoa_id')
        .eq('pessoa_id', titularOrigemId);

      const achouAntigo = (trechosAntigoTitular || []).some((t) => t.documento_id === documentoId);
      console.log(`   🔍 Busca da VEGA filtrando pelo antigo titular: ${achouAntigo ? 'ERRO: ainda achou no antigo' : 'CORRETO: não encontra mais no antigo! 🛡️'}`);

      if (!achouNovo || achouAntigo) {
        throw new Error('Falha na busca após migração de titular!');
      }
    }

    console.log('\n====================================================');
    console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ ERRO NO TESTE:', error.message);
    throw error;
  } finally {
    // Limpeza estrita (Regra 24)
    console.log('🧹 Limpando dados fictícios criados para o teste...');
    if (trechoId) {
      await supabase.from('trechos').delete().eq('id', trechoId);
    }
    if (documentoId) {
      await supabase.from('documentos').delete().eq('id', documentoId);
    }
    if (titularOrigemId) {
      await supabase.from('titulares').delete().eq('id', titularOrigemId);
    }
    if (titularDestinoId) {
      await supabase.from('titulares').delete().eq('id', titularDestinoId);
    }
    console.log('✅ Base de dados completamente limpa. Nenhum dado real foi alterado.');
  }
}

rodarTesteMoverDocumento()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
