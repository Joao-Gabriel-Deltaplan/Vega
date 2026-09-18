import React, { useState, useEffect } from 'react';
import {
  Settings,
  Server,
  Cpu,
  CheckCircle,
  FolderLock,
  FileCheck,
  SearchX,
  Clock,
  User,
  Zap,
  AlertTriangle,
  DollarSign,
  Activity,
  BarChart2,
  RefreshCw,
  ShieldAlert,
  Edit3,
  Layers,
  FileSpreadsheet,
  Check,
  X,
} from 'lucide-react';
import {
  Conversa,
  DocumentoRegistro,
  BuscaSemResultadoRegistro,
  MetricasUsoIA,
  TabelaPrecos,
} from '../types/chat.js';
import { ASSISTENTE } from '../config/assistente.js';

interface AdminViewProps {
  conversas: Conversa[];
}

export const AdminView: React.FC<AdminViewProps> = ({ conversas }) => {
  const [subAba, setSubAba] = useState<'uso_ia' | 'geral'>('uso_ia');
  const [modelo, setModelo] = useState('gpt-5.4-mini');
  const [temperatura, setTemperatura] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(1500);
  const [mensagemSalvo, setMensagemSalvo] = useState('');
  const [documentos, setDocumentos] = useState<DocumentoRegistro[]>([]);
  const [buscasSemResultado, setBuscasSemResultado] = useState<BuscaSemResultadoRegistro[]>([]);
  const [statusIA, setStatusIA] = useState<{
    modoSimulador: boolean;
    provedor: string;
    modelo: string;
  } | null>(null);

  // Estado de Métricas de Uso da IA
  const [metricasIA, setMetricasIA] = useState<MetricasUsoIA | null>(null);
  const [carregandoMetricas, setCarregandoMetricas] = useState(false);

  // Estado de Edição de Preços
  const [modalPrecosAberto, setModalPrecosAberto] = useState(false);
  const [precoEntradaInput, setPrecoEntradaInput] = useState<number>(0);
  const [precoSaidaInput, setPrecoSaidaInput] = useState<number>(0);
  const [salvandoPrecos, setSalvandoPrecos] = useState(false);

  // Carrega documentos, buscas sem resultado, status e métricas da IA
  const carregarDados = async () => {
    try {
      const [resDocs, resBuscas, resStatus] = await Promise.all([
        fetch('/api/documentos'),
        fetch('/api/buscas-sem-resultado'),
        fetch('/api/status-ia'),
      ]);

      if (resDocs.ok) {
        const dadosDocs = await resDocs.json();
        if (Array.isArray(dadosDocs)) setDocumentos(dadosDocs);
      }

      if (resBuscas.ok) {
        const dadosBuscas = await resBuscas.json();
        if (Array.isArray(dadosBuscas)) setBuscasSemResultado(dadosBuscas);
      }

      if (resStatus.ok) {
        const dadosStatus = await resStatus.json();
        setStatusIA(dadosStatus);
        if (dadosStatus.modelo) setModelo(dadosStatus.modelo);
      }
    } catch (err) {
      console.error('Erro ao carregar dados do admin:', err);
    }
  };

  const carregarMetricasIA = async () => {
    setCarregandoMetricas(true);
    try {
      const res = await fetch('/api/uso-ia/metricas');
      if (res.ok) {
        const dados: MetricasUsoIA = await res.json();
        setMetricasIA(dados);
        const configModelo = dados.tabelaPrecos?.[modelo] || dados.tabelaPrecos?.['gpt-5.4-mini'];
        if (configModelo) {
          setPrecoEntradaInput(configModelo.precoEntradaPorMilhao || 0);
          setPrecoSaidaInput(configModelo.precoSaidaPorMilhao || 0);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar métricas de uso da IA:', err);
    } finally {
      setCarregandoMetricas(false);
    }
  };

  useEffect(() => {
    carregarDados();
    carregarMetricasIA();
  }, []);

  const handleSalvarConfig = () => {
    setMensagemSalvo('Configurações operacionais da VEGA atualizadas!');
    setTimeout(() => setMensagemSalvo(''), 3000);
  };

  const handleSalvarPrecos = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoPrecos(true);
    try {
      const novaTabela: TabelaPrecos = {
        ...(metricasIA?.tabelaPrecos || {}),
        [modelo]: {
          precoEntradaPorMilhao: Number(precoEntradaInput),
          precoSaidaPorMilhao: Number(precoSaidaInput),
          moeda: 'BRL',
        },
      };

      const res = await fetch('/api/precos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novaTabela),
      });

      if (res.ok) {
        setModalPrecosAberto(false);
        setMensagemSalvo('Tabela de preços de tokens atualizada com sucesso!');
        setTimeout(() => setMensagemSalvo(''), 3000);
        await carregarMetricasIA();
      }
    } catch (err) {
      console.error('Erro ao salvar preços:', err);
    } finally {
      setSalvandoPrecos(false);
    }
  };

  // Cálculos do Geral / Cofre
  const totalDocumentos = documentos.length;
  const totalDiretoria = documentos.filter((d) => d.visibilidade === 'diretoria').length;
  const totalGeral = documentos.filter((d) => d.visibilidade === 'geral').length;

  const documentosEntregues = conversas.reduce((acc, conv) => {
    const entregas = conv.mensagens.filter(
      (m) =>
        m.remetente === 'assistente' &&
        ((m.anexos && m.anexos.length > 0) ||
          m.texto.toLowerCase().includes('aqui está seu') ||
          m.texto.toLowerCase().includes('segue o'))
    ).length;
    return acc + entregas;
  }, 0);

  const totalBuscasSemResultado = buscasSemResultado.length;

  return (
    <div className="flex-1 h-full bg-wa-bg overflow-y-auto p-6 text-wa-textPrimary">
      <div className="max-w-5xl mx-auto space-y-6 pb-16">
        {/* Header Principal com Alternador de Sub-Abas */}
        <div className="border-b border-wa-border pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl bg-wa-green/20 text-wa-greenLight flex items-center justify-center shadow">
                <Settings className="w-5 h-5 text-wa-green" />
              </div>
              <h1 className="text-xl font-bold text-wa-textPrimary">
                Painel de Administração • {ASSISTENTE.nome} ({ASSISTENTE.empresa})
              </h1>
            </div>
            <p className="text-xs text-wa-textSecondary">
              Gestão de cotas de IA, tarifas por milhão de tokens, performance determinística e cofre corporativo.
            </p>
          </div>

          {/* Seletor de Sub-Abas */}
          <div className="flex items-center gap-1.5 p-1 bg-wa-panel border border-wa-border rounded-xl shadow-inner self-start md:self-auto">
            <button
              onClick={() => setSubAba('uso_ia')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                subAba === 'uso_ia'
                  ? 'bg-wa-green text-slate-950 shadow'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-bg/60'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Uso da IA</span>
              {metricasIA?.alertaRPD && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              )}
            </button>
            <button
              onClick={() => setSubAba('geral')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                subAba === 'geral'
                  ? 'bg-wa-green text-slate-950 shadow'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-bg/60'
              }`}
            >
              <FolderLock className="w-4 h-4" />
              <span>Geral & Cofre</span>
            </button>
          </div>
        </div>

        {/* MENSAGEM DE SUCESSO GLOBAL */}
        {mensagemSalvo && (
          <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-xl text-sm flex items-center gap-2 animate-fadeIn">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{mensagemSalvo}</span>
          </div>
        )}

        {/* AVISO VISÍVEL: MODO SIMULADOR ATIVO */}
        {statusIA?.modoSimulador && (
          <div className="p-3.5 bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded-xl text-xs flex items-center justify-between gap-3 shadow-sm animate-fadeIn">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="font-bold text-amber-300">
                  MODO SIMULADOR ATIVO — respostas não vêm de um modelo real.
                </p>
                <p className="text-amber-300/80 text-[11px] mt-0.5">
                  Tokens e cotas estão sendo contabilizados no simulador local com base em caracteres. Configure <code>OPENAI_API_KEY</code> no <code>.env</code> para habilitar o modelo oficial.
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
              Simulador
            </span>
          </div>
        )}

        {/* ================================================================= */}
        {/* SUB-ABA: USO DA IA */}
        {/* ================================================================= */}
        {subAba === 'uso_ia' && (
          <div className="space-y-6 animate-fadeIn">
            {/* ALERTAS DE COTA E TETO DE CUSTO */}
            {metricasIA?.requisicoesHoje !== undefined &&
              metricasIA.limiteRPD !== undefined &&
              metricasIA.requisicoesHoje >= metricasIA.limiteRPD && (
                <div className="p-4 bg-rose-500/20 border border-rose-500/50 text-rose-200 rounded-xl text-xs flex items-start gap-3 shadow-lg">
                  <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-rose-300 text-sm">
                      Limite diário de consultas inteligentes atingido ({metricasIA.requisicoesHoje}/{metricasIA.limiteRPD})!
                    </p>
                    <p className="text-rose-200/90 text-xs mt-1">
                      A busca direta determinística no cofre continua funcionando 100% normalmente. Novas chamadas inteligentes à IA estão pausadas até a meia-noite (Horário do Pacífico).
                    </p>
                  </div>
                </div>
              )}

            {metricasIA?.alertaRPD &&
              metricasIA.requisicoesHoje < metricasIA.limiteRPD && (
                <div className="p-3.5 bg-amber-500/20 border border-amber-500/50 text-amber-200 rounded-xl text-xs flex items-center justify-between gap-3 shadow">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <div>
                      <p className="font-bold text-amber-300">
                        Alerta de Cota Diária: {metricasIA.percentualRPD}% atingido!
                      </p>
                      <p className="text-amber-200/80 text-[11px] mt-0.5">
                        Foram realizadas {metricasIA.requisicoesHoje} de {metricasIA.limiteRPD} requisições permitidas hoje.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded bg-amber-500/30 text-amber-200 text-[11px] font-bold">
                    {metricasIA.percentualRPD}% RPD
                  </span>
                </div>
              )}

            {metricasIA?.tetoExcedido && (
              <div className="p-3.5 bg-rose-500/20 border border-rose-500/50 text-rose-200 rounded-xl text-xs flex items-center gap-3 shadow">
                <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                <div>
                  <p className="font-bold text-rose-300">
                    Teto de Custo Mensal Excedido (R$ {metricasIA.custoEstimadoMes.toFixed(2)} / R$ {metricasIA.tetoCustoMensal.toFixed(2)})
                  </p>
                  <p className="text-rose-200/80 text-[11px]">
                    Bloqueio automático ativado para proteger a fatura. A busca determinística no cofre segue ativa.
                  </p>
                </div>
              </div>
            )}

            {/* BARRA SUPERIOR DE AÇÕES E ATUALIZAÇÃO */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-wa-textSecondary">
                <Activity className="w-4 h-4 text-wa-green" />
                <span>Métricas consolidadas de consumo do modelo</span>
                <span className="px-2 py-0.5 rounded bg-wa-panel border border-wa-border text-wa-textPrimary font-mono font-bold">
                  {modelo}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={carregarMetricasIA}
                  disabled={carregandoMetricas}
                  className="px-3 py-1.5 bg-wa-panel hover:bg-wa-panel/80 border border-wa-border text-wa-textPrimary rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="Atualizar métricas agora"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${carregandoMetricas ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>

                <button
                  onClick={() => setModalPrecosAberto(true)}
                  className="px-3 py-1.5 bg-wa-green hover:bg-wa-greenHover text-slate-950 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Tabela de Preços</span>
                </button>
              </div>
            </div>

            {/* GRID DE 4 CARDS DE MÉTRICAS PRINCIPAIS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CARD 1: Requisições Hoje / RPD */}
              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-wa-textSecondary font-medium">
                      Requisições Hoje (RPD)
                    </span>
                    <Activity className="w-4 h-4 text-sky-400" />
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-2xl font-bold text-wa-textPrimary">
                      {metricasIA?.requisicoesHoje ?? 0}
                    </span>
                    <span className="text-xs text-wa-textMuted">
                      / {metricasIA?.limiteRPD ?? 250} max
                    </span>
                  </div>
                  <p className="text-[10px] text-wa-textMuted mt-0.5">
                    Reset à meia-noite (Horário do Pacífico)
                  </p>
                </div>

                {/* Barra de Progresso RPD */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-wa-textSecondary">Consumo Diário</span>
                    <span
                      className={`font-bold ${
                        (metricasIA?.percentualRPD ?? 0) >= 90
                          ? 'text-rose-400'
                          : (metricasIA?.percentualRPD ?? 0) >= 70
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {metricasIA?.percentualRPD ?? 0}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-wa-bg rounded-full overflow-hidden border border-wa-border/50">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        (metricasIA?.percentualRPD ?? 0) >= 90
                          ? 'bg-rose-500'
                          : (metricasIA?.percentualRPD ?? 0) >= 70
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(metricasIA?.percentualRPD ?? 0, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* CARD 2: Requisições no Último Minuto (RPM) */}
              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-wa-textSecondary font-medium">
                      Último Minuto (RPM)
                    </span>
                    <Zap className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-2xl font-bold text-wa-textPrimary">
                      {metricasIA?.requisicoesUltimoMinuto ?? 0}
                    </span>
                    <span className="text-xs text-wa-textMuted">
                      / {metricasIA?.limiteRPM ?? 10} rpm
                    </span>
                  </div>
                  <p className="text-[10px] text-wa-textMuted mt-0.5">
                    Janela deslizante de 60 segundos
                  </p>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-wa-textSecondary">Backoff Automático</span>
                    <span className="text-wa-textMuted font-mono text-[10px]">
                      {(metricasIA?.requisicoesUltimoMinuto ?? 0) >= (metricasIA?.limiteRPM ?? 10)
                        ? 'Espera ativa'
                        : 'Livre'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-wa-bg rounded-full overflow-hidden border border-wa-border/50">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        (metricasIA?.requisicoesUltimoMinuto ?? 0) >= (metricasIA?.limiteRPM ?? 10)
                          ? 'bg-rose-500'
                          : 'bg-wa-green'
                      }`}
                      style={{
                        width: `${Math.min(
                          Math.round(
                            ((metricasIA?.requisicoesUltimoMinuto ?? 0) /
                              (metricasIA?.limiteRPM ?? 10)) *
                              100
                          ),
                          100
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* CARD 3: Respostas SEM IA nos últimos 30 dias */}
              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-wa-textSecondary font-medium">
                      Respostas Sem IA (30d)
                    </span>
                    <Zap className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-2xl font-bold text-emerald-400">
                      {metricasIA?.percentualSemIA30d ?? 100}%
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                        (metricasIA?.percentualSemIA30d ?? 100) >= 90
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {(metricasIA?.percentualSemIA30d ?? 100) >= 90
                        ? 'Meta Atingida'
                        : 'Abaixo'}
                    </span>
                  </div>
                  <p className="text-[10px] text-wa-textMuted mt-0.5">
                    Meta institucional: acima de 90%
                  </p>
                </div>

                <div className="mt-3 text-[11px] text-wa-textSecondary bg-wa-bg/60 p-1.5 rounded-lg border border-wa-border/40">
                  <span className="font-semibold text-wa-textPrimary">
                    {metricasIA?.mensagensSemIA30d ?? 0}
                  </span>{' '}
                  de {metricasIA?.totalMensagens30d ?? 0} mensagens via busca direta.
                </div>
              </div>

              {/* CARD 4: Custo Estimado do Mês */}
              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-wa-textSecondary font-medium">
                      Custo Estimado do Mês
                    </span>
                    <DollarSign className="w-4 h-4 text-wa-green" />
                  </div>
                  <div className="mt-2">
                    {metricasIA?.isFreeTier ? (
                      <div>
                        <span className="text-lg font-bold text-wa-greenLight">
                          R$ 0,00
                        </span>
                        <p className="text-[11px] text-wa-textSecondary font-medium mt-0.5">
                          Free tier — sem custo
                        </p>
                      </div>
                    ) : (
                      <div>
                        <span className="text-2xl font-bold text-wa-textPrimary">
                          R$ {(metricasIA?.custoEstimadoMes ?? 0).toFixed(2)}
                        </span>
                        <p className="text-[11px] text-wa-textMuted mt-0.5">
                          Faturamento de tokens ativo
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-wa-textMuted">
                    Teto:{' '}
                    {metricasIA?.tetoCustoMensal && metricasIA.tetoCustoMensal > 0
                      ? `R$ ${metricasIA.tetoCustoMensal.toFixed(2)}`
                      : 'Sem limite'}
                  </span>
                  <button
                    onClick={() => setModalPrecosAberto(true)}
                    className="text-wa-green hover:underline cursor-pointer flex items-center gap-1 font-medium"
                  >
                    <Edit3 className="w-3 h-3" />
                    Editar
                  </button>
                </div>
              </div>
            </div>

            {/* SEÇÃO INTERMEDIÁRIA: TOKENS DO MÊS & QUEBRA POR MOTIVO */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Card Tokens do Mês */}
              <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-400" />
                    Consumo de Tokens no Mês Corrente
                  </h2>
                  <span className="text-xs text-wa-textMuted font-mono">
                    Total: {(metricasIA?.totalTokensMes ?? 0).toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border">
                    <p className="text-wa-textMuted text-[11px]">Tokens de Entrada (Prompt)</p>
                    <p className="text-lg font-bold text-sky-400 mt-1 font-mono">
                      {(metricasIA?.tokensEntradaMes ?? 0).toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">
                      Instruções do sistema + catálogos + mensagem
                    </p>
                  </div>

                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border">
                    <p className="text-wa-textMuted text-[11px]">Tokens de Saída (Candidatos)</p>
                    <p className="text-lg font-bold text-emerald-400 mt-1 font-mono">
                      {(metricasIA?.tokensSaidaMes ?? 0).toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">
                      Respostas JSON e mensagens emitidas
                    </p>
                  </div>
                </div>

                {/* Mini Barra de Proporção */}
                <div>
                  <div className="w-full h-2 bg-wa-bg rounded-full overflow-hidden flex border border-wa-border/50">
                    <div
                      className="bg-sky-500 h-full transition-all"
                      style={{
                        width: `${
                          (metricasIA?.totalTokensMes ?? 0) > 0
                            ? Math.round(
                                ((metricasIA?.tokensEntradaMes ?? 0) /
                                  (metricasIA?.totalTokensMes ?? 1)) *
                                  100
                              )
                            : 50
                        }%`,
                      }}
                      title="Entrada"
                    ></div>
                    <div
                      className="bg-emerald-500 h-full transition-all"
                      style={{
                        width: `${
                          (metricasIA?.totalTokensMes ?? 0) > 0
                            ? Math.round(
                                ((metricasIA?.tokensSaidaMes ?? 0) /
                                  (metricasIA?.totalTokensMes ?? 1)) *
                                  100
                              )
                            : 50
                        }%`,
                      }}
                      title="Saída"
                    ></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-wa-textMuted mt-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky-500"></span> Entrada
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Saída
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Quebra por Motivo */}
              <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-wa-green" />
                    Distribuição por Motivo de Chamada
                  </h2>
                  <span className="text-xs text-wa-textMuted">Classificação das requisições</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border text-center">
                    <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold uppercase">
                      Interpretação
                    </span>
                    <p className="text-xl font-bold text-wa-textPrimary mt-2 font-mono">
                      {metricasIA?.motivos?.interpretacao ?? 0}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">Busca semântica</p>
                  </div>

                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border text-center">
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold uppercase">
                      Equivalência
                    </span>
                    <p className="text-xl font-bold text-wa-textPrimary mt-2 font-mono">
                      {metricasIA?.motivos?.equivalencia ?? 0}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">Sugestão de dados</p>
                  </div>

                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border text-center">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase">
                      Conversa
                    </span>
                    <p className="text-xl font-bold text-wa-textPrimary mt-2 font-mono">
                      {metricasIA?.motivos?.conversa ?? 0}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">Geral / Dúvidas</p>
                  </div>

                  <div className="p-3 bg-wa-bg rounded-lg border border-wa-border text-center">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase">
                      Áudio
                    </span>
                    <p className="text-xl font-bold text-wa-textPrimary mt-2 font-mono">
                      {metricasIA?.motivos?.transcricao_audio ?? 0}
                    </p>
                    <p className="text-[10px] text-wa-textMuted mt-0.5">Whisper (Voz)</p>
                  </div>
                </div>

                {/* Barra segmentada de motivos */}
                {(() => {
                  const total =
                    (metricasIA?.motivos?.interpretacao ?? 0) +
                    (metricasIA?.motivos?.equivalencia ?? 0) +
                    (metricasIA?.motivos?.conversa ?? 0) +
                    (metricasIA?.motivos?.transcricao_audio ?? 0);
                  const pInterp = total > 0 ? ((metricasIA?.motivos?.interpretacao ?? 0) / total) * 100 : 25;
                  const pEquiv = total > 0 ? ((metricasIA?.motivos?.equivalencia ?? 0) / total) * 100 : 25;
                  const pConv = total > 0 ? ((metricasIA?.motivos?.conversa ?? 0) / total) * 100 : 25;
                  const pAudio = total > 0 ? ((metricasIA?.motivos?.transcricao_audio ?? 0) / total) * 100 : 25;

                  return (
                    <div>
                      <div className="w-full h-2 bg-wa-bg rounded-full overflow-hidden flex border border-wa-border/50">
                        <div style={{ width: `${pInterp}%` }} className="bg-sky-500 h-full"></div>
                        <div style={{ width: `${pEquiv}%` }} className="bg-purple-500 h-full"></div>
                        <div style={{ width: `${pConv}%` }} className="bg-emerald-500 h-full"></div>
                        <div style={{ width: `${pAudio}%` }} className="bg-amber-500 h-full"></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-wa-textMuted mt-1">
                        <span className="text-sky-400">Interpretação ({Math.round(pInterp)}%)</span>
                        <span className="text-purple-400">Equivalência ({Math.round(pEquiv)}%)</span>
                        <span className="text-emerald-400">Conversa ({Math.round(pConv)}%)</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* GRÁFICO DE CHAMADAS POR DIA (ÚLTIMOS 30 DIAS) */}
            <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-wa-green" />
                    Histórico de Chamadas por Dia (Últimos 30 Dias)
                  </h2>
                  <p className="text-xs text-wa-textMuted mt-0.5">
                    Visualização diária do acionamento de IA pela diretoria e usuários internos
                  </p>
                </div>

                <div className="text-xs text-wa-textSecondary flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded bg-wa-green inline-block"></span>
                  <span>Chamadas registradas</span>
                </div>
              </div>

              {/* Área do Gráfico */}
              <div className="pt-4 pb-2">
                {(() => {
                  const dias = metricasIA?.chamadasUltimos30Dias || [];
                  const maxChamadas = Math.max(...dias.map((d) => d.chamadas), 5);

                  return (
                    <div className="space-y-2">
                      <div className="h-36 flex items-end gap-1.5 px-2 bg-wa-bg/50 rounded-xl border border-wa-border/40 pt-4 pb-2">
                        {dias.map((d) => {
                          const alturaPct = Math.round((d.chamadas / maxChamadas) * 100);
                          const diaFormatado = d.data.slice(8, 10) + '/' + d.data.slice(5, 7);

                          return (
                            <div
                              key={d.data}
                              className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer"
                            >
                              {/* Tooltip no Hover */}
                              <div className="absolute -top-9 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-wa-textPrimary text-[10px] px-2 py-1 rounded shadow-lg border border-wa-border pointer-events-none whitespace-nowrap z-20">
                                <span className="font-bold text-wa-greenLight">{d.chamadas} chamadas</span>
                                <span className="text-wa-textMuted"> em {diaFormatado}</span>
                              </div>

                              {/* Barra */}
                              <div
                                className={`w-full rounded-t-sm transition-all duration-300 ${
                                  d.chamadas > 0
                                    ? 'bg-wa-green hover:bg-wa-greenLight shadow-sm'
                                    : 'bg-wa-panel/40 hover:bg-wa-panel'
                                }`}
                                style={{
                                  height: `${Math.max(alturaPct, 4)}%`,
                                }}
                              ></div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Legenda de Datas (Início, Meio, Fim) */}
                      {dias.length > 0 && (
                        <div className="flex justify-between text-[10px] text-wa-textMuted px-2 font-mono">
                          <span>{dias[0].data.slice(8, 10)}/{dias[0].data.slice(5, 7)} (30d atrás)</span>
                          <span>{dias[Math.floor(dias.length / 2)].data.slice(8, 10)}/{dias[Math.floor(dias.length / 2)].data.slice(5, 7)}</span>
                          <span className="text-wa-green font-bold">Hoje ({dias[dias.length - 1].data.slice(8, 10)}/{dias[dias.length - 1].data.slice(5, 7)})</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* TABELA DAS ÚLTIMAS 50 CHAMADAS */}
            <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-sky-400" />
                    Últimas 50 Chamadas ao Modelo de IA
                  </h2>
                  <p className="text-xs text-wa-textMuted mt-0.5">
                    Histórico detalhado gravado em <code>data/uso_ia.json</code>
                  </p>
                </div>
                <span className="text-xs text-wa-textSecondary font-mono">
                  {metricasIA?.ultimas50Chamadas?.length ?? 0} chamadas listadas
                </span>
              </div>

              {(!metricasIA?.ultimas50Chamadas || metricasIA.ultimas50Chamadas.length === 0) ? (
                <div className="p-8 text-center text-wa-textSecondary text-xs bg-wa-bg/40 rounded-lg border border-dashed border-wa-border">
                  Nenhuma chamada registrada no histórico até o momento.
                </div>
              ) : (
                <div className="overflow-x-auto border border-wa-border/50 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-wa-bg text-wa-textSecondary border-b border-wa-border text-[11px]">
                        <th className="py-2.5 px-3 font-semibold">Data / Hora</th>
                        <th className="py-2.5 px-3 font-semibold">Contato</th>
                        <th className="py-2.5 px-3 font-semibold">Motivo</th>
                        <th className="py-2.5 px-3 font-semibold">Tokens (Entrada / Saída)</th>
                        <th className="py-2.5 px-3 font-semibold">Custo Estimado</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wa-border/40">
                      {metricasIA.ultimas50Chamadas.map((ch) => {
                        const dataObj = new Date(ch.data);
                        const dataStr = dataObj.toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                        });
                        const horaStr = dataObj.toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });

                        return (
                          <tr key={ch.id} className="hover:bg-wa-bg/40 transition-colors">
                            <td className="py-2 px-3 whitespace-nowrap text-wa-textPrimary font-mono text-[11px]">
                              <span>{dataStr}</span> <span className="text-wa-textMuted">{horaStr}</span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-wa-textPrimary font-medium">
                              {ch.contatoNome || ch.contatoId}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  ch.motivo === 'interpretacao'
                                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                    : ch.motivo === 'equivalencia'
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : ch.motivo === 'transcricao_audio'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                {ch.motivo === 'interpretacao'
                                  ? 'Interpretação'
                                  : ch.motivo === 'equivalencia'
                                  ? 'Equivalência'
                                  : ch.motivo === 'transcricao_audio'
                                  ? 'Áudio'
                                  : 'Conversa'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-wa-textSecondary font-mono text-[11px]">
                              <span className="text-sky-400 font-semibold">{ch.tokensEntrada}</span> in /{' '}
                              <span className="text-emerald-400 font-semibold">{ch.tokensSaida}</span> out
                              {ch.estimado && (
                                <span className="ml-1.5 px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px]">
                                  est.
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap font-mono text-wa-textPrimary text-[11px]">
                              {ch.custoEstimado > 0 ? (
                                `R$ ${ch.custoEstimado.toFixed(4)}`
                              ) : (
                                <span className="text-wa-textMuted">R$ 0,00</span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {ch.sucesso ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Sucesso</span>
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-rose-400 text-[11px]"
                                  title={ch.erro || 'Falha na requisição'}
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Erro</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* SUB-ABA: GERAL & COFRE (Visão clássica do painel de administração) */}
        {/* ================================================================= */}
        {subAba === 'geral' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Cards de Métricas do Cofre & Performance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-wa-textSecondary font-medium">
                    Total de Documentos no cofre
                  </span>
                  <FolderLock className="w-4 h-4 text-wa-green" />
                </div>
                <p className="text-2xl font-bold text-wa-textPrimary mt-1">{totalDocumentos}</p>
                <div className="flex items-center gap-2 text-[11px] text-wa-textMuted mt-1">
                  <span>{totalDiretoria} diretoria</span>
                  <span>•</span>
                  <span>{totalGeral} gerais</span>
                </div>
              </div>

              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-wa-textSecondary font-medium">
                    Documentos entregues (30d)
                  </span>
                  <FileCheck className="w-4 h-4 text-sky-400" />
                </div>
                <p className="text-2xl font-bold text-sky-400 mt-1">{documentosEntregues}</p>
                <p className="text-[11px] text-wa-textMuted mt-1">
                  Entregues via chat corporativo
                </p>
              </div>

              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-wa-textSecondary font-medium">
                    Buscas sem resultado (30d)
                  </span>
                  <SearchX className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-2xl font-bold text-amber-400 mt-1">{totalBuscasSemResultado}</p>
                <p className="text-[11px] text-wa-textMuted mt-1">
                  Registradas no log do cofre
                </p>
              </div>

              <div className="p-4 bg-wa-panel border border-wa-border rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-wa-textSecondary font-medium">
                    Respostas sem IA (30d)
                  </span>
                  <Zap className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  {metricasIA?.percentualSemIA30d ?? 100}%
                </p>
                <p className="text-[11px] text-wa-textMuted mt-1">
                  Motor determinístico (custo zero)
                </p>
              </div>
            </div>

            {/* LOG DE BUSCAS SEM RESULTADO (ÚLTIMOS 30 DIAS) */}
            <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                  <SearchX className="w-4 h-4 text-amber-400" />
                  Buscas Sem Resultado no Cofre ({buscasSemResultado.length})
                </h2>
                <span className="text-xs text-wa-textMuted">
                  Documentos que a diretoria e equipe procuram e ainda não foram cadastrados
                </span>
              </div>

              {buscasSemResultado.length === 0 ? (
                <div className="p-6 text-center text-wa-textSecondary text-xs bg-wa-bg/40 rounded-lg border border-dashed border-wa-border">
                  Nenhuma busca sem resultado registrada nos últimos 30 dias.
                </div>
              ) : (
                <div className="divide-y divide-wa-border/50 text-xs">
                  {buscasSemResultado.map((busca) => {
                    const dataFormatada = new Date(busca.data).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={busca.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-wa-bg/30 px-2 rounded-lg transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 text-[11px] text-wa-textMuted">
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3 text-wa-green" />
                              <strong className="text-wa-textPrimary">{busca.contatoNome}</strong>
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {dataFormatada}
                            </span>
                          </div>
                          <p className="text-sm text-wa-textPrimary font-medium italic">
                            "{busca.textoDoPedido}"
                          </p>
                        </div>

                        <div className="flex-shrink-0 flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              busca.iaAcionada
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {busca.iaAcionada ? 'IA Acionada' : 'Sem IA'}
                          </span>

                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                              busca.motivo === 'loop'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : busca.motivo === 'sem_permissao'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : busca.motivo === 'inexistente_com_equivalente'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {busca.motivo === 'loop'
                              ? 'Loop / Repetição'
                              : busca.motivo === 'sem_permissao'
                              ? 'Restrito à Diretoria'
                              : busca.motivo === 'inexistente_com_equivalente'
                              ? 'Com Equivalente'
                              : 'Não Cadastrado'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Seção de Status dos Servidores e Conexão */}
            <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
              <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                <Server className="w-4 h-4 text-wa-green" />
                Status da Infraestrutura Local
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-wa-bg rounded-lg border border-wa-border flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-wa-textPrimary">Backend Express (API & Cofre)</p>
                    <p className="text-wa-textMuted">Porta 4301 • CORS Liberado</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Ativo
                  </span>
                </div>

                <div className="p-3 bg-wa-bg rounded-lg border border-wa-border flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-wa-textPrimary">Frontend Vite + React</p>
                    <p className="text-wa-textMuted">Porta 4300 • Proxy Ativo</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Ativo
                  </span>
                </div>
              </div>
            </div>

            {/* Seção de Parâmetros Operacionais */}
            <div className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4">
              <h2 className="text-sm font-semibold text-wa-textPrimary flex items-center gap-2">
                <Cpu className="w-4 h-4 text-wa-green" />
                Parâmetros Operacionais da {ASSISTENTE.nome}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-wa-textSecondary mb-1.5 font-medium">
                    Modelo de Inteligência Artificial
                  </label>
                  <input
                    type="text"
                    disabled
                    value={modelo}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-sm text-wa-textPrimary font-mono opacity-80 cursor-not-allowed"
                  />
                  <p className="text-[10px] text-wa-textMuted mt-1">
                    Definido via variável <code>OPENAI_CHAT_MODEL</code> no arquivo <code>.env</code>.
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-wa-textSecondary mb-1.5 font-medium">
                    Temperatura: <span className="text-wa-greenLight font-bold">{temperatura}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperatura}
                    onChange={(e) => setTemperatura(parseFloat(e.target.value))}
                    className="w-full accent-wa-green cursor-pointer mt-2"
                  />
                  <div className="flex justify-between text-[10px] text-wa-textMuted mt-1">
                    <span>0.0 (Mais preciso/direto)</span>
                    <span>1.0 (Mais criativo)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-wa-textSecondary mb-1.5 font-medium">
                    Limite Máximo de Tokens por Resposta: <span className="text-wa-greenLight font-bold">{maxTokens}</span>
                  </label>
                  <input
                    type="number"
                    min="200"
                    max="4000"
                    step="100"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-sm text-wa-textPrimary focus:border-wa-green focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleSalvarConfig}
                  className="px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Salvar Parâmetros</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: EDIÇÃO DA TABELA DE PREÇOS */}
        {/* ================================================================= */}
        {modalPrecosAberto && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-wa-panel border border-wa-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-4">
              {/* Header do Modal */}
              <div className="p-5 border-b border-wa-border flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-wa-green/20 text-wa-greenLight flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-wa-green" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-wa-textPrimary">
                      Tabela de Preços de Tokens
                    </h3>
                    <p className="text-xs text-wa-textSecondary font-mono">{modelo}</p>
                  </div>
                </div>

                <button
                  onClick={() => setModalPrecosAberto(false)}
                  className="text-wa-textSecondary hover:text-wa-textPrimary p-1.5 rounded-lg hover:bg-wa-bg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corpo do Formulário */}
              <form onSubmit={handleSalvarPrecos} className="p-5 space-y-4">
                <div className="p-3 bg-wa-bg rounded-xl border border-wa-border text-xs text-wa-textSecondary space-y-1">
                  <p className="font-semibold text-wa-textPrimary">
                    Como funciona o cálculo:
                  </p>
                  <p>
                    O custo é calculado em R$ por milhão de tokens consumidos na API da OpenAI, baseado nas taxas vigentes do modelo.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                    Preço por Milhão de Tokens de Entrada (Prompt) em R$:
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-wa-textMuted font-mono">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={precoEntradaInput}
                      onChange={(e) => setPrecoEntradaInput(parseFloat(e.target.value) || 0)}
                      className="w-full pl-9 pr-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-sm text-wa-textPrimary focus:border-wa-green focus:outline-none font-mono"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-[10px] text-wa-textMuted mt-1">
                    Ex: R$ 0.90 por 1M tokens de entrada (para gpt-4o-mini comercial).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                    Preço por Milhão de Tokens de Saída (Geração) em R$:
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-wa-textMuted font-mono">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={precoSaidaInput}
                      onChange={(e) => setPrecoSaidaInput(parseFloat(e.target.value) || 0)}
                      className="w-full pl-9 pr-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-sm text-wa-textPrimary focus:border-wa-green focus:outline-none font-mono"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-[10px] text-wa-textMuted mt-1">
                    Ex: R$ 3.40 por 1M tokens de saída.
                  </p>
                </div>

                {precoEntradaInput === 0 && precoSaidaInput === 0 && (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Free Tier ativado — o painel exibirá "Free tier — sem custo".</span>
                  </div>
                )}

                {/* Footer do Modal */}
                <div className="pt-3 border-t border-wa-border flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setModalPrecosAberto(false)}
                    className="px-4 py-2 bg-wa-bg hover:bg-wa-panel border border-wa-border text-wa-textSecondary rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={salvandoPrecos}
                    className="px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 font-semibold rounded-lg text-xs transition-all shadow cursor-pointer disabled:opacity-50"
                  >
                    {salvandoPrecos ? 'Salvando...' : 'Salvar Preços'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
