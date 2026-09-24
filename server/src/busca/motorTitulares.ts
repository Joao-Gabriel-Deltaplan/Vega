import {
  FichaTitular,
  CampoTitularId,
  DocumentoRegistro,
  Contato,
  NivelAcesso,
} from '../types.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';

const LABELS_CAMPOS: Record<CampoTitularId, string> = {
  nome: 'Nome',
  rg: 'RG',
  orgaoEmissor: 'Órgão emissor',
  cpf: 'CPF',
  dataNascimento: 'Data de nascimento',
  estadoCivil: 'Estado civil',
  profissao: 'Profissão',
  endereco: 'Endereço',
  nacionalidade: 'Nacionalidade',
  filiacao: 'Filiação',
  cnh: 'CNH',
  categoriaCnh: 'Categoria CNH',
  validadeCnh: 'Validade CNH',
};

/**
 * Identifica quais campos específicos foram solicitados no texto da mensagem
 */
export function identificarCamposPedidos(texto: string): CampoTitularId[] {
  const textoLower = (texto || '').toLowerCase();
  const campos: CampoTitularId[] = [];

  if (/\b(rg|identidade)\b/i.test(textoLower)) campos.push('rg');
  if (/\b(cpf)\b/i.test(textoLower)) campos.push('cpf');
  if (/\b(endereco|endereço|residencia|residência|onde mora)\b/i.test(textoLower)) campos.push('endereco');
  if (/\b(estado civil|casado|solteiro|casamento)\b/i.test(textoLower)) campos.push('estadoCivil');
  if (/\b(profissao|profissão|cargo|funcao|função|ocupacao|ocupação)\b/i.test(textoLower)) campos.push('profissao');
  if (/\b(data de nascimento|nascimento|idade|aniversario|aniversário)\b/i.test(textoLower)) campos.push('dataNascimento');
  if (/\b(nacionalidade|naturalidade)\b/i.test(textoLower)) campos.push('nacionalidade');
  if (/\b(filiacao|filiação|pais|pai|mae|mãe)\b/i.test(textoLower)) campos.push('filiacao');
  if (/\b(cnh|habilitacao|habilitação)\b/i.test(textoLower)) campos.push('cnh');

  return campos;
}

/**
 * Identifica o detalhe descritivo do campo pedido (ex: "nome do pai", "nome da mãe", "RG", etc.)
 */
export function identificarDetalheCampoPedido(texto: string): string | undefined {
  const t = (texto || '').toLowerCase();
  if (/\b(nome do pai|do pai|o pai|quem e o pai|quem é o pai|pai)\b/i.test(t)) {
    return 'o nome do pai';
  }
  if (/\b(nome da m[aã]e|da m[aã]e|a m[aã]e|quem e a m[aã]e|quem é a m[aã]e|m[aã]e)\b/i.test(t)) {
    return 'o nome da mãe';
  }
  if (/\b(filia[cç][aã]o|pais)\b/i.test(t)) {
    return 'a filiação';
  }
  if (/\b(rg|identidade)\b/i.test(t)) {
    return 'o RG';
  }
  if (/\b(cpf)\b/i.test(t)) {
    return 'o CPF';
  }
  if (/\b(endere[cç]o|resid[eê]ncia|onde mora)\b/i.test(t)) {
    return 'o endereço';
  }
  if (/\b(estado civil|casado|solteiro|casamento)\b/i.test(t)) {
    return 'o estado civil';
  }
  if (/\b(profiss[aã]o|cargo|fun[cç][aã]o|ocupa[cç][aã]o)\b/i.test(t)) {
    return 'a profissão';
  }
  if (/\b(data de nascimento|nascimento|idade|anivers[aá]rio)\b/i.test(t)) {
    return 'a data de nascimento';
  }
  if (/\b(cnh|habilita[cç][aã]o)\b/i.test(t)) {
    return 'a CNH';
  }
  if (/\b(nacionalidade|naturalidade)\b/i.test(t)) {
    return 'a nacionalidade';
  }
  return undefined;
}

/**
 * Verifica se a mensagem é um pedido genérico de dados ("me passa os dados do X", "tudo sobre o X")
 */
export function isPedidoGenericoDeDados(texto: string): boolean {
  const t = (texto || '').toLowerCase().trim();
  const padroesGenericos = [
    /\b(dados|informacoes|informações|ficha|tudo|cadastro)\b/i,
    /\b(me passa os dados|passa os dados|quero os dados|preciso dos dados)\b/i,
    /\b(o que (voce|você) tem d[eo]|quais os dados|dados cadastrais)\b/i,
  ];

  const contemPadraoGenerico = padroesGenericos.some((p) => p.test(t));
  const camposEspecificos = identificarCamposPedidos(t);

  // É genérico se pediu "dados/informações" sem especificar campos específicos
  return contemPadraoGenerico && camposEspecificos.length === 0;
}

