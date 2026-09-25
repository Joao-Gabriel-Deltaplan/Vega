// Utilitário para extração de primeiro nome e higienização de vocativos

const PREFIXOS_TRATAMENTO = [
  /^dr\b\.?/i,
  /^dra\b\.?/i,
  /^sr\b\.?/i,
  /^sra\b\.?/i,
  /^eng\b\.?/i,
  /^engª\b\.?/i,
  /^eng\.ª\b\.?/i,
  /^enga\b\.?/i,
  /^arq\b\.?/i,
  /^arqa\b\.?/i,
  /^prof\b\.?/i,
  /^profa\b\.?/i,
  /^adv\b\.?/i,
  /^adva\b\.?/i,
];

/**
 * Extrai a primeira palavra real do nome, ignorando pronomes de tratamento e títulos.
 * Ex: "Dr. Ricardo Alves" -> "Ricardo"
 *     "Sra. Maria Souza" -> "Maria"
 *     "Ana" -> "Ana"
 *     "" ou "Dr." -> ""
 */
export function extrairPrimeiroNome(nomeCompleto?: string): string {
  if (!nomeCompleto) return '';
  const partes = nomeCompleto.trim().split(/\s+/);

  while (partes.length > 0) {
    const primeira = partes[0].trim();
    const ehPrefixo = PREFIXOS_TRATAMENTO.some((rx) => rx.test(primeira));
    if (ehPrefixo) {
      partes.shift();
    } else {
      break;
    }
  }

  if (partes.length === 0) return '';
  const palavraLimpa = partes[0].replace(/[.,;:!?]/g, '').trim();
  return palavraLimpa;
}

import { obterArtigoDefinido, obterPreposicaoTitular } from '../busca/equivalenciaService.js';

/**
 * Monta a frase de acompanhamento garantindo separação rigorosa entre o usuário solicitante
 * e o titular do documento, sem nunca chamar o usuário pelo nome do titular.
 * Ex: titular Thomaz, usuário João -> "Aqui está o Cartão Vacinas do Thomaz, João."
 *     titular e usuário João       -> "Aqui está seu Cartão Vacinas, João."
 */
export function formatarFraseAcompanhamento(
  titulo: string,
  nomeUsuario?: string,
  nomeTitularDoc?: string
): string {
  const usuarioLimpo = extrairPrimeiroNome(nomeUsuario);
  const titularLimpo = extrairPrimeiroNome(nomeTitularDoc);

  let frase: string;

  if (titularLimpo && (!usuarioLimpo || titularLimpo.toLowerCase() !== usuarioLimpo.toLowerCase())) {
    const prep = obterPreposicaoTitular(titularLimpo);
    const artigo = obterArtigoDefinido(titulo);
    frase = usuarioLimpo
      ? `Aqui está ${artigo} ${titulo} ${prep} ${titularLimpo}, ${usuarioLimpo}.`
      : `Aqui está ${artigo} ${titulo} ${prep} ${titularLimpo}.`;
  } else if (usuarioLimpo) {
    const artigo = obterArtigoDefinido(titulo);
    const pronome = artigo === 'a' ? 'sua' : 'seu';
    frase = `Aqui está ${pronome} ${titulo}, ${usuarioLimpo}.`;
  } else {
    frase = `Aqui está o documento solicitado: ${titulo}.`;
  }

  // Normalização estrita de pontuação final
  frase = frase
    .replace(/\s+/g, ' ')
    .replace(/,\s*\./g, '.')
    .replace(/,\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();

  return frase;
}

/**
 * Normaliza uma string de nome aplicando regras fonéticas do português:
 * - Remove acentos e caracteres especiais
 * - Unifica th -> t, ph -> f, y -> i, w -> v
 * - Unifica z e s (ambos viram s)
 * - Remove consoantes dobradas (tt -> t, ll -> l, ss -> s, etc.)
 * - Remove h mudo inicial ou pós-consoante
 */
export function normalizarFoneticaNome(nome?: string): string {
  if (!nome) return '';

  let s = nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')   // apenas letras, números e espaços
    .replace(/\s+/g, ' ')
    .trim();

  // Substituições fonéticas
  s = s
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/ç/g, 's')
    .replace(/ce\b/g, 'se')
    .replace(/ci\b/g, 'si')
    .replace(/z/g, 's')              // Thomaz -> tomas, Thomas -> tomas, Luiz -> luis
    .replace(/h/g, '')              // h mudo
    .replace(/([b-df-hj-np-tv-z])\1+/g, '$1'); // consoantes dobradas -> simples

  return s.trim();
}

/**
 * Calcula a distância de Levenshtein entre duas strings
 */
export function calcularDistanciaLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substituição
          matrix[i][j - 1] + 1,     // inserção
          matrix[i - 1][j] + 1      // deleção
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Verifica se dois nomes ou termos correspondem com tolerância a variações de grafia
 * (S/Z, TH/T, Y/I, acentos, pontuação, pequenas digitações).
 */
export function nomesSaoEquivalentesComTolerancia(nomeA: string, nomeB: string): boolean {
  if (!nomeA || !nomeB) return false;

  const aLimpo = nomeA.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const bLimpo = nomeB.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Igualdade exata
  if (aLimpo === bLimpo) return true;

  // 2. Igualdade fonética
  const fonA = normalizarFoneticaNome(aLimpo);
  const fonB = normalizarFoneticaNome(bLimpo);
  if (fonA === fonB) return true;

  // 3. Comparação de primeiro nome fonético
  const pA = fonA.split(/\s+/)[0];
  const pB = fonB.split(/\s+/)[0];
  if (pA && pB && pA.length >= 3 && pA === pB) return true;

  // 4. Se um contém o outro (ex: "Thomaz" em "Thomaz Lustri Fabre")
  if (fonA.length >= 3 && fonB.length >= 3) {
    if (fonA.includes(fonB) || fonB.includes(fonA)) return true;
  }

  // 5. Tolerância Levenshtein de 1 caractere para palavras de tamanho >= 4
  if (pA && pB && Math.min(pA.length, pB.length) >= 4) {
    const dist = calcularDistanciaLevenshtein(pA, pB);
    if (dist <= 1) return true;
  }

  return false;
}
