import React, { useState, useMemo } from 'react';
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
  ShieldAlert,
} from 'lucide-react';
import { AlertaVencimento, AvisoSistemaRegistro } from '../types/chat.js';
import { AvisosSistemaTab } from './AvisosSistemaTab.js';

interface ModalAlertasVencimentoProps {
  aberto: boolean;
  onFechar: () => void;
  alertas: AlertaVencimento[];
  totalNaoLidos: number;
  onMarcarLido: (id: string) => Promise<void>;
  onMarcarTodosLidos: () => Promise<void>;
  onRecarregar: () => Promise<void>;
  onSilenciarDocumento?: (documentoId: string) => Promise<void>;
  // Propriedades para Avisos do Sistema
  avisosSistema?: AvisoSistemaRegistro[];
  onMarcarAvisoLido?: (id: string) => Promise<void>;
  onMarcarTodosAvisosLidos?: () => Promise<void>;
}

export const ModalAlertasVencimento: React.FC<ModalAlertasVencimentoProps> = ({
  aberto,
  onFechar,
  alertas,
  totalNaoLidos: totalNaoLidosProp,
  onMarcarLido,
  onMarcarTodosLidos,
  onRecarregar,
  onSilenciarDocumento,
  avisosSistema = [],
  onMarcarAvisoLido = async () => {},
  onMarcarTodosAvisosLidos = async () => {},
}) => {
  const [abaPrincipal, setAbaPrincipal] = useState<'vencimentos' | 'avisos'>('vencimentos');
  const [filtro, setFiltro] = useState<'todos' | 'nao_lidos' | 'vencidos' | 'a_vencer'>('todos');
  const [atualizando, setAtualizando] = useState(false);

  // Deduplicação defensiva por documentoId para garantir que nenhum documento apareça repetido
  const alertasUnicos = useMemo(() => {
    const mapa = new Map<string, AlertaVencimento>();
    for (const a of alertas) {
      if (!a.documentoId) continue;
      const existente = mapa.get(a.documentoId);
      if (!existente || new Date(a.dataGeracao).getTime() > new Date(existente.dataGeracao).getTime()) {
        mapa.set(a.documentoId, a);
      }
    }
    return Array.from(mapa.values());
  }, [alertas]);

  const totalNaoLidosAtual = useMemo(() => {
    const calculados = alertasUnicos.filter((a) => !a.lido).length;
    return typeof totalNaoLidosProp === 'number' ? Math.min(totalNaoLidosProp, calculados) : calculados;
  }, [alertasUnicos, totalNaoLidosProp]);

  const totalAvisosNaoLidos = useMemo(() => {
    return avisosSistema.filter((a) => a.status !== 'lido').length;
  }, [avisosSistema]);

  if (!aberto) return null;

  const handleRecarregar = async () => {
    setAtualizando(true);
    try {
      await onRecarregar();
    } finally {
      setAtualizando(false);
    }
  };

  const alertasFiltrados = alertasUnicos.filter((a) => {
    if (filtro === 'nao_lidos') return !a.lido;
    if (filtro === 'vencidos') return a.status === 'vencido';
    if (filtro === 'a_vencer') return a.status === 'a_vencer' || a.status === 'vence_hoje';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#121820] border border-[#202937] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-[#1e2633] flex items-center justify-between bg-[#18202b]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">
                  Central de Notificações
                </h2>
                {(totalNaoLidosAtual > 0 || totalAvisosNaoLidos > 0) && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {totalNaoLidosAtual + totalAvisosNaoLidos} pendente(s)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Prazos de validade do Cofre e monitoramento de serviços da VEGA
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRecarregar}
              disabled={atualizando}
              className="p-2 rounded-xl bg-[#121820] hover:bg-[#202937] text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer disabled:opacity-50"
              title="Atualizar agora"
            >
              <RefreshCw className={`w-4 h-4 ${atualizando ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onFechar}
              className="p-2 rounded-xl bg-[#121820] hover:bg-[#202937] text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Abas Principais: Vencimentos vs Avisos do Sistema */}
        <div className="flex border-b border-[#1e2633] bg-[#0d1218] px-4 pt-2">
          <button
            type="button"
            onClick={() => setAbaPrincipal('vencimentos')}
            className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              abaPrincipal === 'vencimentos'
                ? 'border-amber-400 text-amber-300 bg-[#121820]/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Vencimento de Documentos</span>
            {totalNaoLidosAtual > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">
                {totalNaoLidosAtual}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setAbaPrincipal('avisos')}
            className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              abaPrincipal === 'avisos'
                ? 'border-rose-400 text-rose-300 bg-[#121820]/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Avisos do Sistema</span>
            {totalAvisosNaoLidos > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300">
                {totalAvisosNaoLidos}
              </span>
            )}
          </button>
        </div>

        {/* Conteúdo da Aba Ativa */}
        {abaPrincipal === 'avisos' ? (
          <AvisosSistemaTab
            avisos={avisosSistema}
            carregando={atualizando}
            onMarcarLido={onMarcarAvisoLido}
            onMarcarTodosLidos={onMarcarTodosAvisosLidos}
            onRecarregar={onRecarregar}
          />
        ) : (
          <>
            {/* Barra de Filtros e Ações em Lote */}
            <div className="px-4 py-2.5 bg-[#0f141c] border-b border-[#1e2633] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFiltro('todos')}
              className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filtro === 'todos'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-[#18202b]'
              }`}
            >
              Todos ({alertasUnicos.length})
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
              Não lidos ({totalNaoLidosAtual})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('vencidos')}
              className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filtro === 'vencidos'
                  ? 'bg-rose-500 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-rose-300 bg-[#18202b]'
              }`}
            >
              Vencidos ({alertasUnicos.filter((a) => a.status === 'vencido').length})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('a_vencer')}
              className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filtro === 'a_vencer'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-amber-300 bg-[#18202b]'
              }`}
            >
              A vencer ({alertasUnicos.filter((a) => a.status === 'a_vencer' || a.status === 'vence_hoje').length})
            </button>
          </div>

          {totalNaoLidosAtual > 0 && (
            <button
              type="button"
              onClick={onMarcarTodosLidos}
              className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:underline cursor-pointer ml-auto"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Marcar todos como lidos</span>
            </button>
          )}
        </div>

        {/* Lista de Alertas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {alertasFiltrados.length === 0 ? (
            <div className="p-10 text-center space-y-3 bg-[#0f141c] rounded-xl border border-dashed border-[#202937]">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">
                  Nenhum alerta nesta visualização
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Os documentos monitorados estão em conformidade com as regras de vencimento da Delta Plan.
                </p>
              </div>
            </div>
          ) : (
            alertasFiltrados.map((alerta) => {
              const ehVencido = alerta.status === 'vencido';
              const ehVenceHoje = alerta.status === 'vence_hoje';

              let corBorda = 'border-[#202937]';
              let corFundo = alerta.lido ? 'bg-[#121820]/60' : 'bg-[#121820]';
              const textoAVencer = alerta.diasRestantes === 1 ? '1 DIA (AMANHÃ)' : `${alerta.diasRestantes} DIAS`;
              let badgeStatus = (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wider uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span>A VENCER EM {textoAVencer}</span>
                </span>
              );

              if (ehVencido) {
                corBorda = alerta.lido ? 'border-rose-500/20' : 'border-rose-500/40';
                corFundo = alerta.lido ? 'bg-rose-950/10' : 'bg-rose-950/20';
                const diasPos = Math.abs(alerta.diasRestantes);
                const textoVencido = diasPos === 1 ? '1 DIA' : `${diasPos} DIAS`;
                badgeStatus = (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wider uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>VENCIDO HÁ {textoVencido}</span>
                  </span>
                );
              } else if (ehVenceHoje) {
                corBorda = 'border-rose-500/40';
                corFundo = 'bg-rose-950/20';
                badgeStatus = (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-rose-500 text-white flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>VENCE HOJE!</span>
                  </span>
                );
              }

              return (
                <div
                  key={alerta.id}
                  className={`p-3.5 rounded-xl border ${corBorda} ${corFundo} flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                        <h4 className="font-semibold text-xs text-slate-100 truncate">
                          {alerta.documentoTitulo}
                        </h4>
                      </div>
                      {badgeStatus}
                      {!alerta.lido && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Novo alerta" />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1 text-slate-500">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>Titular: <strong className="text-slate-300">{alerta.titular || 'Delta Plan'}</strong></span>
                      </span>

                      <span className="flex items-center gap-1 text-slate-500">
                        <Calendar className="w-3.5 h-3.5 text-amber-400" />
                        <span>Validade: <strong className="text-slate-200">{alerta.dataValidade}</strong></span>
                      </span>

                      <span className="text-[11px] text-slate-500">
                        Gerado em: {new Date(alerta.dataGeracao).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          window.confirm(
                            `Deseja silenciar alertas do documento "${alerta.documentoTitulo}"?`
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
                      className="px-2.5 py-1 bg-[#18202b] hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-lg text-xs font-medium border border-[#263345] hover:border-rose-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                      title="Silenciar alertas deste documento"
                    >
                      <BellOff className="w-3.5 h-3.5 text-rose-400" />
                      <span className="hidden sm:inline">Silenciar</span>
                    </button>

                    {!alerta.lido ? (
                      <button
                        type="button"
                        onClick={() => onMarcarLido(alerta.id)}
                        className="px-2.5 py-1 bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 rounded-lg text-xs font-medium border border-[#263345] flex items-center gap-1 transition-colors cursor-pointer"
                        title="Marcar este alerta como lido"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Marcar lido</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 flex items-center gap-1 px-2 py-0.5">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
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
        <div className="p-3 bg-[#18202b] border-t border-[#1e2633] text-[11px] text-slate-500 flex items-center justify-between">
          <span>Alertas automáticos: 60, 30 e 7 dias antes do vencimento.</span>
          <span className="font-mono text-[10px]">Delta Plan • VEGA</span>
        </div>
        </>
        )}
      </div>
    </div>
  );
};