function formatarListaItens(itens: string[]): string {
  if (itens.length === 0) return '';
  if (itens.length === 1) return itens[0];
  if (itens.length === 2) return `${itens[0]} e ${itens[1]}`;
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function normalizarOrigem(raw: string): { nome: string; prep: string } {
  const r = (raw || '').toLowerCase();
  if (r.includes('cnh')) return { nome: 'CNH', prep: 'da' };
  if (r.includes('ctps')) return { nome: 'CTPS', prep: 'da' };
  if (r.includes('certidao') || r.includes('certidão')) return { nome: 'Certidão de Casamento', prep: 'da' };
  if (r.includes('residencia') || r.includes('residência') || r.includes('endereco'))
    return { nome: 'Comprovante de Residência', prep: 'do' };
  if (r.includes('manual')) return { nome: 'cadastro manual', prep: 'do' };
  return { nome: raw, prep: 'de' };
}

/**
 * Monta a resposta para um pedido genérico de dados
 */
export function formatarRespostaPedidoGenerico(
  titularNome: string,
  contatoNome?: string,
  documentosDoTitular: DocumentoRegistro[] = []
): string {
  const primeiroNomeContato = extrairPrimeiroNome(contatoNome);
  const vocativo = primeiroNomeContato ? `, ${primeiroNomeContato}` : '';
  const primeiroNomeTitular = extrairPrimeiroNome(titularNome) || titularNome;

  // Lista os tipos dos documentos disponíveis autorizados de forma limpa
  const tiposDocs = Array.from(
    new Set(
      documentosDoTitular.map((d) => {
        const titLower = d.titulo.toLowerCase();
        if (titLower.includes('cnh')) return 'CNH';
        if (titLower.includes('certidao') || titLower.includes('certidão')) return 'Certidão de Casamento';
        if (titLower.includes('ctps')) return 'CTPS';
        return d.tipo || d.titulo;
      })
    )
  ).filter(Boolean);

  const listaTiposFormatada =
    tiposDocs.length > 0 ? formatarListaItens(tiposDocs) : 'nenhum documento no cofre no momento';

  return `O que você precisa do ${primeiroNomeTitular}${vocativo}?
 - Dados cadastrais (RG, CPF, endereço, estado civil, profissão)
 - Documentos em anexo (${listaTiposFormatada})
 Pode pedir campos específicos também.`;
}

/**
 * Monta a resposta para consulta de campos específicos do titular
 */
export function formatarRespostaConsultaCampos(dados: {
  titular: FichaTitular;
  camposPedidos: CampoTitularId[];
  documentosCofre: DocumentoRegistro[];
  contato?: Contato;
  detalheCampo?: string;
}): string {
  const { titular, camposPedidos, documentosCofre, contato, detalheCampo } = dados;
  const primeiroNomeTitular = extrairPrimeiroNome(titular.nome) || titular.nome;
  const nivelUsuario: NivelAcesso =
    contato?.nivelAcesso || contato?.ficha?.nivelAcesso || 'geral';

  // Filtra documentos do cofre pertencentes a este titular e autorizados para o usuário
  const docsDoTitular = documentosCofre.filter((d) => {
    if (!d.titular) return false;
    const titLower = d.titular.toLowerCase();
    const nomeTitularLower = titular.nome.toLowerCase();
    const matchTitular =
      titLower.includes(primeiroNomeTitular.toLowerCase()) ||
      nomeTitularLower.includes(titLower);

    if (!matchTitular) return false;
    if (nivelUsuario !== 'diretoria' && d.visibilidade === 'diretoria') return false;
    return true;
  });

  const linhasResposta: string[] = [];

  // Se nenhum campo específico foi detectado, usa os campos padrão
  const camposAListar: CampoTitularId[] =
    camposPedidos.length > 0
      ? camposPedidos
      : ['rg', 'cpf', 'estadoCivil', 'profissao', 'endereco'];

  // Caso especial: pedido de UM ÚNICO campo específico (ex: "nome do pai do Fulano")
  if (camposAListar.length === 1) {
    const campoId = camposAListar[0];
    const label = LABELS_CAMPOS[campoId] || campoId;
    const registroCampo = titular.campos[campoId];

    if (
      nivelUsuario !== 'diretoria' &&
      registroCampo &&
      registroCampo.origemVisibilidade === 'diretoria'
    ) {
      return `Não constam dados disponíveis para este titular.`;
    }

    if (registroCampo && registroCampo.conferido && registroCampo.valor) {
      let valorFormatado = registroCampo.valor;
      if (
        campoId === 'rg' &&
        titular.campos.orgaoEmissor?.valor &&
        titular.campos.orgaoEmissor.conferido
      ) {
        valorFormatado = `${valorFormatado} (${titular.campos.orgaoEmissor.valor})`;
      }

      let origemBruta = registroCampo.origemNome || registroCampo.origem || 'cadastro';
      if (origemBruta.startsWith('doc-') || origemBruta.startsWith('doc_')) {
        const docCorrespondente = documentosCofre.find((d) => d.id === registroCampo.origem);
        if (docCorrespondente) {
          origemBruta = docCorrespondente.tipo || docCorrespondente.titulo;
        }
      }
      const origem = normalizarOrigem(origemBruta);

      const temDocAvulsoDesteTipo = docsDoTitular.some((d) => {
        const t = (d.tipo || '').toLowerCase();
        const tit = (d.titulo || '').toLowerCase();
        const c = campoId.toLowerCase();
        return t === c || tit.includes(c) || (d.apelidos || []).some((ap) => ap.toLowerCase() === c);
      });

      if (!temDocAvulsoDesteTipo && origem.nome.toLowerCase() !== campoId.toLowerCase()) {
        return `Dados do ${primeiroNomeTitular}:\n - ${label}: ${valorFormatado} — extraído ${origem.prep} ${origem.nome}. Não há ${label} avulso anexado no cofre.`;
      }
      return `Dados do ${primeiroNomeTitular}:\n - ${label}: ${valorFormatado} — ${origem.prep} ${origem.nome}`;
    }

    // Campo não encontrado/não conferido em consulta direta de campo único:
    const descrCampo = detalheCampo || `o ${label.toLowerCase()}`;
    return `Não encontrei ${descrCampo} do ${primeiroNomeTitular} nos documentos.`;
  }

  for (const campoId of camposAListar) {
    const label = LABELS_CAMPOS[campoId] || campoId;
    const registroCampo = titular.campos[campoId];

    // REGRA DE PERMISSÃO: usuário "geral" só vê campos cuja origem seja documento visível a ele.
    // Campo vindo de documento restrito não aparece — nem como "não cadastrado", simplesmente é omitido!
    if (
      nivelUsuario !== 'diretoria' &&
      registroCampo &&
      registroCampo.origemVisibilidade === 'diretoria'
    ) {
      continue;
    }

    if (registroCampo && registroCampo.conferido && registroCampo.valor) {
      let valorFormatado = registroCampo.valor;

      // Se tiver órgão emissor e o campo for RG, exibe junto ex: "00.000.000-0 (SSP/SP)"
      if (
        campoId === 'rg' &&
        titular.campos.orgaoEmissor?.valor &&
        titular.campos.orgaoEmissor.conferido
      ) {
        valorFormatado = `${valorFormatado} (${titular.campos.orgaoEmissor.valor})`;
      }

      // Identifica origem amigável e preposição gramatical correta
      let origemBruta = registroCampo.origemNome || registroCampo.origem || 'cadastro';
      if (origemBruta.startsWith('doc-') || origemBruta.startsWith('doc_')) {
        const docCorrespondente = documentosCofre.find((d) => d.id === registroCampo.origem);
        if (docCorrespondente) {
          origemBruta = docCorrespondente.tipo || docCorrespondente.titulo;
        }
      }
      const origem = normalizarOrigem(origemBruta);

      // Verifica se há documento específico avulso daquele tipo no cofre (ex: se tem PDF de RG)
      const temDocAvulsoDesteTipo = docsDoTitular.some((d) => {
        const t = (d.tipo || '').toLowerCase();
        const tit = (d.titulo || '').toLowerCase();
        const c = campoId.toLowerCase();
        return t === c || tit.includes(c) || (d.apelidos || []).some((ap) => ap.toLowerCase() === c);
      });

      if (
        !temDocAvulsoDesteTipo &&
        origem.nome.toLowerCase() !== campoId.toLowerCase() &&
        camposAListar.length === 1
      ) {
        linhasResposta.push(
          ` - ${label}: ${valorFormatado} — extraído ${origem.prep} ${origem.nome}. Não há ${label} avulso anexado no cofre.`
        );
      } else {
        linhasResposta.push(` - ${label}: ${valorFormatado} — ${origem.prep} ${origem.nome}`);
      }
    } else {
      // Campo não conferido ou ausente -> "não cadastrado"
      linhasResposta.push(` - ${label}: não cadastrado`);
    }
  }

  // Se todos os campos foram omitidos por permissão
  if (linhasResposta.length === 0) {
    return `Não constam dados disponíveis para este titular.`;
  }

  let resposta = `Dados do ${primeiroNomeTitular}:\n${linhasResposta.join('\n')}`;

  // Oferece documentos disponíveis em anexo ao final se houver e se pediu múltiplos campos
  if (docsDoTitular.length > 0 && camposAListar.length > 1) {
    const nomesDocs = Array.from(
      new Set(
        docsDoTitular.map((d) => {
          const titLower = d.titulo.toLowerCase();
          if (titLower.includes('cnh')) return 'CNH';
          if (titLower.includes('certidao') || titLower.includes('certidão')) return 'Certidão de Casamento';
          if (titLower.includes('ctps')) return 'CTPS';
          return d.tipo || d.titulo;
        })
      )
    );
    resposta += `\n\nQuer algum documento em anexo? Tenho ${formatarListaItens(nomesDocs)} dele.`;
  }

  return resposta;
}
