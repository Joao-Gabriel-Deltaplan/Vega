import path from 'path';
import OpenAI from 'openai';
import { extractText } from 'unpdf';
import { AnaliseDocumentoResponse, VisibilidadeDoc } from './types.js';
import { extrairCamposTitularDeDocumento } from './extracaoTitularService.js';
import { extrairTextoImagemComVisao } from './indexador/indexadorService.js';

/**
 * Analisa o arquivo enviado (pelo nome e conteúdo do PDF ou imagem quando disponível).
 * Para PDFs com texto vetorial, extrai diretamente. Para imagens ou PDFs escaneados,
 * utiliza visão quando apropriado para sugerir metadados cadastrais com máxima precisão.
 */
export async function analisarDocumentoParaCofre(dados: {
  nomeArquivo: string;
  mimeType?: string;
  base64?: string;
  tamanho?: number;
}): Promise<AnaliseDocumentoResponse> {
  const { nomeArquivo, base64 } = dados;

  // Fallback inicial: título baseado no nome do arquivo sem extensão
  const nomeLimpo = nomeArquivo.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const nomeLower = nomeLimpo.toLowerCase();

  // Título sugerido formatado (Title Case)
  const tituloBase = nomeLimpo
    .split(' ')
    .map((palavra) => {
      const p = palavra.toLowerCase();
      if (['de', 'da', 'do', 'dos', 'das', 'e'].includes(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');

  let tituloSugerido = tituloBase;
  let tipoSugerido = 'Outros';
  let titularSugerido = 'Delta Plan';
  let visibilidadeSugerida: VisibilidadeDoc = 'diretoria';
  let descricaoSugerida = `Documento ${nomeLimpo} armazenado no cofre corporativo.`;
  const apelidosSet = new Set<string>();

  // Adiciona termos do próprio nome aos apelidos
  nomeLower
    .split(/\s+/)
    .map((p) => p.replace(/[.,;:!?]/g, ''))
    .filter((p) => p.length >= 3 && !['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'para', 'com'].includes(p))
    .forEach((p) => apelidosSet.add(p));

  // Extração de texto em memória caso seja PDF ou Imagem com base64
  let textoExtraido = '';
  const isPdf = dados.mimeType === 'application/pdf' || nomeArquivo.toLowerCase().endsWith('.pdf');
  const isImagem = dados.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(nomeArquivo);

  if (base64 && isPdf) {
    try {
      const base64Limpo = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Limpo, 'base64');
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      textoExtraido = (text || '').toUpperCase();
    } catch (err) {
      textoExtraido = '';
    }
  } else if (base64 && isImagem) {
    try {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (apiKey) {
        const openai = new OpenAI({ apiKey });
        const base64Limpo = base64.replace(/^data:.*?;base64,/, '');
        const buffer = Buffer.from(base64Limpo, 'base64');
        const ext = path.extname(nomeArquivo).toLowerCase();
        let mime = dados.mimeType || 'image/jpeg';
        if (ext === '.png') mime = 'image/png';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        const txt = await extrairTextoImagemComVisao(buffer, mime, openai);
        textoExtraido = (txt || '').toUpperCase();
      }
    } catch (err) {
      textoExtraido = '';
    }
  }

  // Texto consolidado para regras (em maiúsculas)
  const textoParaAnalise = (textoExtraido + ' ' + nomeLimpo.toUpperCase()).trim();

  // 1. CARTEIRA NACIONAL DE HABILITACAO -> tipo "CNH", apelido "cnh"
  if (
    textoParaAnalise.includes('CARTEIRA NACIONAL DE HABILITACAO') ||
    nomeLower.includes('cnh') ||
    textoParaAnalise.includes('DETRAN')
  ) {
    tipoSugerido = 'CNH';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('cnh');
    apelidosSet.add('habilitacao');
    apelidosSet.add('documento pessoal');
    descricaoSugerida = 'Carteira Nacional de Habilitação (CNH).';

    // Extrai titular se tiver nome no arquivo
    const partesNome = nomeLimpo
      .replace(/\b(cnh|digital|carteira|habilitacao|doc|documento|de|da|do)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (partesNome.length > 2) {
      titularSugerido = partesNome
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      apelidosSet.add(partesNome.toLowerCase());
      tituloSugerido = `CNH ${titularSugerido}`;
    }
  }
  // 2. CERTIDÃO DE REGISTRO TÉCNICO (CRT) / CONSELHO REGIONAL DOS TÉCNICOS (CFT/CRT)
  else if (
    /\bcrt\b/i.test(nomeLimpo) ||
    textoParaAnalise.includes('CERTIDAO DE REGISTRO') ||
    textoParaAnalise.includes('REGISTRO TECNICO') ||
    textoParaAnalise.includes('CONSELHO REGIONAL DOS TECNICOS') ||
    textoParaAnalise.includes('CONSELHO FEDERAL DOS TECNICOS') ||
    /\bCFT\b/.test(textoParaAnalise)
  ) {
    tipoSugerido = 'CRT';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('crt');
    apelidosSet.add('registro tecnico');
    apelidosSet.add('certidao tecnica');
    descricaoSugerida = 'Certidão de Registro Técnico (CRT).';

    const partesNome = nomeLimpo
      .replace(/\b(crt|certidao|registro|tecnico|doc|documento|de|da|do)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (partesNome.length > 2) {
      titularSugerido = partesNome
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      apelidosSet.add(partesNome.toLowerCase());
      tituloSugerido = `CRT ${titularSugerido}`;
    } else {
      tituloSugerido = `CRT ${titularSugerido}`;
    }
  }
  // 3. ANOTAÇÃO DE RESPONSABILIDADE TÉCNICA (ART) / CREA
  else if (
    /\bart\b/i.test(nomeLimpo) ||
    textoParaAnalise.includes('ANOTACAO DE RESPONSABILIDADE TECNICA') ||
    textoParaAnalise.includes('ANOTAÇÃO DE RESPONSABILIDADE TÉCNICA') ||
    /\bCREA\b/.test(textoParaAnalise)
  ) {
    tipoSugerido = 'ART';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('art');
    apelidosSet.add('anotacao tecnica');
    apelidosSet.add('crea');
    descricaoSugerida = 'Anotação de Responsabilidade Técnica (ART).';

    const partesNome = nomeLimpo
      .replace(/\b(art|anotacao|responsabilidade|tecnica|doc|documento|de|da|do)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (partesNome.length > 2) {
      titularSugerido = partesNome
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      apelidosSet.add(partesNome.toLowerCase());
      tituloSugerido = `ART ${titularSugerido}`;
    } else {
      tituloSugerido = `ART ${titularSugerido}`;
    }
  }
  // 4. Padrão CPF -> apenas se for especificamente um comprovante/cartão de CPF
  else if (
    /\bcpf\b/i.test(nomeLimpo) ||
    textoParaAnalise.includes('CADASTRO DE PESSOAS FISICAS') ||
    textoParaAnalise.includes('CADASTRO DE PESSOA FISICA') ||
    textoParaAnalise.includes('COMPROVANTE DE INSCRICAO NO CPF') ||
    textoParaAnalise.includes('COMPROVANTE DE SITUACAO CADASTRAL NO CPF')
  ) {
    tipoSugerido = 'CPF';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('cpf');
    apelidosSet.add('documento pessoal');
    descricaoSugerida = 'Cadastro de Pessoas Físicas (CPF).';

    const partesNome = nomeLimpo
      .replace(/\b(cpf|doc|documento|de|da|do)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (partesNome.length > 2) {
      titularSugerido = partesNome
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      apelidosSet.add(partesNome.toLowerCase());
      tituloSugerido = `CPF ${titularSugerido}`;
    }
  }
  // 3. Padrão CNPJ (00.000.000/0000-00) -> tipo "CNPJ"
  else if (
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(textoParaAnalise) ||
    nomeLower.includes('cnpj')
  ) {
    tipoSugerido = 'CNPJ';
    titularSugerido = 'Delta Plan';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('cnpj');
    apelidosSet.add('cartao cnpj');
    apelidosSet.add('inscricao');
    descricaoSugerida = 'Comprovante de Inscrição e de Situação Cadastral no CNPJ.';
    tituloSugerido = 'Cartão CNPJ Delta Plan';
  }
  // 4. CONTRATO SOCIAL -> tipo "Societário"
  else if (
    textoParaAnalise.includes('CONTRATO SOCIAL') ||
    nomeLower.includes('contrato social') ||
    textoParaAnalise.includes('ESTATUTO SOCIAL') ||
    nomeLower.includes('societario') ||
    nomeLower.includes('societário')
  ) {
    tipoSugerido = 'Societário';
    titularSugerido = 'Delta Plan';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('contrato');
    apelidosSet.add('social');
    apelidosSet.add('estatuto');
    apelidosSet.add('societario');
    apelidosSet.add('delta plan');
    descricaoSugerida = 'Contrato Social consolidado e atos societários da Delta Plan.';
    tituloSugerido = 'Contrato Social Delta Plan';
  }
  // 5. DEMONSTRACAO DO RESULTADO / DRE -> tipo "Financeiro"
  else if (
    textoParaAnalise.includes('DEMONSTRACAO DO RESULTADO') ||
    textoParaAnalise.includes('DEMONSTRAÇÃO DO RESULTADO') ||
    /\bDRE\b/.test(textoParaAnalise) ||
    nomeLower.includes('dre') ||
    nomeLower.includes('balanco') ||
    nomeLower.includes('balanço') ||
    nomeLower.includes('faturamento')
  ) {
    tipoSugerido = 'Financeiro';
    titularSugerido = 'Delta Plan';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('dre');
    apelidosSet.add('balanco');
    apelidosSet.add('balanço');
    apelidosSet.add('financeiro');
    apelidosSet.add('demonstrativo');
    descricaoSugerida = 'Demonstração do Resultado do Exercício (DRE) / Registros Contábeis.';
    tituloSugerido = 'DRE Delta Plan';
  }
  // 6. Normas e Regimentos (Gerais)
  else if (
    textoParaAnalise.includes('REGIMENTO INTERNO') ||
    textoParaAnalise.includes('CODIGO DE CONDUTA') ||
    nomeLower.includes('regimento') ||
    nomeLower.includes('conduta') ||
    nomeLower.includes('politica') ||
    nomeLower.includes('política') ||
    nomeLower.includes('manual')
  ) {
    tipoSugerido = 'Normativo';
    titularSugerido = 'Delta Plan';
    visibilidadeSugerida = 'geral';
    apelidosSet.add('regimento');
    apelidosSet.add('conduta');
    apelidosSet.add('manual');
    apelidosSet.add('politica');
    descricaoSugerida = 'Regulamento interno e código de conduta da Delta Plan.';
    tituloSugerido = 'Regimento Interno e Código de Conduta';
  }
  // 7. Proposta Comercial
  else if (
    textoParaAnalise.includes('PROPOSTA COMERCIAL') ||
    textoParaAnalise.includes('PROPOSTA TECNICA') ||
    nomeLower.includes('proposta')
  ) {
    tipoSugerido = 'Proposta';
    titularSugerido = 'Delta Plan';
    visibilidadeSugerida = 'diretoria';
    apelidosSet.add('proposta');
    apelidosSet.add('comercial');
    apelidosSet.add('minuta');
    descricaoSugerida = 'Proposta técnica e comercial Delta Plan.';
    tituloSugerido = 'Proposta Comercial Delta Plan';
  }

  // Extração estruturada de dados de titular (se aplicável ao tipo/conteúdo)
  const camposSugeridosTitular = extrairCamposTitularDeDocumento({
    tipo: tipoSugerido,
    texto: textoParaAnalise,
    nomeArquivo,
    titular: titularSugerido,
  });

  // Extração de validade do documento
  let dataValidadeSugerida: string | null = null;
  if (camposSugeridosTitular?.validadeCnh) {
    dataValidadeSugerida = camposSugeridosTitular.validadeCnh;
  } else if (
    !['CERTIDÃO', 'CASAMENTO', 'VACINA', 'DIPLOMA', 'CTPS', 'TRABALHO'].some((termo) =>
      textoParaAnalise.includes(termo)
    )
  ) {
    const matchValidade = textoParaAnalise.match(
      /\b(?:VALIDADE|VENCIMENTO|VIGENCIA|VÁLIDO\s*ATÉ|VALIDO\s*ATE|EXPIRA\s*EM)[\s:.]*(\d{2}\/\d{2}\/\d{4})\b/i
    );
    if (matchValidade) {
      dataValidadeSugerida = matchValidade[1];
    }
  }

  // Descarta qualquer conteúdo lido da memória
  textoExtraido = '';

  return {
    tituloSugerido,
    tipoSugerido,
    titularSugerido,
    apelidosSugeridos: Array.from(apelidosSet),
    visibilidadeSugerida,
    descricaoSugerida,
    camposSugeridosTitular,
    dataValidadeSugerida,
  };
}
