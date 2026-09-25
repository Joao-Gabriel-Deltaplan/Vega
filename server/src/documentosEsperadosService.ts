import { getSupabaseClient } from './db/supabaseClient.js';
import {
  DocumentoEsperado,
  DocumentoEsperadoDispensa,
  CategoriaDocumentoEsperado,
  ChecklistTitularResultado,
  ItemChecklistDocumento,
  SituacaoChecklistDocumento,
  DocumentoRegistro,
  FichaTitular,
  DocumentoFaltanteRegistro,
} from './types.js';
import {
  obterTodosDocumentos,
  obterTodosTitulares,
  obterTitularPorId,
} from './storage.js';
import { obterDocumentosFaltantes } from './documentosFaltantesService.js';
import { obterAgoraIsoUtc } from './utils/dataHoraUtils.js';

/**
 * Normaliza textos para comparação sem acentos, pontuação ou espaços duplicados.
 */
function normalizar(texto?: string | null): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapeia termos e equivalências para reconhecer o documento no Cofre.
 */
const EQUIVALENCIAS_DOCUMENTOS: Record<string, string[]> = {
  rg: ['rg', 'identidade', 'registro geral', 'cedula de identidade', 'carteira de identidade'],
  cpf: ['cpf', 'cadastro de pessoa fisica'],
  cnh: ['cnh', 'habilitacao', 'carteira nacional de habilitacao', 'cnh digital'],
  'comprovante de residencia': [
    'comprovante de residencia',
    'comprovante de endereco',
    'residencia',
    'endereco',
    'conta de luz',
    'conta de agua',
    'energia',
    'fatura',
  ],
  'certidao nascimento ou casamento': [
    'certidao de nascimento',
    'certidao de casamento',
    'certidao nascimento',
    'certidao casamento',
    'certidao',
  ],
  'titulo de eleitor': ['titulo de eleitor', 'titulo eleitoral', 'titulo'],
  ctps: ['ctps', 'carteira de trabalho', 'carteira profissional', 'trabalho e previdencia'],
  'pis pasep': ['pis', 'pasep', 'pis pasep', 'extrato pis', 'cartao cidadao'],
  passaporte: ['passaporte'],
  'certificado de reservista': ['reservista', 'certificado de reservista', 'dispensa militar', 'alistamento'],
  'diploma ou certificado de formacao': ['diploma', 'certificado', 'graduacao', 'escolaridade', 'formacao'],
  'registro profissional crea crt crm etc': ['crea', 'crt', 'crm', 'cau', 'oab', 'registro profissional', 'anuidade crea'],
  'declaracao de imposto de renda': ['imposto de renda', 'irpf', 'declaracao ir', 'recibo irpf', 'dirpf'],
  'cartao de vacinas': ['vacina', 'vacinacao', 'cartao de vacina', 'imunizacao', 'covid'],
  'certidao negativa de debitos': ['cnd', 'certidao negativa', 'certidao de debitos', 'quitacao'],
  'comprovante de conta bancaria': ['conta bancaria', 'comprovante bancario', 'extrato bancario', 'dados bancarios'],
  'contrato social e alteracoes': ['contrato social', 'alteracao contratual', 'estatuto social', 'ato constitutivo'],
  'cartao cnpj': ['cartao cnpj', 'cnpj', 'comprovante cnpj', 'inscricao cadastral'],
  'inscricao estadual ou municipal': ['inscricao estadual', 'inscricao municipal', 'deca', 'ie', 'im'],
  'alvara de funcionamento': ['alvara', 'alvara de funcionamento', 'licenca de funcionamento', 'habite se'],
  'certidao negativa federal': ['cnd federal', 'certidao federal', 'receita federal', 'tributos federais'],
  'certidao negativa estadual': ['cnd estadual', 'certidao estadual', 'fazenda estadual', 'sefaz'],
  'certidao negativa municipal': ['cnd municipal', 'certidao municipal', 'prefeitura', 'tributos municipais'],
  'certidao negativa trabalhista cndt': ['cndt', 'trabalhista', 'certidao trabalhista', 'justica do trabalho'],
  'certificado de regularidade do fgts': ['crf', 'fgts', 'regularidade do fgts', 'caixa fgts'],
  'certidao do crea da empresa': ['crea empresa', 'registro crea', 'anuidade empresa crea'],
  'apolices de seguro': ['apolice', 'seguro', 'seguro de vida', 'seguro garantia'],
  procuracoes: ['procuracao', 'substabelecimento'],
  'atestados de capacidade tecnica': ['capacidade tecnica', 'atestado tecnico', 'art', 'rrt', 'acervo tecnico'],
  'balanco patrimonial': ['balanco', 'balanco patrimonial', 'dre', 'demonstracoes financeiras'],
  'licencas ambientais': ['licenca ambiental', 'licenciamento', 'ibama', 'cetesb', 'lp', 'li', 'lo'],
};

