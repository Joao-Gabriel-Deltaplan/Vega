import { getSupabaseClient } from './db/supabaseClient.js';
import {
  DocumentoFaltanteRegistro,
  StatusDocumentoFaltante,
} from './types.js';
import { obterTodosTitulares, resolverTitularCadastrado, registrarBuscaSemResultado } from './storage.js';

/**
 * Normaliza strings para comparação insensível a acentos e espaços
 */
function normalizar(texto?: string | null): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Formata o tipo de documento de forma legível e elegante (Title Case)
 */
export function formatarTipoDocumentoLegivel(tipo: string): string {
  if (!tipo) return 'Documento';
  const t = tipo.trim();
  // Siglas conhecidas mantidas em maiúsculas
  const siglas = ['cnh', 'rg', 'cpf', 'crea', 'crt', 'art', 'rrt', 'ctps', 'cnpj', 'dre'];
  if (siglas.includes(t.toLowerCase())) {
    return t.toUpperCase();
  }
  return t
    .split(/\s+/)
    .map((p) => {
      const pLow = p.toLowerCase();
      if (['de', 'da', 'do', 'das', 'dos', 'e'].includes(pLow)) return pLow;
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Registra uma solicitação de documento não encontrado no Cofre.
 * Se o pedido já existir para o mesmo titular e tipo, soma a contagem sem duplicar.
 */
export async function registrarOuIncrementarDocumentoFaltante(params: {
  tipoDocumento: string;
  titularInformado?: string | null;
  solicitanteNome: string;
  solicitanteContato?: string | null;
  dadosEquivalentesOferecidos?: string | null;
  textoDoPedido?: string;
}): Promise<DocumentoFaltanteRegistro> {
  const supabase = getSupabaseClient();
  const todosTitulares = await obterTodosTitulares();

  const titularResolvido = params.titularInformado
    ? resolverTitularCadastrado(params.titularInformado, todosTitulares)
    : null;

  const titularFinal = titularResolvido ? titularResolvido.nome : (params.titularInformado?.trim() || 'Titular Não Informado');
  const pessoaIdFinal = titularResolvido ? titularResolvido.id : null;
  const tipoFormatado = formatarTipoDocumentoLegivel(params.tipoDocumento || 'Documento');
  const tipoNorm = normalizar(tipoFormatado);

  const agoraIso = new Date().toISOString();

  try {
    // 1. Busca se já existe um registro correspondente
    let query = supabase.from('documentos_faltantes').select('*');
    if (pessoaIdFinal) {
      query = query.eq('pessoa_id', pessoaIdFinal);
    } else {
      query = query.ilike('titular', titularFinal);
    }

    const { data: existentes, error: errBusca } = await query;
    if (errBusca) {
      console.error('[Documentos Faltantes ⚠️] Erro ao buscar existentes:', errBusca);
    }

    const matchExistente = (existentes || []).find((reg: any) => {
      return normalizar(reg.tipo_documento) === tipoNorm;
    });

    if (matchExistente) {
      // Pedido repetido: incrementa a contagem e atualiza a data do último pedido
      const novaQtd = (matchExistente.quantidade_pedidos || 1) + 1;
      let solicitantes = matchExistente.solicitante_nome || '';
      if (params.solicitanteNome && !solicitantes.toLowerCase().includes(params.solicitanteNome.toLowerCase())) {
        solicitantes = `${solicitantes}, ${params.solicitanteNome}`;
      }

      const updates: any = {
        quantidade_pedidos: novaQtd,
        data_ultimo_pedido: agoraIso,
        solicitante_nome: solicitantes,
        atualizado_em: agoraIso,
      };

      if (params.dadosEquivalentesOferecidos) {
        updates.dados_equivalentes_oferecidos = params.dadosEquivalentesOferecidos;
      }

      // Se estava dispensado e foi pedido novamente, reabre como pendente
      if (matchExistente.status === 'dispensado') {
        updates.status = 'pendente';
        updates.observacao = matchExistente.observacao
          ? `${matchExistente.observacao} | Reaberto após novo pedido.`
          : 'Reaberto após novo pedido.';
      }

      await supabase
        .from('documentos_faltantes')
        .update(updates)
        .eq('id', matchExistente.id);

      console.log(`[Documentos Faltantes 📈] Incrementado pedido repetido "${tipoFormatado}" de "${titularFinal}". Total: ${novaQtd}`);

      // Telemetria histórica em buscas_sem_resultado
      await registrarBuscaSemResultado({
        contatoId: params.solicitanteContato || 'chat-interno',
        contatoNome: params.solicitanteNome,
        textoDoPedido: params.textoDoPedido || `${tipoFormatado} de ${titularFinal}`,
        motivo: 'inexistente_com_equivalente',
        iaAcionada: false,
        equivalenteOferecido: params.dadosEquivalentesOferecidos || undefined,
      }).catch(() => null);

      return {
        id: matchExistente.id,
        tipoDocumento: matchExistente.tipo_documento,
        titular: matchExistente.titular,
        pessoaId: matchExistente.pessoa_id,
        solicitanteNome: solicitantes,
        solicitanteContato: matchExistente.solicitante_contato,
        quantidadePedidos: novaQtd,
        dataPrimeiroPedido: matchExistente.data_primeiro_pedido,
        dataUltimoPedido: agoraIso,
        status: updates.status || matchExistente.status,
        observacao: updates.observacao || matchExistente.observacao,
        dadosEquivalentesOferecidos: params.dadosEquivalentesOferecidos || matchExistente.dados_equivalentes_oferecidos,
        criadoEm: matchExistente.criado_em,
        atualizadoEm: agoraIso,
      };
    }

    // 2. Novo pedido faltante
    const novoId = `faltante-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const novoRegistro = {
      id: novoId,
      tipo_documento: tipoFormatado,
      titular: titularFinal,
      pessoa_id: pessoaIdFinal,
      solicitante_nome: params.solicitanteNome,
      solicitante_contato: params.solicitanteContato || null,
      quantidade_pedidos: 1,
      data_primeiro_pedido: agoraIso,
      data_ultimo_pedido: agoraIso,
      status: 'pendente' as StatusDocumentoFaltante,
      observacao: null,
      dados_equivalentes_oferecidos: params.dadosEquivalentesOferecidos || null,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    };

    await supabase.from('documentos_faltantes').insert(novoRegistro);
    console.log(`[Documentos Faltantes 📝] Novo pedido faltante registrado: "${tipoFormatado}" de "${titularFinal}".`);

    // Telemetria histórica em buscas_sem_resultado
    await registrarBuscaSemResultado({
      contatoId: params.solicitanteContato || 'chat-interno',
      contatoNome: params.solicitanteNome,
      textoDoPedido: params.textoDoPedido || `${tipoFormatado} de ${titularFinal}`,
      motivo: 'inexistente_com_equivalente',
      iaAcionada: false,
      equivalenteOferecido: params.dadosEquivalentesOferecidos || undefined,
    }).catch(() => null);

    return {
      id: novoRegistro.id,
      tipoDocumento: novoRegistro.tipo_documento,
      titular: novoRegistro.titular,
      pessoaId: novoRegistro.pessoa_id,
      solicitanteNome: novoRegistro.solicitante_nome,
      solicitanteContato: novoRegistro.solicitante_contato,
      quantidadePedidos: 1,
      dataPrimeiroPedido: agoraIso,
      dataUltimoPedido: agoraIso,
      status: 'pendente',
      observacao: null,
      dadosEquivalentesOferecidos: novoRegistro.dados_equivalentes_oferecidos,
      criadoEm: agoraIso,
      atualizadoEm: agoraIso,
    };
  } catch (err) {
    console.error('[Documentos Faltantes ❌] Erro ao registrar documento faltante:', err);
    return {
      id: `err-${Date.now()}`,
      tipoDocumento: tipoFormatado,
      titular: titularFinal,
      pessoaId: pessoaIdFinal,
      solicitanteNome: params.solicitanteNome,
      quantidadePedidos: 1,
      dataPrimeiroPedido: agoraIso,
      dataUltimoPedido: agoraIso,
      status: 'pendente',
    };
  }
}

/**
 * Obtém todos os documentos faltantes ordenados pelos mais pedidos
 */
export async function obterDocumentosFaltantes(): Promise<DocumentoFaltanteRegistro[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('documentos_faltantes')
      .select('*')
      .order('quantidade_pedidos', { ascending: false })
      .order('data_ultimo_pedido', { ascending: false });

    if (error) {
      console.error('[Documentos Faltantes ⚠️] Erro ao obter lista:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      tipoDocumento: row.tipo_documento,
      titular: row.titular,
      pessoaId: row.pessoa_id,
      solicitanteNome: row.solicitante_nome,
      solicitanteContato: row.solicitante_contato,
      quantidadePedidos: Number(row.quantidade_pedidos || 1),
      dataPrimeiroPedido: row.data_primeiro_pedido,
      dataUltimoPedido: row.data_ultimo_pedido,
      status: row.status as StatusDocumentoFaltante,
      observacao: row.observacao,
      dadosEquivalentesOferecidos: row.dados_equivalentes_oferecidos,
      criadoEm: row.criado_em,
      atualizadoEm: row.atualizado_em,
    }));
  } catch (err) {
    console.error('[Documentos Faltantes ⚠️] Erro inesperado ao listar faltantes:', err);
    return [];
  }
}

/**
 * Atualiza status e observação de um documento faltante
 */
export async function atualizarStatusObservacaoFaltante(
  id: string,
  dados: {
    status?: StatusDocumentoFaltante;
    observacao?: string | null;
  }
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = {
      atualizado_em: new Date().toISOString(),
    };
    if (dados.status !== undefined) payload.status = dados.status;
    if (dados.observacao !== undefined) payload.observacao = dados.observacao;

    const { error } = await supabase
      .from('documentos_faltantes')
      .update(payload)
      .eq('id', id);

    if (error) {
      console.error('[Documentos Faltantes ⚠️] Erro ao atualizar item:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Documentos Faltantes ⚠️] Erro inesperado ao atualizar item:', err);
    return false;
  }
}

/**
 * Marca automaticamente documentos faltantes correspondentes como "providenciado"
 * quando um novo documento é adicionado ao Cofre.
 */
export async function marcarDocumentoFaltanteComoProvidenciado(
  tipoDocumento: string,
  pessoaId?: string | null,
  titularNome?: string | null
): Promise<number> {
  if (!tipoDocumento) return 0;

  try {
    const supabase = getSupabaseClient();
    const tipoNorm = normalizar(tipoDocumento);

    let query = supabase
      .from('documentos_faltantes')
      .select('*')
      .eq('status', 'pendente');

    if (pessoaId) {
      query = query.eq('pessoa_id', pessoaId);
    } else if (titularNome) {
      query = query.ilike('titular', titularNome);
    }

    const { data: pendentes, error } = await query;
    if (error || !pendentes || pendentes.length === 0) return 0;

    const dataAtualBr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    let atualizados = 0;

    for (const p of pendentes) {
      if (normalizar(p.tipo_documento) === tipoNorm || tipoNorm.includes(normalizar(p.tipo_documento))) {
        const obsAtual = p.observacao ? `${p.observacao} | ` : '';
        const novaObs = `${obsAtual}Providenciado automaticamente via upload no Cofre em ${dataAtualBr}.`;

        await supabase
          .from('documentos_faltantes')
          .update({
            status: 'providenciado',
            observacao: novaObs,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', p.id);

        atualizados++;
        console.log(`[Documentos Faltantes ✅] Item "${p.tipo_documento}" de "${p.titular}" marcado automaticamente como providenciado!`);
      }
    }

    return atualizados;
  } catch (err) {
    console.error('[Documentos Faltantes ⚠️] Erro ao marcar como providenciado:', err);
    return 0;
  }
}
