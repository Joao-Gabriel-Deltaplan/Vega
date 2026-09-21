import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { extractText } from 'unpdf';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  obterTodosDocumentos,
  obterTodosConhecimentos,
  obterTodosTitulares,
  salvarOuAtualizarTitular,
} from '../storage.js';
import { DocumentoRegistro, FichaTitular, CampoTitularId } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');
const TEMP_DIR = path.resolve(__dirname, '../../../temp_ocr');

function assegurarTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function calcularHashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calcularHashTexto(texto: string): string {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

function mascararDadosSensiveis(texto: string): string {
  return texto
    .replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, '***.***.$3-**')
    .replace(/\b(\d{1,2})\.?(\d{3})\.?(\d{3})-?([0-9Xx])\b/g, '**.***.$3-*');
}

export interface PaginaExtraida {
  pagina: number;
  texto: string;
  usouOCR: boolean;
}

export interface RelatorioDocumento {
  id: string;
  titulo: string;
  arquivo: string;
  paginas: number;
  usouOCR: boolean;
  caracteresExtraidos: number;
  quantidadeTrechos: number;
  custoEstimadoUSD: number;
  camposSugeridos?: Record<string, string>;
  amostra300: string;
  status: 'indexado' | 'inalterado' | 'erro';
  erro?: string;
}

/**
 * Converte uma página específica de um PDF em imagem PNG usando pdftoppm e executa OCR com gpt-5.4-mini
 */
async function executarOcrPaginaComVisao(
  caminhoPdf: string,
  numPagina: number,
  openai: OpenAI
): Promise<string> {
  assegurarTempDir();
  const prefixoSaida = path.join(TEMP_DIR, `pagina_${Date.now()}_${numPagina}`);

  try {
    // pdftoppm extrai com 150 DPI para equilíbrio perfeito entre custo de tokens e legibilidade
    execSync(
      `pdftoppm -png -r 150 -f ${numPagina} -l ${numPagina} "${caminhoPdf}" "${prefixoSaida}"`,
      { stdio: 'pipe' }
    );

    // Encontra o arquivo gerado (pdftoppm gera no formato prefixoSaida-1.png ou prefixoSaida-01.png)
    const arquivosGerados = fs
      .readdirSync(TEMP_DIR)
      .filter((f) => f.startsWith(path.basename(prefixoSaida)) && f.endsWith('.png'));

    if (arquivosGerados.length === 0) {
      throw new Error(`pdftoppm não gerou arquivo de imagem para a página ${numPagina}`);
    }

    const caminhoImg = path.join(TEMP_DIR, arquivosGerados[0]);
    const imgBuffer = fs.readFileSync(caminhoImg);
    const base64Img = imgBuffer.toString('base64');

    // Remove imagem temporária imediatamente
    try {
      fs.unlinkSync(caminhoImg);
    } catch {
      // Silencioso
    }

    // Chama o gpt-5.4-mini com visão
    const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcreva todo o texto contido nesta imagem de documento com máxima fidelidade, preservando nomes próprios, datas, números, filiação e campos estruturados. Não adicione comentários adicionais, apenas o texto transcrito.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Img}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_completion_tokens: 3000,
      temperature: 0.1,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (err: any) {
    console.error(`Erro no OCR da página ${numPagina}:`, err?.message || err);
    throw err;
  }
}

/**
 * Remove textos de cabeçalho, capa ou rodapé gerados pela própria VEGA
 */
