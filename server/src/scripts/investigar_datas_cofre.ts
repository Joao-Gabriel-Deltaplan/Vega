import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { obterTodosDocumentos } from '../storage.js';

function dataEstaEmContextoDeNascimentoOuValidade(texto: string, index: number, matchLen: number): boolean {
  const trechoAntes = texto.slice(Math.max(0, index - 80), index).toLowerCase();
  const trechoDepois = texto.slice(index + matchLen, Math.min(texto.length, index + matchLen + 50)).toLowerCase();

  const ehNascimento =
    /(?:nascid[oa]|nascimento|data de nascimento|d\.n\.|nasceu|filh[oa]\s+de|natural\s+de|menor|idade|anos\s+de\s+idade)/i.test(
      trechoAntes
    ) || /\b(nascimento|nascid[oa])\b/i.test(trechoDepois);

  const ehValidade =
    /(?:validade|vencimento|v[aá]lido\s+at[eé]|vence\s+em|expira\s+em|validade\s+at[eé])/i.test(trechoAntes) ||
    /(?:validade|vencimento)/i.test(trechoDepois);

  return ehNascimento || ehValidade;
}

function validarAnoRazoavelEmissao(dataStr: string): boolean {
  const matchAno = dataStr.match(/\b(19\d{2}|20\d{2})\b/);
  if (!matchAno) return false;
  const ano = parseInt(matchAno[1], 10);
  const anoAtual = new Date().getFullYear();
  return ano >= 1950 && ano <= anoAtual;
}

