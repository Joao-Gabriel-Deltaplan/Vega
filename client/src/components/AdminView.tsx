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
  Layers,
  FileSpreadsheet,
  Check,
  X,
  TrendingUp,
  Users,
  Sliders,
  MessageSquare,
  Mic,
  Eye,
  FileText,
  Binary,
  Info,
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

  // Estado de Edição de Configurações de IA (Limite OpenAI & Cotação do Dólar)
  const [modalConfigIAAberto, setModalConfigIAAberto] = useState(false);
  const [limiteMensalInput, setLimiteMensalInput] = useState<number>(10.0);
  const [cotacaoDolarInput, setCotacaoDolarInput] = useState<number>(5.60);
  const [salvandoConfigIA, setSalvandoConfigIA] = useState(false);

  // Modo de visualização do gráfico de 30 dias
  const [modoVisualizacaoGrafico, setModoVisualizacaoGrafico] = useState<'custo_usd' | 'custo_brl' | 'chamadas'>('custo_usd');

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
        if (dados.limiteMensalUsd !== undefined) setLimiteMensalInput(dados.limiteMensalUsd);
        if (dados.cotacaoDolar !== undefined) setCotacaoDolarInput(dados.cotacaoDolar);
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

  const handleSalvarConfigIA = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvandoConfigIA(true);
    try {
      const res = await fetch('/api/uso-ia/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limiteMensalUsd: Number(limiteMensalInput),
          cotacaoDolar: Number(cotacaoDolarInput),
        }),
      });

      if (res.ok) {
        setModalConfigIAAberto(false);
        setMensagemSalvo('Configurações de limite da OpenAI e cotação do dólar atualizadas!');
        setTimeout(() => setMensagemSalvo(''), 3000);
        await carregarMetricasIA();
      }
    } catch (err) {
      console.error('Erro ao salvar configuração de IA:', err);
    } finally {
      setSalvandoConfigIA(false);
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
    <div className="flex-1 h-full bg-[#0b0f14] overflow-y-auto p-6 text-slate-100">
      <div className="max-w-5xl mx-auto space-y-6 pb-16">
        {/* Header Principal com Alternador de Sub-Abas Padronizado */}
        <div className="border-b border-[#1e2633] pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
                <Settings className="w-5 h-5" />
              </div>
              <h1 className="text-base font-semibold text-slate-100">
                Painel de Configurações & Métricas • {ASSISTENTE.nome}
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Monitoramento de cotas de IA, tarifas de tokens, custos operacionais e saúde dos serviços
            </p>
          </div>

          {/* Seletor de Sub-Abas Estilo Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-[#121820] border border-[#202937] rounded-xl self-start md:self-auto">
            <button
              onClick={() => setSubAba('uso_ia')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                subAba === 'uso_ia'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202b]'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Consumo da IA</span>
              {metricasIA?.alertaRPD && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              )}
            </button>
            <button
              onClick={() => setSubAba('geral')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                subAba === 'geral'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#18202b]'
              }`}
            >
              <FolderLock className="w-4 h-4" />
              <span>Serviços & Cofre</span>
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
            {/* ALERTAS VISUAIS DE LIMITE OPENAI (50% e 80%) E RPD */}
            {metricasIA?.limiteExcedido && (
              <div className="p-4 bg-rose-500/20 border border-rose-500/50 text-rose-200 rounded-xl text-xs flex items-start justify-between gap-3 shadow-lg animate-fadeIn">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-rose-300 text-sm">
                      Limite Mensal da OpenAI Excedido (US$ {metricasIA.gastoMesUsd.toFixed(4)} / US$ {metricasIA.limiteMensalUsd.toFixed(2)})!
                    </p>
                    <p className="text-rose-200/90 text-xs mt-1">
                      O consumo deste mês atingiu {metricasIA.percentualLimiteMensal}% do limite configurado. Considere aumentar o limite da OpenAI ou monitorar o volume de requisições.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalConfigIAAberto(true)}
                  className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-slate-950 font-bold rounded-lg text-xs transition-colors flex-shrink-0 cursor-pointer"
                >
                  Ajustar Limite
                </button>
              </div>
            )}

            {!metricasIA?.limiteExcedido && metricasIA?.alerta80 && (
              <div className="p-4 bg-rose-500/15 border border-rose-500/40 text-rose-200 rounded-xl text-xs flex items-center justify-between gap-3 shadow animate-fadeIn">
                <div className="flex items-center gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-rose-300 text-sm">
                      Alerta Crítico: {metricasIA.percentualLimiteMensal}% do Limite Mensal da OpenAI consumido!
                    </p>
                    <p className="text-rose-200/80 text-[11px] mt-0.5">
                      Gasto atual de US$ {metricasIA.gastoMesUsd.toFixed(4)} (R$ {metricasIA.gastoMesBrl.toFixed(2)}) de um limite de US$ {metricasIA.limiteMensalUsd.toFixed(2)}.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalConfigIAAberto(true)}
                  className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Configurar
                </button>
              </div>
            )}

            {!metricasIA?.limiteExcedido && !metricasIA?.alerta80 && metricasIA?.alerta50 && (
              <div className="p-3.5 bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded-xl text-xs flex items-center justify-between gap-3 shadow animate-fadeIn">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-amber-300">
                      Atenção: Consumo ultrapassou 50% do limite mensal da OpenAI ({metricasIA.percentualLimiteMensal}%)
                    </p>
                    <p className="text-amber-200/80 text-[11px] mt-0.5">
                      Foram consumidos US$ {metricasIA.gastoMesUsd.toFixed(4)} (R$ {metricasIA.gastoMesBrl.toFixed(2)}) da cota de US$ {metricasIA.limiteMensalUsd.toFixed(2)}.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalConfigIAAberto(true)}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Ver Limite
                </button>
              </div>
            )}

            {metricasIA?.requisicoesHoje !== undefined &&
              metricasIA.limiteRPD !== undefined &&
              metricasIA.requisicoesHoje >= metricasIA.limiteRPD && (
                <div className="p-3.5 bg-rose-500/20 border border-rose-500/50 text-rose-200 rounded-xl text-xs flex items-center gap-3 shadow">
                  <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-rose-300">
                      Limite diário RPD atingido ({metricasIA.requisicoesHoje}/{metricasIA.limiteRPD})!
                    </p>
                    <p className="text-rose-200/80 text-[11px] mt-0.5">
                      Consultas inteligentes pausadas até meia-noite. A busca determinística no cofre segue 100% ativa.
                    </p>
                  </div>
                </div>
              )}

            {/* BARRA SUPERIOR DE INFORMAÇÕES E CONFIGURAÇÃO */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-[#121820] p-3.5 rounded-xl border border-[#1e2633]">
              <div className="flex flex-wrap items-center gap-2 text-slate-300">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Activity className="w-4 h-4" />
                  <span>Consumo OpenAI</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="px-2 py-0.5 rounded bg-[#182230] border border-[#233145] text-slate-200 font-mono text-[11px]">
                  {modelo}
                </span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1 text-slate-400 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Fuso: Brasília (UTC-3)</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 text-[11px]">
                  Cotação Dólar: <strong className="text-slate-200 font-mono">R$ {(metricasIA?.cotacaoDolar ?? 5.60).toFixed(2)}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={carregarMetricasIA}
                  disabled={carregandoMetricas}
                  className="px-3 py-1.5 bg-[#182230] hover:bg-[#202d40] border border-[#233145] text-slate-200 rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="Atualizar métricas agora"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${carregandoMetricas ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>{carregandoMetricas ? 'Atualizando...' : 'Atualizar'}</span>
                </button>

                <button
                  onClick={() => setModalConfigIAAberto(true)}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                  title="Editar limite da OpenAI e cotação do dólar"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Limite & Cotação</span>
                </button>

                <button
                  onClick={() => setModalPrecosAberto(true)}
                  className="px-3 py-1.5 bg-[#182230] hover:bg-[#202d40] border border-[#233145] text-slate-300 rounded-lg text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Tabela de preços por milhão de tokens"
                >
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Tarifas</span>
                </button>
              </div>
            </div>

            {/* SKELETON LOADING STATE */}
            {carregandoMetricas && !metricasIA && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="p-5 bg-[#121820] border border-[#1e2633] rounded-xl h-36">
                    <div className="h-4 bg-[#1a2332] rounded w-2/3 mb-4"></div>
                    <div className="h-8 bg-[#1a2332] rounded w-1/2 mb-3"></div>
                    <div className="h-3 bg-[#1a2332] rounded w-4/5"></div>
                  </div>
                ))}
              </div>
            )}

            {/* GRID DE 4 CARDS DE MÉTRICAS PRINCIPAIS (MÊS ATUAL NO FUSO DE BRASÍLIA) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CARD 1: Gasto no Mês Atual */}
              <div className="p-4 bg-[#121820] border border-[#1e2633] rounded-xl flex flex-col justify-between hover:border-[#2a3649] transition-colors">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Gasto no Mês Atual</span>
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-100 font-mono">
                      US$ {(metricasIA?.gastoMesUsd ?? 0).toFixed(4)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span className="font-semibold text-emerald-400 font-mono">
                      R$ {(metricasIA?.gastoMesBrl ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      (dólar a R$ {(metricasIA?.cotacaoDolar ?? 5.60).toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* Barra do Limite OpenAI com marcadores de 50% e 80% */}
                <div className="mt-3.5 pt-3 border-t border-[#1e2633]/60">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Limite OpenAI</span>
                    <span
                      className={`font-bold font-mono ${
                        (metricasIA?.percentualLimiteMensal ?? 0) >= 80
                          ? 'text-rose-400'
                          : (metricasIA?.percentualLimiteMensal ?? 0) >= 50
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {metricasIA?.percentualLimiteMensal ?? 0}% de US$ {(metricasIA?.limiteMensalUsd ?? 10).toFixed(2)}
                    </span>
                  </div>
                  <div className="relative w-full h-2 bg-[#0b0f14] rounded-full overflow-hidden border border-[#202937]">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        (metricasIA?.percentualLimiteMensal ?? 0) >= 80
                          ? 'bg-rose-500'
                          : (metricasIA?.percentualLimiteMensal ?? 0) >= 50
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(metricasIA?.percentualLimiteMensal ?? 0, 100)}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-500 mt-1 font-mono">
                    <span>0%</span>
                    <span className="text-amber-500/70">50%</span>
                    <span className="text-rose-500/70">80%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* CARD 2: Requisições do Mês */}
              <div className="p-4 bg-[#121820] border border-[#1e2633] rounded-xl flex flex-col justify-between hover:border-[#2a3649] transition-colors">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Requisições no Mês</span>
                    <Activity className="w-4 h-4 text-sky-400" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-100 font-mono">
                      {(metricasIA?.requisicoesMes ?? 0).toLocaleString('pt-BR')}
                    </span>
                    <span className="text-xs text-slate-500">chamadas</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Hoje: <strong className="text-slate-200">{metricasIA?.requisicoesHoje ?? 0}</strong> chamadas ({metricasIA?.percentualRPD ?? 0}% RPD)
                  </p>
                </div>

                <div className="mt-3.5 pt-3 border-t border-[#1e2633]/60">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Taxa por Minuto (RPM)</span>
                    <span className="text-slate-300 font-mono text-[10px]">
                      {metricasIA?.requisicoesUltimoMinuto ?? 0} / {metricasIA?.limiteRPM ?? 10} rpm
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#0b0f14] rounded-full overflow-hidden border border-[#202937]">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        (metricasIA?.requisicoesUltimoMinuto ?? 0) >= (metricasIA?.limiteRPM ?? 10)
                          ? 'bg-rose-500'
                          : 'bg-sky-400'
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

              {/* CARD 3: Consumo de Tokens no Mês */}
              <div className="p-4 bg-[#121820] border border-[#1e2633] rounded-xl flex flex-col justify-between hover:border-[#2a3649] transition-colors">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Tokens no Mês</span>
                    <Layers className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-100 font-mono">
                      {(metricasIA?.totalTokensMes ?? 0).toLocaleString('pt-BR')}
                    </span>
                    <span className="text-xs text-slate-500">tokens</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      In: <strong className="text-sky-400 font-mono">{(metricasIA?.tokensEntradaMes ?? 0).toLocaleString('pt-BR')}</strong>
                    </span>
                    <span>
                      Out: <strong className="text-emerald-400 font-mono">{(metricasIA?.tokensSaidaMes ?? 0).toLocaleString('pt-BR')}</strong>
                    </span>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-[#1e2633]/60">
                  <div className="w-full h-2 bg-[#0b0f14] rounded-full overflow-hidden flex border border-[#202937]">
                    <div
                      className="bg-sky-400 h-full transition-all"
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
                      className="bg-emerald-400 h-full transition-all"
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
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky-400"></span> Entrada
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Saída
                    </span>
                  </div>
                </div>
              </div>

              {/* CARD 4: Custo Médio por Mensagem */}
              <div className="p-4 bg-[#121820] border border-[#1e2633] rounded-xl flex flex-col justify-between hover:border-[#2a3649] transition-colors">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Custo por Mensagem</span>
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-100 font-mono">
                      US$ {(metricasIA?.custoMedioPorMensagemUsd ?? 0).toFixed(5)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono font-medium">
                    <span>R$ {(metricasIA?.custoMedioPorMensagemBrl ?? 0).toFixed(4)}</span>
                    <span className="text-slate-500 text-[10px] font-sans font-normal">por resposta VEGA</span>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-[#1e2633]/60 text-[11px] text-slate-400">
                  <div className="flex justify-between items-center mb-0.5">
                    <span>Mensagens respondidas:</span>
                    <strong className="text-slate-200 font-mono">{metricasIA?.totalMensagensRespondidasMes ?? 0}</strong>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500">
                    <span>Custo médio por requisição:</span>
                    <span className="font-mono text-slate-400">US$ {(metricasIA?.custoMedioPorRequisicaoUsd ?? 0).toFixed(5)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* GRÁFICO DE GASTO POR DIA (ÚLTIMOS 30 DIAS NO FUSO DE BRASÍLIA) */}
            <div className="p-5 bg-[#121820] border border-[#1e2633] rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-emerald-400" />
                    Consumo Diário dos Últimos 30 Dias (Horário de Brasília)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Acompanhamento dia a dia do gasto e volume de requisições disparadas à OpenAI
                  </p>
                </div>

                {/* Seletor do Modo de Visualização do Gráfico */}
                <div className="flex items-center gap-1 p-1 bg-[#0b0f14] border border-[#1e2633] rounded-lg self-start sm:self-auto text-xs">
                  <button
                    onClick={() => setModoVisualizacaoGrafico('custo_usd')}
                    className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                      modoVisualizacaoGrafico === 'custo_usd'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Gasto (US$)
                  </button>
                  <button
                    onClick={() => setModoVisualizacaoGrafico('custo_brl')}
                    className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                      modoVisualizacaoGrafico === 'custo_brl'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Gasto (R$)
                  </button>
                  <button
                    onClick={() => setModoVisualizacaoGrafico('chamadas')}
                    className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                      modoVisualizacaoGrafico === 'chamadas'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Requisições
                  </button>
                </div>
              </div>

              {/* Área do Gráfico */}
              <div className="pt-2 pb-1">
                {(() => {
                  const dias = metricasIA?.grafico30Dias || [];
                  if (dias.length === 0) {
                    return (
                      <div className="p-8 text-center text-slate-500 text-xs bg-[#0b0f14]/50 rounded-xl border border-dashed border-[#1e2633]">
                        Nenhum registro de uso nos últimos 30 dias.
                      </div>
                    );
                  }

                  let maxValor = 0;
                  if (modoVisualizacaoGrafico === 'custo_usd') {
                    maxValor = Math.max(...dias.map((d) => d.custoUsd), 0.005);
                  } else if (modoVisualizacaoGrafico === 'custo_brl') {
                    maxValor = Math.max(...dias.map((d) => d.custoBrl), 0.02);
                  } else {
                    maxValor = Math.max(...dias.map((d) => d.chamadas), 5);
                  }

                  return (
                    <div className="space-y-2">
                      <div className="h-44 flex items-end gap-1.5 px-3 bg-[#0b0f14]/60 rounded-xl border border-[#1e2633]/60 pt-6 pb-2">
                        {dias.map((d, idx) => {
                          let valorAtual = 0;
                          let textoValor = '';

                          if (modoVisualizacaoGrafico === 'custo_usd') {
                            valorAtual = d.custoUsd;
                            textoValor = `US$ ${d.custoUsd.toFixed(4)}`;
                          } else if (modoVisualizacaoGrafico === 'custo_brl') {
                            valorAtual = d.custoBrl;
                            textoValor = `R$ ${d.custoBrl.toFixed(2)}`;
                          } else {
                            valorAtual = d.chamadas;
                            textoValor = `${d.chamadas} reqs`;
                          }

                          const alturaPct = maxValor > 0 ? Math.round((valorAtual / maxValor) * 100) : 0;
                          const isHoje = idx === dias.length - 1;

                          return (
                            <div
                              key={d.data}
                              className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer"
                            >
                              {/* Tooltip no Hover */}
                              <div className="absolute -top-16 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-slate-900 text-slate-100 text-[10px] p-2 rounded-lg shadow-xl border border-[#2a3649] pointer-events-none whitespace-nowrap z-30">
                                <p className="font-bold text-emerald-400">{d.diaMes} {isHoje ? '(Hoje)' : ''} • {textoValor}</p>
                                <p className="text-slate-200 font-mono">
                                  US$ {d.custoUsd.toFixed(4)} <span className="text-slate-400">/ R$ {d.custoBrl.toFixed(2)}</span>
                                </p>
                                <p className="text-slate-400 text-[9px]">
                                  {d.chamadas} chamadas • {d.tokens.toLocaleString('pt-BR')} tokens
                                </p>
                              </div>

                              {/* Barra Vertical */}
                              <div
                                className={`w-full rounded-t-sm transition-all duration-300 ${
                                  valorAtual > 0
                                    ? isHoje
                                      ? 'bg-emerald-400 hover:bg-emerald-300 shadow-sm shadow-emerald-500/20'
                                      : 'bg-emerald-600 hover:bg-emerald-400'
                                    : 'bg-[#182230]/40 hover:bg-[#182230]'
                                }`}
                                style={{
                                  height: `${Math.max(alturaPct, 4)}%`,
                                }}
                              ></div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Legenda de Datas */}
                      <div className="flex justify-between text-[10px] text-slate-400 px-3 font-mono pt-1">
                        <span>{dias[0].diaMes} (30 dias atrás)</span>
                        <span>{dias[Math.floor(dias.length / 2)].diaMes}</span>
                        <span className="text-emerald-400 font-bold">Hoje ({dias[dias.length - 1].diaMes})</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* SEÇÃO: DIVISÃO DO GASTO POR ORIGEM (O QUE MAIS CONSOME) */}
            <div className="p-5 bg-[#121820] border border-[#1e2633] rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Divisão do Gasto por Origem (O que mais consome)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Classificação proporcional das requisições para identificar os maiores geradores de custo
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  Gasto Mês: US$ {(metricasIA?.gastoMesUsd ?? 0).toFixed(4)}
                </span>
              </div>

              {/* Grid das Origens */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(metricasIA?.divisaoOrigens || []).map((origem) => {
                  let icone = <MessageSquare className="w-4 h-4" />;
                  if (origem.chave === 'transcricao_audio') icone = <Mic className="w-4 h-4" />;
                  if (origem.chave === 'ocr') icone = <Eye className="w-4 h-4" />;
                  if (origem.chave === 'indexacao') icone = <FileText className="w-4 h-4" />;
                  if (origem.chave === 'embeddings') icone = <Binary className="w-4 h-4" />;
                  if (origem.chave === 'testes') icone = <Sliders className="w-4 h-4" />;

                  return (
                    <div
                      key={origem.chave}
                      className="p-3.5 bg-[#0b0f14]/60 border border-[#1e2633] rounded-xl flex flex-col justify-between hover:border-[#2a3649] transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2" style={{ color: origem.cor }}>
                            {icone}
                            <span className="text-xs font-semibold text-slate-200">{origem.nome}</span>
                          </div>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: `${origem.cor}20`,
                              color: origem.cor,
                              border: `1px solid ${origem.cor}40`,
                            }}
                          >
                            {origem.percentual}%
                          </span>
                        </div>

                        <div className="mt-2.5 flex items-baseline justify-between">
                          <span className="text-base font-bold text-slate-100 font-mono">
                            US$ {origem.custoUsd.toFixed(4)}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            R$ {origem.custoBrl.toFixed(2)}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{origem.chamadas} requisições</span>
                          <span>{origem.tokens.toLocaleString('pt-BR')} tokens</span>
                        </div>
                      </div>

                      {/* Barra de Proporção da Origem */}
                      <div className="mt-3">
                        <div className="w-full h-1.5 bg-[#121820] rounded-full overflow-hidden border border-[#1e2633]">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(origem.percentual, 100)}%`,
                              backgroundColor: origem.cor,
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SEÇÃO: DIVISÃO POR PESSOA (QUEM MAIS USA A VEGA PELO WHATSAPP) */}
            <div className="p-5 bg-[#121820] border border-[#1e2633] rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Divisão por Pessoa (Quem mais usa pelo WhatsApp)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ranking de usuários internos e diretoria por volume de uso e custo gerado
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {metricasIA?.divisaoPessoas?.length ?? 0} usuários registrados
                </span>
              </div>

              {(!metricasIA?.divisaoPessoas || metricasIA.divisaoPessoas.length === 0) ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-[#0b0f14]/50 rounded-xl border border-dashed border-[#1e2633]">
                  Nenhum registro vinculado a pessoas no período apurado.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#1e2633] rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#0b0f14] text-slate-400 border-b border-[#1e2633] text-[11px]">
                        <th className="py-2.5 px-3 font-semibold w-12 text-center">Posição</th>
                        <th className="py-2.5 px-3 font-semibold">Pessoa / Contato WhatsApp</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Requisições</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Tokens Consumidos</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Custo Total (US$ / R$)</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Custo Médio / Req</th>
                        <th className="py-2.5 px-3 font-semibold w-28 text-center">Participação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2633]/60 bg-[#121820]">
                      {metricasIA.divisaoPessoas.map((p, idx) => {
                        const ehTop1 = idx === 0;
                        const ehTop2 = idx === 1;
                        const ehTop3 = idx === 2;

                        return (
                          <tr key={p.contatoId || idx} className="hover:bg-[#182230]/50 transition-colors">
                            {/* Posição / Medalha */}
                            <td className="py-2.5 px-3 text-center">
                              {ehTop1 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400/20 text-amber-300 font-bold text-xs border border-amber-400/30">
                                  1º
                                </span>
                              ) : ehTop2 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300/20 text-slate-200 font-bold text-xs border border-slate-300/30">
                                  2º
                                </span>
                              ) : ehTop3 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-500 font-bold text-xs border border-amber-700/30">
                                  3º
                                </span>
                              ) : (
                                <span className="text-slate-500 font-mono text-xs">{idx + 1}º</span>
                              )}
                            </td>

                            {/* Nome / Contato */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                                  {p.contatoNome ? p.contatoNome.charAt(0).toUpperCase() : 'U'}
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-100">{p.contatoNome}</p>
                                  {p.contatoId && p.contatoId !== p.contatoNome && (
                                    <p className="text-[10px] text-slate-500 font-mono">{p.contatoId}</p>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Requisições */}
                            <td className="py-2.5 px-3 text-center font-mono text-slate-200 font-semibold">
                              {p.chamadas}
                            </td>

                            {/* Tokens */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-300 text-[11px]">
                              {p.tokens.toLocaleString('pt-BR')}
                            </td>

                            {/* Custo Total */}
                            <td className="py-2.5 px-3 text-right font-mono">
                              <span className="font-bold text-slate-100">US$ {p.custoUsd.toFixed(4)}</span>
                              <span className="block text-[10px] text-emerald-400">R$ {p.custoBrl.toFixed(2)}</span>
                            </td>

                            {/* Custo Médio por Requisição */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-400 text-[11px]">
                              <span>US$ {p.custoMedioUsd.toFixed(5)}</span>
                            </td>

                            {/* Barra de Participação */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-[#0b0f14] rounded-full overflow-hidden border border-[#202937]">
                                  <div
                                    className="h-full bg-emerald-500 rounded-full"
                                    style={{ width: `${Math.min(p.percentual, 100)}%` }}
                                  ></div>
                                </div>
                                <span className="text-[10px] font-mono text-slate-400 w-7 text-right">
                                  {p.percentual}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* TABELA DAS ÚLTIMAS 50 CHAMADAS AO MODELO */}
            <div className="p-5 bg-[#121820] border border-[#1e2633] rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-sky-400" />
                    Últimas 50 Chamadas ao Modelo de IA
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Histórico detalhado registrado no Supabase (tabela <code>uso_ia</code>)
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {metricasIA?.ultimas50Chamadas?.length ?? 0} chamadas listadas
                </span>
              </div>

              {(!metricasIA?.ultimas50Chamadas || metricasIA.ultimas50Chamadas.length === 0) ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-[#0b0f14]/50 rounded-xl border border-dashed border-[#1e2633]">
                  Nenhuma chamada registrada no histórico até o momento.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#1e2633] rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#0b0f14] text-slate-400 border-b border-[#1e2633] text-[11px]">
                        <th className="py-2.5 px-3 font-semibold">Data / Hora (Brasília)</th>
                        <th className="py-2.5 px-3 font-semibold">Contato</th>
                        <th className="py-2.5 px-3 font-semibold">Origem / Motivo</th>
                        <th className="py-2.5 px-3 font-semibold">Tokens (In / Out)</th>
                        <th className="py-2.5 px-3 font-semibold">Custo Estimado</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2633]/60 bg-[#121820]">
                      {metricasIA.ultimas50Chamadas.map((ch) => {
                        const dataObj = new Date(ch.data);
                        const dataStr = dataObj.toLocaleDateString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                          day: '2-digit',
                          month: '2-digit',
                        });
                        const horaStr = dataObj.toLocaleTimeString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });

                        const custoBrlChamada = ch.custoEstimado * (metricasIA?.cotacaoDolar ?? 5.60);

                        return (
                          <tr key={ch.id} className="hover:bg-[#182230]/40 transition-colors">
                            <td className="py-2 px-3 whitespace-nowrap text-slate-200 font-mono text-[11px]">
                              <span>{dataStr}</span> <span className="text-slate-500">{horaStr}</span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-200 font-medium">
                              {ch.contatoNome || (ch.contatoId ? `Contato (${ch.contatoId})` : 'Sistema')}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                  ch.motivo?.includes('audio') || ch.motivo?.includes('transcricao')
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : ch.motivo?.includes('ocr') || ch.motivo?.includes('visao')
                                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                    : ch.motivo?.includes('embedding')
                                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                                    : ch.motivo?.startsWith('indexacao')
                                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                                    : ch.motivo?.startsWith('teste')
                                    ? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                }`}
                              >
                                {ch.motivo || 'chat'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                              <span className="text-sky-400 font-semibold">{ch.tokensEntrada}</span> in /{' '}
                              <span className="text-emerald-400 font-semibold">{ch.tokensSaida}</span> out
                              {ch.estimado && (
                                <span className="ml-1.5 px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px]">
                                  est.
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                              <span className="text-slate-100 font-semibold">US$ {ch.custoEstimado.toFixed(5)}</span>
                              <span className="ml-1.5 text-slate-500 text-[10px]">(R$ {custoBrlChamada.toFixed(4)})</span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-center">
                              {ch.sucesso ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>OK</span>
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
        {/* MODAL: EDIÇÃO DO LIMITE OPENAI & COTAÇÃO DO DÓLAR */}
        {/* ================================================================= */}
        {modalConfigIAAberto && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-[#121820] border border-[#1e2633] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-0 text-slate-100">
              {/* Header do Modal */}
              <div className="p-5 border-b border-[#1e2633] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center justify-center">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Limite da OpenAI & Cotação do Dólar
                    </h3>
                    <p className="text-xs text-slate-400">
                      Parâmetros orçamentários do assistente Delta Plan
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setModalConfigIAAberto(false)}
                  className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-[#182230] transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corpo do Formulário */}
              <form onSubmit={handleSalvarConfigIA} className="p-5 space-y-4">
                <div className="p-3 bg-[#0b0f14] rounded-xl border border-[#1e2633] text-xs text-slate-300 space-y-1">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <Info className="w-4 h-4 flex-shrink-0" />
                    <span>Autonomia e Previsibilidade</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    A cotação é salva localmente no banco para que o cálculo não falhe caso serviços externos de câmbio fiquem fora do ar. Os alertas visuais disparam aos 50% e 80% do limite configurado.
                  </p>
                </div>

                {/* Campo 1: Limite Mensal da OpenAI */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Limite Mensal Contratado na OpenAI (em US$):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">
                      US$
                    </span>
                    <input
                      type="number"
                      step="0.50"
                      min="1"
                      required
                      value={limiteMensalInput}
                      onChange={(e) => setLimiteMensalInput(parseFloat(e.target.value) || 0)}
                      className="w-full pl-11 pr-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-lg text-sm text-slate-100 focus:border-emerald-500 focus:outline-none font-mono font-bold"
                      placeholder="10.00"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Aviso em 50%: <strong className="text-amber-400 font-mono">US$ {(limiteMensalInput * 0.5).toFixed(2)}</strong> | Alerta crítico em 80%: <strong className="text-rose-400 font-mono">US$ {(limiteMensalInput * 0.8).toFixed(2)}</strong>
                  </p>
                </div>

                {/* Campo 2: Cotação Fixa do Dólar */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Cotação Fixa do Dólar (R$ por 1 USD):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      min="1"
                      required
                      value={cotacaoDolarInput}
                      onChange={(e) => setCotacaoDolarInput(parseFloat(e.target.value) || 0)}
                      className="w-full pl-10 pr-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-lg text-sm text-slate-100 focus:border-emerald-500 focus:outline-none font-mono font-bold"
                      placeholder="5.60"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Teto mensal equivalente em moeda nacional: <strong className="text-emerald-400 font-mono">R$ {(limiteMensalInput * cotacaoDolarInput).toFixed(2)}</strong>
                  </p>
                </div>

                {/* Footer do Modal */}
                <div className="pt-3 border-t border-[#1e2633] flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setModalConfigIAAberto(false)}
                    className="px-4 py-2 bg-[#182230] hover:bg-[#202d40] border border-[#233145] text-slate-300 rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={salvandoConfigIA}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition-all shadow cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{salvandoConfigIA ? 'Salvando...' : 'Salvar Configurações'}</span>
                  </button>
                </div>
              </form>
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
