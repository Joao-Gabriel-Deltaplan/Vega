/**
 * Utilitários para processamento de texto, similaridade e detecção de blocos estruturados.
 */

export function calcularSimilaridade(str1: string, str2: string): number {
  if (!str1 || !str2) return 0.0;

  // Normalização básica: minúsculas, remove pontuação e múltiplos espaços
  const s1 = str1
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const s2 = str2
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Se uma contém a outra com comprimento muito similar
  const maxLen = Math.max(s1.length, s2.length);
  const minLen = Math.min(s1.length, s2.length);
  if ((s1.includes(s2) || s2.includes(s1)) && minLen / maxLen >= 0.85) {
    return minLen / maxLen;
  }

  // Distância de Levenshtein
  const matriz: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matriz[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const custo = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + custo
      );
    }
  }

  const distancia = matriz[s1.length][s2.length];
  return Math.max(0, 1.0 - distancia / maxLen);
}

/**
 * Detecta e extrai o termo de um bloco ```nao_encontrado
 */
export function detectarBlocoNaoEncontrado(texto: string): { termo?: string } | null {
  const regex = /```nao_encontrado\s*([\s\S]*?)\s*```/i;
  const match = texto.match(regex);
  if (!match) return null;

  const conteudo = match[1].trim();
  try {
    const parsed = JSON.parse(conteudo);
    return parsed;
  } catch {
    // Tenta regex caso o JSON esteja ligeiramente mal formatado
    const termoMatch = conteudo.match(/"?termo"?\s*:\s*"([^"]+)"/i);
    if (termoMatch) {
      return { termo: termoMatch[1] };
    }
    return { termo: conteudo.replace(/[{}"']/g, '').trim() };
  }
}

/**
 * Remove blocos ```nao_encontrado do texto para não exibir raw JSON ao usuário
 */
export function removerBlocoNaoEncontrado(texto: string): string {
  return texto
    .replace(/```nao_encontrado[\s\S]*?```/gi, '')
    .trim();
}
