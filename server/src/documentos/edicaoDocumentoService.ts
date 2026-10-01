import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  obterTodosTitulares,
  obterTitularPorId,
  salvarOuAtualizarTitular,
  atualizarDocumento,
  resolverTitularCadastrado,
  obterTodosDocumentos,
} from '../storage.js';
import { DocumentoRegistro, FichaTitular } from '../types.js';
import { indexarDocumentoBackground } from '../indexador/indexadorAutomatico.js';

export interface CampoFichaAlimentado {
  chave: string;
  rotulo: string;
  valor: string;
  manual: boolean;
}

export interface TitularComCamposAlimentados {
  titularId: string;
  titularNome: string;
  campos: CampoFichaAlimentado[];
}

export interface InfoCamposFichaAlimentados {
  temCampos: boolean;
  titularesAfetados: TitularComCamposAlimentados[];
  mensagemResumo?: string;
}

export interface AtualizarDocumentoConsistenteParams {
  titulo?: string;
  tipo?: string;
  titular?: string;
  pessoaId?: string | null;
  dataValidade?: string | null;
  usuarioAlteracao?: string;
  acaoCamposFicha?: 'mover' | 'remover' | 'manter';
  silenciarAlertas?: boolean;
}

const ROTULOS_CAMPOS: Record<string, string> = {
  cpf: 'CPF',
  rg: 'RG',
  cnh: 'CNH',
  dataNascimento: 'Data de Nascimento',
  filiacao: 'Filiação',
  profissao: 'Profissão',
  estadoCivil: 'Estado Civil',
  endereco: 'Endereço',
  validadeCnh: 'Validade da CNH',
  categoriaCnh: 'Categoria da CNH',
  orgaoEmissor: 'Órgão Emissor',
  nacionalidade: 'Nacionalidade',
  naturalidade: 'Naturalidade',
  tituloEleitor: 'Título de Eleitor',
  pis: 'PIS/PASEP',
  reservista: 'Certificado de Reservista',
};

/**
 * Consulta quais fichas cadastrais possuem campos alimentados pelo documento especificado.
 */
export async function obterCamposAlimentadosPorDocumento(
  docId: string
): Promise<InfoCamposFichaAlimentados> {
  const todosTitulares = await obterTodosTitulares();
  const titularesAfetados: TitularComCamposAlimentados[] = [];

  for (const tit of todosTitulares) {
    const camposObj = tit.campos || {};
    const camposDoc: CampoFichaAlimentado[] = [];

    for (const [chave, dado] of Object.entries(camposObj)) {
      const campo = dado as any;
      if (campo && campo.origem === docId) {
        camposDoc.push({
          chave,
          rotulo: ROTULOS_CAMPOS[chave] || chave,
          valor: String(campo.valor || ''),
          manual: Boolean(campo.manual),
        });
      }
    }

    if (camposDoc.length > 0) {
      titularesAfetados.push({
        titularId: tit.id,
        titularNome: tit.nome,
        campos: camposDoc,
      });
    }
  }

  const temCampos = titularesAfetados.length > 0;
  let mensagemResumo: string | undefined;

  if (temCampos) {
    const nomesAfetados = titularesAfetados.map((t) => t.titularNome).join(', ');
    const camposNaoManuais = titularesAfetados
      .flatMap((t) => t.campos.filter((c) => !c.manual).map((c) => c.rotulo));
    const listaCamposTxt = Array.from(new Set(camposNaoManuais)).join(', ');

    if (listaCamposTxt) {
      mensagemResumo = `Este documento preencheu ${listaCamposTxt} na ficha de ${nomesAfetados}.`;
    }
  }

  return {
    temCampos,
    titularesAfetados,
    mensagemResumo,
  };
}

