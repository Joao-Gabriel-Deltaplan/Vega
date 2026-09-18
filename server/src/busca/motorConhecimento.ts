import { ItemConhecimento } from '../types.js';
import { obterTodosConhecimentos } from '../storage.js';
import { calcularSimilaridade } from '../utils/textoUtils.js';

export interface ResultadoBuscaConhecimento {
  status: 'unico' | 'ambiguo' | 'nenhum';
  instrucao?: ItemConhecimento;
  resultados: ItemConhecimento[];
  assunto?: string;
  assuntoIdentificado?: string;
  score: number;
}

/**
 * Remove acentos de uma string
 */
function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Stopwords e expressões comuns de consulta para limpeza
 */
const STOPWORDS_CONHECIMENTO = [
  'o que temos sobre',
  'o que voce tem de',
  'o que você tem de',
  'o que voce sabe sobre',
  'o que você sabe sobre',
  'o que voce sabe de',
  'o que você sabe de',
  'quero saber o que voce tem de',
  'quero saber o que você tem de',
  'quero saber sobre',
  'pode me explicar sobre',
  'pode me explicar',
  'qual a politica de',
  'qual a política de',
  'qual a regra de',
  'quais as regras de',
  'como funciona o',
  'como funciona a',
  'como funciona',
  'qual o prazo de',
  'qual o prazo',
  'me fala sobre',
  'me fale sobre',
  'me explica',
  'sabe sobre',
  'tem sobre',
  'sobre o',
  'sobre a',
  'sobre',
  'para',
  'pra',
  'com',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'um',
  'uma',
  'os',
  'as',
  'o',
  'a',
];

/**
 * Normaliza o texto removendo stopwords e pontuação
 */
