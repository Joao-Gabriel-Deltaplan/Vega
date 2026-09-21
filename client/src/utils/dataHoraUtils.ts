/**
 * Utilitários para formatação de data e hora no fuso horário oficial de Brasília (America/Sao_Paulo)
 * no frontend do painel.
 */

export const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

/**
 * Formata um Date ou timestamp ISO para exibição de horário (HH:mm) em Brasília
 */
export function formatarHorario(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) return '';

  try {
    // Se for string pura "HH:mm", já está no formato correto
    if (typeof dataOuIso === 'string' && /^\d{2}:\d{2}$/.test(dataOuIso.trim())) {
      return dataOuIso.trim();
    }

    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      return String(dataOuIso);
    }

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return String(dataOuIso || '');
  }
}

/**
 * Formata um Date ou timestamp ISO para exibição de data (DD/MM/AAAA) em Brasília
 */
export function formatarData(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) return '';

  try {
    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      return String(dataOuIso);
    }

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(dataOuIso || '');
  }
}

/**
 * Formata um Date ou timestamp ISO para "DD/MM/AAAA HH:mm" em Brasília
 */
export function formatarDataHora(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) return '';

  try {
    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      return String(dataOuIso);
    }

    const dt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);

    const hr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);

    return `${dt} ${hr}`;
  } catch {
    return String(dataOuIso || '');
  }
}
