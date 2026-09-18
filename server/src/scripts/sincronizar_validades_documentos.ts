import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { sincronizarValidadesDocumentosExistentes, obterTodosAlertas, executarRotinaVerificacaoVencimentos } from '../vencimentos/alertaVencimentoService.js';
import { obterTodosDocumentos } from '../storage.js';

async function rodar() {
  console.log('===============================================================');
  console.log('EXTRAÇÃO E SINCRONIZAÇÃO DE VALIDADES DE DOCUMENTOS');
  console.log('===============================================================\n');

  const docs = await sincronizarValidadesDocumentosExistentes();

  console.log('Documentos processados:');
  for (const doc of docs) {
    console.log(`- "${doc.titulo}" (${doc.titular || 'Delta Plan'}): Validade = ${doc.dataValidade || 'Nenhum (nulo)'} [Origem: ${doc.origemValidade}]`);
  }

  console.log('\nExecutando verificação de vencimentos inicial...');
  const resRotina = await executarRotinaVerificacaoVencimentos();
  console.log('Alertas gerados:', resRotina.alertasGerados.length);
  console.log('Total de alertas:', resRotina.totalAlertas);
  console.log('Não lidos:', resRotina.totalNaoLidos);
}

rodar().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
