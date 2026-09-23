import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import { extractText } from 'unpdf';
import { AnaliseDocumentoResponse, VisibilidadeDoc } from './types.js';
import { extrairCamposTitularDeDocumento } from './extracaoTitularService.js';
import { extrairTextoImagemComVisao } from './indexador/indexadorService.js';
import { obterTodosTitulares } from './storage.js';

const TEMP_DIR = path.resolve(process.cwd(), 'temp_ocr');

function assegurarTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Converte a primeira página de um PDF em imagem PNG usando pdftoppm e extrai o texto com gpt-5.4-mini (visão)
 */
async function extrairTextoPdfEscaneadoComVisao(
  bufferPdf: Buffer,
  openai: OpenAI
): Promise<string> {
  assegurarTempDir();
  const idTemp = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const caminhoPdfTemp = path.join(TEMP_DIR, `${idTemp}.pdf`);
  const prefixoSaida = path.join(TEMP_DIR, `${idTemp}_p1`);

  try {
    fs.writeFileSync(caminhoPdfTemp, bufferPdf);
    // Extrai página 1 em PNG com 150 DPI
    execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${caminhoPdfTemp}" "${prefixoSaida}"`, {
      stdio: 'pipe',
    });

    const arquivosGerados = fs
      .readdirSync(TEMP_DIR)
      .filter((f) => f.startsWith(path.basename(prefixoSaida)) && f.endsWith('.png'));

    if (arquivosGerados.length === 0) {
      return '';
    }

    const caminhoImg = path.join(TEMP_DIR, arquivosGerados[0]);
    const imgBuffer = fs.readFileSync(caminhoImg);
    const base64Img = imgBuffer.toString('base64');

    try {
      fs.unlinkSync(caminhoImg);
    } catch {}

    const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcreva todo o texto contido nesta imagem de documento com máxima fidelidade. Preserve nomes completos, títulos, órgãos emissores, datas, números de documentos, nacionalidade e filiação.',
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
      max_completion_tokens: 2500,
      temperature: 0.1,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('[analiseDocumentoService ⚠️] Erro ao processar OCR em PDF escaneado:', err);
    return '';
  } finally {
    try {
      if (fs.existsSync(caminhoPdfTemp)) fs.unlinkSync(caminhoPdfTemp);
    } catch {}
  }
}

/**
 * Analisa o documento enviado (PDF ou imagens JPG/PNG/WEBP).
 * Utiliza IA (gpt-5.4-mini) com reconhecimento dinâmico de tipos (sem listas engessadas)
 * e conferência estrita de titulares contra os cadastrados no Supabase.
 * NUNCA utiliza titulares ou tipos padrão (como 'Delta Plan' ou 'Outros') quando não identificados.
 */
