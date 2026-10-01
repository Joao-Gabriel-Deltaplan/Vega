import { FichaTitular, DocumentoRegistro } from '../types.js';
import {
  extrairPrimeiroNome,
  normalizarFoneticaNome,
  calcularDistanciaLevenshtein,
  nomesSaoEquivalentesComTolerancia,
} from './nomeUtils.js';

export interface PessoaConhecida {
  nomeOficial: string;
  primeiroNome: string;
  nomeNorm: string;
  primeiroNomeNorm: string;
  apelidos: string[];
  apelidosNorm: string[];
  ehTitularCadastrado: boolean;
  titularId?: string;
  documentoId?: string;
}

export type TipoCorrespondenciaPessoa = 'exata' | 'aproximada' | 'inexistente';

export interface ResultadoCorrespondenciaNome {
  tipo: TipoCorrespondenciaPessoa;
  nomeEntendido: string;
  pessoaExata?: PessoaConhecida;
  candidatosAproximados?: PessoaConhecida[];
  mensagemRespostaObrigatoria?: string;
}

/**
 * Remove acentos, pontuação, múltiplos espaços e converte para minúsculas.
 */
export function normalizarParaComparacao(texto?: string): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Monta o catálogo consolidado de todas as pessoas conhecidas no sistema
 * (titulares cadastrados e pessoas físicas identificadas em documentos do Cofre).
 */
export function extrairCatalogoPessoas(
  titulares: FichaTitular[] = [],
  documentos: DocumentoRegistro[] = []
): PessoaConhecida[] {
  const pessoas: PessoaConhecida[] = [];
  const nomesJaAdicionados = new Set<string>();

  // 1. Titulares cadastrados no Supabase
  for (const t of titulares) {
    if (!t.nome || !t.nome.trim()) continue;
    const nomeNorm = normalizarParaComparacao(t.nome);
    if (!nomeNorm || nomesJaAdicionados.has(nomeNorm)) continue;

    const pNome = extrairPrimeiroNome(t.nome) || t.nome;
    const pNomeNorm = normalizarParaComparacao(pNome);
    const apelidos = t.apelidos || [];
    const apelidosNorm = apelidos.map(normalizarParaComparacao).filter(Boolean);

    pessoas.push({
      nomeOficial: t.nome,
      primeiroNome: pNome,
      nomeNorm,
      primeiroNomeNorm: pNomeNorm,
      apelidos,
      apelidosNorm,
      ehTitularCadastrado: true,
      titularId: t.id,
    });
    nomesJaAdicionados.add(nomeNorm);
    if (pNomeNorm && pNomeNorm.length >= 3) {
      nomesJaAdicionados.add(pNomeNorm);
    }
  }

  // 2. Pessoas com documentos no Cofre (mesmo sem cadastro formal de titular)
  for (const d of documentos) {
    const donoProvavel =
      (d.metadata?.donoProvavel ||
        d.metadata?.nomeNoDocumento ||
        d.metadata?.donoDocumento ||
        '') as string;

    const candidatos = [donoProvavel].filter(Boolean);

    // Nomes detectados em arquivos ou títulos (ex: "CNH ONLINE NIL.pdf" -> Nilceia)
    const arqLower = (d.arquivo || '').toLowerCase();
    const titLower = (d.titulo || '').toLowerCase();
    if (arqLower.includes('nil') || titLower.includes('nilceia')) {
      candidatos.push('Nilceia Batista Ramos Fabre');
    }

    for (const cand of candidatos) {
      const candNorm = normalizarParaComparacao(cand);
      if (!candNorm || candNorm.length < 3) continue;
      // Ignora empresas genéricas
      if (['delta plan', 'reng engenharia', 'servicos menegazzo'].includes(candNorm)) continue;
      if (nomesJaAdicionados.has(candNorm)) continue;

      const pNome = extrairPrimeiroNome(cand) || cand;
      const pNomeNorm = normalizarParaComparacao(pNome);

      pessoas.push({
        nomeOficial: cand,
        primeiroNome: pNome,
        nomeNorm: candNorm,
        primeiroNomeNorm: pNomeNorm,
        apelidos: [],
        apelidosNorm: [],
        ehTitularCadastrado: false,
        documentoId: d.id,
      });
      nomesJaAdicionados.add(candNorm);
      if (pNomeNorm && pNomeNorm.length >= 3) {
        nomesJaAdicionados.add(pNomeNorm);
      }
    }
  }

  return pessoas;
}

/**
 * Formata um nome em Title Case preservando preposições minúsculas ("de", "da", "do", "e").
 * Ex: "danil ceia" -> "Danil Ceia", "roberto da silva" -> "Roberto da Silva"
 */