export function normalizarTextoConsulta(texto: string): string {
  let limpo = removerAcentos((texto || '').toLowerCase().trim());

  for (const stop of STOPWORDS_CONHECIMENTO) {
    const stopLimpa = removerAcentos(stop);
    const regex = new RegExp(`\\b${stopLimpa}\\b`, 'gi');
    limpo = limpo.replace(regex, ' ');
  }

  return limpo.replace(/[.,;:!?\(\)\[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extrai sigla entre parênteses do título (ex: "Segurança de Dados (LGPD)" -> "LGPD")
 */
function extrairSiglaTitulo(titulo: string): string | null {
  const match = titulo.match(/\(([A-Z0-9]{2,10})\)/);
  if (match) return match[1];
  const palavras = titulo.split(/\s+/);
  for (const p of palavras) {
    if (/^[A-Z0-9]{2,10}$/.test(p)) return p;
  }
  return null;
}

/**
 * Extrai o nome amigável do assunto a partir do título
 */
export function extrairAssuntoAmigavel(instrucao: ItemConhecimento): string {
  const sigla = extrairSiglaTitulo(instrucao.titulo);
  if (sigla) return sigla;

  // Se tiver dois pontos (ex: "Regra de Negócio: Proposta Comercial e Orçamentos")
  if (instrucao.titulo.includes(':')) {
    return instrucao.titulo.split(':')[1].trim();
  }

  return instrucao.titulo;
}

/**
 * Executa busca determinística na Base de Conhecimento aplicando pesos estritos
 */
export async function buscarConhecimento(
  textoUsuario: string,
  baseConhecimento?: ItemConhecimento[]
): Promise<ResultadoBuscaConhecimento> {
  const itens = baseConhecimento || (await obterTodosConhecimentos());
  if (!itens || itens.length === 0) {
    return { status: 'nenhum', resultados: [], score: 0 };
  }

  const textoCru = (textoUsuario || '').toLowerCase().trim();
  const textoCruSemAcentos = removerAcentos(textoCru);
  const textoLimpo = normalizarTextoConsulta(textoUsuario);

  const pontuados: { item: ItemConhecimento; score: number }[] = [];

  for (const item of itens) {
    const tituloNorm = removerAcentos(item.titulo.toLowerCase());
    const categoriaNorm = removerAcentos(item.categoria.toLowerCase());
    const conteudoNorm = removerAcentos(item.conteudo.toLowerCase());

    const sigla = extrairSiglaTitulo(item.titulo);
    const siglaNorm = sigla ? removerAcentos(sigla.toLowerCase()) : null;

    let score = 0;

    // 1. Match de sigla no título (ex: "LGPD", "DRE", "ART") -> 95
    if (siglaNorm) {
      const regexSigla = new RegExp(`\\b${siglaNorm}\\b`, 'i');
      if (regexSigla.test(textoCruSemAcentos)) {
        score = Math.max(score, 95);
      }
    }

    // 2. Match exato do título -> 100
    if (textoLimpo.length > 3 && (tituloNorm === textoLimpo || tituloNorm === textoCruSemAcentos)) {
      score = Math.max(score, 100);
    }

    // 3. Palavras do título presentes no texto -> 70
    const palavrasTitulo = tituloNorm
      .split(/\s+/)
      .filter((p) => p.length > 2 && !['para', 'com', 'dos', 'das', 'uma', 'sobre'].includes(p));

    if (palavrasTitulo.length > 0) {
      const palavrasPresentes = palavrasTitulo.filter((p) => textoCruSemAcentos.includes(p));
      const proporcaoTitulo = palavrasPresentes.length / palavrasTitulo.length;
      if (proporcaoTitulo >= 0.75) {
        score = Math.max(score, 70);
      }
    }

    // 4. Termos no Conteúdo da Instrução -> 60 (ou 75 se match forte de múltiplas palavras-chave)
    // Exemplo: "qual o prazo de implantação dos projetos de IA"
    if (textoLimpo.length >= 3) {
      if (conteudoNorm.includes(textoLimpo)) {
        score = Math.max(score, 75);
      } else {
        const palavrasBusca = textoLimpo.split(/\s+/).filter((p) => p.length >= 3);
        if (palavrasBusca.length > 0) {
          const presentesNoConteudo = palavrasBusca.filter((p) => conteudoNorm.includes(p));
          const proporcaoConteudo = presentesNoConteudo.length / palavrasBusca.length;

          if (proporcaoConteudo >= 0.75 && presentesNoConteudo.length >= 2) {
            score = Math.max(score, 75); // Match conceitual forte no conteúdo
          } else if (proporcaoConteudo >= 0.5) {
            score = Math.max(score, 60);
          }
        }
      }
    }

    // 5. Similaridade de Levenshtein no título (> 0.85) -> 60
    if (textoLimpo.length >= 4) {
      const sim = calcularSimilaridade(tituloNorm, textoLimpo);
      if (sim >= 0.85) {
        score = Math.max(score, 60);
      }
    }

    if (score > 0) {
      pontuados.push({ item, score });
    }
  }

  // Ordena por maior pontuação
  pontuados.sort((a, b) => b.score - a.score);

  if (pontuados.length === 0) {
    return { status: 'nenhum', resultados: [], score: 0 };
  }

  const melhor = pontuados[0];

  // Caso 1: Score >= 70 e vantagem clara (ou único >= 70)
  if (melhor.score >= 70) {
    const empatados = pontuados.filter((p) => p.score >= 70 && p.score >= melhor.score - 5);
    if (empatados.length === 1) {
      return {
        status: 'unico',
        instrucao: melhor.item,
        resultados: [melhor.item],
        assunto: extrairAssuntoAmigavel(melhor.item),
        score: melhor.score,
      };
    } else {
      return {
        status: 'ambiguo',
        resultados: empatados.map((p) => p.item),
        score: melhor.score,
      };
    }
  }

  // Se o melhor score for menor que 70, classifica como nenhum para permitir escalonamento à IA
  return {
    status: 'nenhum',
    resultados: pontuados.map((p) => p.item),
    score: melhor.score,
  };
}
