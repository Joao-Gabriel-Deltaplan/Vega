import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  CheckCheck,
  Check,
  RefreshCw,
  Clock,
  Database,
  WifiOff,
  Brain,
  DollarSign,
  MicOff,
  FileWarning,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { AvisoSistemaRegistro, TipoAviso, SeveridadeAviso } from '../types/chat.js';

interface AvisosSistemaTabProps {
  avisos: AvisoSistemaRegistro[];
  carregando?: boolean;
  onMarcarLido: (id: string) => Promise<void>;
  onMarcarTodosLidos: () => Promise<void>;
  onRecarregar: () => Promise<void>;
}

/**
 * Formata timestamp ISO para o Fuso Oficial de Brasília (America/Sao_Paulo)
 */
function formatarDataHoraBrasilia(isoStr?: string): string {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  } catch {
    return isoStr;
  }
}

export const AvisosSistemaTab: React.FC<AvisosSistemaTabProps> = ({
  avisos,
  carregando = false,
  onMarcarLido,
  onMarcarTodosLidos,
  onRecarregar,
}) => {
  const [filtro, setFiltro] = useState<'todos' | 'nao_lidos' | 'criticos' | 'consumo' | 'falhas'>('todos');
  const [detalhesExpandidos, setDetalhesExpandidos] = useState<Record<string, boolean>>({});
  const [marcandoId, setMarcandoId] = useState<string | null>(null);

  const toggleDetalhe = (id: string) => {
    setDetalhesExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalNaoLidos = useMemo(
    () => avisos.filter((a) => a.status !== 'lido').length,
    [avisos]
  );

  const avisosFiltrados = useMemo(() => {
    return avisos.filter((a) => {
      if (filtro === 'nao_lidos') return a.status !== 'lido';
      if (filtro === 'criticos') return a.severidade === 'critico' || a.severidade === 'critica';
      if (filtro === 'consumo') return a.tipo === 'consumo_limite';
      if (filtro === 'falhas') return a.tipo !== 'consumo_limite' && a.tipo !== 'recuperacao';
      return true;
    });
  }, [avisos, filtro]);

  const handleMarcarLido = async (id: string) => {
    setMarcandoId(id);
    try {
      await onMarcarLido(id);
    } finally {
      setMarcandoId(null);
    }
  };

  const renderIconeTipo = (tipo: TipoAviso, severidade: SeveridadeAviso) => {
    switch (tipo) {
      case 'openai_erro':
        return <Brain className="w-4 h-4 text-purple-400" />;
      case 'consumo_limite':
        return <DollarSign className="w-4 h-4 text-amber-400" />;
      case 'evolution_falha':
        return <WifiOff className="w-4 h-4 text-orange-400" />;
      case 'supabase_falha':
        return <Database className="w-4 h-4 text-rose-400" />;
      case 'indexacao_falha':
        return <FileWarning className="w-4 h-4 text-sky-400" />;
      case 'transcricao_falha':
        return <MicOff className="w-4 h-4 text-yellow-400" />;
      case 'recuperacao':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      default:
        return severidade === 'critico' || severidade === 'critica' ? (
          <AlertOctagon className="w-4 h-4 text-rose-400" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        );
    }
  };

  const renderBadgeSeveridade = (severidade: SeveridadeAviso) => {
    const sev = (severidade || '').toLowerCase();
    if (sev === 'critico' || sev === 'critica') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
          Crítico
        </span>
      );
    }
    if (sev === 'alerta' || sev === 'alta' || sev === 'media') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          Alerta
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
        Informativo
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Barra de Filtros e Ações em Lote */}
      <div className="px-4 py-2.5 bg-[#0f141c] border-b border-[#1e2633] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            type="button"
            onClick={() => setFiltro('todos')}
            className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              filtro === 'todos'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 bg-[#18202b]'
            }`}
          >
            Todos ({avisos.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltro('nao_lidos')}
            className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              filtro === 'nao_lidos'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 bg-[#18202b]'
            }`}
          >
            Não lidos ({totalNaoLidos})
          </button>
          <button
            type="button"
            onClick={() => setFiltro('criticos')}
            className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              filtro === 'criticos'
                ? 'bg-rose-500 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-rose-300 bg-[#18202b]'
            }`}
          >
            Críticos ({avisos.filter((a) => a.severidade === 'critico' || a.severidade === 'critica').length})
          </button>
          <button
            type="button"
            onClick={() => setFiltro('falhas')}
            className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              filtro === 'falhas'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-amber-300 bg-[#18202b]'
            }`}
          >
            Falhas Técnicas ({avisos.filter((a) => a.tipo !== 'consumo_limite' && a.tipo !== 'recuperacao').length})
          </button>
          <button
            type="button"
            onClick={() => setFiltro('consumo')}
            className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              filtro === 'consumo'
                ? 'bg-purple-500 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-purple-300 bg-[#18202b]'
            }`}
          >
            Consumo ({avisos.filter((a) => a.tipo === 'consumo_limite').length})
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {totalNaoLidos > 0 && (
            <button
              type="button"
              onClick={onMarcarTodosLidos}
              className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:underline cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Marcar todos como lidos</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onRecarregar()}
            disabled={carregando}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="Atualizar avisos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Lista de Avisos */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {avisosFiltrados.length === 0 ? (
          <div className="p-10 text-center space-y-3 bg-[#0f141c] rounded-xl border border-dashed border-[#202937]">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">
                Nenhum aviso nesta visualização
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                A VEGA e seus serviços associados estão operando normalmente.
              </p>
            </div>
          </div>
        ) : (
          avisosFiltrados.map((aviso) => {
            const isLido = aviso.status === 'lido';
            const expandido = Boolean(detalhesExpandidos[aviso.id]);
            const isRecorrente = (aviso.quantidadeOcorrencias || 1) > 1;

            return (
              <div
                key={aviso.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isLido
                    ? 'bg-[#121820]/60 border-[#1e2633] opacity-75'
                    : 'bg-[#18202b] border-[#263345] shadow-md hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#121820] border border-[#202937] flex items-center justify-center shrink-0 mt-0.5">
                      {renderIconeTipo(aviso.tipo, aviso.severidade)}
                    </div>

                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">
                          {aviso.titulo}
                        </span>
                        {renderBadgeSeveridade(aviso.severidade)}

                        {isRecorrente && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Ocorreu {aviso.quantidadeOcorrencias} vezes
                          </span>
                        )}

                        {aviso.status === 'resolvido' && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Resolvido
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed break-words">
                        {aviso.mensagem}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1 font-mono text-slate-400">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {formatarDataHoraBrasilia(aviso.ultimaOcorrencia || aviso.criadoEm)}
                        </span>
                        <span>•</span>
                        <span className="text-slate-400 truncate max-w-xs">
                          Origem: <strong className="text-slate-300">{aviso.origem}</strong>
                        </span>
                        {aviso.enviadoWhatsapp && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400 flex items-center gap-1">
                              <span>✓ Enviado no WhatsApp</span>
                            </span>
                          </>
                        )}
                      </div>

                      {/* Detalhe Técnico Expansível */}
                      {aviso.detalheTecnico && (
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => toggleDetalhe(aviso.id)}
                            className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer font-medium"
                          >
                            <span>{expandido ? 'Ocultar mensagem técnica' : 'Ver mensagem técnica'}</span>
                            {expandido ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>

                          {expandido && (
                            <pre className="mt-2 p-2.5 rounded-lg bg-[#0b0f14] border border-[#1e2633] text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-40">
                              {aviso.detalheTecnico}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="shrink-0 flex items-center gap-1">
                    {!isLido && (
                      <button
                        type="button"
                        onClick={() => handleMarcarLido(aviso.id)}
                        disabled={marcandoId === aviso.id}
                        className="px-2.5 py-1 rounded-lg bg-[#121820] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 text-xs border border-[#263345] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        title="Marcar como lido"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="hidden sm:inline">Lido</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé informativo */}
      <div className="p-3 bg-[#0b0f14] border-t border-[#1e2633] flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <span>Avisos com mais de 30 dias são descartados automaticamente pelo sistema.</span>
        </div>
      </div>
    </div>
  );
};
