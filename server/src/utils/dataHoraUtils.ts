/**
 * Utilitários para padronização de datas e horários no fuso horário oficial de Brasília (America/Sao_Paulo)
 * e armazenamento em formato ISO UTC.
 */

export const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

export interface DataHoraBrasilia {
  ano: number;
  mes: number; // 1 a 12
  dia: number; // 1 a 31
  hora: number; // 0 a 23
  minuto: number; // 0 a 59
  segundo: number; // 0 a 59
  dataStr: string; // DD/MM/AAAA
  horaStr: string; // HH:mm
  dataHoraStr: string; // DD/MM/AAAA HH:mm
  dataIsoUtc: string; // YYYY-MM-DDTHH:mm:ss.sssZ
  dataRef: Date; // Objeto Date representando meia-noite do dia atual no fuso de Brasília
}

/**
 * Retorna o timestamp atual em formato ISO UTC (padrão de persistência)
 */
export function obterAgoraIsoUtc(): string {
  return new Date().toISOString();
}

/**
 * Obtém a data e hora atual desmembrada no fuso de Brasília (America/Sao_Paulo)
 */
export function obterAgoraBrasilia(dataReferencia: Date = new Date()): DataHoraBrasilia {
  const formatadorData = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_HORARIO_PADRAO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_HORARIO_PADRAO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const [anoStr, mesStr, diaStr] = formatadorData.format(dataReferencia).split('-');
  const [horaStr, minutoStr, segundoStr] = formatadorHora.format(dataReferencia).split(':');

  const ano = parseInt(anoStr, 10);
  const mes = parseInt(mesStr, 10);
  const dia = parseInt(diaStr, 10);
  const hora = parseInt(horaStr, 10);
  const minuto = parseInt(minutoStr, 10);
  const segundo = parseInt(segundoStr, 10);

  const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
  const horaFormatada = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

  // Data zerada às 00:00:00 representando o dia de referência no Brasil
  const dataRef = new Date(ano, mes - 1, dia, 0, 0, 0, 0);

  return {
    ano,
    mes,
    dia,
    hora,
    minuto,
    segundo,
    dataStr: dataFormatada,
    horaStr: horaFormatada,
    dataHoraStr: `${dataFormatada} ${horaFormatada}`,
    dataIsoUtc: dataReferencia.toISOString(),
    dataRef,
  };
}

/**
 * Formata um Date ou string ISO para HH:mm no fuso de Brasília
 */
export function formatarHorarioBrasilia(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) {
    return obterAgoraBrasilia().horaStr;
  }

  try {
    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      // Se já for uma string "HH:mm", retorna diretamente
      if (typeof dataOuIso === 'string' && /^\d{2}:\d{2}$/.test(dataOuIso.trim())) {
        return dataOuIso.trim();
      }
      return obterAgoraBrasilia().horaStr;
    }

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return obterAgoraBrasilia().horaStr;
  }
}

/**
 * Formata um Date ou string ISO para DD/MM/AAAA no fuso de Brasília
 */
export function formatarDataBrasilia(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) {
    return obterAgoraBrasilia().dataStr;
  }

  try {
    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      return obterAgoraBrasilia().dataStr;
    }

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return obterAgoraBrasilia().dataStr;
  }
}

/**
 * Formata um Date ou string ISO para "DD/MM/AAAA às HH:mm" no fuso de Brasília
 */
export function formatarDataHoraCompletaBrasilia(dataOuIso?: string | Date | null): string {
  if (!dataOuIso) {
    const agora = obterAgoraBrasilia();
    return `${agora.dataStr} às ${agora.horaStr}`;
  }

  try {
    const d = typeof dataOuIso === 'string' ? new Date(dataOuIso) : dataOuIso;
    if (isNaN(d.getTime())) {
      const agora = obterAgoraBrasilia();
      return `${agora.dataStr} às ${agora.horaStr}`;
    }

    const dataFormatada = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);

    const horaFormatada = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);

    return `${dataFormatada} às ${horaFormatada}`;
  } catch {
    const agora = obterAgoraBrasilia();
    return `${agora.dataStr} às ${agora.horaStr}`;
  }
}