function extrairDataEmissaoTest(titulo: string, descricao: string, trechos: string[]): string | null {
  const textoUnificado = `${titulo || ''} ${descricao || ''} ${trechos.join(' ')}`;

  // 1. DIRPF
  const matchExercicio = textoUnificado.match(/exerc[ií]cio\s+(\d{4})/i);
  if (matchExercicio) {
    const anoExercicio = matchExercicio[1];
    const matchRecibo = textoUnificado.match(/(?:recibo|transmiss[aã]o|entrega|emiss[aã]o|gerado em|data[:\s]+)(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/i);
    if (matchRecibo && !dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, matchRecibo.index || 0, matchRecibo[0].length)) {
      return matchRecibo[1];
    }
    return `30/04/${anoExercicio}`;
  }

  // 2. Certidão civil formato tabular: "Dia Mês Ano 12 04 2010"
  const matchTabular = textoUnificado.match(/Dia\s+M[eê]s\s+Ano\s*(\d{1,2})\s+(\d{1,2})\s+(\d{4})/i);
  if (matchTabular) {
    const dia = matchTabular[1].padStart(2, '0');
    const mes = matchTabular[2].padStart(2, '0');
    const ano = matchTabular[3];
    return `${dia}/${mes}/${ano}`;
  }

  // 3. Padrões explícitos com palavras-chave de emissão/registro
  const regexExplicit = /(?:data do registro|data de registro|registro do casamento|termo do registro|termo lavrado|lavrado aos?|lavrado em|assento lavrado|casamento celebrado|casamento realizado|contra[ií]ram matrim[oô]nio|expedido em|emitido em|data da expedi[cç][aã]o|data de expedi[cç][aã]o|concluiu em|colação de grau|data da assinatura|firmado em|assinado em|situação cadastral extraída em)[\s\S]{0,60}?(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4})/gi;

  let mExplicit: RegExpExecArray | null;
  while ((mExplicit = regexExplicit.exec(textoUnificado)) !== null) {
    const dataCapturada = mExplicit[1];
    const idx = mExplicit.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mExplicit[0].length)) {
      const dataConv = converterDataParaBr(dataCapturada);
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  // 4. Local e data no final de certidões/termos (ex.: "OURINHOS-SP, 12 de abril de 2010")
  const regexLocalData = /(?:[A-ZÀ-Ú\s]{3,25})[\s\-]+(?:SP|RJ|MG|PR|SC|RS|DF|GO)?,?\s*(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;
  let mLocal: RegExpExecArray | null;
  while ((mLocal = regexLocalData.exec(textoUnificado)) !== null) {
    const idx = mLocal.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mLocal[0].length)) {
      const dia = mLocal[1].padStart(2, '0');
      const mes = converterMesExtenso(mLocal[2]);
      const ano = mLocal[3];
      const dataConv = `${dia}/${mes}/${ano}`;
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  // 5. Varredura geral de datas por extenso descartando nascimento
  const regexExtenso = /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;
  let mExt: RegExpExecArray | null;
  while ((mExt = regexExtenso.exec(textoUnificado)) !== null) {
    const idx = mExt.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mExt[0].length)) {
      const dia = mExt[1].padStart(2, '0');
      const mes = converterMesExtenso(mExt[2]);
      const ano = mExt[3];
      const dataConv = `${dia}/${mes}/${ano}`;
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  return null;
}

function converterMesExtenso(mesNome: string): string {
  const meses: Record<string, string> = {
    janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08',
    setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };
  return meses[mesNome.toLowerCase()] || '01';
}

function converterDataParaBr(dStr: string): string {
  if (dStr.includes(' de ')) {
    const m = dStr.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
    if (m) {
      return `${m[1].padStart(2, '0')}/${converterMesExtenso(m[2])}/${m[3]}`;
    }
  }
  return dStr.replace(/[-.]/g, '/');
}

export function limparENormalizarEndereco(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // 1. Trunca quando começam outros campos do documento/cartório/certidão
  const delimitadoresCorte = [
    /\b(?:Nilceia|Nomes completos|Filho de|Filha de|Nascid[oa]|Natural de|Data do registro|Regime de bens|Observações|Casamento celebrado|O conteúdo da certidão|Expedido em|Número de registro|Registro Nacional|Título\(s\)|Decreto Federal|Diploma\/Certificado|A presente certidão|Esta certidão|Eletrônico|Telefone|E-mail|Email|Natureza da Ocupação|Ocupação Principal|Tipo de declaração|Nº do recibo|DEPENDENTES|ALIMENTANDOS|RENDIMENTOS)\b/i,
    /\b(?:CPF|RG|CNPJ)\s*[:\s]*\d/i,
  ];
  for (const delim of delimitadoresCorte) {
    const idx = s.search(delim);
    if (idx > 10) {
      s = s.slice(0, idx).trim();
    }
  }

  // 2. Remove rótulos crus de formulários
  s = s.replace(/\b(?:LOGRADOURO|Logradouro|ENDEREÇO|Endereço|ENDERECO|Endereco)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:NÚMERO|Número|NUMERO|Numero|Nº|N°|No\.?)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:COMPLEMENTO|Complemento)\s*[:\s]+(?=[A-Za-z0-9])/gi, '');
  s = s.replace(/\b(?:COMPLEMENTO|Complemento)\s*[:\s]*/gi, '');
  s = s.replace(/\b(?:BAIRRO\/DISTRITO|Bairro\/Distrito|BAIRRO|Bairro|DISTRITO|Distrito)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:MUNICÍPIO|Município|MUNICIPIO|Municipio|CIDADE|Cidade)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:UF|ESTADO|Estado)\s*[:\s]+/gi, '');

  // 3. Normaliza e extrai CEP se presente
  let cepFormatado = '';
  const matchCep = s.match(/\b(?:CEP:?\s*)?(\d{2})\.?(\d{3})-?(\d{3})\b/i);
  if (matchCep) {
    cepFormatado = `CEP ${matchCep[1]}${matchCep[2]}-${matchCep[3]}`;
    s = s.replace(/\b(?:CEP:?\s*)?\d{2}\.?\d{3}-?\d{3}\b/i, '');
  }

  // 4. Remove caracteres estranhos (••, *****, resíduos)
  s = s.replace(/[•*]+/g, ' ');
  s = s.replace(/[\t\r\n]+/g, ' ');
  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/,\s*,+/g, ',');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[,.\s-]+|[,.\s-]+$/g, '');

  // 5. Normaliza siglas e capitalização
  const ufs = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'ES', 'BA', 'DF', 'GO', 'MT', 'MS', 'PE', 'CE', 'PA', 'AM', 'MA', 'RN', 'PB', 'AL', 'SE', 'PI', 'TO', 'RO', 'AC', 'AP', 'RR']);
  const minusculas = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas']);

  // Divide por vírgulas para capitalizar cada pedaço (Logradouro, Bairro, Cidade)
  const partes = s.split(',').map((p) => p.trim()).filter(Boolean);
  const partesFormatadas = partes.map((parte) => {
    return parte.split(' - ').map((subParte) => {
      return subParte.split(' ').map((palavra, idx) => {
        const pUp = palavra.toUpperCase().replace(/[^A-Z]/g, '');
        if (ufs.has(pUp) && palavra.length <= 4) {
          return pUp;
        }
        const pLow = palavra.toLowerCase();
        if (minusculas.has(pLow) && idx > 0) {
          return pLow;
        }
        if (pLow.startsWith('nº') || pLow.startsWith('n°')) {
          return 'nº ' + pLow.slice(2).trim();
        }
        if (pLow === 'jd.' || pLow === 'jd') return 'Jardim';
        if (pLow === 'res.' || pLow === 'res') return 'Residencial';
        return pLow.charAt(0).toUpperCase() + pLow.slice(1);
      }).join(' ');
    }).join('-');
  });

  let resultado = partesFormatadas.join(', ');
  resultado = resultado.replace(/\s*-\s*([A-Z]{2})\b/g, '-$1');
  resultado = resultado.replace(/,\s*([A-Z]{2})\b/g, '-$1');
  resultado = resultado.replace(/\bEm\s+([A-ZÀ-Ú])/g, '$1');

  if (cepFormatado) {
    resultado += `, ${cepFormatado}`;
  }

  // Corta se sobrou algum texto após o UF
  const matchFimUf = resultado.match(/^(.*?[A-Z]{2}(?:,\s*CEP\s*\d{5}-\d{3})?)/);
  if (matchFimUf && matchFimUf[1].length >= 15) {
    resultado = matchFimUf[1];
  }

  return resultado.replace(/\s+/g, ' ').replace(/^,\s*/, '').trim();
}

