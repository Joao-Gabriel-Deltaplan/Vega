import {
  DocumentoRegistro,
  AlertaVencimento,
  StatusAlertaVencimento,
  PrazoAlerta,
} from '../types.js';
import {
  obterTodosDocumentos,
  obterTodosTitulares,
  atualizarDocumento,
} from '../storage.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  obterAgoraBrasilia,
  obterAgoraIsoUtc,
} from '../utils/dataHoraUtils.js';

/**
 * Lê todos os alertas gravados na tabela alertas_vencimento do Supabase
 */
export async function obterTodosAlertas(): Promise<AlertaVencimento[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('alertas_vencimento')
      .select('*')
      .order('data_geracao', { ascending: false });

    if (error) {
      console.error('[Alertas Supabase ⚠️] Erro ao obter alertas:', error);
      return [];
    }

    return (data || []).map((a: any) => ({
      id: a.id,
      documentoId: a.documento_id,
      documentoTitulo: a.documento_titulo,
      titular: a.titular,
      dataValidade: a.data_validade,
      diasRestantes: a.dias_restantes,
      status: a.status as StatusAlertaVencimento,
      prazoAlerta: (isNaN(Number(a.prazo_alerta)) ? a.prazo_alerta : Number(a.prazo_alerta)) as PrazoAlerta,
      dataGeracao: a.data_geracao,
      lido: Boolean(a.lido),
      notificadoWhatsApp: Boolean(a.notificado_whatsapp),
    }));
  } catch (err) {
    console.error('[Alertas Supabase ⚠️] Erro ao consultar alertas:', err);
    return [];
  }
}

/**
 * Salva a lista de alertas na tabela alertas_vencimento do Supabase
 */
export async function salvarAlertas(alertas: AlertaVencimento[]): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const registros = alertas.map((a) => ({
      id: a.id,
      documento_id: a.documentoId,
      documento_titulo: a.documentoTitulo,
      titular: a.titular || null,
      data_validade: a.dataValidade,
      dias_restantes: a.diasRestantes,
      status: a.status,
      prazo_alerta: String(a.prazoAlerta),
      data_geracao: a.dataGeracao || new Date().toISOString(),
      lido: Boolean(a.lido),
      notificado_whatsapp: Boolean(a.notificadoWhatsApp),
    }));

    const { error } = await supabase
      .from('alertas_vencimento')
      .upsert(registros, { onConflict: 'id' });

    if (error) {
      console.error('[Alertas Supabase ⚠️] Erro ao salvar alertas:', error);
    }
  } catch (err) {
    console.error('[Alertas Supabase ⚠️] Erro ao persistir alertas:', err);
  }
}

/**
 * Converte data string DD/MM/AAAA para objeto Date zerado nas horas
 */
export function parseDataBr(dataStr: string): Date | null {
  if (!dataStr || typeof dataStr !== 'string') return null;
  const limpa = dataStr.trim();
  const match = limpa.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10) - 1;
  const ano = parseInt(match[3], 10);
  const d = new Date(ano, mes, dia, 0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calcula os dias restantes até a data de validade em relação ao dia de hoje no fuso de Brasília
 */
export function calcularDiasRestantes(dataValidadeStr: string, dataReferencia?: Date): number | null {
  const dValidade = parseDataBr(dataValidadeStr);
  if (!dValidade) return null;

  const dataBase = dataReferencia || obterAgoraBrasilia().dataRef;
  const ref = new Date(
    dataBase.getFullYear(),
    dataBase.getMonth(),
    dataBase.getDate(),
    0, 0, 0, 0
  );

  const diffMs = dValidade.getTime() - ref.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determina o status do alerta com base nos dias restantes
 */
export function determinarStatusVencimento(diasRestantes: number): StatusAlertaVencimento {
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes === 0) return 'vence_hoje';
  return 'a_vencer';
}

/**
 * Determina a categoria de prazo do alerta (60, 30, 7, 0 ou vencido_semanal)
 */
export function determinarPrazoAlerta(diasRestantes: number): PrazoAlerta | null {
  if (diasRestantes < 0) {
    return 'vencido_semanal';
  }
  if (diasRestantes === 0) {
    return 0;
  }
  if (diasRestantes <= 7) {
    return 7;
  }
  if (diasRestantes <= 30) {
    return 30;
  }
  if (diasRestantes <= 60) {
    return 60;
  }
  return null;
}

/**
 * Zera todos os alertas de um documento específico quando sua data de validade é alterada ou substituída
 */
export async function zerarAlertasDocumento(documentoId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('alertas_vencimento')
      .delete()
      .eq('documento_id', documentoId);
    console.log(`[Alertas Vencimento 🔄] Alertas do documento ${documentoId} zerados após alteração de validade.`);
  } catch (err) {
    console.error(`Erro ao zerar alertas do documento ${documentoId}:`, err);
  }
}

