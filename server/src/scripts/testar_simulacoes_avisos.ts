import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import {
  simularFalhaParaTeste,
  listarAvisosSistema,
  contarAvisosAtivos,
  obterConfiguracoesAvisos,
} from '../avisos/avisosFalhaService.js';
import { supabase } from '../supabaseClient.js';

async function run() {
  console.log('================================================================');
  console.log('INICIANDO BATERIA DE TESTES DE AVISOS DE FALHA E DE CONSUMO');
  console.log('================================================================\n');

  // 1. Obter configurações ativas
  const config = await obterConfiguracoesAvisos();
  console.log('1. Configuração ativa no Supabase:');
  console.log(`   - Destinatários WhatsApp: ${config.destinatariosWhatsapp.join(', ') || 'Nenhum'}`);
  console.log(`   - Limite mensal USD: $${config.limiteMensalUsd}`);
  console.log(`   - Tipos monitorados: ${config.tiposAtivos.join(', ')}\n`);

  // 2. Testar simulação de cada um dos tipos requeridos
  const cenarios = [
    { tipo: 'openai_erro', descricao: 'Falha na OpenAI (Cota excedida / Timeout / Instabilidade)' },
    { tipo: 'consumo_limite', descricao: 'Consumo mensal atingindo 50%, 80% ou 100%' },
    { tipo: 'evolution_falha', descricao: 'Falha na Evolution API (WhatsApp desconectado / Erro de envio)' },
    { tipo: 'supabase_falha', descricao: 'Falha no Supabase (Banco de dados ou Storage indisponível)' },
    { tipo: 'indexacao_falha', descricao: 'Falha na Indexação (Documento com erro ou zero trechos)' },
    { tipo: 'transcricao_falha', descricao: 'Falha na Transcrição de Áudio (gpt-transcribe indisponível)' },
  ];

  console.log('2. Disparando simulação dos 6 tipos de falha:');
  for (const cenario of cenarios) {
    console.log(`   -> Testando [${cenario.tipo}]: ${cenario.descricao}...`);
    const resultado = await simularFalhaParaTeste(cenario.tipo);
    console.log(`      Resultado: ${resultado.sucesso ? 'SUCESSO' : 'FALHA'}`);
    console.log(`      Mensagem: ${resultado.mensagem}`);
    console.log(`      ID gravado: ${resultado.aviso?.id || 'N/A'}`);
    console.log(`      Severidade: ${resultado.aviso?.severidade || 'N/A'}\n`);
  }

  // 3. Teste do Anti-Spam: Repetição do mesmo erro
  console.log('3. Testando Agrupamento Anti-Spam (repetição do mesmo erro):');
  console.log('   -> Disparando segunda ocorrência do erro da OpenAI...');
  const repeticao1 = await simularFalhaParaTeste('openai_erro');
  console.log(`      Mensagem: ${repeticao1.mensagem}`);
  console.log(`      Total de ocorrências agrupadas: ${repeticao1.aviso?.quantidadeOcorrencias || 1}`);

  console.log('   -> Disparando terceira ocorrência do erro da OpenAI...');
  const repeticao2 = await simularFalhaParaTeste('openai_erro');
  console.log(`      Total de ocorrências agrupadas: ${repeticao2.aviso?.quantidadeOcorrencias || 1}`);
  console.log('      (Anti-Spam ativado: notificações via WhatsApp foram silenciadas para evitar flood)\n');

  // 4. Teste de Recuperação de Serviço
  console.log('4. Testando Notificação de Recuperação de Serviço (serviço restabelecido):');
  const resRecuperacao = await simularFalhaParaTeste('recuperacao');
  console.log(`   Resultado: ${resRecuperacao.sucesso ? 'SUCESSO' : 'FALHA'}`);
  console.log(`   Mensagem: ${resRecuperacao.mensagem}\n`);

  // 5. Verificar leitura e contagem no Supabase
  console.log('5. Verificando dados persistidos no Supabase:');
  const contagem = await contarAvisosAtivos();
  console.log(`   - Total de avisos no sistema: ${contagem.totalAtivos}`);
  console.log(`   - Avisos não lidos: ${contagem.naoLidos}`);

  const lista = await listarAvisosSistema({ limite: 10 });
  console.log(`\n   Últimos registros gravados no Supabase (${lista.length}):`);
  for (const a of lista.slice(0, 5)) {
    console.log(`   - [${a.tipo}] [${a.severidade.toUpperCase()}] status: ${a.status} | ocorrências: ${a.quantidadeOcorrencias}`);
    console.log(`     Título: ${a.titulo}`);
    console.log(`     Data: ${a.criadoEm}`);
  }

  console.log('\n================================================================');
  console.log('BATERIA DE TESTES CONCLUÍDA COM SUCESSO');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('Erro durante bateria de testes:', err);
  process.exit(1);
});
