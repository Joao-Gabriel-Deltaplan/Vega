import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { Anexo, Contato, DocumentoRegistro } from './types.js';
import { ASSISTENTE } from './config/assistente.js';
import { obterTodosDocumentos } from './storage.js';
import { formatarFraseAcompanhamento, extrairPrimeiroNome } from './utils/nomeUtils.js';
import { uploadArquivoStorage } from './utils/storageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARQUIVOS_DIR = path.resolve(__dirname, '../../arquivos');

// Garante que o diretório de arquivos exista
export function assegurarDiretorioArquivos(): void {
  if (!fs.existsSync(ARQUIVOS_DIR)) {
    fs.mkdirSync(ARQUIVOS_DIR, { recursive: true });
  }
}

// Formata tamanho em bytes para KB ou MB
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DadosPdf {
  titulo?: string;
  conteudo_markdown?: string;
}

// Extrai blocos ```pdf ... ``` da resposta
export function detectarBlocoPdf(texto: string): { dados: DadosPdf; textoLimpo: string } | null {
  const regexPdf = /```pdf\s*([\s\S]*?)\s*```/i;
  const match = texto.match(regexPdf);

  if (!match) {
    return null;
  }

  const conteudoBloco = match[1].trim();
  let dados: DadosPdf = {};

  try {
    // Tenta parsear como JSON
    dados = JSON.parse(conteudoBloco);
  } catch {
    // Se não for JSON estrito, tenta extrair título e markdown
    const linhas = conteudoBloco.split('\n');
    dados = {
      titulo: linhas[0].replace(/^#*\s*/, '').trim() || 'Documento Delta Plan',
      conteudo_markdown: conteudoBloco,
    };
  }

  // Remove o bloco do texto que vai aparecer no chat para ficar limpo
  const textoLimpo = texto.replace(regexPdf, '').trim();

  return { dados, textoLimpo };
}

interface DadosBlocoEntrega {
  id?: string;
  titulo?: string;
  arquivo?: string;
  nome?: string;
  conteudo_markdown?: string;
}

// Processa a entrega de documentos (Cofre de Documentos ou Geração de PDF)
export async function processarEntregaDocumento(
  textoCompleto: string,
  primeiroNome?: string,
  contato?: Contato
): Promise<{ anexo: Anexo | null; textoFinal: string }> {
  // Regex para capturar blocos ```documento ... ``` ou ```pdf ... ```
  const regexDocumento = /```(?:documento|pdf)\s*([\s\S]*?)\s*```/i;
  const match = textoCompleto.match(regexDocumento);

  if (!match) {
    return { anexo: null, textoFinal: textoCompleto.trim() };
  }

  const conteudoBloco = match[1].trim();
  let dados: DadosBlocoEntrega = {};

  try {
    dados = JSON.parse(conteudoBloco);
  } catch {
    const linhas = conteudoBloco.split('\n');
    dados = {
      titulo: linhas[0].replace(/^#*\s*/, '').trim() || 'Documento',
      conteudo_markdown: conteudoBloco,
    };
  }

  // Validação de Visibilidade e Acesso (Backend Guard)
  const nivelUsuario = contato?.nivelAcesso || contato?.ficha?.nivelAcesso || 'geral';
  const todosDocumentos = await obterTodosDocumentos();

  const docCorrespondente = todosDocumentos.find(
    (d) =>
      (dados.id && d.id.toLowerCase() === dados.id.toLowerCase()) ||
      (dados.arquivo && path.basename(d.arquivo).toLowerCase() === path.basename(dados.arquivo).toLowerCase()) ||
      (dados.titulo && d.titulo.toLowerCase() === dados.titulo.toLowerCase())
  );

  // Se o documento existe e requer nível diretoria, mas o usuário possui nível geral:
  // DESCARTA o bloco e responde exatamente "Não localizei esse documento." (sem revelar que existe e é restrito)
  if (docCorrespondente && docCorrespondente.visibilidade === 'diretoria' && nivelUsuario !== 'diretoria') {
    return { anexo: null, textoFinal: 'Não localizei esse documento.' };
  }

  const titulo = docCorrespondente?.titulo || dados.titulo || 'Documento';
  let anexo: Anexo | null = null;

  assegurarDiretorioArquivos();

  if (dados.arquivo) {
    const nomeArquivo = path.basename(docCorrespondente?.arquivo || dados.arquivo).trim();
    const caminho = path.join(ARQUIVOS_DIR, nomeArquivo);
    const ext = path.extname(nomeArquivo).toLowerCase();
    const isImagem = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const tipoAnexo: 'imagem' | 'pdf' | 'arquivo' = isImagem ? 'imagem' : (ext === '.pdf' ? 'pdf' : 'arquivo');

    if (fs.existsSync(caminho)) {
      const stats = fs.statSync(caminho);
      anexo = {
        tipo: tipoAnexo,
        url: `/arquivos/${encodeURIComponent(nomeArquivo)}`,
        nome: nomeArquivo,
        titulo: titulo.trim(),
        titular: docCorrespondente?.titular?.trim(),
        dataCadastro: docCorrespondente?.dataCadastro || new Date().toLocaleDateString('pt-BR'),
        tamanho: formatarTamanho(stats.size),
        visibilidade: docCorrespondente?.visibilidade,
      };
    } else {
      // Arquivo está no Supabase Storage (ou em nuvem)
      anexo = {
        tipo: tipoAnexo,
        url: `/arquivos/${encodeURIComponent(nomeArquivo)}`,
        nome: nomeArquivo,
        titulo: titulo.trim(),
        titular: docCorrespondente?.titular?.trim(),
        dataCadastro: docCorrespondente?.dataCadastro || new Date().toLocaleDateString('pt-BR'),
        tamanho: docCorrespondente?.tamanho || (isImagem ? 'Imagem' : 'PDF'),
        visibilidade: docCorrespondente?.visibilidade,
      };
    }
  } else {
    // Se não tem arquivo pré-definido, gera dinamicamente
    anexo = await gerarPdfDeMarkdown({
      titulo: titulo.trim(),
      conteudo_markdown:
        dados.conteudo_markdown ||
        `# ${titulo.trim()}\n\nDocumento gerado pela assistente virtual ${ASSISTENTE.nome}.`,
    });
  }

  // Remove o bloco do texto
  let textoLimpo = textoCompleto.replace(regexDocumento, '').trim();

  // Limpa quaisquer crases residuais
  textoLimpo = textoLimpo.replace(/```+/g, '').trim();

  // GARANTIA DE TEXTO (Fallback determinístico):
  // Se, após remover o bloco, o texto ficar vazio ou só com espaços, preencher automaticamente
  if (!textoLimpo || textoLimpo.length === 0) {
    textoLimpo = formatarFraseAcompanhamento(
      titulo.trim(),
      primeiroNome || contato?.nome,
      docCorrespondente?.titular
    );
  } else {
    // Normalização estrita: impede pontuações anômalas como ".." ou ",." ou ", ."
    textoLimpo = textoLimpo
      .replace(/\s+/g, ' ')
      .replace(/,\s*\./g, '.')
      .replace(/,\./g, '.')
      .replace(/\.{2,}/g, '.')
      .trim();
  }

  return { anexo, textoFinal: textoLimpo };
}

/**
 * Cria diretamente um objeto Anexo para um DocumentoRegistro do cofre
 */
export async function criarAnexoParaDocumento(doc: DocumentoRegistro): Promise<Anexo> {
  const nomeArquivo = path.basename(doc.arquivo).trim();
  const caminho = path.join(ARQUIVOS_DIR, nomeArquivo);
  const ext = path.extname(nomeArquivo).toLowerCase();
  const isImagem = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
  const tipoAnexo: 'imagem' | 'pdf' | 'arquivo' = isImagem ? 'imagem' : (ext === '.pdf' ? 'pdf' : 'arquivo');

  let tamanho = doc.tamanho || (isImagem ? 'Imagem' : 'PDF');
  if (fs.existsSync(caminho)) {
    try {
      const stats = fs.statSync(caminho);
      tamanho = formatarTamanho(stats.size);
    } catch {}
  }

  return {
    tipo: tipoAnexo,
    url: `/arquivos/${encodeURIComponent(nomeArquivo)}`,
    nome: nomeArquivo,
    titulo: doc.titulo.trim(),
    titular: doc.titular?.trim(),
    dataCadastro: doc.dataCadastro || new Date().toLocaleDateString('pt-BR'),
    tamanho,
    visibilidade: doc.visibilidade,
  };
}

// Gera um documento PDF com visual corporativo Delta Plan
export async function gerarPdfDeMarkdown(
  dados: DadosPdf,
  nomeArquivoPersonalizado?: string
): Promise<Anexo> {
  assegurarDiretorioArquivos();

  const titulo = dados.titulo || 'Documento Oficial Delta Plan';
  const conteudo = dados.conteudo_markdown || 'Nenhum conteúdo especificado.';
  
  const timestamp = Date.now();
  const slug = titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30);
  const nomeArquivo = nomeArquivoPersonalizado || `${slug}_${timestamp}.pdf`;
  const caminhoCompleto = path.join(ARQUIVOS_DIR, nomeArquivo);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: titulo,
        Author: 'Delta Plan Consultoria e IA',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => {
      chunks.push(chunk);
    });

    // Cache local opcional (não quebra caso o ambiente não permita escrita local)
    try {
      const fileStream = fs.createWriteStream(caminhoCompleto);
      fileStream.on('error', () => {});
      doc.pipe(fileStream);
    } catch {}

    // Cabeçalho estilizado
    doc
      .rect(0, 0, doc.page.width, 90)
      .fill('#0f172a'); // Fundo escuro azul/cinza

    doc
      .fillColor('#00a884')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('DELTA PLAN', 50, 25);

    doc
      .fillColor('#94a3b8')
      .fontSize(10)
      .font('Helvetica')
      .text('CONSULTORIA & SOLUÇÕES DE INTELIGÊNCIA ARTIFICIAL', 50, 52);

    doc
      .fillColor('#cbd5e1')
      .fontSize(9)
      .text(`Emissão: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, doc.page.width - 230, 45, { align: 'right', width: 180 });

    doc.moveDown(4);

    // Título do Documento
    doc
      .fillColor('#1e293b')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(titulo, 50, 115);

    doc
      .moveTo(50, 140)
      .lineTo(doc.page.width - 50, 140)
      .lineWidth(1.5)
      .strokeColor('#00a884')
      .stroke();

    doc.y = 155;

    // Renderização do conteúdo linha por linha
    const linhas = conteudo.split('\n');
    for (const linha of linhas) {
      const linhaTrim = linha.trim();

      if (!linhaTrim) {
        doc.moveDown(0.5);
        continue;
      }

      if (linhaTrim.startsWith('# ')) {
        doc
          .fillColor('#0f172a')
          .fontSize(15)
          .font('Helvetica-Bold')
          .text(linhaTrim.replace(/^#\s+/, ''), { paragraphGap: 6 });
      } else if (linhaTrim.startsWith('## ')) {
        doc
          .fillColor('#1e293b')
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(linhaTrim.replace(/^##\s+/, ''), { paragraphGap: 5 });
      } else if (linhaTrim.startsWith('### ')) {
        doc
          .fillColor('#334155')
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(linhaTrim.replace(/^###\s+/, ''), { paragraphGap: 4 });
      } else if (linhaTrim.startsWith('- ') || linhaTrim.startsWith('* ')) {
        doc
          .fillColor('#334155')
          .fontSize(10)
          .font('Helvetica')
          .text(`•   ${linhaTrim.substring(2)}`, { indent: 15, paragraphGap: 3 });
      } else {
        // Texto corrido (suporta negrito simples **texto**)
        const textoSemMarcadores = linhaTrim.replace(/\*\*(.*?)\*\*/g, '$1');
        doc
          .fillColor('#475569')
          .fontSize(10)
          .font('Helvetica')
          .text(textoSemMarcadores, { paragraphGap: 4, lineGap: 2 });
      }
    }

    // Rodapé
    const totalPaginas = 1;
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#94a3b8')
      .text(
        `${ASSISTENTE.empresa} • Documento gerado pela assistente virtual ${ASSISTENTE.nome} • delta-plan.com.br`,
        50,
        doc.page.height - 40,
        { align: 'center', width: doc.page.width - 100 }
      );

    doc.end();

    doc.on('end', async () => {
      try {
        const bufferFinal = Buffer.concat(chunks);
        const tamanhoBytes = bufferFinal.length;

        // Upload imediato para o Supabase Storage
        try {
          await uploadArquivoStorage(nomeArquivo.trim(), bufferFinal, 'application/pdf');
        } catch (errUpload) {
          console.warn('[pdfService ⚠️] Aviso ao fazer upload do PDF para o Supabase Storage:', errUpload);
        }

        resolve({
          tipo: 'pdf',
          url: `/arquivos/${encodeURIComponent(nomeArquivo.trim())}`,
          nome: nomeArquivo.trim(),
          titulo: titulo.trim(),
          dataCadastro: new Date().toLocaleDateString('pt-BR'),
          tamanho: formatarTamanho(tamanhoBytes),
        });
      } catch (errFinal) {
        reject(errFinal);
      }
    });

    doc.on('error', (err) => {
      reject(err);
    });
  });
}

// Gera um PDF de demonstração inicial se ainda não existir
export async function gerarPdfDemonstracaoSeNecessario(): Promise<void> {
  assegurarDiretorioArquivos();
  const arquivoExemplo = path.join(ARQUIVOS_DIR, 'proposta_comercial_delta_plan.pdf');
  if (!fs.existsSync(arquivoExemplo)) {
    await gerarPdfDeMarkdown(
      {
        titulo: 'Proposta Comercial - Delta Plan',
        conteudo_markdown: `# Proposta de Soluções Inteligentes Delta Plan

**Cliente:** Rodrigo Almeida
**Validade:** 15 dias

## 1. Diagnóstico do Cenário
A Delta Plan identificou a oportunidade de automação e integração nos fluxos de atendimento corporativo, reduzindo em até 70% o tempo de resposta inicial e garantindo triagem inteligente de chamados.

## 2. Escopo Proposto
- Assistente Virtual Corporativo com IA generativa
- Painel Operacional integrado estilo WhatsApp Business
- Integração com base de conhecimento interna e envio de orçamentos em PDF
- Treinamento e suporte contínuo da equipe técnica

## 3. Prazos e Cronograma
- **Semana 1:** Mapeamento de regras de negócio e alinhamento de persona
- **Semana 2:** Implantação e testes operacionais
- **Semana 3:** Go-live e acompanhamento de métricas

Atenciosamente,
**${ASSISTENTE.nome} - Consultora ${ASSISTENTE.empresa}**`,
      },
      'proposta_comercial_delta_plan.pdf'
    );
  }
}

export class PdfProtegidoPorSenhaError extends Error {
  public readonly isPdfProtegido = true;
  constructor(message = 'Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.') {
    super(message);
    this.name = 'PdfProtegidoPorSenhaError';
  }
}

/**
 * Verifica se um arquivo PDF está protegido por senha.
 */
export async function verificarSePdfProtegidoPorSenha(buffer: Buffer): Promise<{
  protegido: boolean;
  precisaSenha: boolean;
}> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    const uint8 = new Uint8Array(buffer);
    await getDocumentProxy(uint8);
    return { protegido: false, precisaSenha: false };
  } catch (err: any) {
    const isSenha =
      err?.name === 'PasswordException' ||
      String(err?.message || '').toLowerCase().includes('password') ||
      String(err?.message || '').includes('No password given');
    if (isSenha) {
      return { protegido: true, precisaSenha: true };
    }
    return { protegido: false, precisaSenha: false };
  }
}

/**
 * Extrai texto de um PDF, suportando opcionalmente senha.
 * Se estiver protegido e a senha não for fornecida ou for inválida, lança exceção com detalhes.
 */
export async function extrairTextoPdfComSenha(
  buffer: Buffer,
  senha?: string
): Promise<{ text: string | string[]; totalPages: number }> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const uint8 = new Uint8Array(buffer);
  try {
    const proxy = await getDocumentProxy(uint8, senha ? { password: senha } : undefined);
    return await extractText(proxy, { mergePages: false });
  } catch (err: any) {
    if (
      err?.name === 'PasswordException' ||
      String(err?.message || '').toLowerCase().includes('password') ||
      String(err?.message || '').includes('No password given')
    ) {
      if (!senha) {
        throw new PdfProtegidoPorSenhaError();
      } else {
        throw new Error('Senha incorreta para este documento PDF.');
      }
    }
    throw err;
  }
}
