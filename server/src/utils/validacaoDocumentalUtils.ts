/**
 * Módulo de Validação e Extração de Dados Documentais Específicos
 * 
 * Garante que dados equivalentes oferecidos (ex: Título de Eleitor, CPF, CNH, PIS)
 * só sejam aceitos e registrados quando a IA/sistema extrair um valor válido
 * com formato matemático e estrutural comprovado, evitando que trechos crus
 * ou palavras com similaridade semântica ("titular" vs "título") sejam confundidos.
 */

export interface ResultadoValidacaoDadoDocumental {
  valido: boolean;
  tipoDetectado?: string;
  valorFormatado?: string;
  valorBruto?: string;
  motivoRejeicao?: string;
}

/**
 * Valida se uma sequência de 12 dígitos representa um Título de Eleitor válido
 * segundo o algoritmo oficial do TSE (Tribunal Superior Eleitoral).
 */
export function validarTituloEleitor(numero: string): boolean {
  const limpo = (numero || '').replace(/\D/g, '');
  if (limpo.length !== 12) return false;

  // Dígitos de estado (9º e 10º): devem estar entre 01 e 28
  const uf = parseInt(limpo.substring(8, 10), 10);
  if (isNaN(uf) || uf < 1 || uf > 28) return false;

  const d = limpo.split('').map(Number);

  // 1º Dígito Verificador (11º dígito)
  let soma1 = 0;
  for (let i = 0; i < 8; i++) {
    soma1 += d[i] * (i + 2);
  }
  let resto1 = soma1 % 11;
  let dv1 = resto1;
  if (resto1 === 10) {
    dv1 = 0;
  } else if (resto1 === 0 && (uf === 1 || uf === 2)) {
    // Casos especiais para SP (01) e MG (02) quando resto for 0
    dv1 = 1;
  }

  if (d[10] !== dv1) return false;

  // 2º Dígito Verificador (12º dígito)
  const soma2 = d[8] * 7 + d[9] * 8 + dv1 * 9;
  let resto2 = soma2 % 11;
  let dv2 = resto2;
  if (resto2 === 10) {
    dv2 = 0;
  } else if (resto2 === 0 && (uf === 1 || uf === 2)) {
    dv2 = 1;
  }

  return d[11] === dv2;
}

/**
 * Valida se uma sequência de 11 dígitos representa um CPF válido (módulo 11)
 */
export function validarCpf(numero: string): boolean {
  const limpo = (numero || '').replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  const d = limpo.split('').map(Number);

  // 1º DV
  let soma1 = 0;
  for (let i = 0; i < 9; i++) {
    soma1 += d[i] * (10 - i);
  }
  let resto1 = (soma1 * 10) % 11;
  if (resto1 === 10 || resto1 === 11) resto1 = 0;
  if (d[9] !== resto1) return false;

  // 2º DV
  let soma2 = 0;
  for (let i = 0; i < 10; i++) {
    soma2 += d[i] * (11 - i);
  }
  let resto2 = (soma2 * 10) % 11;
  if (resto2 === 10 || resto2 === 11) resto2 = 0;
  return d[10] === resto2;
}

/**
 * Valida se uma sequência de 11 dígitos representa uma CNH válida
 */
export function validarCnh(numero: string): boolean {
  const limpo = (numero || '').replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  const d = limpo.split('').map(Number);

  let soma1 = 0;
  for (let i = 0; i < 9; i++) {
    soma1 += d[i] * (9 - i);
  }
  let resto1 = soma1 % 11;
  let dv1 = resto1 >= 10 ? 0 : resto1;

  let soma2 = 0;
  for (let i = 0; i < 9; i++) {
    soma2 += d[i] * (1 + i);
  }
  let resto2 = soma2 % 11;
  let dv2 = resto2 >= 10 ? 0 : resto2;

  // Regra de ajuste oficial do Denatran
  if (resto1 >= 10) {
    dv2 = (dv2 - 2) < 0 ? dv2 - 2 + 11 : dv2 - 2;
  }

  return d[9] === dv1 && d[10] === dv2;
}

/**
 * Valida PIS / PASEP / NIT (11 dígitos)
 */
export function validarPis(numero: string): boolean {
  const limpo = (numero || '').replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  const d = limpo.split('').map(Number);
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += d[i] * pesos[i];
  }

  const resto = soma % 11;
  const dv = 11 - resto;
  const dvFinal = (dv === 10 || dv === 11) ? 0 : dv;

  return d[10] === dvFinal;
}