export function formatarNomeExibicao(nome: string): string {
  if (!nome) return '';
  const preps = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .trim()
    .split(/\s+/)
    .map((palavra, idx) => {
      const pLower = palavra.toLowerCase();
      if (idx > 0 && preps.has(pLower)) {
        return pLower;
      }
      return pLower.charAt(0).toUpperCase() + pLower.slice(1);
    })
    .join(' ');
}

/**
 * Classifica a correspondência de um nome de pessoa segundo a regra oficial da VEGA:
 * 1. Correspondência Exata (ignorando acentos e maiúsculas): prioridade máxima, responde direto.
 * 2. Correspondência Aproximada (erro de transcrição ou digitação): NÃO revelar nomes, NÃO entregar dados.
 *    Pede confirmação do nome entendido sugerindo digitar.
 * 3. Nenhuma Correspondência: responde que não encontrou, repetindo o nome entendido.
 */
export function verificarCorrespondenciaNomePessoa(
  nomeInformado: string,
  pessoasConhecidas: PessoaConhecida[]
): ResultadoCorrespondenciaNome {
  if (!nomeInformado || !nomeInformado.trim()) {
    return {
      tipo: 'inexistente',
      nomeEntendido: '',
      mensagemRespostaObrigatoria: 'Não encontrei esse nome no Cofre.',
    };
  }

  // Remove preposições comuns no início se o nome veio bruto ("da Nilceia" -> "Nilceia", "do Thomaz" -> "Thomaz")
  let nomeLimpo = nomeInformado.trim();
  const matchPrep = /^(?:da|de|do|das|dos)\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)$/i.exec(nomeLimpo);
  if (matchPrep && matchPrep[1]) {
    nomeLimpo = matchPrep[1].trim();
  }

  const nomeExibicao = nomeLimpo === nomeLimpo.toLowerCase() ? formatarNomeExibicao(nomeLimpo) : nomeLimpo;
  const nomeNorm = normalizarParaComparacao(nomeLimpo);
  const primeiroNomeNorm = normalizarParaComparacao(extrairPrimeiroNome(nomeLimpo) || nomeLimpo);

  // -------------------------------------------------------------
  // 1. CORRESPONDÊNCIA EXATA (Prioridade Máxima)
  // Ignora apenas acentos e maiúsculas.
  // -------------------------------------------------------------
  for (const p of pessoasConhecidas) {
    // a) Nome completo exato
    if (p.nomeNorm === nomeNorm) {
      return {
        tipo: 'exata',
        nomeEntendido: nomeExibicao,
        pessoaExata: p,
      };
    }
    // b) Primeiro nome exato (se tamanho >= 3)
    if (p.primeiroNomeNorm && p.primeiroNomeNorm.length >= 3 && p.primeiroNomeNorm === nomeNorm) {
      return {
        tipo: 'exata',
        nomeEntendido: nomeExibicao,
        pessoaExata: p,
      };
    }
    // c) Apelido oficial cadastrado exato
    // (Apenas se for apelido autêntico como "Berna" ou "Zé", NUNCA se for variação ortográfica do primeiro nome como Thomas/Thomaz)
    if (p.apelidosNorm && p.apelidosNorm.includes(nomeNorm)) {
      const ehVariacaoOrtograficaDoPrimeiroNome =
        p.primeiroNomeNorm &&
        (calcularDistanciaLevenshtein(nomeNorm, p.primeiroNomeNorm) <= 2 ||
          normalizarFoneticaNome(nomeNorm) === normalizarFoneticaNome(p.primeiroNomeNorm));

      if (!ehVariacaoOrtograficaDoPrimeiroNome) {
        return {
          tipo: 'exata',
          nomeEntendido: nomeExibicao,
          pessoaExata: p,
        };
      }
    }
    // d) Se informou primeiro nome e sobrenome que coincidem exatamente com o início ou partes do nome oficial
    if (nomeNorm.includes(' ') && p.nomeNorm.startsWith(nomeNorm)) {
      return {
        tipo: 'exata',
        nomeEntendido: nomeExibicao,
        pessoaExata: p,
      };
    }
  }

  // -------------------------------------------------------------
  // 2. CORRESPONDÊNCIA APROXIMADA (Erro de Transcrição ou Digitação)
  // -------------------------------------------------------------
  const candidatosAproximados: PessoaConhecida[] = [];

  for (const p of pessoasConhecidas) {
    let ehAproximado = false;

    // A) Aglutinação de fala / erro fonético de transcrição Whisper
    // Ex: "Danil Ceia", "Danilceia", "nil ceia" para "Nilceia"
    const semEspacos = nomeNorm.replace(/\s+/g, '');
    if (
      semEspacos === `da${p.primeiroNomeNorm}` ||
      semEspacos === `de${p.primeiroNomeNorm}` ||
      semEspacos === `do${p.primeiroNomeNorm}` ||
      semEspacos === p.primeiroNomeNorm
    ) {
      ehAproximado = true;
    }

    // B) Distância Levenshtein (erros de digitação de 1 a 2 caracteres)
    if (!ehAproximado && p.primeiroNomeNorm.length >= 4) {
      const distPNome = calcularDistanciaLevenshtein(primeiroNomeNorm, p.primeiroNomeNorm);
      if (distPNome >= 1 && distPNome <= 2) {
        ehAproximado = true;
      }
    }

    // C) Equivalência fonética de sibilantes/grafias (S/Z, TH/T, Y/I, C/S)
    if (!ehAproximado) {
      const fonInformado = normalizarFoneticaNome(primeiroNomeNorm);
      const fonPessoa = normalizarFoneticaNome(p.primeiroNomeNorm);
      if (fonInformado && fonPessoa && fonInformado === fonPessoa) {
        ehAproximado = true;
      }
    }

    // D) Tolerância ampla da função nomesSaoEquivalentesComTolerancia
    if (!ehAproximado) {
      if (
        nomesSaoEquivalentesComTolerancia(nomeNorm, p.nomeNorm) ||
        nomesSaoEquivalentesComTolerancia(primeiroNomeNorm, p.primeiroNomeNorm)
      ) {
        ehAproximado = true;
      }
    }

    if (ehAproximado && !candidatosAproximados.some((c) => c.nomeOficial === p.nomeOficial)) {
      candidatosAproximados.push(p);
    }
  }

  if (candidatosAproximados.length > 0) {
    return {
      tipo: 'aproximada',
      nomeEntendido: nomeExibicao,
      candidatosAproximados,
      mensagemRespostaObrigatoria: `Não encontrei '${nomeExibicao}'. Pode confirmar o nome? Se possível, digite para eu não entender errado.`,
    };
  }

  // -------------------------------------------------------------
  // 3. NENHUMA CORRESPONDÊNCIA (Inexistente)
  // -------------------------------------------------------------
  return {
    tipo: 'inexistente',
    nomeEntendido: nomeExibicao,
    mensagemRespostaObrigatoria: `Não encontrei informações sobre '${nomeExibicao}' no Cofre.`,
  };
}