/**
 * Ativa ou desativa a opção "Não alertar mais" de um documento.
 * Se silenciar === true, limpa também todos os alertas pendentes dele.
 */
export async function silenciarAlertasDocumento(
  documentoId: string,
  silenciar: boolean = true
): Promise<DocumentoRegistro | null> {
  const docAtualizado = await atualizarDocumento(documentoId, { silenciarAlertas: silenciar });
  if (!docAtualizado) return null;

  if (silenciar) {
    await zerarAlertasDocumento(documentoId);
    console.log(`[Alertas Vencimento 🔕] Alertas do documento "${docAtualizado.titulo}" (${documentoId}) foram SILENCIADOS.`);
  } else {
    console.log(`[Alertas Vencimento 🔔] Alertas do documento "${docAtualizado.titulo}" (${documentoId}) foram REATIVADOS.`);
  }

  return docAtualizado;
}

/**
 * Marca um alerta individual como lido
 */
export async function marcarAlertaComoLido(alertaId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('alertas_vencimento')
      .update({ lido: true })
      .eq('id', alertaId);

    return !error;
  } catch (err) {
    console.error(`Erro ao marcar alerta ${alertaId} como lido:`, err);
    return false;
  }
}

/**
 * Marca todos os alertas como lidos
 */
export async function marcarTodosAlertasComoLidos(): Promise<number> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('alertas_vencimento')
      .update({ lido: true })
      .eq('lido', false)
      .select('id');

    if (error) {
      console.error('Erro ao marcar todos alertas como lidos:', error);
      return 0;
    }

    return data?.length || 0;
  } catch (err) {
    console.error('Erro ao marcar todos alertas como lidos:', err);
    return 0;
  }
}

/**
 * Atualiza no Supabase a validade de um documento
 */
export async function atualizarValidadeDocumento(
  documentoId: string,
  novaValidade: string | null,
  origemValidade: 'extraído automaticamente' | 'corrigido pelo chat' | 'manual',
  autor?: string
): Promise<DocumentoRegistro | null> {
  const todosDocs = await obterTodosDocumentos();
  const doc = todosDocs.find((d) => d.id === documentoId);
  if (!doc) return null;

  const validadeAnterior = doc.dataValidade || '';
  const payload: Partial<DocumentoRegistro> = {
    dataValidade: novaValidade,
    origemValidade,
  };

  if (origemValidade === 'corrigido pelo chat' || origemValidade === 'manual') {
    payload.historicoValidade = {
      valorAnterior: validadeAnterior,
      valorNovo: novaValidade || '',
      corrigidoPor: autor || 'Chat VEGA',
      dataHora: obterAgoraIsoUtc(),
    };
  }

  const atualizado = await atualizarDocumento(documentoId, payload);
  await zerarAlertasDocumento(documentoId);

  return atualizado;
}

/**
 * Função preparada para envio de alerta via WhatsApp no futuro.
 */
export async function enviarAlertaVencimentoWhatsApp(alerta: AlertaVencimento): Promise<boolean> {
  const destinatariosConfig = process.env.WHATSAPP_ALERTA_DESTINATARIOS?.trim();
  const habilitado = process.env.WHATSAPP_ALERTA_ATIVO === 'true';

  if (!habilitado || !destinatariosConfig) {
    console.log(
      `[WhatsApp Alertas ℹ️] Disparo simulado (desativado no momento): "${alerta.documentoTitulo}" (${alerta.status}, ${alerta.diasRestantes} dias) para [${destinatariosConfig || 'nenhum destinatário configurado'}]`
    );
    return false;
  }

  console.log(`[WhatsApp Alertas 🚀] Enviando alerta para ${destinatariosConfig}...`);
  return true;
}

/**
 * Rotina diária de verificação de vencimento de documentos:
 * - Checa documentos com dataValidade
 * - Gera alertas para 60, 30, 7 dias, no dia (0) e lembrete semanal para vencidos
 * - Não repete o mesmo alerta para o mesmo prazo
 */
