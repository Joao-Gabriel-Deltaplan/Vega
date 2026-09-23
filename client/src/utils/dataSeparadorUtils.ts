import { Mensagem } from '../types/chat.js';

const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

function obterDataBrasiliaFormatada(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_HORARIO_PADRAO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Retorna o rótulo de data relativo ou absoluto em formato corporativo limpo no fuso de Brasília.
 * Ex: "Hoje", "Ontem", "18/09/2026"
 */
export function formatarRotuloData(dataIsoOuTimestamp?: string): string {
  if (!dataIsoOuTimestamp) return '';

  const dataMsg = new Date(dataIsoOuTimestamp);
  if (isNaN(dataMsg.getTime())) return '';

  const hoje = new Date();
  const strHoje = obterDataBrasiliaFormatada(hoje);
  const strMsg = obterDataBrasiliaFormatada(dataMsg);

  if (strMsg === strHoje) return 'Hoje';

  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  const strOntem = obterDataBrasiliaFormatada(ontem);
  if (strMsg === strOntem) return 'Ontem';

  return strMsg;
}

/**
 * Verifica se entre a mensagem anterior e a mensagem atual houve mudança de dia no fuso de Brasília.
 */
export function deveExibirSeparadorData(
  msgAtual: Mensagem,
  msgAnterior?: Mensagem
): boolean {
  if (!msgAnterior) return true;

  const tAtual = msgAtual.timestamp || msgAtual.horario;
  const tAnterior = msgAnterior.timestamp || msgAnterior.horario;

  const dAtual = new Date(tAtual || '');
  const dAnterior = new Date(tAnterior || '');

  if (isNaN(dAtual.getTime()) || isNaN(dAnterior.getTime())) {
    return false;
  }

  return obterDataBrasiliaFormatada(dAtual) !== obterDataBrasiliaFormatada(dAnterior);
}