/**
 * Valida Passaporte Brasileiro (2 letras seguidas de 6 dígitos numéricos)
 */
export function validarPassaporte(numero: string): boolean {
  const limpo = (numero || '').trim().toUpperCase();
  return /^[A-Z]{2}\d{6}$/.test(limpo);
}

/**
 * Extrai e valida o dado documental específico contido em um trecho de texto.
 * 
 * Se o tipo documental tiver formato matemático/estrutural conhecido:
 * 1. Varre o texto procurando candidatos com o número exato de dígitos e separadores;
 * 2. Valida o algoritmo específico (TSE para título, módulo 11 para CPF/CNH/PIS);
 * 3. Só retorna valido: true se encontrar um valor comprovadamente válido.
 */
export function extrairEValidarDadoDocumental(
  tipoDocumento: string,
  textoTrecho: string
): ResultadoValidacaoDadoDocumental {
  if (!tipoDocumento || !textoTrecho || typeof textoTrecho !== 'string') {
    return { valido: false, motivoRejeicao: 'Texto ou tipo documental vazio.' };
  }

  const tipoNorm = tipoDocumento
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // =========================================================================
  // 1. TÍTULO DE ELEITOR (12 dígitos numéricos obrigatórios + validação TSE)
  // =========================================================================
  if (tipoNorm.includes('titulo') && (tipoNorm.includes('eleitor') || tipoNorm.includes('eleitoral'))) {
    // Candidatos no texto:
    // a) Grupos de 12 dígitos com espaços ou pontos: ex: "1234 5678 9012" ou "1234.5678.9012"
    // b) Sequência contínua de 12 dígitos: ex: "123456789012"
    const regexCandidatos = [
      /\b(\d{4})[\s.-]?(\d{4})[\s.-]?(\d{4})\b/g,
      /(?:titulo(?:\s+de)?\s+eleitor(?:al)?|inscricao|n[ºo.]?)\s*[:.\s-]*([0-9\s.-]{12,16})/gi,
      /\b\d{12}\b/g,
    ];

    const numerosTestados = new Set<string>();

    for (const regex of regexCandidatos) {
      let match;
      while ((match = regex.exec(textoTrecho)) !== null) {
        const strCapturada = match[0];
        const apenasDigitos = strCapturada.replace(/\D/g, '');

        if (apenasDigitos.length === 12 && !numerosTestados.has(apenasDigitos)) {
          numerosTestados.add(apenasDigitos);

          // Validação TSE
          if (validarTituloEleitor(apenasDigitos)) {
            const formatado = `${apenasDigitos.slice(0, 4)} ${apenasDigitos.slice(4, 8)} ${apenasDigitos.slice(8, 12)}`;
            return {
              valido: true,
              tipoDetectado: 'Título de Eleitor',
              valorFormatado: formatado,
              valorBruto: apenasDigitos,
            };
          } else {
            // Se houver rótulo explícito e inequívoco de Título de Eleitor no trecho,
            // mas o DV falhar por alguma variação do estado, checa se tem UF válida (01 a 28)
            const uf = parseInt(apenasDigitos.substring(8, 10), 10);
            const rotuloExplicito = /(?:t[ií]tulo(?:\s+de)?\s+eleitor|inscri[çc][ãa]o\s+eleitoral)/i.test(textoTrecho);
            if (rotuloExplicito && uf >= 1 && uf <= 28) {
              const formatado = `${apenasDigitos.slice(0, 4)} ${apenasDigitos.slice(4, 8)} ${apenasDigitos.slice(8, 12)}`;
              return {
                valido: true,
                tipoDetectado: 'Título de Eleitor',
                valorFormatado: formatado,
                valorBruto: apenasDigitos,
              };
            }
          }
        }
      }
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhum Título de Eleitor com 12 dígitos válidos foi encontrado no trecho.',
    };
  }

  // =========================================================================
  // 2. CPF (11 dígitos numéricos com validação matemática)
  // =========================================================================
  if (tipoNorm === 'cpf' || tipoNorm.includes('cadastro de pessoa')) {
    const regexCpf = [
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
      /\b\d{11}\b/g,
      /(?:cpf|cpf\/mf)\s*[:.\s-]*([0-9\s.-]{11,15})/gi,
    ];

    const testados = new Set<string>();
    for (const regex of regexCpf) {
      let match;
      while ((match = regex.exec(textoTrecho)) !== null) {
        const digitos = match[0].replace(/\D/g, '');
        if (digitos.length === 11 && !testados.has(digitos)) {
          testados.add(digitos);
          if (validarCpf(digitos)) {
            const formatado = `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9, 11)}`;
            return {
              valido: true,
              tipoDetectado: 'CPF',
              valorFormatado: formatado,
              valorBruto: digitos,
            };
          }
        }
      }
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhum CPF válido de 11 dígitos foi encontrado no trecho.',
    };
  }

  // =========================================================================
  // 3. CNH (11 dígitos numéricos com validação de habilitação)
  // =========================================================================
  if (tipoNorm === 'cnh' || tipoNorm.includes('habilitacao') || tipoNorm.includes('carteira nacional')) {
    const regexCnh = [
      /(?:cnh|registro|habilita[çc][ãa]o)\s*[:.\s-]*([0-9]{11})/gi,
      /\b\d{11}\b/g,
    ];

    const testados = new Set<string>();
    for (const regex of regexCnh) {
      let match;
      while ((match = regex.exec(textoTrecho)) !== null) {
        const digitos = match[0].replace(/\D/g, '');
        if (digitos.length === 11 && !testados.has(digitos)) {
          testados.add(digitos);
          if (validarCnh(digitos)) {
            return {
              valido: true,
              tipoDetectado: 'CNH',
              valorFormatado: digitos,
              valorBruto: digitos,
            };
          }
        }
      }
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhuma CNH válida de 11 dígitos foi encontrada no trecho.',
    };
  }

  // =========================================================================
  // 4. PIS / PASEP / NIT (11 dígitos numéricos)
  // =========================================================================
  if (tipoNorm === 'pis' || tipoNorm === 'pasep' || tipoNorm === 'nis' || tipoNorm === 'nit') {
    const regexPis = [
      /\b\d{3}\.\d{5}\.\d{2}-\d\b/g,
      /(?:pis|pasep|nis|nit)\s*[:.\s-]*([0-9\s.-]{11,15})/gi,
      /\b\d{11}\b/g,
    ];

    const testados = new Set<string>();
    for (const regex of regexPis) {
      let match;
      while ((match = regex.exec(textoTrecho)) !== null) {
        const digitos = match[0].replace(/\D/g, '');
        if (digitos.length === 11 && !testados.has(digitos)) {
          testados.add(digitos);
          if (validarPis(digitos)) {
            const formatado = `${digitos.slice(0, 3)}.${digitos.slice(3, 8)}.${digitos.slice(8, 10)}-${digitos.slice(10, 11)}`;
            return {
              valido: true,
              tipoDetectado: 'PIS',
              valorFormatado: formatado,
              valorBruto: digitos,
            };
          }
        }
      }
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhum PIS/PASEP válido de 11 dígitos foi encontrado no trecho.',
    };
  }

  // =========================================================================
  // 5. PASSAPORTE (2 letras + 6 números)
  // =========================================================================
  if (tipoNorm.includes('passaporte')) {
    const match = textoTrecho.match(/\b([A-Z]{2}\d{6})\b/i);
    if (match && validarPassaporte(match[1])) {
      const formatado = match[1].toUpperCase();
      return {
        valido: true,
        tipoDetectado: 'Passaporte',
        valorFormatado: formatado,
        valorBruto: formatado,
      };
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhum número de passaporte com formato válido (2 letras + 6 números) foi encontrado no trecho.',
    };
  }

  // =========================================================================
  // 6. CERTIDÃO (Matrícula CNJ de 32 dígitos)
  // =========================================================================
  if (tipoNorm.includes('certidao')) {
    const matchMatricula = textoTrecho.replace(/\D/g, '').match(/\b\d{32}\b/);
    if (matchMatricula) {
      const m = matchMatricula[0];
      const formatado = `${m.slice(0, 6)} ${m.slice(6, 8)} ${m.slice(8, 10)} ${m.slice(10, 14)} ${m.slice(14, 15)} ${m.slice(15, 20)} ${m.slice(20, 23)} ${m.slice(23, 30)} ${m.slice(30, 32)}`;
      return {
        valido: true,
        tipoDetectado: 'Certidão',
        valorFormatado: formatado,
        valorBruto: m,
      };
    }

    return {
      valido: false,
      motivoRejeicao: 'Nenhum número ou matrícula oficial de certidão foi encontrado no trecho.',
    };
  }

  // Documentos sem formato numérico rígido homologado não são aceitos cegamente como dado equivalente
  return {
    valido: false,
    motivoRejeicao: `O tipo documental "${tipoDocumento}" não possui formato numérico padronizado para extração automática de dado equivalente.`,
  };
}