export function limparTextoCapaVega(texto: string): string {
  if (!texto) return '';
  return texto
    .replace(/DELTA PLAN\s+CONSULTORIA & SOLUÇÕES DE INTELIGÊNCIA ARTIFICIAL[^\n]*/gi, '')
    .replace(/Emissão:\s*\d{2}\/\d{2}\/\d{4}[^\n]*/gi, '')
    .replace(/Documento oficial armazenado no Cofre Delta Plan\.[^\n]*/gi, '')
    .replace(/Emitido em:\s*\d{2}\/\d{2}\/\d{4}[^\n]*/gi, '')
    .replace(/Delta Plan\s*•\s*Documento gerado pela assistente virtual Vega\s*•\s*delta-plan\.com\.br/gi, '')
    .replace(/CNH Digital Thomaz\s+CNH Digital Thomaz/gi, '')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifica se a página do PDF contém imagens relevantes (ex: CNH, documentos escaneados ou fotos)
 */
export function verificarSePaginaTemImagensRelevantes(caminhoPdf: string, numPagina: number): boolean {
  try {
    const out = execSync(`pdfimages -list "${caminhoPdf}"`, { encoding: 'utf-8' });
    const linhas = out.split('\n');
    for (const linha of linhas) {
      const match = linha.trim().match(/^(\d+)\s+\d+\s+image\s+(\d+)\s+(\d+)/i);
      if (match) {
        const pag = parseInt(match[1], 10);
        const w = parseInt(match[2], 10);
        const h = parseInt(match[3], 10);
        if (pag === numPagina && (w >= 120 || h >= 120)) {
          return true;
        }
      }
    }
  } catch {
    // Silencioso se não houver pdfimages disponível
  }
  return false;
}

/**
 * Extrai texto completo de uma imagem usando gpt-5.4-mini com visão
 */
export async function extrairTextoImagemComVisao(
  bufferImg: Buffer,
  mimetype: string,
  openai: OpenAI
): Promise<string> {
  const base64Img = bufferImg.toString('base64');
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  let mediaType = mimetype.toLowerCase();
  if (!mediaType.startsWith('image/')) {
    mediaType = 'image/jpeg';
  }

  const response = await openai.chat.completions.create({
    model: chatModel,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcreva todo o texto contido nesta imagem de documento com máxima fidelidade, preservando nomes próprios, datas, números, filiação e campos estruturados. Não adicione comentários adicionais, apenas o texto transcrito.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaType};base64,${base64Img}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_completion_tokens: 3000,
    temperature: 0.1,
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

/**
 * Extrai texto página por página de documentos (PDF ou imagens JPG/PNG/WEBP),
 * recorrendo a OCR com gpt-5.4-mini caso seja imagem ou página com pouco texto/escaneada.
 */
export async function extrairTextoDocumento(
  caminhoArquivo: string,
  openai: OpenAI,
  docInfo?: { titulo: string; descricao?: string; titular?: string }
): Promise<{ paginas: PaginaExtraida[]; usouOCR: boolean; custoOcrUSD: number }> {
  const ext = path.extname(caminhoArquivo).toLowerCase();
  const isImagem = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

  // SUPORTE NATIVO A IMAGENS (JPG, JPEG, PNG, WEBP)
  if (isImagem) {
    console.log(`   [OCR com Visão 🖼️] Processando arquivo de imagem "${path.basename(caminhoArquivo)}" com gpt-5.4-mini...`);
    const buf = fs.readFileSync(caminhoArquivo);
    let mime = 'image/jpeg';
    if (ext === '.png') mime = 'image/png';
    else if (ext === '.webp') mime = 'image/webp';

    const textoOcr = await extrairTextoImagemComVisao(buf, mime, openai);
    const textoLimpo = limparTextoCapaVega(textoOcr);
    const textoFinal =
      textoLimpo ||
      (docInfo
        ? `${docInfo.titulo}. ${docInfo.descricao || ''} Titular: ${docInfo.titular || ''}`.trim()
        : '');

    return {
      paginas: [{ pagina: 1, texto: textoFinal, usouOCR: true }],
      usouOCR: true,
      custoOcrUSD: 0.00055,
    };
  }

  // SUPORTE A ARQUIVOS PDF
  const buf = fs.readFileSync(caminhoArquivo);
  const { text: paginasTexto, totalPages: paginasDetectadas } = await extractText(new Uint8Array(buf), { mergePages: false });
  const paginasValidas = (Array.isArray(paginasTexto) ? paginasTexto : [paginasTexto]).map((b) => (b || '').trim());

  let totalPaginas = paginasValidas.length;
  try {
    const outputInfo = execSync(`pdfinfo "${caminhoArquivo}"`, { encoding: 'utf-8' });
    const matchP = outputInfo.match(/Pages:\s+(\d+)/i);
    if (matchP) totalPaginas = parseInt(matchP[1], 10);
  } catch {
    if (totalPaginas === 0) totalPaginas = 1;
  }

  const paginasResultado: PaginaExtraida[] = [];
  let usouOCR = false;
  let custoOcrUSD = 0;

  for (let i = 1; i <= Math.max(totalPaginas, 1); i++) {
    const textoPagOriginal = paginasValidas[i - 1] || '';
    const textoPagLimpo = limparTextoCapaVega(textoPagOriginal);

    // Regra: aplica OCR com visão se tiver imagens relevantes OU se a página tiver menos de 300 caracteres úteis!
    const caracteresUteis = textoPagLimpo.replace(/[^a-zA-Z0-9]/g, '').length;
    const temImagensRelevantes = verificarSePaginaTemImagensRelevantes(caminhoArquivo, i);
    const requerOCR = caracteresUteis < 300 || temImagensRelevantes;

    if (requerOCR) {
      console.log(`   [OCR com Visão 📄] Página ${i}/${totalPaginas} (caracteres úteis: ${caracteresUteis}, imagens: ${temImagensRelevantes ? 'SIM' : 'NÃO'}). Aplicando OCR com gpt-5.4-mini...`);
      const textoOcrBruto = await executarOcrPaginaComVisao(caminhoArquivo, i, openai);
      const textoOcrFinal = limparTextoCapaVega(textoOcrBruto);

      let textoPagina = textoOcrFinal;
      if (!textoPagina || textoPagina.length < 15) {
        textoPagina = docInfo ? `${docInfo.titulo}. ${docInfo.descricao || ''} Titular: ${docInfo.titular || ''}`.trim() : textoPagLimpo;
      }

      paginasResultado.push({
        pagina: i,
        texto: textoPagina,
        usouOCR: true,
      });
      usouOCR = true;
      custoOcrUSD += 0.00055;
    } else {
      paginasResultado.push({
        pagina: i,
        texto: textoPagLimpo,
        usouOCR: false,
      });
    }
  }

  return { paginas: paginasResultado, usouOCR, custoOcrUSD };
}

/**
 * Divide o texto em trechos de ~800 tokens (~2400 caracteres) com overlap de ~100 tokens (~350 caracteres)
 * Respeita limites de sentenças/palavras mesmo dentro da mesma página.
 */
export function dividirEmTrechos(
  paginas: PaginaExtraida[],
  tamanhoChars: number = 2400,
  overlapChars: number = 350
): { conteudo: string; pagina: number }[] {
  const trechos: { conteudo: string; pagina: number }[] = [];

  for (const pag of paginas) {
    const textoLimpo = pag.texto.replace(/\s+/g, ' ').trim();
    if (!textoLimpo || textoLimpo.length < 20) continue;

    if (textoLimpo.length <= tamanhoChars) {
      trechos.push({ conteudo: textoLimpo, pagina: pag.pagina });
      continue;
    }

    let inicio = 0;
    while (inicio < textoLimpo.length) {
      let fim = Math.min(inicio + tamanhoChars, textoLimpo.length);

      // Tenta quebrar em limite de frase ou pontuação se não estiver no fim absoluto
      if (fim < textoLimpo.length) {
        const proximoEspaco = textoLimpo.lastIndexOf('. ', fim);
        if (proximoEspaco > inicio + (tamanhoChars * 0.7)) {
          fim = proximoEspaco + 1;
        } else {
          const espaco = textoLimpo.lastIndexOf(' ', fim);
          if (espaco > inicio + (tamanhoChars * 0.7)) {
            fim = espaco;
          }
        }
      }

      const pedaco = textoLimpo.slice(inicio, fim).trim();
      if (pedaco.length > 0) {
        trechos.push({ conteudo: pedaco, pagina: pag.pagina });
      }

      if (fim >= textoLimpo.length) break;
      inicio = Math.max(fim - overlapChars, inicio + 1);
    }
  }

  return trechos;
}

/**
 * Gera embeddings em lote (várias entradas por chamada) com text-embedding-3-small
 */
export async function gerarEmbeddingsEmLote(
  textos: string[],
  openai: OpenAI
): Promise<number[][]> {
  if (textos.length === 0) return [];
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';

  const response = await openai.embeddings.create({
    model,
    input: textos,
  });

  return response.data.map((d) => d.embedding);
}

/**
 * FASE 3: Extrai campos sugeridos de titulares com gpt-5.4-mini para documentos pessoais
 */
export async function extrairCamposSugeridosFicha(
  textoCompleto: string,
  tipoDoc: string,
  openai: OpenAI
): Promise<Record<string, string>> {
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  const promptInstrucao = `Você é um extrator especialista de dados cadastrais para fichas cadastrais brasileiras.
Analise o texto deste documento (${tipoDoc}) e extraia com exatidão os dados solicitados.

IMPORTANTE PARA CERTIDÃO DE CASAMENTO:
Uma certidão de casamento possui DOIS cônjuges e a filiação de ambos.
- Identifique claramente quem é o primeiro cônjuge e quem é o segundo cônjuge.
- O campo "nomeCompleto" deve ser do titular principal (Thomaz se presente, ou do primeiro cônjuge).
- O campo "nomePai" e "nomeMae" devem corresponder aos pais do titular indicado em "nomeCompleto".
- O campo "conjuge" deve ser o nome do outro cônjuge.

Retorne ESTRITAMENTE um objeto JSON com as chaves (todas opcionais, preencha apenas as que constarem com certeza no texto):
{
  "nomeCompleto": "nome da pessoa",
  "nomePai": "nome do pai",
  "nomeMae": "nome da mãe",
  "dataNascimento": "DD/MM/AAAA",
  "cpf": "000.000.000-00",
  "rg": "número do RG",
  "orgaoEmissor": "órgão emissor do RG",
  "cnh": "número de registro da CNH / habilitação",
  "categoriaCnh": "categoria da habilitação (ex: B, AB, A, C, D, E)",
  "validadeCnh": "data de validade da CNH (DD/MM/AAAA)",
  "numeroDocumento": "número do documento se for CREA/CRT",
  "tipoDocumento": "tipo do documento",
  "estadoCivil": "Casado(a), Solteiro(a), etc.",
  "profissao": "profissão informada",
  "conjuge": "nome do cônjuge",
  "dataValidadeDocumento": "data de validade do documento em formato DD/MM/AAAA se existir (CNH, CREA, CRT, alvará, certidão com validade, etc.) ou null caso não exista validade"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: promptInstrucao },
        { role: 'user', content: textoCompleto.slice(0, 10000) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: 1000,
    });

    const conteudo = response.choices[0]?.message?.content || '{}';
    return JSON.parse(conteudo);
  } catch (err) {
    console.error('Erro ao extrair campos da ficha:', err);
    return {};
  }
}

/**
 * Atualiza data/titulares.json com os campos sugeridos sem sobrescrever dados conferidos
 */
export async function salvarCamposSugeridosNoTitular(
  titularNome: string,
  camposSugeridos: Record<string, string>,
  docIdOrigem: string,
  docTituloOrigem: string
): Promise<void> {
  if (!camposSugeridos || Object.keys(camposSugeridos).length === 0) return;
  if (!titularNome || !titularNome.trim()) return;

  const todos = await obterTodosTitulares();
  const nomeTitularBusca = titularNome.toLowerCase().trim();

  let titular = todos.find(
    (t) =>
      t.nome.toLowerCase().includes(nomeTitularBusca) ||
      nomeTitularBusca.includes(t.nome.toLowerCase().split(' ')[0])
  );

  if (!titular) {
    titular = {
      id: `tit_${nomeTitularBusca.replace(/\s+/g, '_')}`,
      nome: titularNome.trim(),
      campos: {},
      atualizadoEm: new Date().toLocaleDateString('pt-BR'),
    };
    todos.push(titular);
  }

  const mapaCampos: Record<string, CampoTitularId> = {
    nomeCompleto: 'nome',
    cpf: 'cpf',
    rg: 'rg',
    orgaoEmissor: 'orgaoEmissor',
    dataNascimento: 'dataNascimento',
    estadoCivil: 'estadoCivil',
    profissao: 'profissao',
    cnh: 'cnh',
    categoriaCnh: 'categoriaCnh',
    validadeCnh: 'validadeCnh',
  };

  for (const [chaveExtraida, valor] of Object.entries(camposSugeridos)) {
    if (!valor || !valor.trim() || valor.toLowerCase().includes('não consta') || valor.toLowerCase().includes('nao consta')) continue;

    // Tratamento especial para pai / mãe -> campo "filiacao"
    if (chaveExtraida === 'nomePai' || chaveExtraida === 'nomeMae') {
      const filiacaoAtual = titular.campos.filiacao;
      if (filiacaoAtual && (filiacaoAtual.manual || filiacaoAtual.origem === 'corrigido pelo chat' || filiacaoAtual.conferido)) {
        continue;
      }
      if (!filiacaoAtual || !filiacaoAtual.conferido) {
        let textoFiliacao = filiacaoAtual?.valor || '';
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (chaveExtraida === 'nomePai' && !norm(textoFiliacao).includes(norm(valor))) {
          textoFiliacao = textoFiliacao ? `${textoFiliacao} | Pai: ${valor}` : `Pai: ${valor}`;
        }
        if (chaveExtraida === 'nomeMae' && !norm(textoFiliacao).includes(norm(valor))) {
          textoFiliacao = textoFiliacao ? `${textoFiliacao} | Mãe: ${valor}` : `Mãe: ${valor}`;
        }
        titular.campos.filiacao = {
          valor: textoFiliacao,
          origem: docIdOrigem,
          origemNome: docTituloOrigem,
          origemVisibilidade: 'diretoria',
          conferido: false, // SUGERIDO, NÃO CONFERIDO!
        };
      }
      continue;
    }

    const campoDestino = mapaCampos[chaveExtraida];
    if (campoDestino) {
      const campoExistente = titular.campos[campoDestino];
      // REGRA INEGOCIÁVEL: NUNCA SOBRESCREVER CAMPOS MANUAIS, CORRIGIDOS PELO CHAT OU JÁ CONFERIDOS!
      if (campoExistente && (campoExistente.manual || campoExistente.origem === 'corrigido pelo chat' || campoExistente.conferido)) {
        continue;
      }

      titular.campos[campoDestino] = {
        valor: valor.trim(),
        origem: docIdOrigem,
        origemNome: docTituloOrigem,
        origemVisibilidade: 'diretoria',
        conferido: false, // SUGERIDO, NÃO CONFERIDO!
      };
    }
  }

  await salvarOuAtualizarTitular(titular);
}
