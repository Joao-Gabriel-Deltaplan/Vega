import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { extrairTextoDocumento, dividirEmTrechos, limparTextoCapaVega } from '../indexador/indexadorService.js';
import { obterTodosDocumentos } from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');
  const openai = new OpenAI({ apiKey });

  const docs = await obterTodosDocumentos();
  const cnhDoc = docs.find(d => d.titulo.toLowerCase().includes('cnh'));
  const creaDoc = docs.find(d => d.titulo.toLowerCase().includes('crea'));

  console.log('=== 1. CNH DIGITAL THOMAZ ===');
  if (cnhDoc) {
    const caminhoCnh = path.resolve(__dirname, '../../../arquivos', cnhDoc.arquivo);
    console.log('Caminho CNH:', caminhoCnh);
    const resCnh = await extrairTextoDocumento(caminhoCnh, openai);
    console.log(`Páginas extraídas: ${resCnh.paginas.length}, Usou OCR: ${resCnh.usouOCR}`);
    resCnh.paginas.forEach(p => {
      console.log(`Página ${p.pagina} (OCR: ${p.usouOCR}, tamanho: ${p.texto.length} chars):`);
      // Mascarar CPF/RG para exibição segura
      let textoSeguro = p.texto
        .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '***.***.***-**')
        .replace(/\b\d{11}\b/g, '***********')
        .replace(/\b\d{2}\.\d{3}\.\d{3}-[\dXx]\b/g, '**.***.***-*');
      console.log('Primeiros 300 caracteres:\n', textoSeguro.slice(0, 300));
    });
  }

  console.log('\n=== 2. CREA - SP ===');
  if (creaDoc) {
    const caminhoCrea = path.resolve(__dirname, '../../../arquivos', creaDoc.arquivo);
    console.log('Caminho CREA:', caminhoCrea);
    const resCrea = await extrairTextoDocumento(caminhoCrea, openai);
    let totalChars = 0;
    resCrea.paginas.forEach(p => {
      totalChars += p.texto.length;
      console.log(`Página ${p.pagina}: ${p.texto.length} caracteres (OCR: ${p.usouOCR})`);
    });
    console.log(`Total de caracteres extraídos do CREA: ${totalChars}`);
    const trechosCrea = dividirEmTrechos(resCrea.paginas, 2400, 350);
    console.log(`Quantidade de trechos gerados para o CREA (~800 tokens / 2400 chars com ~100 tokens / 350 chars overlap): ${trechosCrea.length}`);
    trechosCrea.forEach((t, idx) => {
      console.log(`Trecho ${idx + 1} (Página ${t.pagina}, ${t.conteudo.length} chars): ${t.conteudo.slice(0, 100)}...`);
    });
  }
}

run().catch(console.error);
