import React, { useState, useEffect } from 'react';
import {
  Bell,
  Save,
  CheckCircle2,
  AlertCircle,
  Phone,
  Plus,
  Trash2,
  Cpu,
  DollarSign,
  WifiOff,
  Database,
  FileWarning,
  MicOff,
  ShieldCheck,
  Play,
  RotateCw,
  Info,
} from 'lucide-react';
import { ConfiguracaoAvisos, TipoAviso } from '../types/chat.js';

interface ConfiguracaoAvisosSectionProps {
  onAvisoDisparado?: () => void;
}

export const ConfiguracaoAvisosSection: React.FC<ConfiguracaoAvisosSectionProps> = ({
  onAvisoDisparado,
}) => {
  const [config, setConfig] = useState<ConfiguracaoAvisos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [novoNumero, setNovoNumero] = useState('');
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Estados de teste e simulação
  const [simulandoTipo, setSimulandoTipo] = useState<TipoAviso | null>(null);
  const [resultadoTeste, setResultadoTeste] = useState<{
    sucesso: boolean;
    mensagem: string;
    detalhes?: any;
    dataHora?: string;
  } | null>(null);

  const carregarConfig = async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/avisos/config');
      if (res.ok) {
        const dados = await res.json();
        setConfig(dados);
      } else {
        exibirFeedback('erro', 'Falha ao carregar configurações de avisos.');
      }
    } catch {
      exibirFeedback('erro', 'Erro de conexão ao carregar configurações de avisos.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarConfig();
  }, []);

  const exibirFeedback = (tipo: 'sucesso' | 'erro', texto: string) => {
    setFeedback({ tipo, texto });
    setTimeout(() => setFeedback(null), 4500);
  };

  const handleSalvar = async () => {
    if (!config) return;
    setSalvando(true);
    try {
      const res = await fetch('/api/avisos/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const json = await res.json();
      if (res.ok && json.sucesso) {
        setConfig(json.config);
        exibirFeedback('sucesso', 'Configurações de avisos salvas com sucesso!');
      } else {
        exibirFeedback('erro', json.erro || 'Falha ao salvar configurações.');
      }
    } catch {
      exibirFeedback('erro', 'Erro de conexão ao salvar configurações.');
    } finally {
      setSalvando(false);
    }
  };

  const handleAdicionarNumero = () => {
    const limpo = novoNumero.replace(/\D/g, '').trim();
    if (!limpo) return;

    if (limpo.length < 10) {
      alert('Por favor, informe o número com DDD (ex: 5519999999999 ou 19999999999).');
      return;
    }

    const numeroNormalizado = limpo.startsWith('55') ? limpo : `55${limpo}`;

    if (!config) return;
    if (config.destinatariosWhatsapp.includes(numeroNormalizado)) {
      alert('Este número já está na lista de destinatários.');
      return;
    }

    setConfig({
      ...config,
      destinatariosWhatsapp: [...config.destinatariosWhatsapp, numeroNormalizado],
    });
    setNovoNumero('');
  };

  const handleRemoverNumero = (numeroParaRemover: string) => {
    if (!config) return;
    setConfig({
      ...config,
      destinatariosWhatsapp: config.destinatariosWhatsapp.filter((n) => n !== numeroParaRemover),
    });
  };

  const toggleTipoAtivo = (tipo: TipoAviso) => {
    if (!config) return;
    const jaAtivo = config.tiposAtivos.includes(tipo);
    const novosTipos = jaAtivo
      ? config.tiposAtivos.filter((t) => t !== tipo)
      : [...config.tiposAtivos, tipo];

    setConfig({
      ...config,
      tiposAtivos: novosTipos,
    });
  };

  // Simular falha para teste
  const handleSimularFalha = async (tipo: TipoAviso) => {
    setSimulandoTipo(tipo);
    setResultadoTeste(null);

    try {
      const res = await fetch('/api/avisos/simular-teste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo }),
      });

      const json = await res.json();
      const agoraStr = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());

      if (res.ok && json.sucesso) {
        setResultadoTeste({
          sucesso: true,
          mensagem: `Simulação de "${tipo}" executada com sucesso! O registro foi gravado no Supabase e notificado de acordo com as regras anti-spam.`,
          detalhes: json.resultado,
          dataHora: agoraStr,
        });
        exibirFeedback('sucesso', `Teste de ${tipo} executado com sucesso!`);
        if (onAvisoDisparado) onAvisoDisparado();
      } else {
        setResultadoTeste({
          sucesso: false,
          mensagem: json.erro || 'Falha ao executar teste.',
          dataHora: agoraStr,
        });
        exibirFeedback('erro', json.erro || 'Erro ao simular teste.');
      }
    } catch (err: any) {
      setResultadoTeste({
        sucesso: false,
        mensagem: 'Erro de comunicação com o servidor ao simular teste.',
      });
      exibirFeedback('erro', 'Erro de conexão ao simular teste.');
    } finally {
      setSimulandoTipo(null);
    }
  };

  if (carregando) {
    return (
      <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
        <RotateCw className="w-6 h-6 text-emerald-400 animate-spin" />
        <span className="text-sm">Carregando configurações de avisos...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-sm">Não foi possível carregar as configurações.</p>
        <button
          onClick={carregarConfig}
          className="mt-3 px-4 py-2 bg-[#18202b] rounded-lg text-xs text-slate-200 hover:bg-[#202937]"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`fixed top-5 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border transition-all animate-in fade-in slide-in-from-top-3 ${
            feedback.tipo === 'sucesso'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/50 text-rose-200'
          }`}
        >
          {feedback.tipo === 'sucesso' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-xs md:text-sm font-medium">{feedback.texto}</span>
        </div>
      )}

      {/* 1. DESTINATÁRIOS DE WHATSAPP */}
      <div className="p-5 rounded-2xl bg-[#121820] border border-[#202937] shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Phone className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Destinatários de Avisos no WhatsApp
            </h3>
            <p className="text-xs text-slate-400">
              Números autorizados a receber alertas imediatos de falhas e consumo da VEGA.
            </p>
          </div>
        </div>

        {/* Adicionar número */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <div className="flex-1 relative">
            <input
              type="text"
              value={novoNumero}
              onChange={(e) => setNovoNumero(e.target.value)}
              placeholder="Ex: 5519999999999 ou (19) 99999-9999"
              className="w-full px-3.5 py-2 rounded-xl bg-[#0b0f14] border border-[#263345] text-xs text-slate-200 focus:outline-none focus:border-emerald-400 transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleAdicionarNumero()}
            />
          </div>
          <button
            type="button"
            onClick={handleAdicionarNumero}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar Número</span>
          </button>
        </div>

        {/* Lista de números cadastrados */}
        <div className="space-y-2 pt-2">
          {config.destinatariosWhatsapp.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#0b0f14] border border-dashed border-[#202937] text-center text-xs text-slate-500">
              Nenhum número cadastrado. Os avisos ficarão registrados apenas no Supabase e no Painel.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {config.destinatariosWhatsapp.map((numero) => (
                <div
                  key={numero}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#18202b] border border-[#263345] text-xs text-slate-200 font-mono shadow-xs"
                >
                  <Phone className="w-3 h-3 text-emerald-400" />
                  <span>+{numero}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoverNumero(numero)}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Remover número"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 pt-2 text-[11px] text-slate-400 bg-[#0b0f14]/60 p-3 rounded-xl border border-[#1e2633]">
          <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>Proteção contra cascata:</strong> Se o problema for na própria Evolution API (WhatsApp desconectado ou erro de envio), o aviso é registrado com segurança no Supabase e exibido no painel, sem tentar reenvio pelo WhatsApp.
          </span>
        </div>
      </div>

      {/* 2. TIPOS DE AVISOS ATIVOS */}
      <div className="p-5 rounded-2xl bg-[#121820] border border-[#202937] shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Tipos de Avisos Habilitados
            </h3>
            <p className="text-xs text-slate-400">
              Selecione quais eventos geram notificações para os administradores.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* OpenAI */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('openai_erro')}
              onChange={() => toggleTipoAtivo('openai_erro')}
              className="mt-0.5 rounded border-slate-700 text-purple-500 focus:ring-purple-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>Erros na OpenAI</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Chave inválida, cota excedida, modelo não permitido, instabilidade ou timeout.
              </p>
            </div>
          </label>

          {/* Consumo */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('consumo_limite')}
              onChange={() => toggleTipoAtivo('consumo_limite')}
              className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                <span>Limites de Gasto Mensal</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Avisos quando o gasto mensal atingir 50%, 80% ou 100% do limite em dólares.
              </p>
            </div>
          </label>

          {/* Evolution API */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('evolution_falha')}
              onChange={() => toggleTipoAtivo('evolution_falha')}
              className="mt-0.5 rounded border-slate-700 text-orange-500 focus:ring-orange-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <WifiOff className="w-3.5 h-3.5 text-orange-400" />
                <span>Falha na Evolution API</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                WhatsApp desconectado, erro de envio de mensagens ou documentos.
              </p>
            </div>
          </label>

          {/* Supabase */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('supabase_falha')}
              onChange={() => toggleTipoAtivo('supabase_falha')}
              className="mt-0.5 rounded border-slate-700 text-rose-500 focus:ring-rose-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Database className="w-3.5 h-3.5 text-rose-400" />
                <span>Falha no Supabase</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Banco de dados PostgreSQL ou Storage privado temporariamente indisponível.
              </p>
            </div>
          </label>

          {/* Indexação */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('indexacao_falha')}
              onChange={() => toggleTipoAtivo('indexacao_falha')}
              className="mt-0.5 rounded border-slate-700 text-sky-500 focus:ring-sky-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <FileWarning className="w-3.5 h-3.5 text-sky-400" />
                <span>Falha na Indexação de Documentos</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Documento que terminou com erro ou com zero trechos vetoriais gerados.
              </p>
            </div>
          </label>

          {/* Transcrição de Áudio */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] hover:border-slate-600 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.tiposAtivos.includes('transcricao_falha')}
              onChange={() => toggleTipoAtivo('transcricao_falha')}
              className="mt-0.5 rounded border-slate-700 text-yellow-500 focus:ring-yellow-400"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <MicOff className="w-3.5 h-3.5 text-yellow-400" />
                <span>Falha na Transcrição de Áudio</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Recusa do modelo Whisper/gpt-transcribe ou falha no processamento do arquivo de áudio.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* 3. LIMITES E PERCENTUAIS DE GASTO */}
      <div className="p-5 rounded-2xl bg-[#121820] border border-[#202937] shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <DollarSign className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Limite Mensal e Faixas de Consumo
            </h3>
            <p className="text-xs text-slate-400">
              Controle financeiro mensal em dólares (USD) com alertas únicos por faixa.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Teto Mensal Estimado (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">$</span>
              <input
                type="number"
                step="0.50"
                min="1"
                value={config.limiteMensalUsd || ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    limiteMensalUsd: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full pl-7 pr-3 py-2 rounded-xl bg-[#0b0f14] border border-[#263345] text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
                placeholder="Ex: 25.00"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Valor de referência para cálculo automático dos alertas de 50%, 80% e 100%.
            </p>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-300 mb-1.5">
              Faixas Ativas para Notificação
            </span>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notificar50Porcento}
                onChange={(e) => setConfig({ ...config, notificar50Porcento: e.target.checked })}
                className="rounded border-slate-700 text-amber-500 focus:ring-amber-400"
              />
              <span>Disparar aviso ao atingir <strong>50%</strong> do limite</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notificar80Porcento}
                onChange={(e) => setConfig({ ...config, notificar80Porcento: e.target.checked })}
                className="rounded border-slate-700 text-amber-500 focus:ring-amber-400"
              />
              <span>Disparar aviso ao atingir <strong>80%</strong> do limite</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notificar100Porcento}
                onChange={(e) => setConfig({ ...config, notificar100Porcento: e.target.checked })}
                className="rounded border-slate-700 text-rose-500 focus:ring-rose-400"
              />
              <span>Disparar aviso ao atingir <strong>100%</strong> (bloqueio temporário da IA)</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-[#0b0f14]/60 p-3 rounded-xl border border-[#1e2633]">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            <strong>Anti-Spam Garantido:</strong> Cada faixa de gasto dispara uma única vez por mês. Ao atingir 100%, a VEGA responde aos usuários de forma elegante: <em>"Estou temporariamente indisponível. Já avisei o responsável."</em>
          </span>
        </div>
      </div>

      {/* BOTÃO SALVAR */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={handleSalvar}
          disabled={salvando}
          className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
        >
          {salvando ? (
            <RotateCw className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{salvando ? 'Salvando Configurações...' : 'Salvar Configurações de Avisos'}</span>
        </button>
      </div>

      {/* 4. ÁREA DE TESTE E SIMULAÇÃO DE FALHAS (SEM QUEBRAR O SISTEMA) */}
      <div className="p-5 rounded-2xl bg-[#121820] border border-[#202937] shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Play className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Ambiente de Teste & Simulação de Falhas
            </h3>
            <p className="text-xs text-slate-400">
              Dispare simulações controladas para validar o registro no Supabase, alertas no sino e WhatsApp sem afetar o fluxo real.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleSimularFalha('openai_erro')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-purple-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
              <span>Erro OpenAI</span>
              <Cpu className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Cota excedida / timeout</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('consumo_limite')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-amber-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span>Gasto 80%</span>
              <DollarSign className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Consumo mensal 80%</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('evolution_falha')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-orange-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-orange-300">
              <span>Falha Evolution</span>
              <WifiOff className="w-3.5 h-3.5 text-orange-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">WhatsApp desconectado</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('supabase_falha')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-rose-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-rose-300">
              <span>Falha Supabase</span>
              <Database className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Banco / Storage offline</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('indexacao_falha')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-sky-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-sky-300">
              <span>Falha Indexação</span>
              <FileWarning className="w-3.5 h-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">0 trechos gerados</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('transcricao_falha')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-yellow-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-yellow-300">
              <span>Falha Áudio</span>
              <MicOff className="w-3.5 h-3.5 text-yellow-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Whisper indisponível</p>
          </button>

          <button
            type="button"
            onClick={() => handleSimularFalha('recuperacao')}
            disabled={simulandoTipo !== null}
            className="p-2.5 rounded-xl bg-[#0b0f14] hover:bg-[#18202b] border border-[#263345] hover:border-emerald-500/50 text-left transition-all cursor-pointer disabled:opacity-50 group col-span-2 sm:col-span-2"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span>Recuperação de Serviço</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Notificação de restabelecimento</p>
          </button>
        </div>

        {/* Console / Log de Resultado do Teste */}
        {resultadoTeste && (
          <div className="mt-3 p-3.5 rounded-xl bg-[#0b0f14] border border-[#1e2633] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                {resultadoTeste.sucesso ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                <span>Resultado do Teste</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {resultadoTeste.dataHora}
              </span>
            </div>

            <p className="text-xs text-slate-300">{resultadoTeste.mensagem}</p>

            {resultadoTeste.detalhes && (
              <pre className="p-2 rounded-lg bg-[#121820] text-[11px] font-mono text-slate-400 overflow-x-auto max-h-36">
                {JSON.stringify(resultadoTeste.detalhes, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
