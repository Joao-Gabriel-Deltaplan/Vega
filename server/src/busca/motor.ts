import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Contato, DocumentoRegistro, NivelAcesso } from '../types.js';
import { obterDocumentosPorNivelAcesso } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type StatusBusca =
  | 'unico'
  | 'ambiguo'
  | 'nenhum'
  | 'oferta_equivalente'
  | 'oferta_outro_titular'
  | 'ambiguo_titular';

export interface ResultadoPontuado {
  documento: DocumentoRegistro;
  score: number;
  motivoScore?: string;
}

export interface RespostaMotorBusca {
  status: StatusBusca;
  resultados: DocumentoRegistro[];
  score: number;
  tipoPedido?: string;
  documentoEquivalente?: DocumentoRegistro;
  titularEncontrado?: string;
  titularesPossiveis?: string[];
}

/**
 * Carrega o mapa de equivalências de documentos (data/equivalencias.json)
 */
export function carregarEquivalencias(): Record<string, string[]> {
  const caminho = path.resolve(__dirname, '../../../config/equivalencias.json');
  const caminhoFallback = path.resolve(__dirname, '../../../data/equivalencias.json');
  const caminhoEfetivo = fs.existsSync(caminho) ? caminho : caminhoFallback;
  if (fs.existsSync(caminhoEfetivo)) {
    try {
      return JSON.parse(fs.readFileSync(caminhoEfetivo, 'utf-8'));
    } catch (e) {
      console.error('Erro ao ler equivalencias.json:', e);
    }
  }
  return {
    CNH: ['CPF', 'RG', 'nome', 'data de nascimento', 'filiação'],
    CTPS: ['CPF', 'RG'],
    RG: ['CPF', 'filiação'],
    PASSAPORTE: ['CPF', 'nome', 'data de nascimento'],
    CONTRATO_SOCIAL: ['CNPJ', 'razão social', 'sócios'],
    CARTAO_CNPJ: ['CNPJ', 'razão social', 'endereço'],
  };
}

/**
 * Normaliza o texto: minúsculas, remoção de acentos, pontuação e stopwords de pedido.
 */
export function normalizarTexto(texto: string): string {
  if (!texto) return '';

  let s = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»\\\[\]|]/g, ' ');

  const stopwords = [
    'por favor',
    'por gentileza',
    'me manda',
    'manda pra mim',
    'envia pra mim',
    'preciso do',
    'preciso da',
    'preciso de',
    'quero consultar',
    'quero ver',
    'quero',
    'preciso',
    'envia',
    'manda',
    'enviar',
    'mandar',
    'consultar',
    'uma',
    'um',
    'da',
    'de',
    'do',
    'dos',
    'das',
    'o',
    'a',
    'os',
    'as',
  ];

  for (const sw of stopwords) {
    const regex = new RegExp(`\\b${sw}\\b`, 'gi');
    s = s.replace(regex, ' ');
  }

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Identifica se a mensagem contém confirmação afirmativa do usuário
 */
