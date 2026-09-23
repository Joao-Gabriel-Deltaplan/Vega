import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  extrairTextoDocumento,
  dividirEmTrechos,
  gerarEmbeddingsEmLote,
  extrairCamposSugeridosFicha,
  salvarCamposSugeridosNoTitular,
} from './indexadorService.js';
import {
  obterTodosDocumentos,
  salvarDocumentos,
  obterTodosConhecimentos,
  atualizarDocumento,
  obterTodosTitulares,
  resolverTitularCadastrado,
} from '../storage.js';
import { DocumentoRegistro, ItemConhecimento } from '../types.js';
import { atualizarValidadeDocumento } from '../vencimentos/alertaVencimentoService.js';
import { obterBufferArquivo } from '../utils/storageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

function calcularHashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calcularHashTexto(texto: string): string {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Atualiza o status de indexação de um documento diretamente no Supabase e em memória
 */
async function atualizarStatusIndexacaoDoc(
  docId: string,
  status: 'indexado' | 'pendente' | 'erro',
  erro?: string
): Promise<void> {
  try {
    await atualizarDocumento(docId, {
      statusIndexacao: status,
      erroIndexacao: erro || '',
    });
  } catch (err) {
    console.error('[Indexador Automático] Erro ao atualizar status do documento:', err);
  }
}

/**
 * Executa a indexação completa de um documento em segundo plano
 */
export async function indexarDocumentoBackground(doc: DocumentoRegistro): Promise<void> {
  // Dispara assincronamente sem bloquear a resposta HTTP
  setImmediate(async () => {
    const inicio = Date.now();
    console.log(`\n[Indexador Automático ⚡] Iniciando indexação em segundo plano de "${doc.titulo}" (${doc.arquivo})...`);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      const err = 'OPENAI_API_KEY não configurada no .env';
      console.error(`[Indexador Automático ❌] ${err}`);
      await atualizarStatusIndexacaoDoc(doc.id, 'erro', err);
      return;
    }

    const caminhoArquivo = path.join(ARQUIVOS_DIR, doc.arquivo);
    let buffer: Buffer;

    if (fs.existsSync(caminhoArquivo)) {
      buffer = fs.readFileSync(caminhoArquivo);
    } else {
      const arqStorage = await obterBufferArquivo(doc.arquivo, doc.storagePath);
      if (!arqStorage) {
        const err = `Arquivo não encontrado localmente nem no Supabase Storage: ${doc.arquivo}`;
        console.error(`[Indexador Automático ❌] ${err}`);
        await atualizarStatusIndexacaoDoc(doc.id, 'erro', err);
        return;
      }
      buffer = arqStorage.buffer;
      try {
        if (!fs.existsSync(ARQUIVOS_DIR)) fs.mkdirSync(ARQUIVOS_DIR, { recursive: true });
        fs.writeFileSync(caminhoArquivo, buffer);
      } catch {}
    }

    try {
      await atualizarStatusIndexacaoDoc(doc.id, 'pendente');
      const openai = new OpenAI({ apiKey });
      const supabase = getSupabaseClient();
      const hashAtual = calcularHashBuffer(buffer);

      // 1. Limpeza de trechos antigos associados a este documento (sem apagar o documento!)
      await supabase.from('trechos').delete().eq('documento_id', doc.id);

      // 2. Extração de texto (com OCR via visão se houver imagens relevantes ou < 300 caracteres úteis)
      const { paginas, usouOCR } = await extrairTextoDocumento(caminhoArquivo, openai, {
        titulo: doc.titulo,
        descricao: doc.descricao,
        titular: doc.titular,
      });

      const textoCompleto = paginas.map((p) => p.texto).join('\n\n');
      if (!textoCompleto.trim()) {
        throw new Error('Nenhum texto extraído do documento.');
      }

      // 3. Divisão em trechos (~800 tokens com overlap de ~100 tokens)
      const trechos = dividirEmTrechos(paginas);
      if (trechos.length === 0) {
        trechos.push({ conteudo: textoCompleto.slice(0, 2400), pagina: 1 });
      }

      // 4. Geração de embeddings em lote
      const textosParaEmbedding = trechos.map((t) => t.conteudo);
      const embeddings = await gerarEmbeddingsEmLote(textosParaEmbedding, openai);

      // 5. Atualiza o documento no Supabase com hash e vincula trechos ao doc.id existente
      const ehCorporativo = doc.titular?.toLowerCase().includes('delta') || !doc.titular;
      let pessoaId = (doc as any).pessoa_id || doc.pessoaId || null;
      if (!pessoaId && !ehCorporativo && doc.titular) {
        const todosTitulares = await obterTodosTitulares();
        const titularResolvido = resolverTitularCadastrado(doc.titular, todosTitulares);
        if (titularResolvido) {
          pessoaId = titularResolvido.id;
        }
      }

      await supabase
        .from('documentos')
        .update({
          hash_arquivo: hashAtual,
          pessoa_id: pessoaId,
          corporativo: ehCorporativo,
          status_indexacao: 'indexado',
          erro_indexacao: null,
        })
        .eq('id', doc.id);

      const payloadTrechos = trechos.map((t, idx) => ({
        documento_id: doc.id,
        pessoa_id: pessoaId,
        corporativo: ehCorporativo,
        pagina: t.pagina,
        conteudo: t.conteudo,
        embedding: embeddings[idx],
      }));

      const { error: errTrechos } = await supabase.from('trechos').insert(payloadTrechos);
      if (errTrechos) {
        throw new Error(`Erro ao salvar trechos no Supabase: ${errTrechos?.message}`);
      }

      // Blindagem de segurança pós-indexação: nunca permitir status 'indexado' se houver 0 trechos
      const { count: totalTrechosSalvos, error: errCount } = await supabase
        .from('trechos')
        .select('id', { count: 'exact', head: true })
        .eq('documento_id', doc.id);

      if (errCount || !totalTrechosSalvos || totalTrechosSalvos === 0) {
        throw new Error('Nenhum trecho vetorial foi gerado para este documento.');
      }

      // 6. Ficha Sugerida (Fase 3): extrai dados cadastrais e salva como conferido=false
      if (!ehCorporativo && doc.titular) {
        try {
          const camposSugeridos = await extrairCamposSugeridosFicha(
            textoCompleto,
            doc.tipo || doc.titulo,
            openai
          );
          await salvarCamposSugeridosNoTitular(
            doc.titular,
            camposSugeridos,
            doc.id,
            doc.titulo
          );

          // Se extraiu validade do documento, salva no registro do documento
          const valExtraida = camposSugeridos.validadeCnh || camposSugeridos.dataValidadeDocumento;
          if (valExtraida && (!doc.dataValidade || doc.origemValidade === 'extraído automaticamente')) {
            await atualizarValidadeDocumento(doc.id, valExtraida.trim(), 'extraído automaticamente');
          }
        } catch (errFicha: any) {
          console.warn('[Indexador Automático] Alerta ao extrair ficha sugerida:', errFicha?.message);
        }
      }

      // 7. Atualiza status para 'indexado'
      await atualizarStatusIndexacaoDoc(doc.id, 'indexado');
      const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(`[Indexador Automático ✅] "${doc.titulo}" indexado com sucesso em ${duracao}s (${trechos.length} trechos, OCR: ${usouOCR ? 'SIM' : 'NÃO'}).`);
    } catch (err: any) {
      console.error(`[Indexador Automático ❌] Falha ao indexar "${doc.titulo}":`, err?.message || err);
      await atualizarStatusIndexacaoDoc(doc.id, 'erro', err?.message || 'Erro durante a indexação.');
    }
  });
}