/**
 * 1. Obter todos os documentos esperados cadastrados no Supabase
 */
export async function obterDocumentosEsperados(apenasAtivos = false): Promise<DocumentoEsperado[]> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('documentos_esperados')
      .select('*')
      .order('categoria', { ascending: true })
      .order('ordem', { ascending: true });

    if (apenasAtivos) {
      query = query.eq('ativo', true);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Documentos Esperados ⚠️] Erro ao consultar lista:', error);
      return [];
    }

    return (data || []).map((d: any) => ({
      id: d.id,
      nome: d.nome,
      categoria: d.categoria as CategoriaDocumentoEsperado,
      obrigatorio: Boolean(d.obrigatorio),
      camposFornecidos: Array.isArray(d.campos_fornecidos) ? d.campos_fornecidos : [],
      ativo: Boolean(d.ativo),
      ordem: Number(d.ordem) || 0,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  } catch (err) {
    console.error('[Documentos Esperados ⚠️] Falha ao consultar Supabase:', err);
    return [];
  }
}

/**
 * 2. Salvar ou criar um novo documento esperado
 */
export async function salvarDocumentoEsperado(
  dados: Partial<DocumentoEsperado>
): Promise<DocumentoEsperado | null> {
  try {
    const supabase = getSupabaseClient();
    const nome = (dados.nome || '').trim();
    if (!nome) throw new Error('Nome do documento é obrigatório.');

    const categoria: CategoriaDocumentoEsperado = dados.categoria === 'PJ' ? 'PJ' : 'PF';
    const id = dados.id || `doc-esp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    let ordem = dados.ordem;
    if (typeof ordem !== 'number') {
      const existentes = await obterDocumentosEsperados();
      const daCategoria = existentes.filter((d) => d.categoria === categoria);
      ordem = daCategoria.length > 0 ? Math.max(...daCategoria.map((d) => d.ordem)) + 1 : 1;
    }

    const payload = {
      id,
      nome,
      categoria,
      obrigatorio: dados.obrigatorio !== false,
      campos_fornecidos: Array.isArray(dados.camposFornecidos) ? dados.camposFornecidos : [],
      ativo: dados.ativo !== false,
      ordem,
      updated_at: obterAgoraIsoUtc(),
    };

    const { data, error } = await supabase
      .from('documentos_esperados')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[Documentos Esperados ⚠️] Erro ao salvar:', error);
      return null;
    }

    return {
      id: data.id,
      nome: data.nome,
      categoria: data.categoria,
      obrigatorio: data.obrigatorio,
      camposFornecidos: data.campos_fornecidos || [],
      ativo: data.ativo,
      ordem: data.ordem,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err) {
    console.error('[Documentos Esperados ⚠️] Erro ao salvar documento esperado:', err);
    return null;
  }
}

/**
 * 3. Atualizar documento esperado
 */
export async function atualizarDocumentoEsperado(
  id: string,
  updates: Partial<DocumentoEsperado>
): Promise<DocumentoEsperado | null> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = { updated_at: obterAgoraIsoUtc() };

    if (updates.nome !== undefined) payload.nome = updates.nome.trim();
    if (updates.categoria !== undefined) payload.categoria = updates.categoria;
    if (updates.obrigatorio !== undefined) payload.obrigatorio = Boolean(updates.obrigatorio);
    if (updates.camposFornecidos !== undefined) payload.campos_fornecidos = updates.camposFornecidos;
    if (updates.ativo !== undefined) payload.ativo = Boolean(updates.ativo);
    if (updates.ordem !== undefined) payload.ordem = Number(updates.ordem);

    const { data, error } = await supabase
      .from('documentos_esperados')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      console.error(`[Documentos Esperados ⚠️] Erro ao atualizar ${id}:`, error);
      return null;
    }

    return {
      id: data.id,
      nome: data.nome,
      categoria: data.categoria,
      obrigatorio: data.obrigatorio,
      camposFornecidos: data.campos_fornecidos || [],
      ativo: data.ativo,
      ordem: data.ordem,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err) {
    console.error(`[Documentos Esperados ⚠️] Falha ao atualizar ${id}:`, err);
    return null;
  }
}

/**
 * 4. Excluir documento esperado
 */
export async function excluirDocumentoEsperado(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('documentos_esperados').delete().eq('id', id);
    if (error) {
      console.error(`[Documentos Esperados ⚠️] Erro ao excluir ${id}:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Documentos Esperados ⚠️] Falha ao excluir ${id}:`, err);
    return false;
  }
}

/**
 * 5. Reordenar documentos esperados
 */
export async function reordenarDocumentosEsperados(idsOrdenados: string[]): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    for (let i = 0; i < idsOrdenados.length; i++) {
      await supabase
        .from('documentos_esperados')
        .update({ ordem: i + 1, updated_at: obterAgoraIsoUtc() })
        .eq('id', idsOrdenados[i]);
    }
    return true;
  } catch (err) {
    console.error('[Documentos Esperados ⚠️] Erro ao reordenar:', err);
    return false;
  }
}

/**
 * 6. Obter lista de dispensas ("Não se aplica")
 */
export async function obterDispensas(titularId?: string): Promise<DocumentoEsperadoDispensa[]> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase.from('documentos_esperados_dispensas').select('*');
    if (titularId) {
      query = query.eq('titular_id', titularId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[Dispensas ⚠️] Erro ao consultar dispensas:', error);
      return [];
    }

    return (data || []).map((d: any) => ({
      id: d.id,
      titularId: d.titular_id,
      documentoEsperadoId: d.documento_esperado_id,
      motivo: d.motivo,
      criadoEm: d.criado_em,
    }));
  } catch (err) {
    console.error('[Dispensas ⚠️] Falha ao consultar Supabase:', err);
    return [];
  }
}

/**
 * 7. Marcar item como "não se aplica" para um titular com justificativa/observação
 */
export async function marcarNaoSeAplica(
  titularId: string,
  documentoEsperadoId: string,
  motivo?: string
): Promise<DocumentoEsperadoDispensa | null> {
  try {
    const supabase = getSupabaseClient();
    const id = `disp-${titularId}-${documentoEsperadoId}`;
    const payload = {
      id,
      titular_id: titularId,
      documento_esperado_id: documentoEsperadoId,
      motivo: motivo ? motivo.trim() : null,
      criado_em: obterAgoraIsoUtc(),
    };

    const { data, error } = await supabase
      .from('documentos_esperados_dispensas')
      .upsert(payload, { onConflict: 'titular_id,documento_esperado_id' })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[Dispensas ⚠️] Erro ao marcar dispensa:', error);
      return null;
    }

    return {
      id: data.id,
      titularId: data.titular_id,
      documentoEsperadoId: data.documento_esperado_id,
      motivo: data.motivo,
      criadoEm: data.criado_em,
    };
  } catch (err) {
    console.error('[Dispensas ⚠️] Falha ao marcar dispensa:', err);
    return null;
  }
}

/**
 * 8. Remover marcação de "não se aplica" (reativar item para o titular)
 */
export async function removerNaoSeAplica(
  titularId: string,
  documentoEsperadoId: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('documentos_esperados_dispensas')
      .delete()
      .eq('titular_id', titularId)
      .eq('documento_esperado_id', documentoEsperadoId);

    if (error) {
      console.error('[Dispensas ⚠️] Erro ao remover dispensa:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Dispensas ⚠️] Falha ao remover dispensa:', err);
    return false;
  }
}

/**
 * Determina dinamicamente se o titular cadastrado é Pessoa Física ou Jurídica.
 */
export function determinarCategoriaTitular(
  titular: FichaTitular,
  documentosDoTitular: DocumentoRegistro[] = []
): CategoriaDocumentoEsperado {
  // 1. Se tem CNPJ preenchido na ficha cadastral
  const camposQualquer = titular.campos as Record<string, any> | undefined;
  if (camposQualquer?.cnpj?.valor && String(camposQualquer.cnpj.valor).trim().length > 0) {
    return 'PJ';
  }

  // 2. Se o nome ou apelido contém termos inequívocos de PJ
  const nomeNorm = normalizar(titular.nome);
  const regexPj = /\b(ltda|eireli|s a|sa|me|epp|engenharia|servicos|construcoes|planejamento|assessoria|consultoria|empresa|grupo)\b/i;
  if (regexPj.test(nomeNorm)) {
    return 'PJ';
  }

  // 3. Se algum documento do cofre vinculado é típico de PJ
  for (const doc of documentosDoTitular) {
    const docNorm = normalizar(`${doc.titulo} ${doc.tipo} ${doc.arquivo}`);
    if (
      docNorm.includes('contrato social') ||
      docNorm.includes('cartao cnpj') ||
      docNorm.includes('alvara de funcionamento') ||
      docNorm.includes('inscricao estadual')
    ) {
      return 'PJ';
    }
  }

  return 'PF';
}

/**
 * Verifica se um documento do Cofre corresponde ao Documento Esperado
 */
export function cruzarDocumentoComCofre(
  docEsperado: DocumentoEsperado,
  docsDoTitular: DocumentoRegistro[]
): DocumentoRegistro | null {
  const nomeEspNorm = normalizar(docEsperado.nome);

  // Busca termos correspondentes no mapa de equivalências
  let termosChave: string[] = [nomeEspNorm];
  for (const [chave, equivalentes] of Object.entries(EQUIVALENCIAS_DOCUMENTOS)) {
    if (nomeEspNorm.includes(chave) || chave.includes(nomeEspNorm)) {
      termosChave = Array.from(new Set([...termosChave, ...equivalentes.map(normalizar)]));
    }
  }

  for (const doc of docsDoTitular) {
    const titDoc = normalizar(doc.titulo);
    const tipoDoc = normalizar(doc.tipo);
    const arqDoc = normalizar(doc.arquivo);
    const textoDoc = `${titDoc} ${tipoDoc} ${arqDoc}`;

    // Caso de correspondência exata ou de raiz
    for (const termo of termosChave) {
      if (!termo || termo.length < 2) continue;

      if (termo === 'rg') {
        if (/\brg\b|\bidentidade\b/i.test(textoDoc) && !/\bcnh\b/i.test(textoDoc)) {
          return doc;
        }
      } else if (termo === 'cpf') {
        if (/\bcpf\b/i.test(textoDoc) && !/\bcnh\b/i.test(textoDoc)) {
          return doc;
        }
      } else if (termo === 'cnh') {
        if (/\bcnh\b|\bhabilitacao\b/i.test(textoDoc)) {
          return doc;
        }
      } else if (termo === 'crea') {
        if (/\bcrea\b/i.test(textoDoc)) {
          return doc;
        }
      } else if (termo === 'crt') {
        if (/\bcrt\b/i.test(textoDoc)) {
          return doc;
        }
      } else if (textoDoc.includes(termo)) {
        return doc;
      }
    }
  }

  return null;
}

/**
 * Verifica se os campos que o documento forneceria já existem preenchidos na ficha cadastral
 */
export function cruzarCamposComFicha(
  docEsperado: DocumentoEsperado,
  camposFicha: Record<string, any> = {}
): Array<{ campo: string; valor: string; origem?: string; origemNome?: string }> | null {
  if (!docEsperado.camposFornecidos || docEsperado.camposFornecidos.length === 0) {
    return null;
  }

  const dadosEncontrados: Array<{ campo: string; valor: string; origem?: string; origemNome?: string }> = [];

  // Mapeamento dos campos essenciais por documento
  const camposPrincipais: Record<string, string[]> = {
    'pf-obr-rg': ['rg'],
    'pf-obr-cpf': ['cpf'],
    'pf-obr-cnh': ['cnh'],
    'pf-obr-comp-residencia': ['endereco'],
    'pf-obr-certidao': ['estadoCivil', 'filiacao'],
    'pf-obr-titulo': ['tituloEleitor', 'titulo'],
    'pf-obr-ctps': ['ctps'],
    'pf-obr-pis': ['pis', 'pisPasep'],
    'pj-obr-contrato': ['razaoSocial', 'socios'],
    'pj-obr-cnpj': ['cnpj'],
    'pj-obr-inscricao': ['inscricaoEstadual', 'inscricaoMunicipal'],
    'pj-obr-alvara': ['alvara'],
  };

  const chavesParaBuscar = camposPrincipais[docEsperado.id] || docEsperado.camposFornecidos;
  let achouPrincipal = false;

  for (const chave of chavesParaBuscar) {
    const campoObj = camposFicha[chave];
    if (campoObj && typeof campoObj.valor === 'string' && campoObj.valor.trim().length > 0) {
      achouPrincipal = true;
      dadosEncontrados.push({
        campo: chave,
        valor: campoObj.valor.trim(),
        origem: campoObj.origem || 'Ficha cadastral',
        origemNome: campoObj.origemNome || 'Documento anterior',
      });
    }
  }

  return achouPrincipal && dadosEncontrados.length > 0 ? dadosEncontrados : null;
}

/**
 * 9. Calcula o checklist completo para um titular específico
 */
export async function calcularChecklistTitular(
  titularId: string,
  categoriaForcada?: CategoriaDocumentoEsperado
): Promise<ChecklistTitularResultado | null> {
  const titular = await obterTitularPorId(titularId);
  if (!titular) return null;

  const todosDocs = await obterTodosDocumentos();
  const docsDoTitular = todosDocs.filter(
    (d) => d.pessoaId === titularId || normalizar(d.titular) === normalizar(titular.nome)
  );

  const categoria = categoriaForcada || determinarCategoriaTitular(titular, docsDoTitular);
  const documentosEsperados = await obterDocumentosEsperados(true);
  const docsEsperadosCategoria = documentosEsperados.filter((d) => d.categoria === categoria);

  const dispensas = await obterDispensas(titularId);
  const mapaDispensas = new Map(dispensas.map((disp) => [disp.documentoEsperadoId, disp]));

  const todosFaltantes = await obterDocumentosFaltantes();
  const documentosFaltantes = todosFaltantes.filter((df: DocumentoFaltanteRegistro) => df.status === 'pendente');
  const faltantesDoTitular = documentosFaltantes.filter(
    (df: DocumentoFaltanteRegistro) => df.pessoaId === titularId || normalizar(df.titular) === normalizar(titular.nome)
  );

  const itens: ItemChecklistDocumento[] = [];

  for (const docEsp of docsEsperadosCategoria) {
    // 1. Verifica se está marcado como "não se aplica"
    const dispensa = mapaDispensas.get(docEsp.id);
    if (dispensa) {
      itens.push({
        documentoEsperado: docEsp,
        situacao: 'nao_se_aplica',
        dispensa: {
          id: dispensa.id,
          motivo: dispensa.motivo,
          criadoEm: dispensa.criadoEm,
        },
      });
      continue;
    }

    // 2. Verifica se existe o arquivo no Cofre
    const docCofre = cruzarDocumentoComCofre(docEsp, docsDoTitular);
    if (docCofre) {
      itens.push({
        documentoEsperado: docEsp,
        situacao: 'completo',
        documentoCofre: {
          id: docCofre.id,
          titulo: docCofre.titulo,
          arquivo: docCofre.arquivo,
          tipo: docCofre.tipo,
          dataCadastro: docCofre.dataCadastro,
        },
      });
      continue;
    }

    // 3. Verifica se os campos que esse documento fornece constam na ficha
    const dadosFicha = cruzarCamposComFicha(docEsp, titular.campos || {});
    if (dadosFicha && dadosFicha.length > 0) {
      // Verifica se houve pedido no WhatsApp
      const faltanteWa = faltantesDoTitular.find((df: DocumentoFaltanteRegistro) => {
        const tipoNorm = normalizar(df.tipoDocumento);
        const espNorm = normalizar(docEsp.nome);
        return tipoNorm.includes(espNorm) || espNorm.includes(tipoNorm);
      });

      itens.push({
        documentoEsperado: docEsp,
        situacao: 'so_o_dado',
        dadosFicha,
        solicitadoNoWhatsApp: Boolean(faltanteWa),
        quantidadePedidosWhatsApp: faltanteWa?.quantidadePedidos || 0,
        dataUltimoPedidoWhatsApp: faltanteWa?.dataUltimoPedido,
        prioridade: Boolean(faltanteWa),
      });
      continue;
    }

    // 4. Caso contrário: FALTANDO
    const faltanteWa = faltantesDoTitular.find((df: DocumentoFaltanteRegistro) => {
      const tipoNorm = normalizar(df.tipoDocumento);
      const espNorm = normalizar(docEsp.nome);
      return tipoNorm.includes(espNorm) || espNorm.includes(tipoNorm);
    });

    itens.push({
      documentoEsperado: docEsp,
      situacao: 'faltando',
      solicitadoNoWhatsApp: Boolean(faltanteWa),
      quantidadePedidosWhatsApp: faltanteWa?.quantidadePedidos || 0,
      dataUltimoPedidoWhatsApp: faltanteWa?.dataUltimoPedido,
      prioridade: Boolean(faltanteWa),
    });
  }

  // Estatísticas e Métricas
  const totalEsperados = itens.length;
  const dispensados = itens.filter((i) => i.situacao === 'nao_se_aplica').length;
  const totalAplicaveis = Math.max(1, totalEsperados - dispensados);

  const completos = itens.filter((i) => i.situacao === 'completo').length;
  const soODado = itens.filter((i) => i.situacao === 'so_o_dado').length;
  const faltando = itens.filter((i) => i.situacao === 'faltando').length;
  const prioritarios = itens.filter((i) => i.prioridade).length;

  const percentualArquivos = Math.round((completos / totalAplicaveis) * 100);
  const percentualCompletude = Math.round(((completos + soODado) / totalAplicaveis) * 100);
  const textoCompletude = `${completos} de ${totalAplicaveis} documentos`;

  return {
    titular: {
      id: titular.id,
      nome: titular.nome,
      apelidos: titular.apelidos,
      categoria,
    },
    itens,
    estatisticas: {
      totalEsperados,
      totalAplicaveis,
      completos,
      soODado,
      faltando,
      dispensados,
      prioritarios,
      percentualCompletude,
      percentualArquivos,
      textoCompletude,
    },
  };
}

/**
 * 10. Obter resumo consolidado de checklists de todos os titulares
 */
export async function obterChecklistTodosTitulares(): Promise<ChecklistTitularResultado[]> {
  const titulares = await obterTodosTitulares();
  const resultados: ChecklistTitularResultado[] = [];

  for (const t of titulares) {
    const checklist = await calcularChecklistTitular(t.id);
    if (checklist) {
      resultados.push(checklist);
    }
  }

  return resultados;
}