export async function analisarDocumentoParaCofre(dados: {
  nomeArquivo: string;
  mimeType?: string;
  base64?: string;
  tamanho?: number;
}): Promise<AnaliseDocumentoResponse> {
  const { nomeArquivo, base64 } = dados;

  const nomeLimpo = nomeArquivo.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const tituloBase = nomeLimpo
    .split(' ')
    .map((palavra) => {
      const p = palavra.toLowerCase();
      if (['de', 'da', 'do', 'dos', 'das', 'e'].includes(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');

  // Busca lista de titulares já cadastrados no Supabase para comparação estrita
  let listaTitularesCadastrados: string[] = [];
  try {
    const titulares = await obterTodosTitulares();
    listaTitularesCadastrados = titulares.map((t) => t.nome).filter(Boolean);
  } catch (err) {
    console.error('[analiseDocumentoService] Falha ao obter titulares do Supabase:', err);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  let textoExtraido = '';
  const isPdf = dados.mimeType === 'application/pdf' || nomeArquivo.toLowerCase().endsWith('.pdf');
  const isImagem = dados.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(nomeArquivo);

  if (base64 && isPdf) {
    try {
      const base64Limpo = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Limpo, 'base64');
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      const textoLimpo = (text || '').trim();

      // Se o PDF tiver texto vetorial legível (> 60 caracteres úteis), usa o texto
      const charsUteis = textoLimpo.replace(/[^a-zA-Z0-9]/g, '').length;
      if (charsUteis >= 60) {
        textoExtraido = textoLimpo;
      } else if (openai) {
        // PDF escaneado / foto salva como PDF: executa OCR com visão na página 1
        console.log(`[analiseDocumentoService 📄] PDF "${nomeArquivo}" possui pouco texto vetorial (${charsUteis} chars). Aplicando visão OCR com gpt-5.4-mini...`);
        textoExtraido = await extrairTextoPdfEscaneadoComVisao(buffer, openai);
      }
    } catch (err) {
      console.error('[analiseDocumentoService] Erro ao extrair texto do PDF:', err);
    }
  } else if (base64 && isImagem && openai) {
    try {
      const base64Limpo = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Limpo, 'base64');
      const ext = path.extname(nomeArquivo).toLowerCase();
      let mime = dados.mimeType || 'image/jpeg';
      if (ext === '.png') mime = 'image/png';
      else if (ext === '.webp') mime = 'image/webp';
      else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';

      textoExtraido = await extrairTextoImagemComVisao(buffer, mime, openai);
    } catch (err) {
      console.error('[analiseDocumentoService] Erro ao extrair texto de imagem com visão:', err);
    }
  }

  // Se tiver OpenAI e texto extraído ou nome de arquivo, faz análise com IA
  if (openai && (textoExtraido || nomeLimpo)) {
    try {
      const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';
      const promptSistema = `Você é o analisador oficial de documentos do Cofre da Delta Plan (Assistente VEGA).
Sua missão é extrair com precisão os metadados do documento analisado.

TITULARES CADASTRADOS NO SISTEMA:
${listaTitularesCadastrados.length > 0 ? listaTitularesCadastrados.map((t) => `- ${t}`).join('\n') : '(Nenhum titular cadastrado ainda)'}

REGRAS DE CLASSIFICAÇÃO:
1. TIPO DE DOCUMENTO (tipoDocumento):
   - NÃO é uma lista fixa. Nomeie pelo que o documento realmente é em linguagem natural em português.
   - Exemplos: "Passaporte", "CNH", "RG", "Título de Eleitor", "Certidão de Nascimento", "Certidão de Casamento", "Certificado de Reservista", "Alvará de Funcionamento", "Contrato Social", "Contrato de Prestação de Serviços", "Procuração", "Nota Fiscal", "Anotação de Responsabilidade Técnica (ART)", "Certidão de Registro Técnico (CRT)", "Comprovante de Endereço", "Cartão CNPJ", "DRE", etc.
   - NUNCA retorne "Outros" se for possível classificar. Se não for possível identificar com segurança, retorne null.

2. NOME NO DOCUMENTO (nomeNoDocumento):
   - Extraia o nome completo da pessoa física ou a razão social da empresa que consta expressamente no documento como titular, outorgante, requerente ou titular do documento.
   - Se for documento de identificação pessoal (Passaporte, RG, CNH, Certidões), extraia o nome completo impresso no documento.
   - Se não constar nenhum nome de pessoa ou empresa, retorne null.

3. RECONHECIMENTO DE TITULAR (titularIdentificado):
   - Se o "nomeNoDocumento" pertencer claramente a um titular cadastrado (ex: "THOMAZ LUSTRI FABRE" ou "Thomaz Fabre" corresponde ao titular cadastrado "Thomaz" ou "Thomaz Lustri Fabre"), retorne exatamente o nome do titular cadastrado.
   - Se o documento for comprovadamente da própria empresa (ex: Contrato Social da Delta Plan, Alvará da Delta Plan), retorne "Delta Plan".
   - Se o documento for pessoal ou de outra empresa e o nome NÃO bater com nenhum titular cadastrado, retorne null e marque "novoTitularSugerido": true.
   - NUNCA assuma "Delta Plan" como padrão para documentos de pessoas físicas ou quando o titular for desconhecido! Campo não identificado deve ser null.

4. DADOS COMPLEMENTARES:
   - "titulo": Título limpo e claro (ex: "Passaporte Thomaz Lustri Fabre", "CNH Thomaz", "Contrato Social Delta Plan").
   - "descricao": Resumo informativo factual em 1 frase.
   - "visibilidade": "diretoria" para documentos pessoais, societários ou financeiros; "geral" para normas ou regimentos.
   - "apelidos": 2 a 4 termos/sinônimos úteis para busca (ex: ["passaporte", "passaporte thomaz"]).
   - "dataValidade": Data de validade/expiração no formato DD/MM/AAAA, ou null se não tiver validade.
   - "camposTitular": { "cpf": string|null, "rg": string|null, "orgaoEmissor": string|null, "dataNascimento": string|null, "validadeCnh": string|null }

RETORNE ESTRITAMENTE UM JSON no formato:
{
  "tipoDocumento": string | null,
  "nomeNoDocumento": string | null,
  "titularIdentificado": string | null,
  "novoTitularSugerido": boolean,
  "titulo": string,
  "descricao": string,
  "visibilidade": "diretoria" | "geral",
  "apelidos": string[],
  "dataValidade": string | null,
  "camposTitular": { ... }
}`;

      const respostaIA = await openai.chat.completions.create({
        model: chatModel,
        messages: [
          { role: 'system', content: promptSistema },
          {
            role: 'user',
            content: `Nome do arquivo: "${nomeArquivo}"\n\nConteúdo extraído do documento:\n${(textoExtraido || '').slice(0, 4000)}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const conteudoResposta = respostaIA.choices[0]?.message?.content?.trim();
      if (conteudoResposta) {
        const parsed = JSON.parse(conteudoResposta);

        const tipoFinal = (parsed.tipoDocumento || '').trim();
        const titularFinal = (parsed.titularIdentificado || '').trim();
        const nomeNoDoc = (parsed.nomeNoDocumento || '').trim() || null;
        const novoTitularSugerido = !!parsed.novoTitularSugerido;

        const camposSugeridosTitular = extrairCamposTitularDeDocumento({
          tipo: tipoFinal,
          texto: textoExtraido + ' ' + nomeLimpo,
          nomeArquivo,
          titular: titularFinal || nomeNoDoc || '',
        });

        // Mescla campos retornados pela IA com campos regex
        if (parsed.camposTitular) {
          Object.assign(camposSugeridosTitular, parsed.camposTitular);
        }

        return {
          tituloSugerido: (parsed.titulo || tituloBase).trim(),
          tipoSugerido: tipoFinal, // Vazio se a IA não identificou! NUNCA 'Outros' arbitrário
          titularSugerido: titularFinal, // Vazio se a IA não identificou! NUNCA 'Delta Plan' arbitrário
          nomeNoDocumento: nomeNoDoc,
          novoTitularSugerido,
          apelidosSugeridos: Array.isArray(parsed.apelidos) ? parsed.apelidos : [nomeLimpo.toLowerCase()],
          visibilidadeSugerida: (parsed.visibilidade as VisibilidadeDoc) || 'diretoria',
          descricaoSugerida: parsed.descricao || `Documento ${nomeLimpo} armazenado no cofre corporativo.`,
          camposSugeridosTitular,
          dataValidadeSugerida: parsed.dataValidade || null,
        };
      }
    } catch (errIa) {
      console.error('[analiseDocumentoService ⚠️] Erro na análise via IA:', errIa);
    }
  }

  // Fallback seguro se não houver IA: NÃO assume titular nem tipo padrão!
  return {
    tituloSugerido: tituloBase,
    tipoSugerido: '', // Fica vazio para perguntar ao usuário
    titularSugerido: '', // Fica vazio para perguntar ao usuário
    nomeNoDocumento: null,
    novoTitularSugerido: false,
    apelidosSugeridos: [nomeLimpo.toLowerCase()],
    visibilidadeSugerida: 'diretoria',
    descricaoSugerida: `Documento ${nomeLimpo} armazenado no cofre corporativo.`,
    camposSugeridosTitular: {},
    dataValidadeSugerida: null,
  };
}