/**
 * Atualiza um documento garantindo consistência completa:
 * 1. Atualiza metadados (título, tipo, validade, titular).
 * 2. Atualiza titular/pessoa_id/corporativo na tabela `trechos` para a busca da VEGA refletir na hora.
 * 3. Gerencia campos da ficha cadastral (mover ou remover, respeitando manual: true).
 * 4. Remove selo 'titular_a_revisar'.
 * 5. Registra histórico de alteração no metadata.
 */
export async function atualizarDocumentoConsistente(
  docId: string,
  params: AtualizarDocumentoConsistenteParams
): Promise<DocumentoRegistro | null> {
  const supabase = getSupabaseClient();
  const todosTitulares = await obterTodosTitulares();
  const todosDocumentos = await obterTodosDocumentos();

  // Localiza documento existente
  const docExistente = todosDocumentos.find((d) => d.id === docId);
  if (!docExistente) {
    return null;
  }

  const alteracoesHistorico: string[] = [];
  const titularAnterior = docExistente.titular || 'Delta Plan';
  const pessoaIdAnterior = docExistente.pessoaId || docExistente.pessoa_id || null;

  // 1. Determina novo titular e pessoa_id
  let novoTitular = docExistente.titular;
  let novoPessoaId = pessoaIdAnterior;
  let ehCorporativo = docExistente.corporativo ?? false;

  if (params.titular !== undefined) {
    const tNome = params.titular.trim();
    const isEmpresa =
      !tNome ||
      tNome.toLowerCase().includes('delta') ||
      tNome.toLowerCase().includes('empresa') ||
      tNome.toLowerCase() === 'corporativo';

    if (isEmpresa) {
      novoTitular = 'Delta Plan';
      novoPessoaId = null;
      ehCorporativo = true;
    } else {
      const titResolvido =
        (params.pessoaId ? todosTitulares.find((t) => t.id === params.pessoaId) : null) ||
        resolverTitularCadastrado(tNome, todosTitulares);

      if (titResolvido) {
        novoTitular = titResolvido.nome;
        novoPessoaId = titResolvido.id;
        ehCorporativo = false;
      } else {
        novoTitular = tNome;
        novoPessoaId = params.pessoaId || null;
        ehCorporativo = false;
      }
    }

    if (novoTitular !== titularAnterior) {
      alteracoesHistorico.push(`Titular alterado de "${titularAnterior}" para "${novoTitular}"`);
    }
  }

  // 2. Atualiza trechos do documento no Supabase se houve mudança de titular
  if (novoTitular !== titularAnterior || novoPessoaId !== pessoaIdAnterior) {
    const { error: errTrechos } = await supabase
      .from('trechos')
      .update({
        pessoa_id: novoPessoaId,
        corporativo: ehCorporativo,
      })
      .eq('documento_id', docExistente.id);

    if (errTrechos) {
      console.warn(`[Edição Documento] Aviso ao atualizar trechos do doc ${docExistente.id}:`, errTrechos);
    }
  }

  // 3. Gerenciamento de campos da ficha cadastral
  const acaoCampos = params.acaoCamposFicha || 'manter';
  if ((acaoCampos === 'mover' || acaoCampos === 'remover') && novoTitular !== titularAnterior) {
    const infoCampos = await obterCamposAlimentadosPorDocumento(docExistente.id);

    if (infoCampos.temCampos) {
      for (const titAfetado of infoCampos.titularesAfetados) {
        const fichaAntiga = await obterTitularPorId(titAfetado.titularId);
        if (!fichaAntiga) continue;

        const camposAntigos: Record<string, any> = { ...(fichaAntiga.campos || {}) };
        const camposParaMover: Record<string, any> = {};
        let teveRemocao = false;

        for (const c of titAfetado.campos) {
          // REGRA MANDATÓRIA: Campos manuais NUNCA são mexidos!
          if (c.manual) continue;

          if (camposAntigos[c.chave]) {
            camposParaMover[c.chave] = camposAntigos[c.chave];
            delete camposAntigos[c.chave];
            teveRemocao = true;
          }
        }

        if (teveRemocao) {
          fichaAntiga.campos = camposAntigos;
          await salvarOuAtualizarTitular(fichaAntiga);
          alteracoesHistorico.push(
            `Campos removidos da ficha de "${titAfetado.titularNome}": ${Object.keys(camposParaMover).join(', ')}`
          );
        }

        // Se a ação for mover e o novo titular for pessoa física cadastrada
        if (acaoCampos === 'mover' && novoPessoaId && Object.keys(camposParaMover).length > 0) {
          const fichaNova = await obterTitularPorId(novoPessoaId);
          if (fichaNova) {
            fichaNova.campos = {
              ...(fichaNova.campos || {}),
              ...camposParaMover,
            };
            await salvarOuAtualizarTitular(fichaNova);
            alteracoesHistorico.push(
              `Campos movidos para a ficha de "${fichaNova.nome}": ${Object.keys(camposParaMover).join(', ')}`
            );
          }
        }
      }
    }
  }

  // 4. Verificação de Título, Tipo e Validade
  if (params.titulo !== undefined && params.titulo.trim() !== docExistente.titulo) {
    alteracoesHistorico.push(`Título alterado de "${docExistente.titulo}" para "${params.titulo.trim()}"`);
  }
  if (params.tipo !== undefined && params.tipo.trim() !== docExistente.tipo) {
    alteracoesHistorico.push(`Tipo alterado de "${docExistente.tipo}" para "${params.tipo.trim()}"`);
  }
  if (params.dataValidade !== undefined && params.dataValidade !== docExistente.dataValidade) {
    alteracoesHistorico.push(
      `Validade alterada de "${docExistente.dataValidade || 'Sem validade'}" para "${params.dataValidade || 'Sem validade'}"`
    );
  }

  // 5. Metadados e Histórico de Alterações
  const metaAtual = { ...(docExistente.metadata || {}) };

  // Remove o selo "Titular a revisar"
  if (metaAtual.alertaTitular === 'titular_a_revisar') {
    delete metaAtual.alertaTitular;
    delete metaAtual.donoProvavel;
    alteracoesHistorico.push('Selo "Titular a revisar" removido e conferido pelo usuário.');
  }

  const agoraIso = new Date().toISOString();
  const historicoAntigo: any[] = Array.isArray(metaAtual.historicoAlteracoes)
    ? metaAtual.historicoAlteracoes
    : [];

  if (alteracoesHistorico.length > 0) {
    historicoAntigo.push({
      dataHora: agoraIso,
      usuario: params.usuarioAlteracao || 'Painel do Cofre',
      detalhes: alteracoesHistorico,
    });
  }
  metaAtual.historicoAlteracoes = historicoAntigo;

  // 6. Atualiza o documento no Supabase
  const payloadAtualizacao: Partial<DocumentoRegistro> = {
    titulo: params.titulo !== undefined ? params.titulo.trim() : docExistente.titulo,
    tipo: params.tipo !== undefined ? params.tipo.trim() : docExistente.tipo,
    titular: novoTitular,
    pessoaId: novoPessoaId || undefined,
    corporativo: ehCorporativo,
    metadata: metaAtual,
  };

  if (params.dataValidade !== undefined) {
    payloadAtualizacao.dataValidade = params.dataValidade ? String(params.dataValidade).trim() : null;
    payloadAtualizacao.origemValidade = 'manual';
  }

  if (params.silenciarAlertas !== undefined) {
    payloadAtualizacao.silenciarAlertas = Boolean(params.silenciarAlertas);
  }

  const docAtualizado = await atualizarDocumento(docExistente.id, payloadAtualizacao);

  if (docAtualizado) {
    // Reindexação assíncrona leve em background para manter sincronia de embeddings
    try {
      indexarDocumentoBackground(docAtualizado);
    } catch {}
  }

  return docAtualizado;
}
