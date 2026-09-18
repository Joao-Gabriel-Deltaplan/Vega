import React, { useState } from 'react';
import {
  Bell,
  BellOff,
  X,
  Check,
  CheckCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  Building2,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { AlertaVencimento } from '../types/chat.js';

interface ModalAlertasVencimentoProps {
  aberto: boolean;
  onFechar: () => void;
  alertas: AlertaVencimento[];
  totalNaoLidos: number;
  onMarcarLido: (id: string) => Promise<void>;
  onMarcarTodosLidos: () => Promise<void>;
  onRecarregar: () => Promise<void>;
  onSilenciarDocumento?: (documentoId: string) => Promise<void>;
}

export const ModalAlertasVencimento: React.FC<ModalAlertasVencimentoProps> = ({
  aberto,
  onFechar,
  alertas,
  totalNaoLidos,
  onMarcarLido,
  onMarcarTodosLidos,
  onRecarregar,
  onSilenciarDocumento,
}) => {
  const [filtro, setFiltro] = useState<'todos' | 'nao_lidos' | 'vencidos' | 'a_vencer'>('todos');
  const [atualizando, setAtualizando] = useState(false);

  if (!aberto) return null;

  const handleRecarregar = async () => {
    setAtualizando(true);
    try {
      await onRecarregar();
    } finally {
      setAtualizando(false);
    }
  };

  const alertasFiltrados = alertas.filter((a) => {
    if (filtro === 'nao_lidos') return !a.lido;
    if (filtro === 'vencidos') return a.status === 'vencido';
    if (filtro === 'a_vencer') return a.status === 'a_vencer' || a.status === 'vence_hoje';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-wa-panel border border-wa-border rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-wa-border flex items-center justify-between bg-wa-panelHover/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-wa-textPrimary">
                  Alertas de Vencimento de Documentos
                </h2>
                {totalNaoLidos > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500 text-white">
                    {totalNaoLidos} novo(s)
                  </span>
                )}
              </div>
              <p className="text-xs text-wa-textMuted">
                Monitoramento diário de prazos de validade do Cofre Corporativo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRecarregar}
              disabled={atualizando}
              className="p-2 rounded-lg bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary border border-wa-border transition-colors cursor-pointer disabled:opacity-50"
              title="Verificar validades agora"
            >
              <RefreshCw className={`w-4 h-4 ${atualizando ? 'animate-spin text-wa-green' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onFechar}
              className="p-2 rounded-lg bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary border border-wa-border transition-colors cursor-pointer"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Filtros e Ações em Lote */}
        <div className="px-4 py-2.5 bg-wa-bg border-b border-wa-border flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFiltro('todos')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filtro === 'todos'
                  ? 'bg-wa-green text-slate-950 font-semibold shadow-sm'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary bg-wa-panel'
              }`}
            >
              Todos ({alertas.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('nao_lidos')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filtro === 'nao_lidos'
                  ? 'bg-wa-green text-slate-950 font-semibold shadow-sm'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary bg-wa-panel'
              }`}
            >
              Não lidos ({totalNaoLidos})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('vencidos')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filtro === 'vencidos'
                  ? 'bg-rose-500 text-white font-semibold shadow-sm'
                  : 'text-wa-textSecondary hover:text-rose-400 bg-wa-panel'
              }`}
            >
              Vencidos ({alertas.filter((a) => a.status === 'vencido').length})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('a_vencer')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                filtro === 'a_vencer'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-wa-textSecondary hover:text-amber-400 bg-wa-panel'
              }`}
            >
              A vencer ({alertas.filter((a) => a.status === 'a_vencer' || a.status === 'vence_hoje').length})
            </button>
          </div>

          {totalNaoLidos > 0 && (
            <button
              type="button"
              onClick={onMarcarTodosLidos}
              className="flex items-center gap-1 text-[11px] font-semibold text-wa-green hover:underline cursor-pointer ml-auto"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Marcar todos como lidos</span>
            </button>
          )}
        </div>

        {/* Lista de Alertas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {alertasFiltrados.length === 0 ? (
            <div className="p-10 text-center space-y-3 bg-wa-bg/40 rounded-xl border border-dashed border-wa-border">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-wa-textPrimary">
                  Nenhum alerta nesta visualização
                </h4>
                <p className="text-xs text-wa-textMuted max-w-sm mx-auto mt-1">
                  Os documentos monitorados estão em conformidade com as regras de vencimento da Delta Plan.
                </p>
              </div>
            </div>
          ) : (
            alertasFiltrados.map((alerta) => {
              const ehVencido = alerta.status === 'vencido';
              const ehVenceHoje = alerta.status === 'vence_hoje';

              let corBorda = 'border-wa-border';
              let corFundo = alerta.lido ? 'bg-wa-panel/60' : 'bg-wa-panel';
              let badgeStatus = (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>A VENCER EM {alerta.diasRestantes} DIAS</span>
                </span>
              );

              if (ehVencido) {
                corBorda = alerta.lido ? 'border-rose-500/30' : 'border-rose-500/60';
                corFundo = alerta.lido ? 'bg-rose-950/20' : 'bg-rose-950/40';
                const diasPos = Math.abs(alerta.diasRestantes);
                badgeStatus = (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/50 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>VENCIDO HÁ {diasPos} DIA(S)</span>
                  </span>
                );
              } else if (ehVenceHoje) {
                corBorda = 'border-rose-500/60';
                corFundo = 'bg-rose-950/30';
                badgeStatus = (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500 text-white flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>VENCE HOJE!</span>
                  </span>
                );
              }

              return (
                <div
                  key={alerta.id}
                  className={`p-3.5 rounded-xl border ${corBorda} ${corFundo} flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all shadow-sm`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-4 h-4 text-wa-green flex-shrink-0" />
                        <h4 className="font-semibold text-xs sm:text-sm text-wa-textPrimary truncate">
                          {alerta.documentoTitulo}
                        </h4>
                      </div>
                      {badgeStatus}
                      {!alerta.lido && (
                        <span className="w-2 h-2 rounded-full bg-wa-green" title="Não lido" />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-wa-textSecondary">
                      <span className="flex items-center gap-1 text-wa-textMuted">
                        <Building2 className="w-3.5 h-3.5 text-wa-green" />
                        <span>Titular: <strong>{alerta.titular || 'Delta Plan'}</strong></span>
                      </span>

                      <span className="flex items-center gap-1 text-wa-textMuted">
                        <Calendar className="w-3.5 h-3.5 text-amber-400" />
                        <span>Validade: <strong className="text-wa-textPrimary">{alerta.dataValidade}</strong></span>
                      </span>

                      <span className="text-[11px] text-wa-textMuted">
                        Gerado em: {new Date(alerta.dataGeracao).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto flex-shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          window.confirm(
                            `Deseja parar de alertar sobre o documento "${alerta.documentoTitulo}"? Se o documento for substituído, os alertas voltarão a funcionar.`
                          )
                        ) {
                          if (onSilenciarDocumento) {
                            await onSilenciarDocumento(alerta.documentoId);
                          } else {
                            await fetch(`/api/vencimentos/documentos/${alerta.documentoId}/silenciar`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ silenciar: true }),
                            });
                            await onRecarregar();
                          }
                        }
                      }}
                      className="px-2.5 py-1 bg-wa-bg hover:bg-rose-500/10 text-wa-textMuted hover:text-rose-400 rounded-lg text-xs font-medium border border-wa-border hover:border-rose-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Não alertar mais sobre este documento"
                    >
                      <BellOff className="w-3.5 h-3.5 text-rose-400" />
                      <span className="hidden sm:inline">Não alertar mais</span>
                    </button>

                    {!alerta.lido ? (
                      <button
                        type="button"
                        onClick={() => onMarcarLido(alerta.id)}
                        className="px-2.5 py-1 bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-green rounded-lg text-xs font-medium border border-wa-border flex items-center gap-1 transition-colors cursor-pointer"
                        title="Marcar este alerta como lido"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Marcar lido</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-wa-textMuted flex items-center gap-1 px-2 py-0.5">
                        <CheckCheck className="w-3.5 h-3.5 text-wa-green" />
                        <span>Lido</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé Informativo */}
        <div className="p-3 bg-wa-panelHover/40 border-t border-wa-border text-[11px] text-wa-textMuted flex items-center justify-between">
          <span>Regras: Alertas a 60, 30, 7 dias, no dia e lembrete semanal para vencidos.</span>
          <span className="font-mono">VEGA • Delta Plan</span>
        </div>
      </div>
    </div>
  );
};
