import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const caminhoCnh = path.resolve(__dirname, '../../../arquivos/CNH DIGITAL THOMAZ.pdf');
  console.log('Tamanho do arquivo:', fs.statSync(caminhoCnh).size, 'bytes');

  const buf = fs.readFileSync(caminhoCnh);
  const parser = new PDFParse(new Uint8Array(buf));
  const textRes = await parser.getText();
  console.log('=== TEXTO NATIVO DO PDF ===');
  console.log(textRes.text);

  try {
    console.log('=== PDFINFO ===');
    console.log(execSync(`pdfinfo "${caminhoCnh}"`, { encoding: 'utf-8' }));
  } catch (e: any) {
    console.log('Erro pdfinfo:', e.message);
  }

  try {
    console.log('=== PDFIMAGES ===');
    console.log(execSync(`pdfimages -list "${caminhoCnh}"`, { encoding: 'utf-8' }));
  } catch (e: any) {
    console.log('Erro pdfimages:', e.message);
  }

  // Gera imagem da página 1 e página 2 com pdftoppm e lista o que gerou
  const tempDir = path.resolve(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  execSync(`pdftoppm -png -r 150 "${caminhoCnh}" "${tempDir}/cnh_debug"`);
  console.log('=== ARQUIVOS GERADOS POR pdftoppm ===');
  const imgs = fs.readdirSync(tempDir).filter(f => f.startsWith('cnh_debug'));
  imgs.forEach(f => {
    const s = fs.statSync(path.join(tempDir, f)).size;
    console.log(`- ${f}: ${s} bytes`);
  });
}

main().catch(console.error);
