import { obterTodosTitulares, obterTodosDocumentos } from '../storage.js';
import {
  normalizarFoneticaNome,
  calcularDistanciaLevenshtein,
} from '../utils/nomeUtils.js';

export interface ItemCorrecaoTranscricao {
  de: string;
  para: string;
  motivo: string;
}

export interface ResultadoCorrecaoTranscricao {
  textoOriginal: string;
  textoCorrigido: string;
  correcoes: ItemCorrecaoTranscricao[];
}

/**
 * Termos canônicos de campos do domínio para matching fonético
 */
const CAMPOS_CANONICOS_DOMINIO: string[] = [
  'título de eleitor',
  'PIS',
  'CPF',
  'RG',
  'CNH',
  'filiação',
  'nome da mãe',
  'nome do pai',
  'data de nascimento',
  'estado civil',
  'órgão emissor',
  'validade da CNH',
  'categoria da CNH',
  'carteira de reservista',
  'carteira de trabalho',
  'certidão de nascimento',
  'certidão de casamento',
  'endereço',
  'profissão',
];

/**
 * Regras determinísticas de erros fonéticos típicos do Whisper / transcrição de áudio em português
 */
interface RegraFoneticaDireta {
  regex: RegExp;
  substituicao: string;
  motivo: string;
}

const REGRAS_DIRETAS_WHISPER: RegraFoneticaDireta[] = [
  // "título de leitor" -> "título de eleitor" (aglutinação fonética clássica [de leitor])
  {
    regex: /\bt[ií]tulo\s+(?:de\s+|do\s+|da\s+)?leitor(?:a|al|es)?\b/gi,
    substituicao: 'título de eleitor',
    motivo: 'Aglutinação fonética de fala: "título de leitor" -> "título de eleitor"',
  },
  {
    regex: /\bt[ií]tulo\s+eleitoral\b/gi,
    substituicao: 'título de eleitor',
    motivo: 'Termo sinônimo formal: "título eleitoral" -> "título de eleitor"',
  },
  // PIS fonético ("piz", "piss")
  {
    regex: /\bpiz\b/gi,
    substituicao: 'PIS',
    motivo: 'Erro fonético de sibilante: "piz" -> "PIS"',
  },
  {
    regex: /\bpiss\b/gi,
    substituicao: 'PIS',
    motivo: 'Erro fonético: "piss" -> "PIS"',
  },
  {
    regex: /\bpasep\b/gi,
    substituicao: 'PASEP',
    motivo: 'Normalização de sigla: "PASEP"',
  },
  // Siglas soletradas ou variantes comuns do português
  {
    regex: /\bc\s*\.?\s*p\s*\.?\s*f\b/gi,
    substituicao: 'CPF',
    motivo: 'Normalização de sigla soletrada: "CPF"',
  },
  {
    regex: /\br\s*\.?\s*g\b/gi,
    substituicao: 'RG',
    motivo: 'Normalização de sigla soletrada: "RG"',
  },
  {
    regex: /\bc\s*\.?\s*n\s*\.?\s*h\b/gi,
    substituicao: 'CNH',
    motivo: 'Normalização de sigla soletrada: "CNH"',
  },
  {
    regex: /\ba\s*\.?\s*r\s*\.?\s*t\b/gi,
    substituicao: 'ART',
    motivo: 'Normalização de sigla soletrada: "ART"',
  },
  {
    regex: /\br\s*\.?\s*r\s*\.?\s*t\b/gi,
    substituicao: 'RRT',
    motivo: 'Normalização de sigla soletrada: "RRT"',
  },
  {
    regex: /\bcr[eé]ia\b/gi,
    substituicao: 'CREA',
    motivo: 'Normalização fonética: "créia" -> "CREA"',
  },
  {
    regex: /\bc\s*\.?\s*r\s*\.?\s*e\s*\.?\s*a\b/gi,
    substituicao: 'CREA',
    motivo: 'Normalização de sigla soletrada: "CREA"',
  },
  {
    regex: /\bc\s*\.?\s*r\s*\.?\s*t\b/gi,
    substituicao: 'CRT',
    motivo: 'Normalização de sigla soletrada: "CRT"',
  },
  {
    regex: /\bc\s*\.?\s*t\s*\.?\s*p\s*\.?\s*s\b/gi,
    substituicao: 'CTPS',
    motivo: 'Normalização de sigla soletrada: "CTPS"',
  },
  {
    regex: /\bd\s*\.?\s*i\s*\.?\s*r\s*\.?\s*p\s*\.?\s*f\b/gi,
    substituicao: 'DIRPF',
    motivo: 'Normalização de sigla soletrada: "DIRPF"',
  },
];

/**
 * Corrige erros fonéticos em um texto transcrito, comparando-o com os termos do domínio
 * (titulares, tipos de documentos e campos consultáveis).
 *
 * Utiliza a mesma tolerância fonética já estabelecida no sistema (normalizarFoneticaNome
 * e calcularDistanciaLevenshtein), estendida para expressões completas de várias palavras.
 */
