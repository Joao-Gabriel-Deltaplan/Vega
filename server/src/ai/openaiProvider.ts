import OpenAI from 'openai';
import {
  obterRegistrosUsoIA,
  obterTabelaPrecos,
} from '../storage.js';
import { chamarEmbeddingsComTelemetria } from './telemetriaIaService.js';

export type AcaoIA =
  | { acao: 'entregar'; id: string }
  | { acao: 'ambiguo'; ids: string[] }
  | { acao: 'nao_encontrado'; termo: string }
  | { acao: 'conversa'; resposta: string }
  | { acao: 'bloqueado_cota'; mensagem: string };

/**
 * Modo simulador SÓ PODE ser ativado com variável explícita AI_SIMULADOR=true.
 * Se não estiver configurado como 'true', opera obrigatoriamente no modo real.
 */
export function isModoSimuladorAtivo(): boolean {
  return process.env.AI_SIMULADOR === 'true';
}

/**
 * Aguarda um determinado número de milissegundos
 */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retorna a data no fuso do Pacífico (America/Los_Angeles) no formato YYYY-MM-DD
 */
export function obterDataPacifico(data: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

/**
 * Converte string ISO para data no fuso do Pacífico
 */
export function obterDataPacificoDeIso(dataIso: string): string {
  try {
    return obterDataPacifico(new Date(dataIso));
  } catch {
    return dataIso.slice(0, 10);
  }
}

/**
 * Calcula o custo estimado em reais para uma quantidade de tokens
 */
export async function calcularCustoEstimado(
  modelo: string,
  tokensEntrada: number,
  tokensSaida: number
): Promise<number> {
  const tabela = await obterTabelaPrecos();
  const config = tabela[modelo] || tabela['gpt-5.4-mini'] || tabela['gpt-4o-mini'] || {
    precoEntradaPorMilhao: 0.9,
    precoSaidaPorMilhao: 3.6,
  };
  const custoEntrada = (tokensEntrada / 1_000_000) * (config.precoEntradaPorMilhao || 0);
  const custoSaida = (tokensSaida / 1_000_000) * (config.precoSaidaPorMilhao || 0);
  return Number((custoEntrada + custoSaida).toFixed(6));
}

export interface ResultadoChecagemCota {
  permitido: boolean;
  motivoBloqueio?: 'rpd' | 'teto';
  mensagem?: string;
}

/**
 * Verifica limites de cota:
 * - RPM (10 req/min): Se estourar, aguarda com backoff
 * - RPD (250 req/dia): Reset meia-noite Pacífico. Se estourar, bloqueia chamada
 * - Teto de custo mensal: Se > 0 e exceder, bloqueia chamada
 */
export async function verificarLimitesCota(): Promise<ResultadoChecagemCota> {
  const limiteRPM = parseInt(process.env.LIMITE_RPM || '10', 10);
  const limiteRPD = parseInt(process.env.LIMITE_RPD || '250', 10);
  const tetoMensal = parseFloat(process.env.TETO_CUSTO_MENSAL || '0');

  const agora = Date.now();
  const registros = await obterRegistrosUsoIA();

  // 1. Verificação de RPD (Fuso do Pacífico)
  const dataHojePac = obterDataPacifico(new Date(agora));
  const chamadasHoje = registros.filter(
    (r) => obterDataPacificoDeIso(r.data) === dataHojePac
  );

  if (chamadasHoje.length >= limiteRPD) {
    console.warn(
      `[VEGA/Cota] Limite diário (RPD) atingido: ${chamadasHoje.length}/${limiteRPD} em ${dataHojePac} (Horário do Pacífico).`
    );
    return {
      permitido: false,
      motivoBloqueio: 'rpd',
      mensagem:
        'Limite diário de consultas inteligentes atingido. A busca direta continua funcionando normalmente.',
    };
  }

  // 2. Verificação de Teto de Custo Mensal
  if (tetoMensal > 0) {
    const mesAtual = new Date(agora).toISOString().slice(0, 7);
    const custoMes = registros
      .filter((r) => r.data.slice(0, 7) === mesAtual)
      .reduce((acc, r) => acc + (r.custoEstimado || 0), 0);

    if (custoMes >= tetoMensal) {
      console.warn(
        `[VEGA/Cota] Teto mensal de custo atingido: R$ ${custoMes.toFixed(2)} / R$ ${tetoMensal.toFixed(2)}`
      );
      return {
        permitido: false,
        motivoBloqueio: 'teto',
        mensagem:
          'Teto de custo mensal da IA atingido. A busca direta continua funcionando normalmente.',
      };
    }
  }

  // 3. Verificação de RPM com espera e backoff (até 5 tentativas)
  let tentativasRPM = 0;
  while (tentativasRPM < 5) {
    const timestampAtual = Date.now();
    const registrosRecentes = await obterRegistrosUsoIA();
    const noUltimoMinuto = registrosRecentes.filter(
      (r) => timestampAtual - new Date(r.data).getTime() < 60000
    );

    if (noUltimoMinuto.length < limiteRPM) {
      break;
    }

    tentativasRPM++;
    // Ordena do mais antigo para calcular quando o slot vai liberar
    noUltimoMinuto.sort(
      (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime()
    );
    const maisAntiga = new Date(noUltimoMinuto[0].data).getTime();
    const tempoAteLiberar = 60000 - (timestampAtual - maisAntiga) + 500;
    const tempoEspera = Math.max(1000, Math.min(tempoAteLiberar, 5000));

    console.warn(
      `[VEGA/RPM] Limite de RPM atingido (${noUltimoMinuto.length}/${limiteRPM}). Aguardando ${tempoEspera}ms (tentativa ${tentativasRPM}/5)...`
    );
    await esperar(tempoEspera);
  }

  return { permitido: true };
}

/**
 * Gera embedding vetorial para um texto usando o modelo configurado em OPENAI_EMBEDDING_MODEL.
 */
export async function gerarEmbedding(texto: string): Promise<number[]> {
  if (isModoSimuladorAtivo()) {
    // Retorna vetor simulado de 1536 dimensões se em modo simulador
    return new Array(1536).fill(0).map(() => (Math.random() - 0.5) * 0.1);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === 'sua_chave_aqui' || apiKey.length < 10) {
    console.error('[VEGA] ❌ ERRO CRÍTICO: OPENAI_API_KEY ausente para gerar embedding e AI_SIMULADOR não está ativo.');
    throw new Error('OPENAI_API_KEY ausente e AI_SIMULADOR desativado');
  }

  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const openai = new OpenAI({ apiKey });

  const resposta = await chamarEmbeddingsComTelemetria(
    openai,
    {
      model: embeddingModel,
      input: texto,
    },
    { motivo: 'busca_embedding' }
  );

  return resposta.data[0].embedding;
}