/**
 * Tenta extrair da mensagem o nome de pessoa perguntado
 * Ex: "me entrega o CPF da Danil Ceia" -> "Danil Ceia"
 *     "o nome completo é Nilceia Batista Ramos Fabre" -> "Nilceia Batista Ramos Fabre"
 *     "qual a CNH do Thomas?" -> "Thomas"
 */
export function extrairNomePessoaDaMensagem(
  mensagem: string,
  pessoasConhecidas: PessoaConhecida[] = []
): string | null {
  if (!mensagem || !mensagem.trim()) return null;
  const msgLimpa = mensagem.trim();

  // 1. Mensagem declarativa de nome completo: "o nome completo é Fulano de Tal"
  const matchNomeCompleto = /(?:o\s+)?nome(?:\s+completo)?\s+(?:[eé]|seria)\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)/i.exec(msgLimpa);
  if (matchNomeCompleto && matchNomeCompleto[1]) {
    const nome = matchNomeCompleto[1].trim();
    if (nome.length >= 3) return nome;
  }

  // 2. Mensagem com preposição de titularidade: "CPF da Danil Ceia", "CNH do Thomas", "dados de Nilceia"
  const matchPrep = /(?:d[oa]\s+|de\s+)([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ýa-zà-öø-ÿ]+)*|[A-Za-zÀ-ÖØ-öø-ÿ]{3,}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]{3,})*)/i.exec(msgLimpa);
  if (matchPrep && matchPrep[1]) {
    const extraido = matchPrep[1].trim();
    const extraidoNorm = normalizarParaComparacao(extraido);
    const ignorar = [
      'empresa', 'delta plan', 'cofre', 'sistema', 'documento', 'documentos',
      'pasta', 'arquivo', 'ano', 'mes', 'dia', 'hoje', 'ontem', 'amanha',
      'pdf', 'foto', 'imagem', 'cartao', 'certidao', 'contrato', 'comprovante'
    ];
    if (!ignorar.includes(extraidoNorm) && extraido.length >= 3) {
      return extraido;
    }
  }

  // 3. Mensagem curta contendo apenas o nome: "Danil Ceia", "Nilceia", "Thomas"
  const palavras = msgLimpa.split(/\s+/);
  if (palavras.length <= 4) {
    const candidatosIgnorados = ['ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'sim', 'nao', 'ok', 'obrigado'];
    if (!candidatosIgnorados.includes(normalizarParaComparacao(msgLimpa))) {
      return msgLimpa;
    }
  }

  return null;
}
