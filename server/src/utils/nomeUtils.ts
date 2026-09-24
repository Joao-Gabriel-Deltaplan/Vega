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
