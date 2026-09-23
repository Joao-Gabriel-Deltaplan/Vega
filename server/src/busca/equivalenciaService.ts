import { DocumentoRegistro } from '../types.js';

export interface SugestaoDadoEquivalente {
  dadoNome: string;
  documentoFonte: string;
  fraseOferta: string;
}

/**
 * Determina o artigo definido correto para o tipo de documento em português
 */
export function obterArtigoDefinido(tipo: string): 'o' | 'a' {
  const t = tipo.trim().toLowerCase();
  // Documentos femininos típicos
  if (
    t.includes('certidão') ||
    t.includes('cnh') ||
    t.includes('carteira') ||
    t.includes('procuração') ||
    t.includes('declaração') ||
    t.includes('art') ||
    t.includes('rrt') ||
    t.includes('nota fiscal') ||
    t.includes('folha')
  ) {
    return 'a';
  }
  return 'o';
}

/**
 * Determina a preposição correta para o titular ('do' ou 'da')
 */
export function obterPreposicaoTitular(titular: string): 'do' | 'da' {
  const t = titular.trim().toLowerCase();
  if (
    t.includes('empresa') ||
    t.includes('delta') ||
    t.includes('reng') ||
    t.includes('ltda') ||
    t.includes('eletroloc')
  ) {
    return 'da';
  }
  return 'do';
}

/**
 * Verifica estritamente se o dado que o usuário provavelmente quer com o documento pedido
 * existe de fato em outro documento daquele titular no Cofre.
 * 
 * Regra do projeto: "Só ofereça o dado se ele realmente existir nos documentos; nunca prometa o que não tem."
 */
export function verificarDadoDisponivelEmOutroDocumento(
  tipoPedido: string,
  docsDoTitular: DocumentoRegistro[]
): SugestaoDadoEquivalente | null {
  if (!tipoPedido || !docsDoTitular || docsDoTitular.length === 0) {
    return null;
  }

  const tipoNorm = tipoPedido
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Pedido de Certidão de Nascimento
  if (tipoNorm.includes('nascimento') || tipoNorm.includes('certidao de nascimento')) {
    // Procura se o titular tem CNH no cofre
    const cnhDoc = docsDoTitular.find(
      (d) =>
        d.tipo?.toLowerCase() === 'cnh' ||
        d.titulo.toLowerCase().includes('cnh') ||
        d.arquivo.toLowerCase().includes('cnh')
    );
    if (cnhDoc) {
      return {
        dadoNome: 'data de nascimento',
        documentoFonte: 'CNH',
        fraseOferta: 'Se precisar só da data de nascimento, ela consta na CNH. Quer que eu informe?',
      };
    }

    // Se não tem CNH, mas tem Passaporte
    const passaporteDoc = docsDoTitular.find(
      (d) =>
        d.tipo?.toLowerCase().includes('passaporte') ||
        d.titulo.toLowerCase().includes('passaporte')
    );
    if (passaporteDoc) {
      return {
        dadoNome: 'data de nascimento',
        documentoFonte: 'Passaporte',
        fraseOferta: 'Se precisar só da data de nascimento, ela consta no Passaporte. Quer que eu informe?',
      };
    }

    // Se não tem CNH nem Passaporte, mas tem Certificado de Dispensa Militar
    const dispensaDoc = docsDoTitular.find(
      (d) =>
        d.titulo.toLowerCase().includes('dispensa') ||
        d.tipo?.toLowerCase().includes('dispensa')
    );
    if (dispensaDoc) {
      return {
        dadoNome: 'data de nascimento',
        documentoFonte: 'Certificado de Dispensa',
        fraseOferta: 'Se precisar só da data de nascimento, ela consta no Certificado de Dispensa. Quer que eu informe?',
      };
    }
  }

  // 2. Pedido de Comprovante de Residência ou Endereço
  if (
    tipoNorm.includes('residencia') ||
    tipoNorm.includes('endereco') ||
    tipoNorm.includes('comprovante de residencia')
  ) {
    const docDados = docsDoTitular.find(
      (d) =>
        d.titulo.toLowerCase().includes('dados') ||
        d.titulo.toLowerCase().includes('residencia')
    );
    if (docDados) {
      return {
        dadoNome: 'endereço',
        documentoFonte: docDados.titulo,
        fraseOferta: `Se precisar só do endereço, ele consta no documento ${docDados.titulo}. Quer que eu informe?`,
      };
    }
  }

  // 3. Pedido de Título de Eleitor
  if (tipoNorm.includes('eleitor') || tipoNorm.includes('titulo')) {
    const docDados = docsDoTitular.find((d) => d.titulo.toLowerCase().includes('dados'));
    if (docDados) {
      return {
        dadoNome: 'número do título de eleitor',
        documentoFonte: docDados.titulo,
        fraseOferta: `Se precisar só do número do título de eleitor, ele consta no documento ${docDados.titulo}. Quer que eu informe?`,
      };
    }
  }

  // Nenhum dado equivalente comprovado existe nos documentos do titular
  return null;
}
