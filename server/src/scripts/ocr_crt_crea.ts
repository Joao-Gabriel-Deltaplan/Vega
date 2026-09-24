import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { extrairTextoDocumento } from '../indexador/indexadorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function ocrDocs() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const arquivos = ['CRT_DOCUMENTO.pdf', 'CREA - SP.pdf'];

  for (const arq of arquivos) {
    const caminho = path.resolve(__dirname, '../../../arquivos', arq);
    console.log(`\n======================================================`);
    console.log(`LENDO OCR DE: ${arq}`);
    const res = await extrairTextoDocumento(caminho, openai, {
      titulo: arq,
      descricao: arq,
      titular: 'Titular Teste'
    });
    console.log(`Total páginas: ${res.paginas.length}, Usou OCR: ${res.usouOCR}`);
    for (const p of res.paginas) {
      console.log(`\n--- PÁGINA ${p.pagina} (OCR: ${p.usouOCR}) ---\n${p.texto}`);
    }
  }
}

ocrDocs().catch(console.error);
