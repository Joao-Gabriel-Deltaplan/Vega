import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

async function testar() {
  const arquivos = ['CRT THOMAZ 2025.pdf', 'CREA - SP.pdf', 'CNH DIGITAL THOMAZ.pdf'];
  for (const arq of arquivos) {
    const fullPath = path.join(ARQUIVOS_DIR, arq);
    console.log(`\n========================================`);
    console.log(`ARQUIVO: ${arq}`);
    if (!fs.existsSync(fullPath)) {
      console.log('Arquivo inexistente:', fullPath);
      continue;
    }
    const buf = fs.readFileSync(fullPath);
    const parser = new PDFParse(new Uint8Array(buf));
    const res = await parser.getText();
    console.log(`Texto tamanho: ${res.text.length} caracteres`);
    console.log(res.text.slice(0, 1500));
  }
}

testar().catch(console.error);