/**
 * Remove documento e trechos do Supabase em segundo plano
 */
export async function removerDocumentoSupabaseBackground(arquivo: string): Promise<void> {
  setImmediate(async () => {
    try {
      console.log(`[Indexador Automático ⚡] Removendo documento "${arquivo}" do Supabase...`);
      const supabase = getSupabaseClient();
      const { data: docs } = await supabase.from('documentos').select('id').eq('arquivo', arquivo);
      if (docs && docs.length > 0) {
        for (const d of docs) {
          await supabase.from('trechos').delete().eq('documento_id', d.id);
          await supabase.from('documentos').delete().eq('id', d.id);
        }
      }
      console.log(`[Indexador Automático ✅] Documento "${arquivo}" removido do Supabase.`);
    } catch (err: any) {
      console.error(`[Indexador Automático ❌] Erro ao remover "${arquivo}" do Supabase:`, err?.message || err);
    }
  });
}

/**
 * Indexa um item da aba Conhecimento no Supabase em segundo plano
 * REGRA: A limpeza prévia no Supabase é feita estritamente pelo ID do item.
 */
export async function indexarConhecimentoBackground(item: ItemConhecimento): Promise<void> {
  setImmediate(async () => {
    try {
      console.log(`[Indexador Automático ⚡] Indexando instrução de conhecimento "${item.titulo}" (ID: ${item.id})...`);
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) return;
      const openai = new OpenAI({ apiKey });
      const supabase = getSupabaseClient();

      const nomeArquivoFicticio = `conhecimento_${item.id}.txt`;
      const textoCompleto = `[${item.categoria}] ${item.titulo}\n${item.conteudo}`;
      const hashTexto = calcularHashTexto(textoCompleto);

      // Remove versão anterior estritamente pelo ID do item
      const { data: antigosPorId } = await supabase
        .from('documentos')
        .select('id')
        .eq('arquivo', nomeArquivoFicticio);

      if (antigosPorId && antigosPorId.length > 0) {
        for (const doc of antigosPorId) {
          await supabase.from('trechos').delete().eq('documento_id', doc.id);
          await supabase.from('documentos').delete().eq('id', doc.id);
        }
      }

      const trechos = dividirEmTrechos([{ pagina: 1, texto: textoCompleto, usouOCR: false }]);
      const textosEmbedding = trechos.map((t) => t.conteudo);
      const embeddings = await gerarEmbeddingsEmLote(textosEmbedding, openai);

      const { data: novoDoc, error: errDoc } = await supabase
        .from('documentos')
        .insert({
          titulo: item.titulo,
          arquivo: nomeArquivoFicticio,
          hash_arquivo: hashTexto,
          tipo: 'Conhecimento',
          pessoa_id: null,
          corporativo: true,
          visibilidade: 'geral',
        })
        .select('id')
        .single();

      if (errDoc || !novoDoc) {
        throw new Error(`Erro ao salvar conhecimento no Supabase: ${errDoc?.message}`);
      }

      const payloadTrechos = trechos.map((t, idx) => ({
        documento_id: novoDoc.id,
        pessoa_id: null,
        corporativo: true,
        pagina: t.pagina,
        conteudo: t.conteudo,
        embedding: embeddings[idx],
      }));

      await supabase.from('trechos').insert(payloadTrechos);
      console.log(`[Indexador Automático ✅] Conhecimento "${item.titulo}" indexado com sucesso no Supabase.`);
    } catch (err: any) {
      console.error(`[Indexador Automático ❌] Erro ao indexar conhecimento "${item.titulo}":`, err?.message || err);
    }
  });
}

