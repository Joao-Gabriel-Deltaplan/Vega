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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

export interface AnaliseValidadeResultado {
  documentoId: string;
  titulo: string;
  arquivo: string;
  titular?: string;
  dataValidade: string | null;
  trechoOndeAparece: string | null;
  justificativa: string;
}

export async function analisarValidadeComGPT(
  textoDocumento: string,
  titulo: string,
  tipo: string,
  arquivo: string
): Promise<{ dataValidade: string | null; trechoOndeAparece: string | null; justificativa: string }> {
  const promptSistema = `Você é um perito em análise documental jurídica e cadastral brasileira.
Sua missão é analisar o texto transcrito de um documento e determinar se ele possui UMA DATA DE VALIDADE OU VENCIMENTO FORMAL E EXPLÍCITA.

REGRAS OBRIGATÓRIAS E INEGOCIÁVEIS:
1. IGNORE CATEGORICAMENTE (NÃO SÃO VALIDADE):
   - Data de nascimento / aniversário
   - Data de emissão / expedição / confecção / elaboração / outorga / assinatura
   - Data de registro / protocolo / anotação / averbação
   - Data de colação de grau / diplomação / conclusão de curso
   - Data de admissão / início de atividades / abertura
   - Exercício fiscal / ano-calendário (ex: declaração IRPF 2024)
   - Datas de aplicação de doses de vacinas
2. O QUE É DATA DE VALIDADE/VENCIMENTO:
   - Termos como: "Validade:", "Válida até:", "Vencimento:", "Data de validade:", "Vigência até:", etc.
   - SÓ grave se o documento indicar CLARAMENTE uma data de validade/vencimento.
   - Exemplo 1 (CNH): "VALIDADE: 26/08/2034" -> dataValidade: "26/08/2034", trecho: "VALIDADE 26/08/2034".
   - Exemplo 2 (Certidão CREA): "Válida até: 30/06/2015" -> dataValidade: "30/06/2015", trecho: "Válida até: 30/06/2015".
   - Exemplo 3 (Carteira Profissional Vitalícia ou sem validade expressa, ex: CRT): "Válido em todo Território Nacional" refere-se a território, não a tempo. Se não traz termo de validade temporal, é vitalício/indeterminado (dataValidade: null).
   - Se for documento vitalício, permanente ou sem data expressa de término, retorne dataValidade: null e trechoOndeAparece: null.
3. Formato da data: sempre DD/MM/AAAA.
4. Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "dataValidade": "DD/MM/AAAA" ou null,
  "trechoOndeAparece": "trecho exato do documento com até 100 caracteres onde aparece o termo de validade e a data" ou null,
  "justificativa": "explicação concisa de por que a data foi escolhida ou por que o documento não tem validade"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: promptSistema },
        {
          role: 'user',
          content: `Documento: "${titulo}" (Arquivo: "${arquivo}", Tipo: "${tipo}").\n\nTexto completo do documento:\n${textoDocumento.slice(0, 15000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    return {
      dataValidade: parsed.dataValidade || null,
      trechoOndeAparece: parsed.trechoOndeAparece || null,
      justificativa: parsed.justificativa || '',
    };
  } catch (err: any) {
    console.error(`Erro ao analisar validade de ${titulo} com GPT:`, err.message);
    return {
      dataValidade: null,
      trechoOndeAparece: null,
      justificativa: 'Erro na chamada do modelo de IA.',
    };
  }
}

async function main() {
  console.log('===============================================================');
  console.log(`REPROCESSANDO DOCUMENTOS COM ${chatModel} PARA EXTRAÇÃO DE VALIDADE`);
  console.log('===============================================================\n');

  const docs = await obterTodosDocumentos();
  const resultados: AnaliseValidadeResultado[] = [];

  for (const doc of docs) {
    console.log(`\nProcessando [${doc.tipo}] "${doc.titulo}" (${doc.arquivo})...`);
    const caminhoPdf = path.resolve(__dirname, '../../../arquivos', doc.arquivo);

    let texto = '';
    if (fs.existsSync(caminhoPdf)) {
      const extraido = await extrairTextoDocumento(caminhoPdf, openai, {
        titulo: doc.titulo,
        descricao: doc.descricao,
        titular: doc.titular,
      });
      texto = extraido.paginas.map((p) => p.texto).join('\n');
    } else {
      texto = `${doc.titulo}. ${doc.descricao || ''}`;
    }

    const analise = await analisarValidadeComGPT(texto, doc.titulo, doc.tipo || '', doc.arquivo);
    resultados.push({
      documentoId: doc.id,
      titulo: doc.titulo,
      arquivo: doc.arquivo,
      titular: doc.titular,
      dataValidade: analise.dataValidade,
      trechoOndeAparece: analise.trechoOndeAparece,
      justificativa: analise.justificativa,
    });

    console.log(`   -> Validade: ${analise.dataValidade || 'SEM VALIDADE (NULA)'}`);
    console.log(`   -> Trecho: ${analise.trechoOndeAparece || 'N/A'}`);
    console.log(`   -> Justificativa: ${analise.justificativa}`);
  }

  console.log('\n===============================================================');
  console.log('RESUMO FINAL DA ANÁLISE DE VALIDADE');
  console.log('===============================================================');
  for (const r of resultados) {
    console.log(`\n• Documento: "${r.titulo}" (${r.arquivo}) - Titular: ${r.titular || 'N/A'}`);
    console.log(`  Data de Validade: ${r.dataValidade || 'Sem validade'}`);
    console.log(`  Trecho no Documento: "${r.trechoOndeAparece || 'Nenhum termo de validade'}"`);
    console.log(`  Justificativa: ${r.justificativa}`);
  }
}

// Permite execução direta via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
