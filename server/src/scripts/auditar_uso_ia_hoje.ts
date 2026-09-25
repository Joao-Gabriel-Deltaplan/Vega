import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function consultarUsoHoje() {
  const supabase = getSupabaseClient();
  
  // Consulta registros de uso_ia
  const { data: todosRegistros, error } = await supabase
    .from('uso_ia')
    .select('*')
    .order('data', { ascending: false });

  if (error) {
    console.error('Erro ao consultar uso_ia:', error);
    return;
  }

  console.log(`Total geral de registros na tabela uso_ia: ${todosRegistros?.length || 0}`);

  // Filtrar apenas registros de hoje (2026-09-25 em UTC e Brasília)
  const hojeStrUtc = '2026-09-25';
  
  const registrosHoje = (todosRegistros || []).filter((r: any) => {
    return String(r.data).startsWith(hojeStrUtc);
  });

  console.log(`\n--- Registros de hoje (${hojeStrUtc}) na tabela uso_ia: ${registrosHoje.length} ---`);

  let custoTotalHoje = 0;
  let tokensEntradaTotal = 0;
  let tokensSaidaTotal = 0;
  const porModelo: Record<string, { count: number; custo: number; tokens: number }> = {};
  const porMotivo: Record<string, { count: number; custo: number }> = {};

  for (const r of registrosHoje) {
    const custo = Number(r.custo_estimado || 0);
    const entrada = Number(r.tokens_entrada || 0);
    const saida = Number(r.tokens_saida || 0);
    custoTotalHoje += custo;
    tokensEntradaTotal += entrada;
    tokensSaidaTotal += saida;

    const mod = r.modelo || 'desconhecido';
    if (!porModelo[mod]) porModelo[mod] = { count: 0, custo: 0, tokens: 0 };
    porModelo[mod].count += 1;
    porModelo[mod].custo += custo;
    porModelo[mod].tokens += (entrada + saida);

    const mot = r.motivo || 'desconhecido';
    if (!porMotivo[mot]) porMotivo[mot] = { count: 0, custo: 0 };
    porMotivo[mot].count += 1;
    porMotivo[mot].custo += custo;
  }

  console.log(`Custo Total Hoje em uso_ia: $${custoTotalHoje.toFixed(6)} USD`);
  console.log(`Tokens Totais Hoje: ${tokensEntradaTotal + tokensSaidaTotal} (Entrada: ${tokensEntradaTotal}, Saída: ${tokensSaidaTotal})`);
  console.log('\nPor Modelo:');
  console.table(porModelo);
  console.log('\nPor Motivo:');
  console.table(porMotivo);

  // Também verificar o total de todo o mês de Setembro/2026
  const registrosMes = (todosRegistros || []).filter((r: any) => {
    return String(r.data).startsWith('2026-09');
  });
  const custoMes = registrosMes.reduce((acc: number, r: any) => acc + Number(r.custo_estimado || 0), 0);
  console.log(`\nCusto Total Acumulado em Setembro/2026 em uso_ia: $${custoMes.toFixed(4)} USD (em ${registrosMes.length} chamadas)`);

  // Se houver registros mais antigos, listar a primeira data registrada
  if (todosRegistros && todosRegistros.length > 0) {
    const datas = todosRegistros.map((r: any) => r.data).sort();
    console.log(`\nPrimeiro registro em uso_ia: ${datas[0]}`);
    console.log(`Último registro em uso_ia: ${datas[datas.length - 1]}`);
  }

  // Tentar consultar a API de Usage da OpenAI se a chave tiver permissão
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log('\nTentando consultar endpoints de Usage da OpenAI...');
    try {
      // Testar endpoint de usage da OpenAI
      const dataInicio = '2026-09-25';
      const dataFim = '2026-09-26';
      
      const resUsage = await fetch(`https://api.openai.com/v1/organization/usage/completions?date=${dataInicio}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        }
      });
      console.log(`OpenAI API /organization/usage/completions status: ${resUsage.status}`);
      if (resUsage.ok) {
        const usageData = await resUsage.json();
        console.log('Usage Data OpenAI:', JSON.stringify(usageData).slice(0, 500));
      } else {
        const errText = await resUsage.text();
        console.log('Erro ao consultar /organization/usage/completions:', errText.slice(0, 300));
      }
    } catch (e: any) {
      console.log('Erro de requisição à API da OpenAI:', e.message);
    }
  }
}

consultarUsoHoje().catch(console.error);
