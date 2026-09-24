import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  obterTodosDocumentos,
  obterTodosConhecimentos,
  obterTitularPorNomeOuApelido,
} from '../storage.js';
import {
  extrairTextoDocumento,
  dividirEmTrechos,
  gerarEmbeddingsEmLote,
  extrairCamposSugeridosFicha,
  salvarCamposSugeridosNoTitular,
  RelatorioDocumento,
} from '../indexador/indexadorService.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

function calcularHashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calcularHashTexto(texto: string): string {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

function mascararDadosSensiveis(texto: string): string {
  return texto
    .replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, '***.***.$3-**')
    .replace(/\b(\d{1,2})\.?(\d{3})\.?(\d{3})-?([0-9Xx])\b/g, '**.***.$3-*');
}

export async function rodarIndexacao(idsAlvo: string[]) {
  console.log('================================================================');
  console.log('INICIANDO FASE 2 (INDEXAÇÃO) E FASE 3 (FICHA SUGERIDA)');
  console.log('================================================================\n');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey.length < 10) {
    throw new Error('OPENAI_API_KEY não configurada no .env');
  }

  const openai = new OpenAI({ apiKey });
  const supabase = getSupabaseClient();

  const todosDocs = await obterTodosDocumentos();
  const docsParaIndexar = todosDocs.filter((d) => idsAlvo.includes(d.id));

  console.log(`Documentos selecionados para indexação: ${docsParaIndexar.length}`);

  const relatorios: RelatorioDocumento[] = [];
  let custoTotalGeralUSD = 0;

  // ============================================================================
  // 1. PROCESSAMENTO DOS DOCUMENTOS PDF
  // ============================================================================
  for (const doc of docsParaIndexar) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`Processando [${doc.id}]: "${doc.titulo}" (${doc.arquivo})`);
    console.log(`----------------------------------------------------------------`);

    const caminhoArquivo = path.join(ARQUIVOS_DIR, doc.arquivo);
    if (!fs.existsSync(caminhoArquivo)) {
      console.error(`❌ Arquivo físico não encontrado: ${caminhoArquivo}`);
      relatorios.push({
        id: doc.id,
        titulo: doc.titulo,
        arquivo: doc.arquivo,
        paginas: 0,
        usouOCR: false,
        caracteresExtraidos: 0,
        quantidadeTrechos: 0,
        custoEstimadoUSD: 0,
        amostra300: 'Arquivo não encontrado',
        status: 'erro',
        erro: 'Arquivo físico não encontrado',
      });
      continue;
    }

    const buffer = fs.readFileSync(caminhoArquivo);
    const hashAtual = calcularHashBuffer(buffer);

    // 1.1 Verificação de Hash no Supabase
    const { data: docExistente } = await supabase
      .from('documentos')
      .select('id, hash_arquivo')
      .eq('arquivo', doc.arquivo)
      .maybeSingle();

    if (docExistente && docExistente.hash_arquivo === hashAtual) {
      console.log(`⏩ Arquivo inalterado (SHA-256 idêntico). Pulando reindexação.`);
      relatorios.push({
        id: doc.id,
        titulo: doc.titulo,
        arquivo: doc.arquivo,
        paginas: 0,
        usouOCR: false,
        caracteresExtraidos: 0,
        quantidadeTrechos: 0,
        custoEstimadoUSD: 0,
        amostra300: 'Documento já indexado com mesmo hash',
        status: 'inalterado',
      });
      continue;
    }

    // Se existia com hash diferente, apaga antigo em cascata
    if (docExistente && docExistente.hash_arquivo !== hashAtual) {
      console.log(`🔄 Hash diferente detectado! Apagando versão antiga do banco...`);
      await supabase.from('documentos').delete().eq('id', docExistente.id);
    }

    let docCriadoId: string | null = null;

    try {
      // 1.2 Extração de Texto Página por Página (com OCR se escaneado)
      console.log(`   Extraindo texto página por página...`);
      const { paginas, usouOCR, custoOcrUSD } = await extrairTextoDocumento(caminhoArquivo, openai, {
        titulo: doc.titulo,
        descricao: doc.descricao,
        titular: doc.titular,
      });
      const textoCompleto = paginas.map((p) => p.texto).join('\n\n');
      const totalCaracteres = textoCompleto.length;

      console.log(`   Total de páginas: ${paginas.length} | Caracteres extraídos: ${totalCaracteres} | Usou OCR: ${usouOCR ? 'SIM' : 'NÃO'}`);

      // 1.3 Divisão em Trechos (~800 tokens com overlap de ~100 tokens)
      const trechos = dividirEmTrechos(paginas);
      console.log(`   Trechos gerados: ${trechos.length}`);

      // 1.4 Geração de Embeddings em Lote (text-embedding-3-small)
      console.log(`   Gerando embeddings em lote com text-embedding-3-small...`);
      const textosParaEmbedding = trechos.map((t) => t.conteudo);
      const embeddings = await gerarEmbeddingsEmLote(textosParaEmbedding, openai);

      // Custo de embedding: $0.02 por 1M tokens (~4 chars = 1 token)
      const tokensEmbeddingEstimados = totalCaracteres / 4;
      const custoEmbeddingUSD = (tokensEmbeddingEstimados / 1_000_000) * 0.02;

      // 1.5 Gravação no Supabase (documentos e trechos)
      const ehCorporativo = doc.titular?.toLowerCase().includes('delta') || !doc.titular;
      let pessoaId: string | null = null;
      if (!ehCorporativo && doc.titular) {
        const titularCadastrado = await obterTitularPorNomeOuApelido(doc.titular);
        pessoaId = titularCadastrado?.id || null;
      }

      const { data: novoDoc, error: errDoc } = await supabase
        .from('documentos')
        .insert({
          titulo: doc.titulo,
          arquivo: doc.arquivo,
          hash_arquivo: hashAtual,
          tipo: doc.tipo || 'Documento',
          pessoa_id: pessoaId,
          corporativo: ehCorporativo,
          visibilidade: doc.visibilidade || 'diretoria',
        })
        .select('id')
        .single();

      if (errDoc || !novoDoc) {
        throw new Error(`Falha ao gravar documento no Supabase: ${errDoc?.message}`);
      }

      docCriadoId = novoDoc.id;

      // Gravação dos trechos em lote
      const payloadTrechos = trechos.map((t, idx) => ({
        documento_id: docCriadoId,
        pessoa_id: pessoaId,
        corporativo: ehCorporativo,
        pagina: t.pagina,
        conteudo: t.conteudo,
        embedding: embeddings[idx],
      }));

      const { error: errTrechos } = await supabase.from('trechos').insert(payloadTrechos);
      if (errTrechos) {
        throw new Error(`Falha ao gravar trechos no Supabase: ${errTrechos.message}`);
      }

      console.log(`   ✅ Documento e ${trechos.length} trechos gravados no Supabase com sucesso!`);

      // 1.6 FASE 3: Extração de Ficha Sugerida para Documentos Pessoais
      let camposSugeridos: Record<string, string> | undefined = undefined;
      let custoFichaUSD = 0;

      if (!ehCorporativo) {
        console.log(`   [Fase 3 - Ficha Sugerida] Analisando campos cadastrais com gpt-5.4-mini...`);
        camposSugeridos = await extrairCamposSugeridosFicha(textoCompleto, doc.tipo || doc.titulo, openai);
        custoFichaUSD = 0.0003; // Estimativa de tokens da chamada JSON

        if (Object.keys(camposSugeridos).length > 0 && doc.titular) {
          console.log(`   Campos sugeridos extraídos:`, JSON.stringify(camposSugeridos, null, 2));
          await salvarCamposSugeridosNoTitular(doc.titular, camposSugeridos, doc.id, doc.titulo);
          console.log(`   ✅ Campos sugeridos salvos em data/titulares.json (status: conferido=false, preservando conferidos).`);
        }
      }

      const custoDocUSD = custoOcrUSD + custoEmbeddingUSD + custoFichaUSD;
      custoTotalGeralUSD += custoDocUSD;

      const amostra = textoCompleto.slice(0, 300).replace(/\s+/g, ' ').trim();

      relatorios.push({
        id: doc.id,
        titulo: doc.titulo,
        arquivo: doc.arquivo,
        paginas: paginas.length,
        usouOCR,
        caracteresExtraidos: totalCaracteres,
        quantidadeTrechos: trechos.length,
        custoEstimadoUSD: custoDocUSD,
        camposSugeridos,
        amostra300: mascararDadosSensiveis(amostra),
        status: 'indexado',
      });
    } catch (err: any) {
      console.error(`❌ Erro no processamento de ${doc.arquivo}:`, err?.message || err);
      // ROLLBACK: Apaga registro para não deixar documento pela metade
      if (docCriadoId) {
        console.log(`   [Rollback] Removendo documento parcial criado (ID: ${docCriadoId})...`);
        await supabase.from('documentos').delete().eq('id', docCriadoId);
      }
      relatorios.push({
        id: doc.id,
        titulo: doc.titulo,
        arquivo: doc.arquivo,
        paginas: 0,
        usouOCR: false,
        caracteresExtraidos: 0,
        quantidadeTrechos: 0,
        custoEstimadoUSD: 0,
        amostra300: 'Erro durante o processamento',
        status: 'erro',
        erro: err?.message || String(err),
      });
    }
  }

  // ============================================================================
  // 2. PROCESSAMENTO DA ABA CONHECIMENTO (data/conhecimento.json)
  // ============================================================================
  console.log(`\n================================================================`);
  console.log(`INDEXANDO ITENS DA ABA CONHECIMENTO (data/conhecimento.json)`);
  console.log(`================================================================`);

  const itensConhecimento = await obterTodosConhecimentos();
  console.log(`Total de itens encontrados na Base de Conhecimento: ${itensConhecimento.length}`);

  let conhecimentosIndexados = 0;
  let conhecimentosInalterados = 0;

  // Busca conhecimentos já existentes no Supabase
  const { data: docsConhecimentoExistentes } = await supabase
    .from('documentos')
    .select('id, titulo, hash_arquivo')
    .eq('tipo', 'Conhecimento');

  const mapaExistentes = new Map((docsConhecimentoExistentes || []).map((d) => [d.titulo, d]));
  const titulosAtuaisSet = new Set(itensConhecimento.map((k) => k.titulo));

  // Remove do banco conhecimentos que foram apagados do JSON
  for (const docAntigo of docsConhecimentoExistentes || []) {
    if (!titulosAtuaisSet.has(docAntigo.titulo)) {
      console.log(`🗑️ Removendo conhecimento excluído do banco: "${docAntigo.titulo}"`);
      await supabase.from('documentos').delete().eq('id', docAntigo.id);
    }
  }

  for (const item of itensConhecimento) {
    const textoConsolidado = `[${item.categoria}] ${item.titulo}\n${item.conteudo}`;
    const hashConteudo = calcularHashTexto(textoConsolidado);
    const existente = mapaExistentes.get(item.titulo);

    if (existente && existente.hash_arquivo === hashConteudo) {
      conhecimentosInalterados++;
      continue;
    }

    if (existente && existente.hash_arquivo !== hashConteudo) {
      console.log(`🔄 Conhecimento alterado: "${item.titulo}". Reindexando...`);
      await supabase.from('documentos').delete().eq('id', existente.id);
    }

    // Gera embedding para o item de conhecimento
    const embedding = (await gerarEmbeddingsEmLote([textoConsolidado], openai))[0];

    const { data: novoDocK, error: errK } = await supabase
      .from('documentos')
      .insert({
        titulo: item.titulo,
        arquivo: `conhecimento_${item.id}.txt`,
        hash_arquivo: hashConteudo,
        tipo: 'Conhecimento',
        pessoa_id: null, // Sem pessoa_id
        corporativo: true, // Corporativo = true
        visibilidade: 'geral',
        metadata: { categoria: item.categoria, item_id: item.id },
      })
      .select('id')
      .single();

    if (errK || !novoDocK) {
      console.error(`❌ Erro ao indexar conhecimento "${item.titulo}":`, errK?.message);
      continue;
    }

    // Grava como trecho único
    await supabase.from('trechos').insert({
      documento_id: novoDocK.id,
      pessoa_id: null,
      corporativo: true,
      pagina: 1,
      conteudo: textoConsolidado,
      embedding: embedding,
    });

    conhecimentosIndexados++;
    console.log(`✅ Conhecimento indexado: "${item.titulo}"`);
  }

  console.log(`\nResumo Conhecimento: ${conhecimentosIndexados} indexados, ${conhecimentosInalterados} inalterados.`);

  return { relatorios, custoTotalGeralUSD, conhecimentosIndexados, totalConhecimentos: itensConhecimento.length };
}

// Execução direta via CLI
const ids = [
  'doc-1789395047417',
  'doc-1789482597257',
  'doc-1789498795402',
  'doc-1789498806900',
  'doc-1789498874715',
];

rodarIndexacao(ids)
  .then((res) => {
    console.log('\n================================================================');
    console.log('RELATÓRIO CONSOLIDADO DE INDEXAÇÃO');
    console.log('================================================================');
    console.log(JSON.stringify(res, null, 2));
  })
  .catch((e) => {
    console.error('Falha geral:', e);
    process.exit(1);
  });
