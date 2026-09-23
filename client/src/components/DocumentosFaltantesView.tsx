import React, { useState, useEffect, useMemo } from 'react';
import {
  FileQuestion,
  Search,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  User,
  Loader2,
  Edit3,
  Check,
  X,
  ExternalLink,
  Info,
} from 'lucide-react';
import { DocumentoFaltanteRegistro, StatusDocumentoFaltante } from '../types/chat.js';
import { obterPaletaAvatar, obterIniciais } from '../utils/avatarUtils.js';

const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

function formatarDataBrasilia(dataStr?: string | null): string {
  if (!dataStr || !dataStr.trim()) return '—';
  try {
    const d = new Date(dataStr);
    if (isNaN(d.getTime())) return dataStr;
    return d.toLocaleString('pt-BR', {
      timeZone: FUSO_HORARIO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dataStr;
  }
}

interface DocumentosFaltantesViewProps {
  onIrParaCofre?: () => void;
}

export const DocumentosFaltantesView: React.FC<DocumentosFaltantesViewProps> = ({ onIrParaCofre }) => {
  const [faltantes, setFaltantes] = useState<DocumentoFaltanteRegistro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | StatusDocumentoFaltante>('pendente');

  // Estado para edição inline de observação
  const [idEditandoObs, setIdEditandoObs] = useState<string | null>(null);
  const [textoObs, setTextoObs] = useState('');
  const [salvandoObs, setSalvandoObs] = useState(false);

  // Carregar dados da API
  const carregarFaltantes = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/documentos-faltantes');
      if (!res.ok) throw new Error('Não foi possível carregar os documentos faltantes.');
      const data = await res.json();
      setFaltantes(data);
    } catch (err: any) {
      console.error('Erro ao buscar documentos faltantes:', err);
      setErro(err.message || 'Erro ao carregar dados.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarFaltantes();
  }, []);

  // Atualizar status
  const handleAlterarStatus = async (id: string, novoStatus: StatusDocumentoFaltante) => {
    try {
      const res = await fetch(`/api/documentos-faltantes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar status.');
      setFaltantes((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: novoStatus } : item))
      );
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    }
  };

  // Salvar observação
  const handleSalvarObservacao = async (id: string) => {
    setSalvandoObs(true);
    try {
      const res = await fetch(`/api/documentos-faltantes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observacao: textoObs.trim() || null }),
      });
      if (!res.ok) throw new Error('Falha ao salvar observação.');
      setFaltantes((prev) =>
        prev.map((item) => (item.id === id ? { ...item, observacao: textoObs.trim() || null } : item))
      );
      setIdEditandoObs(null);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setSalvandoObs(false);
    }
  };

  // Métricas
  const totalPendentes = useMemo(
    () => faltantes.filter((f) => f.status === 'pendente').length,
    [faltantes]
  );
  const totalProvidenciados = useMemo(
    () => faltantes.filter((f) => f.status === 'providenciado').length,
    [faltantes]
  );
  const totalDispensados = useMemo(
    () => faltantes.filter((f) => f.status === 'dispensado').length,
    [faltantes]
  );

  // Lista filtrada e ordenada
  const faltantesFiltrados = useMemo(() => {
    return faltantes.filter((item) => {
      const matchStatus = filtroStatus === 'todos' || item.status === filtroStatus;
      const termo = busca.toLowerCase().trim();
      const matchBusca =
        !termo ||
        item.tipoDocumento.toLowerCase().includes(termo) ||
        item.titular.toLowerCase().includes(termo) ||
        item.solicitanteNome.toLowerCase().includes(termo) ||
        (item.observacao && item.observacao.toLowerCase().includes(termo));
      return matchStatus && matchBusca;
    });
  }, [faltantes, filtroStatus, busca]);

  return (
    <div className="flex flex-col h-full bg-[#0b0f14] text-slate-100 overflow-y-auto">
      {/* CABEÇALHO */}
      <div className="p-6 border-b border-[#1e2633] bg-[#0e131b]/60 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <FileQuestion className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-slate-100">Documentos Faltantes no Cofre</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Registro automático de pedidos de documentos inexistentes. Ordenado por prioridade de solicitação.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={carregarFaltantes}
              disabled={carregando}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18202b] hover:bg-[#202b3a] text-slate-300 text-xs font-medium rounded-lg border border-[#263345] transition-all cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} />
              <span>Atualizar</span>
            </button>
            {onIrParaCofre && (
              <button
                onClick={onIrParaCofre}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold rounded-lg border border-emerald-500/30 transition-all cursor-pointer"
              >
                <span>Fazer Upload no Cofre</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* CARDS DE RESUMO */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <div
            onClick={() => setFiltroStatus('pendente')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filtroStatus === 'pendente'
                ? 'bg-amber-500/10 border-amber-500/40 shadow-sm'
                : 'bg-[#121822] border-[#1e2633] hover:border-amber-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Pendentes de Upload</span>
              <span className="text-[10px] uppercase font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/20">
                Ação
              </span>
            </div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{totalPendentes}</div>
            <span className="text-[11px] text-slate-500">Documentos solicitados que faltam</span>
          </div>

          <div
            onClick={() => setFiltroStatus('providenciado')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filtroStatus === 'providenciado'
                ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm'
                : 'bg-[#121822] border-[#1e2633] hover:border-emerald-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Providenciados</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{totalProvidenciados}</div>
            <span className="text-[11px] text-slate-500">Baixados automaticamente ou pelo painel</span>
          </div>

          <div
            onClick={() => setFiltroStatus('dispensado')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              filtroStatus === 'dispensado'
                ? 'bg-slate-700/20 border-slate-500/40 shadow-sm'
                : 'bg-[#121822] border-[#1e2633] hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Dispensados</span>
              <XCircle className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-bold text-slate-300 mt-1">{totalDispensados}</div>
            <span className="text-[11px] text-slate-500">Não necessários no momento</span>
          </div>
        </div>

        {/* BARRA DE FILTROS E BUSCA */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-5">
          {/* Abas de Status */}
          <div className="flex items-center gap-1.5 p-1 bg-[#121822] rounded-xl border border-[#1e2633] w-full sm:w-auto">
            <button
              onClick={() => setFiltroStatus('todos')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex-1 sm:flex-none ${
                filtroStatus === 'todos'
                  ? 'bg-[#1e2633] text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({faltantes.length})
            </button>
            <button
              onClick={() => setFiltroStatus('pendente')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex-1 sm:flex-none ${
                filtroStatus === 'pendente'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pendentes ({totalPendentes})
            </button>
            <button
              onClick={() => setFiltroStatus('providenciado')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex-1 sm:flex-none ${
                filtroStatus === 'providenciado'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Providenciados ({totalProvidenciados})
            </button>
            <button
              onClick={() => setFiltroStatus('dispensado')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex-1 sm:flex-none ${
                filtroStatus === 'dispensado'
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dispensados ({totalDispensados})
            </button>
          </div>

          {/* Campo de Busca */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por documento, titular..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full bg-[#121822] text-xs text-slate-200 pl-9 pr-3 py-2 rounded-xl border border-[#1e2633] focus:outline-none focus:border-emerald-500/50"
            />
            {busca && (
              <button
                onClick={() => setBusca('')}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* LISTAGEM DOS ITENS */}
      <div className="p-6 flex-1">
        {carregando ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-2" />
            <p className="text-xs">Carregando lista de documentos faltantes...</p>
          </div>
        ) : erro ? (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {erro}
          </div>
        ) : faltantesFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 border border-dashed border-[#1e2633] rounded-2xl bg-[#0e131b]/30">
            <FileQuestion className="w-10 h-10 mb-2 text-slate-600" />
            <p className="text-sm font-semibold text-slate-400">Nenhum documento faltante encontrado</p>
            <p className="text-xs text-slate-500 mt-1">
              {busca ? 'Nenhum item corresponde ao termo pesquisado.' : 'Todos os documentos pedidos estão no Cofre!'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {faltantesFiltrados.map((item) => {
              const paleta = obterPaletaAvatar(item.titular);
              const iniciais = obterIniciais(item.titular);

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-[#121822] border border-[#1e2633] hover:border-[#2b3749] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  {/* Coluna 1: Info Principal e Quantidade */}
                  <div className="flex items-start gap-3.5">
                    {/* Badge de Ranking / Frequência */}
                    <div className="flex flex-col items-center justify-center min-w-[54px] px-2.5 py-1.5 rounded-xl bg-[#18202b] border border-[#253245]">
                      <span className="text-xs font-black text-amber-400">
                        {item.quantidadePedidos}x
                      </span>
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                        pedido
                      </span>
                    </div>

                    <div>
                      {/* Tipo do Documento */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-100 group-hover:text-emerald-300 transition-colors">
                          {item.tipoDocumento}
                        </span>

                        {/* Selo de Status */}
                        {item.status === 'pendente' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            Pendente
                          </span>
                        )}
                        {item.status === 'providenciado' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            Providenciado
                          </span>
                        )}
                        {item.status === 'dispensado' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-600">
                            Dispensado
                          </span>
                        )}
                      </div>

                      {/* Titular e Solicitante */}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400 flex-wrap">
                        {/* Titular */}
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                            style={{ backgroundColor: paleta.bg, color: paleta.text }}
                          >
                            {iniciais}
                          </span>
                          <span className="text-slate-300 font-medium">{item.titular}</span>
                        </div>

                        <span className="text-slate-600">•</span>

                        {/* Quem pediu */}
                        <div className="flex items-center gap-1 text-slate-400">
                          <User className="w-3 h-3 text-slate-500" />
                          <span>Pedido por: <strong className="text-slate-300">{item.solicitanteNome}</strong></span>
                        </div>

                        <span className="text-slate-600">•</span>

                        {/* Data */}
                        <div className="flex items-center gap-1 text-slate-500">
                          <Clock className="w-3 h-3" />
                          <span>Último: {formatarDataBrasilia(item.dataUltimoPedido)}</span>
                        </div>
                      </div>

                      {/* Dado equivalente sugerido */}
                      {item.dadosEquivalentesOferecidos && (
                        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-cyan-300/80 bg-cyan-950/30 border border-cyan-800/30 px-2.5 py-1 rounded-lg">
                          <Info className="w-3 h-3 flex-shrink-0 text-cyan-400" />
                          <span>Oferecido dado equivalente: <strong>{item.dadosEquivalentesOferecidos}</strong></span>
                        </div>
                      )}

                      {/* Observação */}
                      {idEditandoObs === item.id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="text"
                            value={textoObs}
                            onChange={(e) => setTextoObs(e.target.value)}
                            placeholder="Escreva uma observação (ex.: Aguardando cartório)..."
                            className="bg-[#18202b] text-xs text-slate-200 px-3 py-1.5 rounded-lg border border-emerald-500/50 focus:outline-none w-72"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSalvarObservacao(item.id)}
                            disabled={salvandoObs}
                            className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-lg cursor-pointer"
                            title="Salvar"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setIdEditandoObs(null)}
                            className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg cursor-pointer"
                            title="Cancelar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        item.observacao && (
                          <div className="mt-1.5 text-xs text-slate-400 bg-[#18202b]/60 px-2.5 py-1 rounded-lg border border-[#202b3a] inline-flex items-center gap-1.5">
                            <span className="text-slate-500 font-semibold text-[10px] uppercase tracking-wider">Obs:</span>
                            <span>{item.observacao}</span>
                            <button
                              onClick={() => {
                                setIdEditandoObs(item.id);
                                setTextoObs(item.observacao || '');
                              }}
                              className="text-slate-500 hover:text-slate-300 ml-1"
                              title="Editar observação"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {/* Coluna 2: Botões de Ação */}
                  <div className="flex items-center gap-2 self-end md:self-center flex-shrink-0">
                    {!item.observacao && idEditandoObs !== item.id && (
                      <button
                        onClick={() => {
                          setIdEditandoObs(item.id);
                          setTextoObs('');
                        }}
                        className="p-2 text-slate-400 hover:text-slate-200 hover:bg-[#18202b] rounded-lg transition-colors border border-transparent hover:border-[#253245] cursor-pointer"
                        title="Adicionar observação"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}

                    {item.status !== 'providenciado' && (
                      <button
                        onClick={() => handleAlterarStatus(item.id, 'providenciado')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-lg border border-emerald-500/30 transition-all cursor-pointer"
                        title="Marcar como Providenciado"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Providenciado</span>
                      </button>
                    )}

                    {item.status !== 'dispensado' && (
                      <button
                        onClick={() => handleAlterarStatus(item.id, 'dispensado')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-all cursor-pointer"
                        title="Marcar como Dispensado"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Dispensar</span>
                      </button>
                    )}

                    {item.status !== 'pendente' && (
                      <button
                        onClick={() => handleAlterarStatus(item.id, 'pendente')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-medium rounded-lg border border-amber-500/30 transition-all cursor-pointer"
                        title="Reabrir como Pendente"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reabrir</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