export function verificarConfirmacao(texto: string): boolean {
  if (!texto) return false;
  const limpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»\\\[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /\b(sim|pode mandar|pode enviar|serve|manda|mande|quero|envia|enviar|ok|beleza|por favor|com certeza|isso|manda esse|pode ser|manda pra mim)\b/i.test(
    limpo
  );
}

/**
 * Identifica se a mensagem é estritamente uma confirmação simples afirmativa
 * (não sendo uma nova pergunta com interrogação ou palavras interrogativas)
 */
export function isConfirmacaoSimples(texto: string): boolean {
  if (!texto) return false;
  const t = texto.toLowerCase().trim();
  const regexPergunta = /\?|\b(qual|quem|quando|onde|quanto|como|porque|por que|o que)\b/i;
  if (regexPergunta.test(t)) return false;
  return verificarConfirmacao(t);
}

/**
 * Identifica o tipo de documento solicitado no texto do usuário
 */
export function identificarTipoPedido(textoOriginal: string): string | null {
  const norm = normalizarTexto(textoOriginal);

  if (/\bcpf\b/i.test(norm)) return 'CPF';
  if (/\b(cnh|habilitacao)\b/i.test(norm)) return 'CNH';
  if (/\b(rg|identidade)\b/i.test(norm)) return 'RG';
  if (/\b(cnpj|cartao cnpj)\b/i.test(norm)) return 'CARTAO_CNPJ';
  if (/\b(contrato social|societario|estatuto social)\b/i.test(norm)) return 'CONTRATO_SOCIAL';
  if (/\b(dre|demonstracao do resultado|balanco)\b/i.test(norm)) return 'DRE';
  if (/\b(proposta|minuta)\b/i.test(norm)) return 'Proposta';
  if (/\b(regimento|conduta|politica)\b/i.test(norm)) return 'Normativo';

  return null;
}

/**
 * Identifica se a mensagem tem marcador de posse pessoal ("meu", "minha", "pra mim")
 */
export function temMarcadorPessoal(texto: string): boolean {
  return /\b(meu|minha|meus|minhas|pra mim|para mim)\b/i.test(texto);
}

/**
 * Extrai titular explícito do pedido ("do Thomaz", "da Delta", etc.)
 */
export function extrairTitularExplicito(texto: string): string | null {
  const match = texto.match(/\b(?:do|da|de)\s+([a-zA-ZÀ-ÿ]+)/i);
  if (match) {
    const titular = match[1].trim();
    const ignorar = ['documento', 'arquivo', 'empresa', 'sistema', 'cofre'];
    if (!ignorar.includes(titular.toLowerCase())) {
      return titular.charAt(0).toUpperCase() + titular.slice(1);
    }
  }

  const nomesConhecidos = ['Thomaz', 'André', 'Andre', 'Ricardo', 'Delta Plan', 'Delta'];
  for (const nome of nomesConhecidos) {
    const regex = new RegExp(`\\b${nome}\\b`, 'i');
    if (regex.test(texto)) {
      return nome === 'Delta' ? 'Delta Plan' : nome;
    }
  }

  return null;
}

/**
 * Verifica se dois nomes de titular correspondem
 */
export function titularCorresponde(docTitular?: string, alvo?: string): boolean {
  if (!docTitular || !alvo) return false;
  const n1 = normalizarTexto(docTitular);
  const n2 = normalizarTexto(alvo);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

/**
 * Distância de Levenshtein entre duas strings
 */
export function calcularDistanciaLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + custo
      );
    }
  }

  return dp[m][n];
}

/**
 * Calcula similaridade Levenshtein (0 a 1)
 */
