import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';
import { classificarEReescreverMensagem } from '../chat/chatOrquestrador.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.error('ERRO: OPENAI_API_KEY ausente.');
  process.exit(1);
}
const openai = new OpenAI({ apiKey });

interface CasoTeste {
  pergunta: string;
  intencaoEsperada: string;
  pessoaEsperada?: string;
  descricao: string;
}

const CASOS_TESTE: CasoTeste[] = [
  // 1. Consulta de vencimentos
  {
    pergunta: 'tem algum documento vencendo?',
    intencaoEsperada: 'consultar_vencimentos',
    descricao: 'Consulta geral de vencimentos',
  },
  {
    pergunta: 'o que vence este mês?',
    intencaoEsperada: 'consultar_vencimentos',
    descricao: 'Vencimentos do mês',
  },
  {
    pergunta: 'quais documentos estão vencidos?',
    intencaoEsperada: 'consultar_vencimentos',
    descricao: 'Documentos vencidos',
  },

  // 2. Checklist de faltantes
  {
    pergunta: 'o que falta do Thomaz?',
    intencaoEsperada: 'consultar_checklist_faltantes',
    pessoaEsperada: 'Thomaz',
    descricao: 'Faltantes com titular',
  },
  {
    pergunta: 'o que está faltando?',
    intencaoEsperada: 'consultar_checklist_faltantes',
    descricao: 'Faltantes geral sem titular',
  },

  // 3. Listagem de catálogo
  {
    pergunta: 'quais documentos você tem?',
    intencaoEsperada: 'listar_documentos',
    descricao: 'Listagem geral do catálogo',
  },
  {
    pergunta: 'o que você tem do Thomaz?',
    intencaoEsperada: 'listar_documentos',
    pessoaEsperada: 'Thomaz',
    descricao: 'Listagem do catálogo por titular',
  },

  // 4. Fatos documentais vs. nascimento
  {
    pergunta: 'quando fui dispensado do serviço militar?',
    intencaoEsperada: 'pergunta_conteudo',
    descricao: 'Fato jurídico dispensa militar (NÃO deve ser dado_pessoal)',
  },
  {
    pergunta: 'qual a data de registro de casamento do Thomaz?',
    intencaoEsperada: 'pergunta_conteudo',
    pessoaEsperada: 'Thomaz',
    descricao: 'Fato jurídico registro de casamento (NÃO deve ser dado_pessoal)',
  },
];

async function main() {
  console.log('===============================================================');
  console.log('BATERIA DE TESTES — ETAPA 2 (REGRAS NO PROMPT DO CLASSIFICADOR)');
  console.log('===============================================================\n');

  let sucessos = 0;
  let falhas = 0;
  const tempos: number[] = [];

  for (let i = 0; i < CASOS_TESTE.length; i++) {
    const c = CASOS_TESTE[i];
    const inicio = Date.now();
    const res = await classificarEReescreverMensagem(c.pergunta, [], openai);
    const duracao = Date.now() - inicio;
    tempos.push(duracao);

    const intencaoOk = res.intencao === c.intencaoEsperada;
    const pessoaOk = c.pessoaEsperada
      ? res.pessoa?.toLowerCase().includes(c.pessoaEsperada.toLowerCase())
      : true;

    if (intencaoOk && pessoaOk) {
      console.log(`[PASSOU] Caso ${i + 1}: "${c.pergunta}"`);
      console.log(`         Desc: ${c.descricao}`);
      console.log(`         Intenção: ${res.intencao} | Pessoa: ${res.pessoa || '(nenhuma)'} | Tempo: ${duracao}ms\n`);
      sucessos++;
    } else {
      console.error(`[FALHOU] Caso ${i + 1}: "${c.pergunta}"`);
      console.error(`         Desc: ${c.descricao}`);
      console.error(`         Esperado: intencao=${c.intencaoEsperada}${c.pessoaEsperada ? `, pessoa=${c.pessoaEsperada}` : ''}`);
      console.error(`         Obtido: intencao=${res.intencao}, pessoa=${res.pessoa || '(nenhuma)'}`);
      console.error(`         Tempo: ${duracao}ms\n`);
      falhas++;
    }
  }

  const tempoMedio = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
  console.log('===============================================================');
  console.log(`RESULTADO DA ETAPA 2: ${sucessos}/${CASOS_TESTE.length} passaram (${falhas} falhas).`);
  console.log(`Tempo médio de classificação: ${tempoMedio}ms`);
  console.log('===============================================================');

  if (falhas > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal no teste:', err);
  process.exit(1);
});
