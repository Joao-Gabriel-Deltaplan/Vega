import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { executarRotinaVerificacaoVencimentos } from '../vencimentos/alertaVencimentoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const resultado = await executarRotinaVerificacaoVencimentos();
  console.log('Resultado da rotina de alertas:', resultado);
}

main().catch(console.error);