export function extrairChaveComparacaoEndereco(endereco: string): string {
  const norm = endereco
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const matchNum = norm.match(/\b(?:n[ºo°]?\s*)?(\d+)\b/);
  const numero = matchNum ? matchNum[1] : '';

  let logradouro = norm;
  logradouro = logradouro.replace(/\bcep\s*[\d.-]+\b/g, '');
  logradouro = logradouro.replace(/\b(?:rua|avenida|av|alameda|travessa|estrada|rodovia|praca|res|residencial|apto|ap|bloco|jd|jardim)\b/g, '');
  const palavras = logradouro.match(/[a-z]{3,}/g) || [];
  const baseLogradouro = palavras.slice(0, 3).join('_');

  return `${baseLogradouro}_${numero}`;
}

async function main() {
  const sb = getSupabaseClient();
  const docs = await obterTodosDocumentos();

  console.log('\n=== TESTE DE EXTRAÇÃO E AGRUPAMENTO DE ENDEREÇOS DO THOMAZ ===');
  const docsThomaz = docs.filter(d => (d.titular || '').toLowerCase().includes('thomaz'));

  const grupos = new Map<string, { endereco: string; docs: Array<{ titulo: string; data: string | null }> }>();

  for (const d of docsThomaz) {
    const { data: tDoc } = await sb.from('trechos').select('conteudo').eq('documento_id', d.id);
    const trechos = (tDoc || []).map(t => t.conteudo);
    if (d.descricao) trechos.push(d.descricao);

    // Usa a lógica de extrair endereço de trechos
    const regexLogradouro = /(?:rua|avenida|av\.|alameda|rodovia|travessa|estrada|pra[cç]a|logradouro|endere[cç]o\s+residencial|endere[cç]o[:\s]+)(?:[^\n\r,\.]+)[,\s]+(?:\d+|nº\s*\d+|s\/n)[^\n\r]*/i;
    let endEncontrado: string | null = null;
    for (const t of trechos) {
      if (/não traz endereço|não cont[eé]m endereço/i.test(t)) continue;
      const m = t.match(regexLogradouro);
      if (m && m[0].length >= 8) {
        endEncontrado = m[0];
        break;
      }
      if (t.includes('EXERCÍCIO 2024') || t.includes('DECLARAÇÃO DE AJUSTE')) {
        const mIr = t.match(/Endereço:([^\n\r]+)/i);
        if (mIr) {
          endEncontrado = mIr[1];
          break;
        }
      }
    }

    if (endEncontrado) {
      const dataExtraida = extrairDataEmissaoTest(d.titulo, d.descricao || '', trechos);
      const endLimpo = limparENormalizarEndereco(endEncontrado);
      const chave = extrairChaveComparacaoEndereco(endLimpo);

      if (!grupos.has(chave)) {
        grupos.set(chave, { endereco: endLimpo, docs: [] });
      }
      grupos.get(chave)!.docs.push({ titulo: d.titulo, data: dataExtraida });
    }
  }

  let num = 1;
  for (const [chave, g] of grupos.entries()) {
    const nomesDocs = g.docs.map(x => `${x.titulo} (${x.data || 'data não identificada'})`).join(' e ');
    console.log(`\n*${num}º)* ${g.endereco}`);
    console.log(`Aparece em: ${nomesDocs}`);
    console.log(`[Chave de agrupamento: ${chave}]`);
    num++;
  }
}

main().catch(console.error);
