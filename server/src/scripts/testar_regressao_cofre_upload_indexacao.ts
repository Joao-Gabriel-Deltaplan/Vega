import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { adicionarDocumento, obterTodosDocumentos } from '../storage.js';
import { indexarDocumentoBackground } from '../indexador/indexadorAutomatico.js';
import { gerarPdfDeMarkdown } from '../pdfService.js';
import { uploadArquivoStorage, obterBufferArquivo } from '../utils/storageUtils.js';
import { DocumentoRegistro } from '../types.js';

const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

async function testarRegressaoCofre() {
  console.log('===============================================================');
  console.log('🧪 TESTE DE REGRESSÃO: UPLOAD E INDEXAÇÃO DE PDF E IMAGEM NO COFRE');
  console.log('===============================================================\n');

  const supabase = getSupabaseClient();
  const timestamp = Date.now();
  const nomePdf = `teste_regressao_${timestamp}.pdf`;
  const nomeImg = `teste_regressao_${timestamp}.jpeg`;

  let idPdf = '';
  let idImg = '';

  try {
    // 1. GERAÇÃO E UPLOAD DO PDF DE TESTE
    console.log(`1️⃣ Gerando e enviando PDF de teste: "${nomePdf}"...`);
    const anexoPdf = await gerarPdfDeMarkdown(
      {
        titulo: 'Relatório Técnico de Teste Delta Plan',
        conteudo_markdown: `# Relatório Técnico de Teste\n\nEste é um documento corporativo de teste automatizado para validação do cofre da VEGA.\n\nContém informações técnicas, diretrizes e procedimentos internos da Delta Plan.`,
      },
      nomePdf
    );

    const caminhoPdfLocal = path.join(ARQUIVOS_DIR, nomePdf);
    const bufferPdf = fs.readFileSync(caminhoPdfLocal);
    await uploadArquivoStorage(nomePdf, bufferPdf);

    const docPdfRegistro: DocumentoRegistro = {
      id: `doc-regressao-pdf-${timestamp}`,
      titulo: 'Relatório Técnico de Teste Delta Plan',
      arquivo: nomePdf,
      tipo: 'Documento Técnico',
      titular: 'Delta Plan',
      descricao: 'PDF de validação de regressão do indexador.',
      visibilidade: 'diretoria',
      tamanho: `${(bufferPdf.length / 1024).toFixed(1)} KB`,
      statusIndexacao: 'pendente',
      storagePath: nomePdf,
    };

    const pdfSalvo = await adicionarDocumento(docPdfRegistro);
    idPdf = pdfSalvo.id;
    console.log(`   ✅ PDF registrado na tabela documentos com ID: ${idPdf}`);

    // 2. OBTENÇÃO E UPLOAD DA IMAGEM DE TESTE
    console.log(`\n2️⃣ Preparando e enviando Imagem de teste: "${nomeImg}"...`);
    const todosDocsExistentes = await obterTodosDocumentos();
    const docImgExistente = todosDocsExistentes.find((d) =>
      /\.(jpe?g|png|webp)$/i.test(d.arquivo || '')
    );
    let bufferImg: Buffer | null = null;
    if (docImgExistente) {
      const resImg = await obterBufferArquivo(docImgExistente.arquivo);
      if (resImg?.buffer) bufferImg = resImg.buffer;
    }
    if (!bufferImg) {
      bufferImg = Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
        'base64'
      );
    }

    await uploadArquivoStorage(nomeImg, bufferImg);
    const caminhoImgLocal = path.join(ARQUIVOS_DIR, nomeImg);
    try {
      if (!fs.existsSync(ARQUIVOS_DIR)) fs.mkdirSync(ARQUIVOS_DIR, { recursive: true });
      fs.writeFileSync(caminhoImgLocal, bufferImg);
    } catch {}

    const docImgRegistro: DocumentoRegistro = {
      id: `doc-regressao-img-${timestamp}`,
      titulo: 'Imagem de Teste de Regressão',
      arquivo: nomeImg,
      tipo: 'Documento Pessoal',
      titular: 'Titular Teste',
      descricao: 'Imagem de validação de regressão do indexador com visão.',
      visibilidade: 'diretoria',
      tamanho: `${(bufferImg.length / 1024).toFixed(1)} KB`,
      statusIndexacao: 'pendente',
      storagePath: nomeImg,
    };

    const imgSalva = await adicionarDocumento(docImgRegistro);
    idImg = imgSalva.id;
    console.log(`   ✅ Imagem registrada na tabela documentos com ID: ${idImg}`);

    // 3. DISPARO DA INDEXAÇÃO EM SEGUNDO PLANO
    console.log('\n3️⃣ Disparando indexação dos dois documentos...');
    await indexarDocumentoBackground(pdfSalvo);
    await indexarDocumentoBackground(imgSalva);

    // 4. AGUARDANDO E CONFIRMANDO QUE NENHUM DOS DOIS SUMIU DA LISTA
    console.log('   ⏳ Aguardando conclusão do processamento...');
    let pdfFinalizado = false;
    let imgFinalizada = false;

    for (let tentativa = 1; tentativa <= 25; tentativa++) {
      await new Promise((r) => setTimeout(r, 1200));

      const todosDocumentos = await obterTodosDocumentos();

      const docPdfAtual = todosDocumentos.find((d) => d.id === idPdf || d.arquivo === nomePdf);
      const docImgAtual = todosDocumentos.find((d) => d.id === idImg || d.arquivo === nomeImg);

      // REGRA CRÍTICA: Nenhum documento pode sumir em silêncio durante ou após a indexação!
      if (!docPdfAtual) {
        throw new Error(`❌ REGRESSÃO DETECTADA: O PDF "${nomePdf}" SUMIU da tabela documentos durante a indexação!`);
      }
      if (!docImgAtual) {
        throw new Error(`❌ REGRESSÃO DETECTADA: A Imagem "${nomeImg}" SUMIU da tabela documentos durante a indexação!`);
      }

      if (docPdfAtual.statusIndexacao === 'indexado') pdfFinalizado = true;
      if (docImgAtual.statusIndexacao === 'indexado') imgFinalizada = true;

      if (docPdfAtual.statusIndexacao === 'erro') {
        throw new Error(`❌ O PDF "${nomePdf}" falhou na indexação: ${docPdfAtual.erroIndexacao}`);
      }
      if (docImgAtual.statusIndexacao === 'erro') {
        throw new Error(`❌ A Imagem "${nomeImg}" falhou na indexação: ${docImgAtual.erroIndexacao}`);
      }

      if (pdfFinalizado && imgFinalizada) {
        console.log(`   🎉 Ambos os documentos concluíram a indexação com sucesso na tentativa ${tentativa}!`);
        break;
      }
    }

    if (!pdfFinalizado || !imgFinalizada) {
      throw new Error(`Tempo limite esgotado esperando indexação (PDF: ${pdfFinalizado ? 'OK' : 'PENDENTE'}, Imagem: ${imgFinalizada ? 'OK' : 'PENDENTE'})`);
    }

    // 5. CONFIRMAÇÃO DOS TRECHOS NO SUPABASE
    console.log('\n4️⃣ Verificando trechos gerados no Supabase...');
    const { data: trechosPdf } = await supabase.from('trechos').select('id').eq('documento_id', idPdf);
    const { data: trechosImg } = await supabase.from('trechos').select('id').eq('documento_id', idImg);

    console.log(`   - Trechos do PDF indexados: ${trechosPdf?.length || 0}`);
    console.log(`   - Trechos da Imagem indexados: ${trechosImg?.length || 0}`);

    if (!trechosPdf || trechosPdf.length === 0) {
      throw new Error('Nenhum trecho gerado para o PDF no Supabase.');
    }
    if (!trechosImg || trechosImg.length === 0) {
      throw new Error('Nenhum trecho gerado para a Imagem no Supabase.');
    }

    console.log('\n✅ TESTE DE REGRESSÃO PASSOU COM SUCESSO ABSOLUTO!');
    console.log('   - Nenhum documento sumiu do Cofre.');
    console.log('   - PDF indexado corretamente com unpdf e embeddings.');
    console.log('   - Imagem indexada corretamente com gpt-5.4-mini (visão) e embeddings.');
  } finally {
    // 6. TEARDOWN E LIMPEZA
    console.log('\n🧹 Limpando dados de teste do banco e storage...');
    try {
      if (idPdf) {
        await supabase.from('trechos').delete().eq('documento_id', idPdf);
        await supabase.from('documentos').delete().eq('id', idPdf);
      }
      if (idImg) {
        await supabase.from('trechos').delete().eq('documento_id', idImg);
        await supabase.from('documentos').delete().eq('id', idImg);
      }
      await supabase.storage.from('documentos').remove([nomePdf, nomeImg]);

      const localPdf = path.join(ARQUIVOS_DIR, nomePdf);
      const localImg = path.join(ARQUIVOS_DIR, nomeImg);
      if (fs.existsSync(localPdf)) fs.unlinkSync(localPdf);
      if (fs.existsSync(localImg)) fs.unlinkSync(localImg);

      console.log('   ✅ Limpeza de arquivos e registros de teste concluída com sucesso.');
    } catch (errLimpeza: any) {
      console.warn('   ⚠️ Aviso durante a limpeza de teste:', errLimpeza?.message);
    }
  }
}

testarRegressaoCofre()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ FALHA NO TESTE DE REGRESSÃO:', err.message || err);
    process.exit(1);
  });
