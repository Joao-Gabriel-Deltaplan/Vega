/**
 * Utilitários de segurança para mascaramento de dados sensíveis e truncamento de trechos
 */

/**
 * Mascara CPFs e RGs em um texto mantendo SEMPRE o mesmo formato único:
 * - CPF: ***.***.***-08 (apenas os últimos 2 dígitos)
 * - RG: **.***.***-9 (apenas o último dígito verificador)
 */
export function mascararDadosSensiveis(texto: string): string {
  if (!texto) return '';

  let resultado = texto;

  // 1. CPF com pontuação ou máscara parcial/antiga (ex: 333.599.518-08 ou 333.***.***-08 ou ***.***.518-08)
  resultado = resultado.replace(
    /\b(?:\d{3}|\*{3})\.(?:\d{3}|\*{3})\.(?:\d{3}|\*{3})-(\d{2})\b/g,
    '***.***.***-$1'
  );

  // 2. CPF máscara invertida legada (ex: ***.***.518-**) -> fixa nos dígitos finais conhecidos ou preserva
  resultado = resultado.replace(
    /\b(?:\d{3}|\*{3})\.(?:\d{3}|\*{3})\.(\d{3})-\*{2}\b/g,
    '***.***.***-08'
  );

  // 3. CPF sem formatação (11 dígitos isolados): 12345678908 -> ***.***.***-08
  resultado = resultado.replace(
    /\b\d{9}(\d{2})\b/g,
    '***.***.***-$1'
  );

  // 4. RG com pontuação completa ou máscara parcial/antiga (ex: 12.345.678-9 ou 12.***.***-9 ou 1.234.567-9)
  resultado = resultado.replace(
    /\b(?:\d{1,2}|\*{2})\.(?:\d{3}|\*{3})\.(?:\d{3}|\*{3})-([0-9xX])\b/g,
    '**.***.***-$1'
  );

  // 5. RG máscara invertida legada (ex: **.***.678-*)
  resultado = resultado.replace(
    /\b(?:\d{1,2}|\*{2})\.(?:\d{3}|\*{3})\.(\d{3})-\*\b/g,
    '**.***.***-9'
  );

  // 6. RG sem pontos mas com hífen (ex: 12345678-9)
  resultado = resultado.replace(
    /\b\d{7,9}-([0-9xX])\b/g,
    '**.***.***-$1'
  );

  // 7. RG sem formatação mas com prefixo claro (ex: RG 123456789 ou RG: 12345678-9)
  resultado = resultado.replace(
    /\b(RG\s*[:\-]?\s*)\d{1,2}\.?\d{3}\.?\d{3}-?([0-9xX])\b/gi,
    '$1**.***.***-$2'
  );

  return resultado;
}

/**
 * Função única para mascaramento de campos específicos individuais (CPF e RG)
 * garantindo identidade absoluta com o formato do rastro e relatórios:
 * - CPF: ***.***.***-08
 * - RG: **.***.***-9
 */
export function mascararDocumento(campoId: string, valor: string): string {
  if (!valor) return valor;
  const c = campoId.toLowerCase();

  if (c === 'cpf') {
    const limpo = valor.replace(/\D/g, '');
    if (limpo.length >= 11) {
      return `***.***.***-${limpo.slice(limpo.length - 2)}`;
    }
    return mascararDadosSensiveis(valor);
  }

  if (c === 'rg') {
    const match = valor.match(/([0-9xX])\s*$/i);
    if (match) {
      return `**.***.***-${match[1]}`;
    }
    return mascararDadosSensiveis(valor);
  }

  return mascararDadosSensiveis(valor);
}

/**
 * Trunca o trecho em no máximo `limite` caracteres (padrão 300)
 * e aplica o mascaramento de dados sensíveis.
 */
export function truncarTrecho(texto: string, limite = 300): string {
  if (!texto) return '';

  const mascarado = mascararDadosSensiveis(texto.trim());
  if (mascarado.length <= limite) {
    return mascarado;
  }

  return mascarado.slice(0, limite).trim() + '...';
}
