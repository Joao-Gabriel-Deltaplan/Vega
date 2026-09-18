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

/**
 * Monta a frase de acompanhamento garantindo pontuação rigorosa (nunca gera ".." ou ",.").
 */
export function formatarFraseAcompanhamento(titulo: string, nomeOuPrimeiroNome?: string): string {
  const nomeReal = extrairPrimeiroNome(nomeOuPrimeiroNome);
  let frase = nomeReal ? `Aqui está seu ${titulo}, ${nomeReal}.` : `Aqui está seu ${titulo}.`;

  // Normalização estrita de pontuação final
  frase = frase
    .replace(/\s+/g, ' ')
    .replace(/,\s*\./g, '.')
    .replace(/,\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();

  return frase;
}
