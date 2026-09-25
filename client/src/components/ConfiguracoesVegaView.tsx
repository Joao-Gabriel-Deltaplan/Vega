import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Sparkles,
  Bot,
  RotateCcw,
  Save,
  Clock,
  User,
  History,
  AlertCircle,
  CheckCircle2,
  Lock,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  RefreshCw,
  Cpu,
  Bell,
} from 'lucide-react';
import { ConfiguracaoAvisosSection } from './ConfiguracaoAvisosSection';

interface ConfiguracaoVega {
  id: string;
  promptPersona: string;
  temperaturaResposta: number;
  atualizadoPorNome?: string;
  atualizadoPorId?: string;
  atualizadoEm?: string;
}

interface VersaoHistoricoVega {
  id: string;
  promptPersona: string;
  temperaturaResposta: number;
  autorNome: string;
  autorId: string;
  motivo?: string;
  criadoEm: string;
}

interface ModelosEmUso {
  chat: string;
  embeddings: string;
  transcricao: string;
  regrasOficiais: string;
}

/**
 * Formata timestamp ISO para o Fuso Oficial de Brasília (America/Sao_Paulo)
 */
function formatarDataBrasilia(isoStr?: string): string {
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

export const ConfiguracoesVegaView: React.FC = () => {
  const [configuracao, setConfiguracao] = useState<ConfiguracaoVega | null>(null);
  const [modelos, setModelos] = useState<ModelosEmUso | null>(null);
  const [historico, setHistorico] = useState<VersaoHistoricoVega[]>([]);

  // Campos do formulário
  const [promptEditado, setPromptEditado] = useState('');
  const [temperaturaEditada, setTemperaturaEditada] = useState(0.1);

  // Aba selecionada
  const [abaAtiva, setAbaAtiva] = useState<'persona' | 'avisos'>('persona');

  // Estados de interface
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [restaurandoPadrao, setRestaurandoPadrao] = useState(false);
  const [restaurandoVersaoId, setRestaurandoVersaoId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Blocos recolhidos por padrão
  const [versaoPreview, setVersaoPreview] = useState<VersaoHistoricoVega | null>(null);
  const [historicoExpandido, setHistoricoExpandido] = useState(false);
  const [tecnicaExpandida, setTecnicaExpandida] = useState(false);

  // Carrega configurações, modelos e histórico
  const carregarDados = async () => {
    setCarregando(true);
    try {
      const [resConfig, resHist] = await Promise.all([
        fetch('/api/configuracoes-vega'),
        fetch('/api/configuracoes-vega/historico'),
      ]);

      if (resConfig.ok) {
        const json = await resConfig.json();
        if (json.configuracoes) {
          setConfiguracao(json.configuracoes);
          setPromptEditado(json.configuracoes.promptPersona || '');
          setTemperaturaEditada(Number(json.configuracoes.temperaturaResposta ?? 0.1));
        }
        if (json.modelos) {
          setModelos(json.modelos);
        }
      } else {
        const erroJson = await resConfig.json().catch(() => ({}));
        setFeedback({
          tipo: 'erro',
          texto: erroJson.erro || 'Falha ao carregar configurações da VEGA.',
        });
      }

      if (resHist.ok) {
        const jsonHist = await resHist.json();
        if (Array.isArray(jsonHist.historico)) {
          setHistorico(jsonHist.historico);
        }
      }
    } catch (err: any) {
      console.error('Erro ao buscar configurações:', err);
      setFeedback({
        tipo: 'erro',
        texto: 'Não foi possível se conectar à API para obter as configurações.',
      });
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const exibirFeedbackTemporario = (tipo: 'sucesso' | 'erro', texto: string) => {
    setFeedback({ tipo, texto });
    setTimeout(() => {
      setFeedback(null);
    }, 4500);
  };

  // Salvar alterações
  const handleSalvar = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!promptEditado.trim()) {
      exibirFeedbackTemporario('erro', 'O prompt da persona não pode ficar em branco.');
      return;
    }

    setSalvando(true);
    try {
      const res = await fetch('/api/configuracoes-vega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptPersona: promptEditado,
          temperaturaResposta: Number(temperaturaEditada),
        }),
      });

      const json = await res.json();
      if (res.ok && json.sucesso) {
        setConfiguracao(json.configuracoes);
        exibirFeedbackTemporario(
          'sucesso',
          'Configurações salvas no Supabase com sucesso! Em vigor imediatamente no WhatsApp e Painel.'
        );
        // Atualiza histórico
        const resHist = await fetch('/api/configuracoes-vega/historico');
        if (resHist.ok) {
          const jsonHist = await resHist.json();
          if (Array.isArray(jsonHist.historico)) setHistorico(jsonHist.historico);
        }
      } else {
        exibirFeedbackTemporario('erro', json.erro || 'Falha ao salvar configurações.');
      }
    } catch (err: any) {
      console.error('Erro ao salvar configurações:', err);
      exibirFeedbackTemporario('erro', 'Erro de conexão ao salvar alterações.');
    } finally {
      setSalvando(false);
    }
  };

  // Restaurar padrão oficial
  const handleRestaurarPadrao = async () => {
    const confirmou = window.confirm(
      'Deseja realmente restaurar o prompt padrão da persona e temperatura 0.1? Uma nova versão será gravada no histórico.'
    );
    if (!confirmou) return;

    setRestaurandoPadrao(true);
    try {
      const res = await fetch('/api/configuracoes-vega/restaurar-padrao', {
        method: 'POST',
      });

      const json = await res.json();
      if (res.ok && json.sucesso) {
        setConfiguracao(json.configuracoes);
        setPromptEditado(json.configuracoes.promptPersona);
        setTemperaturaEditada(Number(json.configuracoes.temperaturaResposta));
        exibirFeedbackTemporario('sucesso', 'Prompt padrão restaurado com sucesso!');
        // Atualiza histórico
        const resHist = await fetch('/api/configuracoes-vega/historico');
        if (resHist.ok) {
          const jsonHist = await resHist.json();
          if (Array.isArray(jsonHist.historico)) setHistorico(jsonHist.historico);
        }
      } else {
        exibirFeedbackTemporario('erro', json.erro || 'Erro ao restaurar padrão.');
      }
    } catch (err) {
      exibirFeedbackTemporario('erro', 'Erro de conexão ao restaurar padrão.');
    } finally {
      setRestaurandoPadrao(false);
    }
  };

  // Restaurar uma versão específica do histórico
  const handleRestaurarVersao = async (idVersao: string) => {
    const confirmou = window.confirm(
      'Deseja restaurar esta versão do histórico? Ela passará a ser a configuração ativa imediatamente.'
    );
    if (!confirmou) return;

    setRestaurandoVersaoId(idVersao);
    try {
      const res = await fetch(`/api/configuracoes-vega/historico/${idVersao}/restaurar`, {
        method: 'POST',
      });

      const json = await res.json();
      if (res.ok && json.sucesso) {
        setConfiguracao(json.configuracoes);
        setPromptEditado(json.configuracoes.promptPersona);
        setTemperaturaEditada(Number(json.configuracoes.temperaturaResposta));
        exibirFeedbackTemporario('sucesso', 'Versão anterior restaurada com sucesso!');
        setVersaoPreview(null);
        // Atualiza histórico
        const resHist = await fetch('/api/configuracoes-vega/historico');
        if (resHist.ok) {
          const jsonHist = await resHist.json();
          if (Array.isArray(jsonHist.historico)) setHistorico(jsonHist.historico);
        }
      } else {
        exibirFeedbackTemporario('erro', json.erro || 'Erro ao restaurar versão.');
      }
    } catch (err) {
      exibirFeedbackTemporario('erro', 'Erro de conexão ao restaurar versão.');
    } finally {
      setRestaurandoVersaoId(null);
    }
  };

  if (carregando) {
    return (
      <div className="flex-1 h-full bg-[#0b0f14] flex flex-col items-center justify-center text-slate-300">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <p className="text-sm font-medium">Carregando configurações da VEGA no Supabase...</p>
      </div>
    );
  }

  // Descrição curta da temperatura (efeito do valor escolhido)
  const obterDescricaoTemperatura = (temp: number) => {
    if (temp <= 0.15) {
      return 'Respostas mais diretas, técnicas e previsíveis (recomendado para a VEGA).';
    }
    if (temp <= 0.45) {
      return 'Respostas diretas com vocabulário mais natural.';
    }
    if (temp <= 0.75) {
      return 'Respostas equilibradas com fraseado mais variado.';
    }
    return 'Respostas mais criativas e variadas.';
  };

  const houveAlteracao =
    configuracao &&
    (promptEditado !== configuracao.promptPersona ||
      temperaturaEditada !== Number(configuracao.temperaturaResposta));

  return (
    <div className="flex-1 h-full bg-[#0b0f14] text-slate-200 overflow-y-auto p-6 md:p-8 font-sans">
      {/* Toast / Banner de Feedback */}
      {feedback && (
        <div
          className={`fixed top-5 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border transition-all animate-in fade-in slide-in-from-top-3 ${
            feedback.tipo === 'sucesso'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/50 text-rose-200'
          }`}
        >
          {feedback.tipo === 'sucesso' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          )}
          <span className="text-xs md:text-sm font-medium">{feedback.texto}</span>
        </div>
      )}

      {/* Cabeçalho da Aba */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-[#1e2633] gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sliders className="w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-100 tracking-tight">
              Configurações da VEGA
            </h1>
          </div>
          <p className="text-xs md:text-sm text-slate-400">
            Ajuste o comportamento e a persona da assistente sem alterar código. Persistido diretamente
            no Supabase com efeito imediato no WhatsApp e no Painel.
          </p>
        </div>

        {/* Informações da última alteração */}
        {configuracao && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-[#121820] border border-[#202937] text-xs text-slate-300">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div>
              <p className="font-semibold text-slate-200">
                Última alteração: {formatarDataBrasilia(configuracao.atualizadoEm)}
              </p>
              <p className="text-[11px] text-slate-400">
                Por: <span className="text-emerald-400">{configuracao.atualizadoPorNome || 'Sistema'}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Navegação entre Abas */}
      <div className="flex items-center gap-2 mb-6 border-b border-[#1e2633] pb-3">
        <button
          type="button"
          onClick={() => setAbaAtiva('persona')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            abaAtiva === 'persona'
              ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#121820] border border-transparent'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>Comportamento & Persona</span>
        </button>
        <button
          type="button"
          onClick={() => setAbaAtiva('avisos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            abaAtiva === 'avisos'
              ? 'bg-amber-500/10 border border-amber-500/40 text-amber-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#121820] border border-transparent'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Avisos de Falha & Consumo</span>
        </button>
      </div>

      {abaAtiva === 'avisos' ? (
        <ConfiguracaoAvisosSection />
      ) : (
        <>
          <div className="space-y-6 mb-8">
          {/* ============================================================== */}
          {/* DESTAQUE 1: Editor do Prompt da Persona */}
          {/* ============================================================== */}
          <div className="bg-[#121820] border border-[#202937] rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-sm md:text-base font-semibold text-slate-100 flex items-center gap-2">
                <Bot className="w-5 h-5 text-emerald-400" />
                Prompt da Persona (Instruções Base da VEGA)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Define a personalidade, vocabulário, regras de tom e diretrizes seguidas pela assistente.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRestaurarPadrao}
                disabled={restaurandoPadrao || salvando}
                className="px-3.5 py-2 rounded-xl bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-slate-100 text-xs font-semibold border border-[#263345] transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                title="Restaura o prompt oficial gravado no Supabase e temperatura 0.1"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${restaurandoPadrao ? 'animate-spin' : ''}`} />
                <span>Restaurar Padrão</span>
              </button>

              <button
                type="button"
                onClick={() => handleSalvar()}
                disabled={salvando || restaurandoPadrao || !houveAlteracao}
                className={`px-5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
                  houveAlteracao
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                    : 'bg-[#18202b] text-slate-500 border border-[#263345] cursor-not-allowed'
                }`}
              >
                <Save className={`w-4 h-4 ${salvando ? 'animate-spin' : ''}`} />
                <span>{salvando ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </div>
          </div>

          <div className="relative rounded-xl border border-[#1e2633] focus-within:border-emerald-500/60 transition-all bg-[#0b0f14]">
            <textarea
              value={promptEditado}
              onChange={(e) => setPromptEditado(e.target.value)}
              rows={15}
              placeholder="Insira as diretrizes da persona da VEGA aqui..."
              className="w-full bg-transparent text-slate-200 text-xs md:text-sm font-mono leading-relaxed p-4 rounded-xl focus:outline-none resize-y min-h-[340px]"
              spellCheck={false}
            />

            <div className="flex items-center justify-between px-4 py-2 border-t border-[#1e2633] bg-[#0d131a] text-[11px] text-slate-400 rounded-b-xl">
              <span>
                {promptEditado.length.toLocaleString('pt-BR')} caracteres •{' '}
                {promptEditado.split(/\s+/).filter(Boolean).length.toLocaleString('pt-BR')} palavras
              </span>
              <span className="flex items-center gap-1.5 text-slate-500">
                <Lock className="w-3 h-3" />
                Salvo no Supabase
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* DESTAQUE 2: Controle de Temperatura da Resposta Final */}
        {/* ============================================================== */}
        <div className="bg-[#121820] border border-[#202937] rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm md:text-base font-semibold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Temperatura da Resposta Final
            </h2>
            <span className="px-3 py-1 rounded-lg bg-[#0b0f14] border border-amber-500/30 text-amber-300 font-mono font-bold text-xs">
              {temperaturaEditada.toFixed(2)}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={temperaturaEditada}
            onChange={(e) => setTemperaturaEditada(parseFloat(e.target.value))}
            className="w-full h-2.5 bg-[#18202b] rounded-lg appearance-none cursor-pointer accent-amber-400"
          />

          <p className="text-xs text-slate-400 mt-2.5">
            <span className="text-slate-300 font-medium">Efeito: </span>
            <span className="text-amber-300">{obterDescricaoTemperatura(temperaturaEditada)}</span>
          </p>
        </div>

        {/* ============================================================== */}
        {/* BLOCO RECOLHIDO 1: Configuração técnica (somente leitura) */}
        {/* ============================================================== */}
        <div className="bg-[#121820] border border-[#202937] rounded-2xl p-6 shadow-xl transition-all">
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setTecnicaExpandida(!tecnicaExpandida)}
          >
            <div>
              <h2 className="text-sm md:text-base font-semibold text-slate-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-slate-400" />
                Configuração técnica (somente leitura)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Modelos de inteligência artificial e temperaturas fixas de estabilidade.
              </p>
            </div>

            <button
              type="button"
              className="p-1.5 rounded-lg bg-[#18202b] text-slate-400 hover:text-slate-200 transition-colors"
            >
              {tecnicaExpandida ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {tecnicaExpandida && (
            <div className="mt-5 pt-5 border-t border-[#1e2633] space-y-4 text-xs">
              {/* Modelos de IA */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Modelos de IA
                </p>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-slate-400">Chat e raciocínio:</span>
                    <strong className="text-slate-100 font-mono">{modelos?.chat || 'gpt-5.4-mini'}</strong>
                    <span className="text-slate-500">— Diálogo com a diretoria, OCR de fotos e respostas da assistente</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-slate-400">Embeddings vetoriais:</span>
                    <strong className="text-slate-100 font-mono">{modelos?.embeddings || 'text-embedding-3-small'}</strong>
                    <span className="text-slate-500">— Busca semântica nos trechos e documentos do Cofre</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-slate-400">Transcrição de áudio:</span>
                    <strong className="text-slate-100 font-mono">{modelos?.transcricao || 'gpt-transcribe'}</strong>
                    <span className="text-slate-500">— Transcrição de mensagens de voz recebidas no WhatsApp</span>
                  </div>
                </div>
              </div>

              {/* Temperaturas Fixas */}
              <div className="pt-4 border-t border-[#1e2633]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Temperaturas Fixas
                </p>
                <div className="space-y-1.5 text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Classificação de intenção:</span>
                    <strong className="text-slate-100 font-mono">0.1</strong>
                    <span className="text-slate-500">(fixa)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Extração de dados de documentos e fichas:</span>
                    <strong className="text-slate-100 font-mono">0.0</strong>
                    <span className="text-slate-500">(fixa)</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">
                  Essas etapas decidem o que a VEGA vai buscar e quais dados extrair dos documentos. Ficam com temperatura baixa e fixa para garantir respostas estáveis: a mesma pergunta sempre segue o mesmo caminho.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* BLOCO RECOLHIDO 2: Histórico de Versões e Rollback */}
        {/* ============================================================== */}
        <div className="bg-[#121820] border border-[#202937] rounded-2xl p-6 shadow-xl transition-all">
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setHistoricoExpandido(!historicoExpandido)}
          >
            <div>
              <h2 className="text-sm md:text-base font-semibold text-slate-100 flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-400" />
                Histórico de Versões e Rollback
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Registro de todas as alterações salvas com data, responsável e opção de restauração rápida.
              </p>
            </div>

            <button
              type="button"
              className="p-1.5 rounded-lg bg-[#18202b] text-slate-400 hover:text-slate-200 transition-colors"
            >
              {historicoExpandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {historicoExpandido && (
            <div className="mt-6 overflow-x-auto">
              {historico.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Nenhum registro de versão anterior encontrado.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1e2633] text-slate-400 uppercase text-[10px] font-semibold tracking-wider">
                      <th className="py-2.5 px-3">Data e Hora (Brasília)</th>
                      <th className="py-2.5 px-3">Responsável</th>
                      <th className="py-2.5 px-3">Temperatura</th>
                      <th className="py-2.5 px-3">Motivo / Tipo</th>
                      <th className="py-2.5 px-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2633]">
                    {historico.map((v, idx) => (
                      <tr key={v.id} className="hover:bg-[#18202b]/50 transition-colors">
                        <td className="py-3 px-3 text-slate-200 font-mono">
                          {formatarDataBrasilia(v.criadoEm)}
                          {idx === 0 && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Atual
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            <span>{v.autorNome}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-amber-300 font-mono font-medium">
                          {v.temperaturaResposta.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-slate-400 capitalize">
                          {v.motivo?.replace(/_/g, ' ') || 'Edição manual'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setVersaoPreview(v)}
                              className="px-2.5 py-1 rounded bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-slate-100 text-[11px] font-medium border border-[#263345] transition-all flex items-center gap-1 cursor-pointer"
                              title="Visualizar o texto salvo nesta versão"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Ver</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRestaurarVersao(v.id)}
                              disabled={restaurandoVersaoId === v.id || idx === 0}
                              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                                idx === 0
                                  ? 'opacity-40 cursor-not-allowed bg-[#18202b] text-slate-500'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              }`}
                              title={idx === 0 ? 'Esta versão já é a ativa' : 'Reverter para esta versão'}
                            >
                              <RotateCcw className={`w-3 h-3 ${restaurandoVersaoId === v.id ? 'animate-spin' : ''}`} />
                              <span>Restaurar</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Prévia de Versão Antiga */}
      {versaoPreview && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-[#263345] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-[#1e2633]">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Versão gravada em {formatarDataBrasilia(versaoPreview.criadoEm)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVersaoPreview(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#18202b]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-[#0b0f14] overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
                <span>Autor: <strong className="text-slate-200">{versaoPreview.autorNome}</strong></span>
                <span>Temperatura: <strong className="text-amber-300 font-mono">{versaoPreview.temperaturaResposta.toFixed(2)}</strong></span>
              </div>
              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed p-3 bg-[#121820] rounded-lg border border-[#1e2633]">
                {versaoPreview.promptPersona}
              </pre>
            </div>

            <div className="p-3 border-t border-[#1e2633] bg-[#121820] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVersaoPreview(null)}
                className="px-3 py-1.5 rounded-lg bg-[#18202b] text-slate-300 text-xs hover:bg-[#202937]"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => handleRestaurarVersao(versaoPreview.id)}
                className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restaurar esta versão
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
