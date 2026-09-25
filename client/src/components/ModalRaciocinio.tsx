import React, { useEffect, useState } from 'react';
import {
  X,
  Clock,
  Cpu,
  FileText,
  Paperclip,
  CheckCircle2,
  Sparkles,
  Database,
  ArrowRight,
  ShieldCheck,
  Coins,
  Edit3,
  Mic,
} from 'lucide-react';
import { RastroRegistro } from '../types/chat.js';

interface ModalRaciocinioProps {
  isOpen: boolean;
  onClose: () => void;
  mensagemId: string;
  rastroInicial?: RastroRegistro;
}

export const ModalRaciocinio: React.FC<ModalRaciocinioProps> = ({
  isOpen,
  onClose,
  mensagemId,
  rastroInicial,
}) => {
  const [rastro, setRastro] = useState<RastroRegistro | undefined>(rastroInicial);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Se já veio com o rastro no objeto da mensagem, usa direto
    if (rastroInicial) {
      setRastro(rastroInicial);
      setCarregando(false);
      setErro(null);
      return;
    }

    // Caso contrário, busca na API /api/rastros/:mensagemId
    if (mensagemId) {
      setCarregando(true);
      setErro(null);

      fetch(`/api/rastros/${mensagemId}`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Rastro não encontrado (HTTP ${res.status})`);
          }
          return res.json();
        })
        .then((data: RastroRegistro) => {
          setRastro(data);
          setCarregando(false);
        })
        .catch((err) => {
          console.error('[ModalRaciocinio] Erro ao carregar rastro:', err);
          setErro(err.message || 'Erro ao carregar rastro de raciocínio');
          setCarregando(false);
        });
    }
  }, [isOpen, mensagemId, rastroInicial]);

  if (!isOpen) return null;

  // Tradução amigável da intenção
  const formatarIntencao = (intencao?: string) => {
    switch (intencao) {
      case 'pedir_arquivo':
        return 'Pedido de Documento (Arquivo Físico)';
      case 'dado_pessoal':
        return 'Consulta a Dado Pessoal de Titular';
      case 'corrigir_dado':
        return 'Correção de Dado Cadastral';
      case 'pergunta_conteudo':
        return 'Consulta de Conteúdo ou Regras Internas';
      case 'saudacao_ou_vago':
        return 'Saudação / Apresentação Institucional';
      case 'fora_de_escopo':
        return 'Fora de Escopo';
      default:
        return intencao || 'Consulta Geral';
    }
  };

  // Tradução amigável do tipo de busca
  const formatarTipoBusca = (tipo?: string) => {
    switch (tipo) {
      case 'nome_cofre':
        return 'Busca por Nome no Cofre de Arquivos';
      case 'ficha_cadastral':
        return 'Ficha Cadastral Estruturada do Titular';
      case 'nome_conhecimento':
        return 'Busca por Tópico na Base de Conhecimento';
      case 'vetorial':
        return 'Busca Semântica Vetorial no Supabase';
      case 'nenhuma':
        return 'Nenhuma (Resposta Direta / Sem busca)';
      default:
        return tipo || 'Automática';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shadow-inner">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-slate-100 flex items-center gap-2">
                Rastro de Raciocínio da VEGA
                <span className="text-[10px] font-normal uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  Auditoria Interna
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Detalhamento técnico e etapas que fundamentaram esta resposta
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm flex-1 custom-scrollbar">
          {carregando && (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Carregando rastro de raciocínio...</p>
            </div>
          )}

          {erro && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-center gap-2">
              <span>⚠️ {erro}</span>
            </div>
          )}

          {!carregando && !erro && !rastro && (
            <div className="py-8 text-center text-slate-400 text-xs">
              Rastro de execução não disponível para esta mensagem.
            </div>
          )}

          {!carregando && rastro && (
            <>
              {/* Grid de Métricas Principais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    Tempo Total
                  </div>
                  <div className="font-semibold text-slate-100 text-sm">
                    {rastro.tempoTotalMs} ms
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                    Modelo de IA
                  </div>
                  <div className="font-semibold text-slate-100 text-sm truncate" title={rastro.modeloUsado}>
                    {rastro.modeloUsado}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Coins className="w-3.5 h-3.5 text-amber-400" />
                    Tokens & Custo
                  </div>
                  <div className="font-semibold text-slate-100 text-sm">
                    {rastro.tokensTotal} tok <span className="text-[11px] text-slate-400 font-normal">(${(rastro.custoEstimadoUsd || 0).toFixed(5)})</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                    Anexo Enviado
                  </div>
                  <div className="font-semibold text-slate-100 text-sm">
                    {rastro.enviouAnexo ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sim
                      </span>
                    ) : (
                      <span className="text-slate-400">Não</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card de Mensagem de Áudio Transcrita */}
              {(rastro.tipoEntrada === 'audio' || rastro.transcricaoAudio) && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-300">
                    <div className="flex items-center gap-1.5">
                      <Mic className="w-4 h-4 text-amber-400" />
                      <span>Mensagem Recebida por Áudio de Voz (WhatsApp)</span>
                    </div>
                    {rastro.transcricaoAudio?.modelo && (
                      <span className="text-[10px] text-amber-400/90 font-mono bg-amber-950/50 px-2 py-0.5 rounded border border-amber-800/40">
                        {rastro.transcricaoAudio.modelo}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 pt-1">
                    <div>
                      <span className="text-slate-400">Duração:</span>{' '}
                      <span className="font-semibold text-slate-100 font-mono">
                        {rastro.transcricaoAudio?.duracaoSegundos ?? 0}s
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Custo Whisper:</span>{' '}
                      <span className="font-semibold text-amber-300 font-mono">
                        ${(rastro.transcricaoAudio?.custoUsd ?? 0).toFixed(6)}
                      </span>
                    </div>
                    {rastro.transcricaoAudio?.metodoDownload && (
                      <div>
                        <span className="text-slate-400">Origem Mídia:</span>{' '}
                        <span className="text-slate-200">
                          {rastro.transcricaoAudio.metodoDownload === 'base64_payload' ? 'Base64 Webhook' : 'Download Evolution API'}
                        </span>
                      </div>
                    )}
                  </div>
                  {rastro.transcricaoAudio?.correcoesAplicadas && rastro.transcricaoAudio.correcoesAplicadas.length > 0 && (
                    <div className="w-full pt-2 border-t border-amber-500/20 text-xs space-y-1.5">
                      <div className="text-[11px] text-amber-300 font-semibold flex items-center gap-1">
                        <span>✨ Correção Fonética de Transcrição:</span>
                      </div>
                      <div className="space-y-1">
                        {rastro.transcricaoAudio.correcoesAplicadas.map((c, i) => (
                          <div key={i} className="text-[11px] text-slate-300 flex items-center gap-1.5 flex-wrap">
                            <span className="line-through text-red-400/90 font-mono bg-red-950/50 px-1.5 py-0.5 rounded border border-red-800/30">
                              "{c.de}"
                            </span>
                            <span className="text-amber-400 font-bold">→</span>
                            <span className="text-emerald-300 font-mono font-semibold bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-800/30">
                              "{c.para}"
                            </span>
                          </div>
                        ))}
                      </div>
                      {rastro.transcricaoAudio?.textoOriginal && rastro.transcricaoAudio?.textoCorrigido && (
                        <div className="text-[10px] text-slate-400 pt-0.5 font-mono">
                          Original: <span className="text-slate-300">"{rastro.transcricaoAudio.textoOriginal}"</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Informações Gerais de Intenção e Busca */}
              <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                  <span className="text-slate-400">🎯 Intenção Detectada:</span>
                  <span className="font-medium text-slate-200">{formatarIntencao(rastro.intencaoDetectada)}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs border-t border-slate-800/80 pt-2">
                  <span className="text-slate-400">🔎 Tipo de Busca Usada:</span>
                  <span className="font-medium text-emerald-400">{formatarTipoBusca(rastro.tipoBusca)}</span>
                </div>
                {rastro.documentoUsado && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs border-t border-slate-800/80 pt-2">
                    <span className="text-slate-400">📄 Documento de Origem Utilizado:</span>
                    <span className="font-medium text-slate-100 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                      {rastro.documentoUsado}
                    </span>
                  </div>
                )}
              </div>

              {/* Card de Correção de Dado Cadastral */}
              {rastro.detalhesCorrecao && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <Edit3 className="w-4 h-4 text-amber-400" />
                    <span>Correção Cadastral: {rastro.detalhesCorrecao.titular}</span>
                    {rastro.detalhesCorrecao.corrigidoPor && (
                      <span className="text-[10px] text-slate-400 font-normal ml-auto">
                        Por: {rastro.detalhesCorrecao.corrigidoPor}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1">
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono">Campo</span>
                      <span className="font-semibold text-slate-200 capitalize">{rastro.detalhesCorrecao.campo}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono">Valor Anterior</span>
                      <span className="font-semibold text-rose-400 line-through">{rastro.detalhesCorrecao.valorAnterior}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono">Novo Valor</span>
                      <span className="font-semibold text-emerald-400">{rastro.detalhesCorrecao.valorNovo}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Linha do Tempo das Etapas */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    Etapas do Raciocínio (Ordem Cronológica)
                  </h4>
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400/90">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Dados sensíveis mascarados</span>
                  </div>
                </div>

                <div className="relative pl-6 space-y-4 border-l-2 border-slate-700/60 ml-2">
                  {rastro.etapas && rastro.etapas.length > 0 ? (
                    rastro.etapas.map((etapa, idx) => (
                      <div key={idx} className="relative">
                        {/* Marcador na linha */}
                        <div className="absolute -left-[31px] top-0.5 w-4 h-4 rounded-full bg-slate-900 border-2 border-emerald-400 flex items-center justify-center shadow">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        </div>

                        {/* Card da etapa */}
                        <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/70 hover:border-slate-600 transition-colors space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-100 text-xs flex items-center gap-1.5">
                              {etapa.ordem}. {etapa.nome}
                            </span>
                            <span className="text-[11px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-700/50 font-mono">
                              {etapa.tempoMs} ms
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed">
                            {etapa.descricao}
                          </p>

                          {/* Se for a etapa 1 de reescrita, mostra a comparação detalhada dos campos estruturados */}
                          {etapa.ordem === 1 && (
                            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-[11px]">
                              <div>
                                <span className="text-slate-400 font-medium">Pergunta Original:</span>{' '}
                                <span className="text-slate-200 font-medium">"{rastro.mensagemOriginal}"</span>
                              </div>
                              <div className="flex items-start gap-1 text-emerald-400 pt-0.5">
                                <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <div>
                                  <span className="font-medium text-emerald-300">Pergunta Completa:</span>{' '}
                                  <span className="text-slate-100 font-normal">
                                    "{rastro.perguntaCompleta || etapa.detalhes?.perguntaCompleta || rastro.perguntaReescrita}"
                                  </span>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
                                <div>
                                  <span className="text-slate-400">Termo de Busca Curto:</span>{' '}
                                  <span className="text-slate-200 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/60">
                                    {rastro.termoBusca || etapa.detalhes?.termoBusca || '-'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Pessoa / Titular:</span>{' '}
                                  <span className="text-slate-200 font-medium">
                                    {rastro.pessoa || etapa.detalhes?.pessoa || '-'}
                                  </span>
                                  {(rastro.origemPessoa || etapa.detalhes?.origemPessoa) && (rastro.pessoa || etapa.detalhes?.pessoa) && (
                                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 font-medium">
                                      {rastro.origemPessoa === 'mensagem_atual' || etapa.detalhes?.origemPessoa === 'mensagem_atual'
                                        ? 'da mensagem atual'
                                        : 'do contexto'}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {(rastro.documentoCitado || etapa.detalhes?.documentoCitado) && (
                                <div className="text-[11px] pt-1">
                                  <span className="text-slate-400">Documento Citado:</span>{' '}
                                  <span className="text-sky-300 font-medium bg-sky-950/50 px-1.5 py-0.5 rounded border border-sky-800/60">
                                    {rastro.documentoCitado || etapa.detalhes?.documentoCitado}
                                  </span>
                                </div>
                              )}
                              {((rastro.campos && rastro.campos.length > 0) || (etapa.detalhes?.campos && etapa.detalhes.campos.length > 0)) && (
                                <div className="text-[11px] pt-1">
                                  <span className="text-slate-400 block mb-1">Campos Cadastrais Detectados:</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {(rastro.campos || etapa.detalhes?.campos || []).map((c: string, cIdx: number) => (
                                      <span
                                        key={cIdx}
                                        className="bg-emerald-950/60 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded-md text-[10px] font-mono"
                                      >
                                        {c}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Se for etapa com detalhamento de campos consultados (dado_pessoal), exibe cada campo e sua origem */}
                          {etapa.detalhes?.camposConsultados && etapa.detalhes.camposConsultados.length > 0 && (
                            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-[11px]">
                              <span className="text-slate-300 font-semibold block mb-1">
                                Rastro dos Campos Consultados ({etapa.detalhes.camposConsultados.length}):
                              </span>
                              <div className="space-y-1.5">
                                {etapa.detalhes.camposConsultados.map((item: any, cIdx: number) => (
                                  <div
                                    key={cIdx}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2 rounded-lg bg-slate-900/60 border border-slate-800/80"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-slate-200">{item.campo}:</span>
                                      <span className={item.encontrado ? 'text-slate-100 font-mono' : 'text-slate-400 italic'}>
                                        {item.valor}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                      <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                                        Origem: {item.origem}
                                        {item.documentoOrigem && item.documentoOrigem !== item.origem ? ` (${item.documentoOrigem})` : ''}
                                      </span>
                                      {item.encontrado && (
                                        <span className={item.conferido ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                                          {item.conferido ? 'Conferido' : 'Pendente de conferência'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400">Nenhuma etapa registrada.</div>
                  )}
                </div>
              </div>

              {/* Documentos e Trechos Encontrados */}
              {rastro.documentosEncontrados && rastro.documentosEncontrados.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <h4 className="font-medium text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-sky-400" />
                    Documentos e Trechos Avaliados ({rastro.documentosEncontrados.length})
                  </h4>

                  <div className="space-y-2">
                    {rastro.documentosEncontrados.map((doc, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          doc.usadoNaResposta
                            ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                            : 'bg-slate-800/40 border-slate-700/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <FileText className={`w-3.5 h-3.5 ${doc.usadoNaResposta ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className="font-semibold text-slate-100">
                              {doc.titulo}
                            </span>
                            {doc.pagina && (
                              <span className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
                                Pág. {doc.pagina}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {doc.similaridade !== undefined && (
                              <span className="font-mono text-[11px] text-sky-400 font-semibold bg-sky-950/60 border border-sky-800/50 px-2 py-0.5 rounded">
                                {doc.similaridade}% relevância
                              </span>
                            )}
                            {doc.usadoNaResposta && (
                              <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Utilizado na resposta
                              </span>
                            )}
                          </div>
                        </div>

                        {doc.trecho && (
                          <div className="p-2 rounded bg-black/40 text-slate-300 font-mono text-[11px] leading-relaxed border border-white/5 break-words">
                            "{doc.trecho}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Anexos Enviados */}
              {rastro.enviouAnexo && rastro.anexosDetalhes && rastro.anexosDetalhes.length > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/50 space-y-1.5">
                  <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" />
                    Arquivo Físico Oficial Anexado:
                  </div>
                  {rastro.anexosDetalhes.map((a, i) => (
                    <div key={i} className="text-xs text-slate-200 flex items-center justify-between">
                      <span className="font-medium">{a.nome}</span>
                      <span className="text-slate-400 text-[11px]">({a.tamanho || 'Tam. N/D'})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Resposta Final Registrada */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
                  <span>Resposta Final Enviada ao Usuário:</span>
                  <span className="text-[10px] text-emerald-400 font-normal">Padrão WhatsApp</span>
                </div>
                <div className="text-xs text-slate-200 leading-relaxed italic">
                  "{rastro.respostaFinal}"
                </div>
              </div>
            </>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            {rastro?.criadoEm ? new Date(rastro.criadoEm).toLocaleString('pt-BR') : ''}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700 shadow-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