/**
 * Remove instrução de conhecimento do Supabase em segundo plano
 * REGRA: A remoção no Supabase é feita estritamente pelo ID do item.
 */
export async function removerConhecimentoSupabaseBackground(itemId: string): Promise<void> {
  setImmediate(async () => {
    try {
      const nomeArquivoFicticio = `conhecimento_${itemId}.txt`;
      console.log(`[Indexador Automático ⚡] Removendo conhecimento "${nomeArquivoFicticio}" do Supabase...`);
      const supabase = getSupabaseClient();

      const { data: docsArquivo } = await supabase
        .from('documentos')
        .select('id')
        .eq('arquivo', nomeArquivoFicticio);

      if (docsArquivo && docsArquivo.length > 0) {
        for (const doc of docsArquivo) {
          await supabase.from('trechos').delete().eq('documento_id', doc.id);
          await supabase.from('documentos').delete().eq('id', doc.id);
        }
      }
      console.log(`[Indexador Automático ✅] Conhecimento "${itemId}" removido do Supabase.`);
    } catch (err: any) {
      console.error(`[Indexador Automático ❌] Erro ao remover conhecimento "${itemId}" do Supabase:`, err?.message || err);
    }
  });
}

/**
 * Reconcilia o Supabase com conhecimento.json e documentos.json na inicialização do servidor:
 * 1. Conhecimento: apaga do Supabase qualquer registro com tipo Conhecimento cujo ID não exista em conhecimento.json;
 *    reindexa os que estiverem faltando ou com hash diferente.
 * 2. Documentos do Cofre: apaga do Supabase qualquer registro cujo arquivo não exista em documentos.json;
 *    reindexa os que estiverem faltando ou com hash diferente.
 */