export async function corrigirTranscricaoFonetica(
  textoOriginal: string
): Promise<ResultadoCorrecaoTranscricao> {
  if (!textoOriginal || typeof textoOriginal !== 'string') {
    return {
      textoOriginal: '',
      textoCorrigido: '',
      correcoes: [],
    };
  }

  let textoCorrigido = textoOriginal.trim();
  const correcoes: ItemCorrecaoTranscricao[] = [];

  // 1. PRIMEIRA CAMADA: Regras determinísticas de erros fonéticos típicos do Whisper
  for (const regra of REGRAS_DIRETAS_WHISPER) {
    if (regra.regex.test(textoCorrigido)) {
      regra.regex.lastIndex = 0;
      const ocorrencias = textoCorrigido.match(regra.regex);
      if (ocorrencias) {
        for (const oc of ocorrencias) {
          if (oc.toLowerCase().trim() !== regra.substituicao.toLowerCase().trim()) {
            correcoes.push({
              de: oc,
              para: regra.substituicao,
              motivo: regra.motivo,
            });
          }
        }
      }
      textoCorrigido = textoCorrigido.replace(regra.regex, regra.substituicao);
    }
  }

  // 2. SEGUNDA CAMADA: Tolerância fonética em expressões de termos do domínio
  try {
    const [titulares, docs] = await Promise.all([
      obterTodosTitulares().catch(() => []),
      obterTodosDocumentos().catch(() => []),
    ]);

    // Monta catálogo dinâmico de expressões do domínio
    const expressoesDominio: string[] = [...CAMPOS_CANONICOS_DOMINIO];

    // Adiciona tipos de documentos do Cofre
    for (const d of docs) {
      if (d.tipo && d.tipo !== 'Outros' && !expressoesDominio.includes(d.tipo)) {
        expressoesDominio.push(d.tipo);
      }
    }

    // Processa expressões compostas (>= 2 palavras)
    for (const expressao of expressoesDominio) {
      const palavrasExpressao = expressao.trim().split(/\s+/);
      if (palavrasExpressao.length < 2) continue;

      const numPalavras = palavrasExpressao.length;
      const fonExpressao = normalizarFoneticaNome(expressao);

      // Divide o texto atual em palavras preservando a pontuação
      const palavrasTexto = textoCorrigido.split(/\s+/);

      // Varre janelas com o mesmo número de palavras da expressão canônica
      const tam = numPalavras;
      if (tam > palavrasTexto.length) continue;

      for (let i = 0; i <= palavrasTexto.length - tam; i++) {
        const fatiaOriginal = palavrasTexto.slice(i, i + tam).join(' ');
        // Limpa pontuação final da fatia para comparação
        const fatiaLimpa = fatiaOriginal.replace(/[.,!?;:]+$/, '').trim();
        if (!fatiaLimpa) continue;

        // Se já for igual (case insensitive), não precisa alterar
        if (fatiaLimpa.toLowerCase() === expressao.toLowerCase()) continue;

        // Se a fatia começar com artigo ("o", "a", "os", "as") e a expressão não começar, pula
        const primeiraPalavraFatia = fatiaLimpa.split(/\s+/)[0]?.toLowerCase();
        const primeiraPalavraExp = expressao.split(/\s+/)[0]?.toLowerCase();
        const artigos = ['o', 'a', 'os', 'as', 'um', 'uma'];
        if (artigos.includes(primeiraPalavraFatia) && !artigos.includes(primeiraPalavraExp)) {
          continue;
        }

        const fonFatia = normalizarFoneticaNome(fatiaLimpa);

        // Verifica equivalência fonética exata ou Levenshtein muito próximo
        const ehIgualFonetico = fonFatia === fonExpressao;
        const distLev = calcularDistanciaLevenshtein(fonFatia, fonExpressao);
        // Tolerância estrita: para expressões com mais de 8 caracteres fonéticos, admite distância <= 1
        const ehFoneticaProxima = fonExpressao.length >= 8 && distLev <= 1;

        if (ehIgualFonetico || ehFoneticaProxima) {
            // Preserva pontuação que estava no final da fatia original (se houver)
            const matchPontuacao = fatiaOriginal.match(/[.,!?;:]+$/);
            const sufixoPontuacao = matchPontuacao ? matchPontuacao[0] : '';
            const termoSubstituto = expressao + sufixoPontuacao;

            // Substitui na string
            const regexFatia = new RegExp(
              `\\b${fatiaLimpa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.,!?;:]*`,
              'i'
            );

            if (regexFatia.test(textoCorrigido)) {
              correcoes.push({
                de: fatiaOriginal,
                para: termoSubstituto,
                motivo: `Equivalência fonética com termo do domínio: "${expressao}" (distância: ${distLev})`,
              });
              textoCorrigido = textoCorrigido.replace(regexFatia, termoSubstituto);
            }
          }
        }
      }
  } catch (err: any) {
    console.warn('[Correção Transcrição ⚠️] Falha não crítica na varredura fonética de expressões:', err?.message || err);
  }

  // Normaliza espaços extras
  textoCorrigido = textoCorrigido.replace(/\s+/g, ' ').trim();

  return {
    textoOriginal,
    textoCorrigido,
    correcoes,
  };
}
