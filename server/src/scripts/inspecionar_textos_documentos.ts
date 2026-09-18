import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { extrairTextoDocumento } from '../indexador/indexadorService.js';
import { obterTodosDocumentos } from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const docs = await obterTodosDocumentos();

  for (const doc of docs) {
    const caminhoPdf = path.resolve(__dirname, '../../../arquivos', doc.arquivo);
    console.log(`\n======================================================`);
    console.log(`DOCUMENTO: "${doc.titulo}" | ARQUIVO: "${doc.arquivo}"`);
    if (!fs.existsSync(caminhoPdf)) {
      console.log(`[AVISO] Arquivo não encontrado em ${caminhoPdf}`);
      continue;
    }

    try {
      const extraido = await extrairTextoDocumento(caminhoPdf, openai, {
        titulo: doc.titulo,
        descricao: doc.descricao,
        titular: doc.titular
      });
      const textoCompleto = extraido.paginas.map(p => p.texto).join('\n--- Quebra de Página ---\n');
      console.log(`Tamanho texto extraído: ${textoCompleto.length} caracteres (usou OCR: ${extraido.usouOCR})`);
      console.log(`--- Primeiros 1000 caracteres: ---\n${textoCompleto.slice(0, 1000)}`);
      
      // Se for CRT ou CREA, imprime tudo
      if (doc.arquivo.includes('CRT') || doc.arquivo.includes('CREA')) {
        console.log(`\n--- TEXTO COMPLETO (${doc.arquivo}) ---\n${textoCompleto}\n--- FIM TEXTO COMPLETO ---`);
      }
    } catch (err: any) {
      console.error(`Erro ao extrair ${doc.arquivo}:`, err.message);
    }
  }
}

main().catch(console.error);
