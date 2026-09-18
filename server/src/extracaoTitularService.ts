import { CampoTitularId } from './types.js';

/**
 * Extrai campos específicos de dados do titular com base no tipo do documento
 * e no conteúdo extraído (apenas em memória, de forma 100% determinística).
 */
export function extrairCamposTitularDeDocumento(dados: {
  tipo: string;
  texto: string;
  nomeArquivo: string;
  titular?: string;
}): Partial<Record<CampoTitularId, string>> {
  const { tipo, texto, titular } = dados;
  const textoLimpo = (texto || '').toUpperCase();
  const tipoUpper = (tipo || '').toUpperCase();

  const campos: Partial<Record<CampoTitularId, string>> = {};

  if (titular && titular.trim() && titular.toLowerCase() !== 'delta plan') {
    campos.nome = titular.trim();
  }

  // 1. CPF (Padrão: 000.000.000-00 ou 11 dígitos)
  const cpfMatch = textoLimpo.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
  if (cpfMatch) {
    campos.cpf = cpfMatch[0];
  }

  // 2. RG (Padrão: 00.000.000-0 ou 0.000.000-0)
  const rgMatch =
    textoLimpo.match(/\b\d{1,2}\.\d{3}\.\d{3}-[0-9Xx]\b/) ||
    textoLimpo.match(/\b(?:RG|DOC\.?\s*IDENTIDADE|REGISTRO GERAL)[\s:.]*([0-9.\-Xx]{7,14})\b/);
  if (rgMatch) {
    campos.rg = rgMatch[1] || rgMatch[0];
  }

  // 3. Órgão Emissor
  const orgaoMatch = textoLimpo.match(/\b(SSP\s*\/\s*[A-Z]{2}|DETRAN\s*\/\s*[A-Z]{2}|PC\s*\/\s*[A-Z]{2}|CREA\s*\/\s*[A-Z]{2}|CFT\s*\/\s*[A-Z]{2})\b/);
  if (orgaoMatch) {
    campos.orgaoEmissor = orgaoMatch[0].replace(/\s+/g, '');
  }

  // 4. Se for CNH
  if (tipoUpper.includes('CNH') || tipoUpper.includes('HABILITACAO')) {
    // Número de Registro CNH
    const numCnhMatch = textoLimpo.match(/\b(?:REGISTRO|HABILITACAO|CNH)[\s:.]*(\d{9,11})\b/);
    if (numCnhMatch) {
      campos.cnh = numCnhMatch[1];
    }

    // Categoria
    const catMatch = textoLimpo.match(/\b(?:CAT|CATEGORIA)[\s:.]*([ABCDE]{1,2})\b/);
    if (catMatch) {
      campos.categoriaCnh = catMatch[1];
    }

    // Validade
    const valMatch = textoLimpo.match(/\b(?:VALIDADE)[\s:.]*(\d{2}\/\d{2}\/\d{4})\b/);
    if (valMatch) {
      campos.validadeCnh = valMatch[1];
    }

    // Data de Nascimento
    const nascMatch = textoLimpo.match(/\b(?:NASCIMENTO|NASC|DATA NASC)[\s:.]*(\d{2}\/\d{2}\/\d{4})\b/);
    if (nascMatch) {
      campos.dataNascimento = nascMatch[1];
    }

    // Filiação
    const filiacaoMatch = textoLimpo.match(/\b(?:FILIACAO|FILIAÇÃO)[\s:.]*([A-Z\s]{4,80})/);
    if (filiacaoMatch) {
      const filiacaoLimpa = filiacaoMatch[1].split('\n')[0].trim();
      if (filiacaoLimpa.length > 3) {
        campos.filiacao = filiacaoLimpa;
      }
    }
  }

  // 5. Se for Certidão (Casamento / Nascimento)
  if (tipoUpper.includes('CERTIDAO') || tipoUpper.includes('CASAMENTO')) {
    const estadoCivilMatch = textoLimpo.match(/\b(CASADO|CASADA|SOLTEIRO|SOLTEIRA|DIVORCIADO|DIVORCIADA|VIUVO|VIUVA|UNIAO ESTAVEL)\b/);
    if (estadoCivilMatch) {
      campos.estadoCivil =
        estadoCivilMatch[0].charAt(0).toUpperCase() + estadoCivilMatch[0].slice(1).toLowerCase();
    }
  }

  // 6. Se for CTPS / CRT / ART
  if (
    tipoUpper.includes('CTPS') ||
    tipoUpper.includes('TRABALHO') ||
    tipoUpper.includes('CRT') ||
    tipoUpper.includes('ART')
  ) {
    const profMatch = textoLimpo.match(/\b(ENGENHEIRO CIVIL|ENGENHEIRO ELETRICISTA|ENGENHEIRO|ARQUITETO E URBANISTA|ARQUITETO|TECNICO EM EDIFICACOES|TECNICO|ADMINISTRADOR|ADVOGADO)\b/);
    if (profMatch) {
      campos.profissao =
        profMatch[0].split(' ')
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(' ');
    }
  }

  // 7. Endereço (se for comprovante de residência)
  if (tipoUpper.includes('ENDERECO') || tipoUpper.includes('RESIDENCIA') || textoLimpo.includes('COMPROVANTE DE RESIDENCIA')) {
    const endMatch = textoLimpo.match(/\b(?:RUA|AVENIDA|ALAMEDA|ESTRADA|RODOVIA|PRAÇA)[\sA-Z0-9,.-]{10,100}\b/);
    if (endMatch) {
      campos.endereco = endMatch[0].trim();
    }
  }

  return campos;
}