export function calcularSimilaridadeLevenshtein(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const dist = calcularDistanciaLevenshtein(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/**
 * Verifica similaridade por janela deslizante ou palavras para strings de comprimentos diferentes
 */
function verificarSimilaridadeFlexivel(textoBusca: string, alvo: string): number {
  if (!textoBusca || !alvo) return 0;
  const simDireta = calcularSimilaridadeLevenshtein(textoBusca, alvo);
  if (simDireta >= 0.85) return simDireta;

  const palavrasBusca = textoBusca.split(/\s+/).filter(Boolean);
  const palavrasAlvo = alvo.split(/\s+/).filter(Boolean);

  let maiorSim = simDireta;

  if (palavrasBusca.length <= palavrasAlvo.length && palavrasBusca.length > 0) {
    const k = palavrasBusca.length;
    for (let i = 0; i <= palavrasAlvo.length - k; i++) {
      const janela = palavrasAlvo.slice(i, i + k).join(' ');
      const simJanela = calcularSimilaridadeLevenshtein(textoBusca, janela);
      if (simJanela > maiorSim) {
        maiorSim = simJanela;
      }
      if (maiorSim >= 0.85) return maiorSim;
    }
  }

  if (palavrasBusca.length > palavrasAlvo.length && palavrasAlvo.length > 0) {
    const k = palavrasAlvo.length;
    for (let i = 0; i <= palavrasAlvo.length - k; i++) {
      const janela = palavrasBusca.slice(i, i + k).join(' ');
      const simJanela = calcularSimilaridadeLevenshtein(janela, alvo);
      if (simJanela > maiorSim) {
        maiorSim = simJanela;
      }
      if (maiorSim >= 0.85) return maiorSim;
    }
  }

  return maiorSim;
}

const SIGLAS_DOCUMENTO = ['cnh', 'cpf', 'rg', 'cnpj', 'dre', 'art'];

/**
 * Função principal do Motor de Busca Determinístico com regras de tipo,
 * escopo de titular e sugestão de equivalentes.
 */
export async function buscarDocumentos(
  texto: string,
  contato?: Contato
): Promise<RespostaMotorBusca> {
  const nivelAcesso: NivelAcesso = contato?.nivelAcesso || contato?.ficha?.nivelAcesso || 'geral';

  // 1. Filtrar o catálogo pelo nivelAcesso do contato ANTES de qualquer comparação
  const catalogo = await obterDocumentosPorNivelAcesso(nivelAcesso);
  if (!catalogo || catalogo.length === 0) {
    return { status: 'nenhum', resultados: [], score: 0 };
  }

  const textoNorm = normalizarTexto(texto);
  if (!textoNorm) {
    return { status: 'nenhum', resultados: [], score: 0 };
  }

  const tipoPedido = identificarTipoPedido(texto);
  const isPessoal = temMarcadorPessoal(texto);
  const titularExplicito = extrairTitularExplicito(texto);
  const primeiroNomeContato = extrairPrimeiroNome(contato?.nome) || contato?.nome || '';
  const titularVinculado =
    contato?.titularVinculado || contato?.ficha?.titularVinculado || primeiroNomeContato;

  const mapaEquivalencias = carregarEquivalencias();

  // =========================================================================
  // CENÁRIO A: Pedido PESSOAL ("meu/minha/pra mim")
  // =========================================================================
  if (isPessoal && tipoPedido) {
    // Procura documento do tipo pedido cujo titular seja o próprio contato
    const docsDoContato = catalogo.filter(
      (d) =>
        (d.tipo?.toUpperCase() === tipoPedido.toUpperCase() ||
          d.titulo.toUpperCase().includes(tipoPedido.toUpperCase())) &&
        titularCorresponde(d.titular, titularVinculado)
    );

    if (docsDoContato.length === 1) {
      return {
        status: 'unico',
        resultados: [docsDoContato[0]],
        score: 100,
        tipoPedido,
      };
    }

    if (docsDoContato.length > 1) {
      return {
        status: 'ambiguo',
        resultados: docsDoContato,
        score: 100,
        tipoPedido,
      };
    }

    // Não encontrou documento deste tipo para o próprio contato.
    // 1. Verifica se há o MESMO TIPO de outro titular que o contato PODE ver
    const docsOutroTitular = catalogo.filter(
      (d) =>
        d.tipo?.toUpperCase() === tipoPedido.toUpperCase() ||
        d.titulo.toUpperCase().includes(tipoPedido.toUpperCase())
    );

    if (docsOutroTitular.length > 0) {
      const docOutro = docsOutroTitular[0];
      return {
        status: 'oferta_outro_titular',
        resultados: [],
        documentoEquivalente: docOutro,
        score: 65,
        tipoPedido,
        titularEncontrado: docOutro.titular,
      };
    }

    // 2. Não há documento do mesmo tipo no cofre. Verifica se há EQUIVALENTE que contém o dado!
    const tiposQueContem = Object.entries(mapaEquivalencias)
      .filter(([_, dadosContidos]) =>
        dadosContidos.some((dado) => dado.toUpperCase() === tipoPedido.toUpperCase())
      )
      .map(([tipoOrigem]) => tipoOrigem.toUpperCase());

    const docsEquivalentes = catalogo.filter((d) =>
      tiposQueContem.includes((d.tipo || '').toUpperCase())
    );

    if (docsEquivalentes.length > 0) {
      const docEquiv = docsEquivalentes[0];
      return {
        status: 'oferta_equivalente',
        resultados: [],
        documentoEquivalente: docEquiv,
        score: 65,
        tipoPedido,
        titularEncontrado: docEquiv.titular,
      };
    }

    return { status: 'nenhum', resultados: [], score: 0, tipoPedido };
  }

  // =========================================================================
  // CENÁRIO B: Pedido com TITULAR EXPLÍCITO ("da Delta", "do Thomaz", etc.)
  // =========================================================================
  if (titularExplicito && tipoPedido) {
    const docsCasamTipoETitular = catalogo.filter(
      (d) =>
        (d.tipo?.toUpperCase() === tipoPedido.toUpperCase() ||
          d.titulo.toUpperCase().includes(tipoPedido.toUpperCase()) ||
          (d.apelidos && d.apelidos.some((ap) => ap.toLowerCase() === tipoPedido.toLowerCase()))) &&
        titularCorresponde(d.titular, titularExplicito)
    );

    if (docsCasamTipoETitular.length === 1) {
      return {
        status: 'unico',
        resultados: [docsCasamTipoETitular[0]],
        score: 100,
        tipoPedido,
      };
    }

    if (docsCasamTipoETitular.length > 1) {
      return {
        status: 'ambiguo',
        resultados: docsCasamTipoETitular,
        score: 100,
        tipoPedido,
      };
    }

    // Se não encontrou o tipo exato para esse titular, verifica se há EQUIVALENTE desse titular
    const tiposQueContem = Object.entries(mapaEquivalencias)
      .filter(([_, dadosContidos]) =>
        dadosContidos.some((dado) => dado.toUpperCase() === tipoPedido.toUpperCase())
      )
      .map(([tipoOrigem]) => tipoOrigem.toUpperCase());

    const docsEquivTitular = catalogo.filter(
      (d) =>
        tiposQueContem.includes((d.tipo || '').toUpperCase()) &&
        titularCorresponde(d.titular, titularExplicito)
    );

    if (docsEquivTitular.length > 0) {
      const docEquiv = docsEquivTitular[0];
      return {
        status: 'oferta_equivalente',
        resultados: [],
        documentoEquivalente: docEquiv,
        score: 65,
        tipoPedido,
        titularEncontrado: docEquiv.titular,
      };
    }
  }

  // =========================================================================
  // CENÁRIO C: Pedido por TIPO sem titular ("me manda o CPF", "o contrato social")
  // =========================================================================
  if (tipoPedido && !titularExplicito) {
    const docsDoTipo = catalogo.filter(
      (d) =>
        d.tipo?.toUpperCase() === tipoPedido.toUpperCase() ||
        d.titulo.toUpperCase().includes(tipoPedido.toUpperCase())
    );

    // Se houver mais de um titular desse documento: pergunta de quem (ambíguo de titular)
    if (docsDoTipo.length > 1) {
      const titularesDistintos = Array.from(new Set(docsDoTipo.map((d) => d.titular).filter(Boolean)));
      if (titularesDistintos.length > 1) {
        return {
          status: 'ambiguo_titular',
          resultados: docsDoTipo,
          score: 90,
          tipoPedido,
          titularesPossiveis: titularesDistintos as string[],
        };
      }
      return {
        status: 'ambiguo',
        resultados: docsDoTipo,
        score: 90,
        tipoPedido,
      };
    }

    if (docsDoTipo.length === 1) {
      return {
        status: 'unico',
        resultados: [docsDoTipo[0]],
        score: 100,
        tipoPedido,
      };
    }

    // Nenhum documento deste tipo existe no cofre.
    // Consulta o mapa de equivalências!
    const tiposQueContem = Object.entries(mapaEquivalencias)
      .filter(([_, dadosContidos]) =>
        dadosContidos.some((dado) => dado.toUpperCase() === tipoPedido.toUpperCase())
      )
      .map(([tipoOrigem]) => tipoOrigem.toUpperCase());

    const docsEquivalentes = catalogo.filter((d) =>
      tiposQueContem.includes((d.tipo || '').toUpperCase())
    );

    if (docsEquivalentes.length > 0) {
      const docEquiv = docsEquivalentes[0];
      return {
        status: 'oferta_equivalente',
        resultados: [],
        documentoEquivalente: docEquiv,
        score: 65,
        tipoPedido,
        titularEncontrado: docEquiv.titular,
      };
    }
  }

  // =========================================================================
  // CENÁRIO D: Pipeline Geral de Pontuação (Busca por título/apelido/Levenshtein)
  // =========================================================================
  const pontuados: ResultadoPontuado[] = [];

  for (const doc of catalogo) {
    let score = 0;
    const normTitulo = normalizarTexto(doc.titulo);
    const apelidos = (doc.apelidos || []).map((ap) => normalizarTexto(ap)).filter(Boolean);
    const palavrasTitulo = normTitulo.split(/\s+/).filter((w) => w.length >= 2);

    // a) Match exato do título ......... 100
    if (textoNorm === normTitulo) {
      score = Math.max(score, 100);
    }

    // b) Match exato de apelido ......... 100
    if (apelidos.some((ap) => ap === textoNorm)) {
      score = Math.max(score, 100);
    }

    // c) Match de sigla
    for (const sigla of SIGLAS_DOCUMENTO) {
      const regexSigla = new RegExp(`\\b${sigla}\\b`, 'i');
      if (regexSigla.test(textoNorm)) {
        const docTemSigla =
          regexSigla.test(normTitulo) ||
          apelidos.some((ap) => regexSigla.test(ap)) ||
          doc.id.toLowerCase().includes(sigla) ||
          doc.arquivo.toLowerCase().includes(sigla) ||
          (doc.tipo && regexSigla.test(doc.tipo));

        if (docTemSigla) {
          score = Math.max(score, 90);
        }
      }
    }

    // d) Apelido contido no texto ......... 80
    if (
      apelidos.some((ap) => {
        if (ap.length < 2) return false;
        const regexAp = new RegExp(`\\b${ap}\\b`, 'i');
        return regexAp.test(textoNorm) || textoNorm.includes(ap);
      })
    ) {
      score = Math.max(score, 80);
    }

    // e) Todas as palavras do título presentes no texto ......... 70
    if (
      palavrasTitulo.length > 0 &&
      palavrasTitulo.every((p) => {
        const regexP = new RegExp(`\\b${p}\\b`, 'i');
        return regexP.test(textoNorm) || textoNorm.includes(p);
      })
    ) {
      score = Math.max(score, 70);
    }

    // f) Similaridade por Levenshtein > 0.85 em título/apelido
    const simTitulo = verificarSimilaridadeFlexivel(textoNorm, normTitulo);
    if (simTitulo > 0.85) {
      score = Math.max(score, 75);
    } else if (simTitulo > 0.75) {
      score = Math.max(score, 60);
    }

      for (const ap of apelidos) {
        const simAp = verificarSimilaridadeFlexivel(textoNorm, ap);
        if (simAp > 0.85) {
          score = Math.max(score, 75);
        } else if (simAp > 0.75) {
          score = Math.max(score, 60);
        }
      }

      // Se o pedido informou um titular explícito e o documento tem outro titular divergente, penaliza
      if (titularExplicito && doc.titular && !titularCorresponde(doc.titular, titularExplicito)) {
        score = Math.max(0, score - 50);
      }

      pontuados.push({ documento: doc, score });
  }

  pontuados.sort((a, b) => b.score - a.score);

  const candidatos = pontuados.filter((p) => p.score >= 70);

  if (candidatos.length === 0) {
    return {
      status: 'nenhum',
      resultados: [],
      score: pontuados[0]?.score || 0,
      tipoPedido: tipoPedido || undefined,
    };
  }

  if (candidatos.length === 1) {
    return {
      status: 'unico',
      resultados: [candidatos[0].documento],
      score: candidatos[0].score,
      tipoPedido: tipoPedido || undefined,
    };
  }

  const primeiro = candidatos[0];
  const segundo = candidatos[1];

  if (primeiro.score - segundo.score > 25) {
    return {
      status: 'unico',
      resultados: [primeiro.documento],
      score: primeiro.score,
      tipoPedido: tipoPedido || undefined,
    };
  }

  return {
    status: 'ambiguo',
    resultados: candidatos.map((c) => c.documento),
    score: primeiro.score,
    tipoPedido: tipoPedido || undefined,
  };
}

/**
 * Obtém uma frase de acompanhamento a partir de data/frases.json
 */
export function obterFraseAcompanhamento(titulo: string, primeiroNome?: string): string {
  const caminhoFrases = path.resolve(__dirname, '../../../config/frases.json');
  const caminhoFallback = path.resolve(__dirname, '../../../data/frases.json');
  const caminhoEfetivo = fs.existsSync(caminhoFrases) ? caminhoFrases : caminhoFallback;
  let templates = [
    'Aqui está seu {titulo}, {primeiroNome}.',
    'Segue o {titulo}, {primeiroNome}.',
    'Encontrei aqui — {titulo} em anexo, {primeiroNome}.',
  ];

  try {
    if (fs.existsSync(caminhoEfetivo)) {
      const conteudo = fs.readFileSync(caminhoEfetivo, 'utf-8');
      const parsed = JSON.parse(conteudo);
      if (Array.isArray(parsed) && parsed.length > 0) {
        templates = parsed;
      }
    }
  } catch (err) {
    console.error('Erro ao ler frases.json:', err);
  }

  const template = templates[Math.floor(Math.random() * templates.length)];

  if (primeiroNome && primeiroNome.trim().length > 0) {
    return template
      .replace('{titulo}', titulo)
      .replace('{primeiroNome}', primeiroNome.trim());
  } else {
    return template
      .replace(', {primeiroNome}', '')
      .replace(' {primeiroNome}', '')
      .replace('{titulo}', titulo)
      .trim();
  }
}