export async function sincronizarSupabaseNoStartup(): Promise<{
  conhecimento: { removidos: number; indexados: number };
  documentos: { removidos: number; indexados: number };
}> {
  console.log('\n================================================================');
  console.log('🔄 [Startup] SINCRONIZANDO BASE VETORIAL (SUPABASE) COM DADOS LOCAIS');
  console.log('================================================================');

  const supabase = getSupabaseClient();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[Startup ⚠️] OPENAI_API_KEY não configurada. Sincronização vetorial suspensa.');
    return { conhecimento: { removidos: 0, indexados: 0 }, documentos: { removidos: 0, indexados: 0 } };
  }
  const openai = new OpenAI({ apiKey });

  // -------------------------------------------------------------
  // 1. SINCRONIZAÇÃO DA ABA CONHECIMENTO (ESTRITAMENTE POR ID)
  // -------------------------------------------------------------
  const itensConhecimento = await obterTodosConhecimentos();
  const arquivosConhecimentoValidos = new Set(itensConhecimento.map((i) => `conhecimento_${i.id}.txt`));

  const { data: docsConhecimentoSupabase } = await supabase
    .from('documentos')
    .select('id, titulo, arquivo, hash_arquivo')
    .eq('tipo', 'Conhecimento');

  let removidosK = 0;
  let indexadosK = 0;

  // Remove do Supabase qualquer Conhecimento cujo ID não exista mais (somente se a consulta retornou itens válidos)
  if (itensConhecimento.length > 0) {
    for (const doc of docsConhecimentoSupabase || []) {
      if (!arquivosConhecimentoValidos.has(doc.arquivo)) {
        console.log(`[Startup 🗑️] Removendo conhecimento órfão do Supabase: "${doc.titulo}" (${doc.arquivo})`);
        await supabase.from('trechos').delete().eq('documento_id', doc.id);
        await supabase.from('documentos').delete().eq('id', doc.id);
        removidosK++;
      }
    }
  }

  // Reindexa os que estiverem faltando ou com hash diferente
  for (const item of itensConhecimento) {
    const nomeArquivoFicticio = `conhecimento_${item.id}.txt`;
    const textoCompleto = `[${item.categoria}] ${item.titulo}\n${item.conteudo}`;
    const hashAtual = calcularHashTexto(textoCompleto);

    const { data: docExistente } = await supabase
      .from('documentos')
      .select('id, hash_arquivo')
      .eq('arquivo', nomeArquivoFicticio)
      .maybeSingle();

    if (docExistente && docExistente.hash_arquivo === hashAtual) {
      continue; // Em dia
    }

    // Se existe mas hash é diferente, remove antes de recriar
    if (docExistente) {
      await supabase.from('trechos').delete().eq('documento_id', docExistente.id);
      await supabase.from('documentos').delete().eq('id', docExistente.id);
      removidosK++;
    }

    const trechos = dividirEmTrechos([{ pagina: 1, texto: textoCompleto, usouOCR: false }]);
    const textosEmbedding = trechos.map((t) => t.conteudo);
    const embeddings = await gerarEmbeddingsEmLote(textosEmbedding, openai);

    const { data: novoDoc, error: errDoc } = await supabase
      .from('documentos')
      .insert({
        titulo: item.titulo,
        arquivo: nomeArquivoFicticio,
        hash_arquivo: hashAtual,
        tipo: 'Conhecimento',
        pessoa_id: null,
        corporativo: true,
        visibilidade: 'geral',
      })
      .select('id')
      .single();

    if (errDoc || !novoDoc) {
      console.error(`[Startup ❌] Erro ao indexar conhecimento "${item.titulo}":`, errDoc?.message);
      continue;
    }

    const payloadTrechos = trechos.map((t, idx) => ({
      documento_id: novoDoc.id,
      pessoa_id: null,
      corporativo: true,
      pagina: t.pagina,
      conteudo: t.conteudo,
      embedding: embeddings[idx],
    }));

    await supabase.from('trechos').insert(payloadTrechos);
    indexadosK++;
    console.log(`[Startup ✅] Conhecimento "${item.titulo}" sincronizado no Supabase.`);
  }

  // -------------------------------------------------------------
  // 2. SINCRONIZAÇÃO DOS DOCUMENTOS DO COFRE
  // -------------------------------------------------------------
  const docsCofre = await obterTodosDocumentos();
  const arquivosCofreValidos = new Set(docsCofre.map((d) => d.arquivo));

  const { data: docsCofreSupabase } = await supabase
    .from('documentos')
    .select('id, titulo, arquivo, hash_arquivo')
    .neq('tipo', 'Conhecimento');

  let removidosDoc = 0;
  let indexadosDoc = 0;

  // Remove do Supabase qualquer documento do cofre cujo arquivo não conste na lista válida (somente se a consulta retornou itens válidos)
  if (docsCofre.length > 0) {
    for (const doc of docsCofreSupabase || []) {
      if (!arquivosCofreValidos.has(doc.arquivo)) {
        console.log(`[Startup 🗑️] Removendo documento órfão do cofre no Supabase: "${doc.titulo}" (${doc.arquivo})`);
        await supabase.from('trechos').delete().eq('documento_id', doc.id);
        await supabase.from('documentos').delete().eq('id', doc.id);
        removidosDoc++;
      }
    }
  }

  // Reindexa os que estiverem faltando ou com hash diferente
  for (const doc of docsCofre) {
    const caminhoArquivo = path.join(ARQUIVOS_DIR, doc.arquivo);
    if (!fs.existsSync(caminhoArquivo)) {
      continue;
    }

    const buffer = fs.readFileSync(caminhoArquivo);
    const hashDisco = calcularHashBuffer(buffer);

    const { data: docExistente } = await supabase
      .from('documentos')
      .select('id, hash_arquivo')
      .eq('arquivo', doc.arquivo)
      .maybeSingle();

    if (docExistente && docExistente.hash_arquivo === hashDisco) {
      continue; // Em dia
    }

    // Se existe mas hash é diferente, remove antes de recriar
    if (docExistente) {
      await supabase.from('trechos').delete().eq('documento_id', docExistente.id);
      await supabase.from('documentos').delete().eq('id', docExistente.id);
      removidosDoc++;
    }

    console.log(`[Startup ⚡] Reindexando documento do cofre: "${doc.titulo}" (${doc.arquivo})...`);
    try {
      const { paginas } = await extrairTextoDocumento(caminhoArquivo, openai, {
        titulo: doc.titulo,
        descricao: doc.descricao,
        titular: doc.titular,
      });

      const trechos = dividirEmTrechos(paginas);
      if (trechos.length === 0) continue;

      const textosParaEmbedding = trechos.map((t) => t.conteudo);
      const embeddings = await gerarEmbeddingsEmLote(textosParaEmbedding, openai);

      const ehCorporativo = doc.titular?.toLowerCase().includes('delta') || !doc.titular;
      let pessoaId = (doc as any).pessoa_id || doc.pessoaId || null;
      if (!pessoaId && !ehCorporativo && doc.titular) {
        const todosTitulares = await obterTodosTitulares();
        const titularResolvido = resolverTitularCadastrado(doc.titular, todosTitulares);
        if (titularResolvido) {
          pessoaId = titularResolvido.id;
        }
      }

      const { data: novoDoc, error: errDoc } = await supabase
        .from('documentos')
        .insert({
          titulo: doc.titulo,
          arquivo: doc.arquivo,
          hash_arquivo: hashDisco,
          tipo: doc.tipo || 'Documento',
          pessoa_id: pessoaId,
          corporativo: ehCorporativo,
          visibilidade: doc.visibilidade || 'diretoria',
        })
        .select('id')
        .single();

      if (errDoc || !novoDoc) {
        console.error(`[Startup ❌] Erro ao salvar "${doc.titulo}" no Supabase:`, errDoc?.message);
        continue;
      }

      const payloadTrechos = trechos.map((t, idx) => ({
        documento_id: novoDoc.id,
        pessoa_id: pessoaId,
        corporativo: ehCorporativo,
        pagina: t.pagina,
        conteudo: t.conteudo,
        embedding: embeddings[idx],
      }));

      await supabase.from('trechos').insert(payloadTrechos);
      indexadosDoc++;
      console.log(`[Startup ✅] Documento do cofre "${doc.titulo}" sincronizado no Supabase.`);
    } catch (err: any) {
      console.error(`[Startup ❌] Falha ao reindexar "${doc.titulo}":`, err?.message || err);
    }
  }

  console.log(`[Startup ✅] Sincronização concluída: Conhecimento (+${indexadosK}/-${removidosK}), Documentos (+${indexadosDoc}/-${removidosDoc})`);
  console.log('================================================================\n');

  return {
    conhecimento: { removidos: removidosK, indexados: indexadosK },
    documentos: { removidos: removidosDoc, indexados: indexadosDoc },
  };
}