export async function executarRotinaVerificacaoVencimentos(): Promise<{
  alertasGerados: AlertaVencimento[];
  totalAlertas: number;
  totalNaoLidos: number;
}> {
  console.log('\n[Vencimentos ⏱️] Executando rotina diária de checagem de validades (Fuso: America/Sao_Paulo)...');
  const documentos = await obterTodosDocumentos();
  const alertasExistentes = await obterTodosAlertas();
  const agoraBrasilia = obterAgoraBrasilia();
  const agora = agoraBrasilia.dataRef;
  const agoraIsoUtc = obterAgoraIsoUtc();
  const alertasGerados: AlertaVencimento[] = [];

  for (const doc of documentos) {
    if (doc.silenciarAlertas) {
      continue;
    }

    if (!doc.dataValidade || !doc.dataValidade.trim()) {
      continue;
    }

    const diasRestantes = calcularDiasRestantes(doc.dataValidade, agora);
    if (diasRestantes === null) continue;

    const prazoAlerta = determinarPrazoAlerta(diasRestantes);
    if (prazoAlerta === null) continue;

    const status = determinarStatusVencimento(diasRestantes);

    if (typeof prazoAlerta === 'number') {
      const jaExiste = alertasExistentes.some(
        (a) =>
          a.documentoId === doc.id &&
          a.prazoAlerta === prazoAlerta &&
          a.dataValidade === doc.dataValidade
      );
      if (jaExiste) continue;
    } else if (prazoAlerta === 'vencido_semanal') {
      const alertasVencidosDoc = alertasExistentes
        .filter((a) => a.documentoId === doc.id && a.prazoAlerta === 'vencido_semanal')
        .sort((a, b) => new Date(b.dataGeracao).getTime() - new Date(a.dataGeracao).getTime());

      if (alertasVencidosDoc.length > 0) {
        const dataUltimo = new Date(alertasVencidosDoc[0].dataGeracao);
        const diasDesdeUltimo = Math.round((agora.getTime() - dataUltimo.getTime()) / (1000 * 60 * 60 * 24));
        if (diasDesdeUltimo < 7) {
          continue;
        }
      }
    }

    const novoAlerta: AlertaVencimento = {
      id: `alt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      documentoId: doc.id,
      documentoTitulo: doc.titulo,
      titular: doc.titular || 'Delta Plan',
      dataValidade: doc.dataValidade,
      diasRestantes,
      status,
      prazoAlerta,
      dataGeracao: agoraIsoUtc,
      lido: false,
      notificadoWhatsApp: false,
    };

    alertasExistentes.unshift(novoAlerta);
    alertasGerados.push(novoAlerta);

    enviarAlertaVencimentoWhatsApp(novoAlerta).catch(() => {});
  }

  if (alertasGerados.length > 0) {
    await salvarAlertas(alertasExistentes);
    console.log(`[Vencimentos 🔔] ${alertasGerados.length} novo(s) alerta(s) de vencimento gerado(s).`);
  } else {
    console.log('[Vencimentos ⏱️] Nenhum novo alerta a ser gerado hoje.');
  }

  const totalNaoLidos = alertasExistentes.filter((a) => !a.lido).length;

  return {
    alertasGerados,
    totalAlertas: alertasExistentes.length,
    totalNaoLidos,
  };
}

/**
 * Sincroniza as validades dos documentos existentes consultando exclusivamente os metadados do documento
 * e a respectiva ficha cadastral do titular vinculado no Supabase.
 * Nunca utiliza nomes de titulares, IDs ou datas hardcoded.
 */
export async function sincronizarValidadesDocumentosExistentes(): Promise<DocumentoRegistro[]> {
  const documentos = await obterTodosDocumentos();
  const titulares = await obterTodosTitulares();

  let alterados = 0;

  for (const doc of documentos) {
    if (doc.origemValidade === 'corrigido pelo chat' || doc.origemValidade === 'manual') {
      continue;
    }

    const titUpper = (doc.titulo || '').toUpperCase();
    const arqUpper = (doc.arquivo || '').toUpperCase();

    // Se o documento é CNH e ainda não possui dataValidade registrada, tenta recuperar da ficha cadastral do titular correspondente
    if (titUpper.includes('CNH') || arqUpper.includes('CNH')) {
      if (!doc.dataValidade) {
        const titularDoc = titulares.find((t) => t.id === doc.pessoaId);
        const validadeFicha = titularDoc?.campos?.validadeCnh?.valor?.trim();

        if (validadeFicha) {
          await atualizarDocumento(doc.id, {
            dataValidade: validadeFicha,
            origemValidade: 'extraído automaticamente',
            trechoValidade: `Validade CNH: ${validadeFicha}`,
          });
          alterados++;
        }
      }
      continue;
    }

    // Documentos profissionais que são permanentes e sem vencimento (ex: CRT)
    if (titUpper.includes('CRT') || arqUpper.includes('CRT')) {
      if (doc.dataValidade !== null) {
        await atualizarDocumento(doc.id, {
          dataValidade: null,
          origemValidade: 'extraído automaticamente',
          trechoValidade: null,
        });
        alterados++;
        await zerarAlertasDocumento(doc.id);
      }
      continue;
    }
  }

  if (alterados > 0) {
    console.log(`[Vencimentos ⏱️] Sincronização concluída: ${alterados} documento(s) atualizado(s) a partir do Supabase.`);
  }
  return await obterTodosDocumentos();
}
