import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sparkles, User, Trash2, Plus } from 'lucide-react';
import { Conversa, Anexo, Mensagem, UsuarioAutorizado } from '../types/chat.js';
import { ChatThread } from './ChatThread.js';
import { ContactDetails } from './ContactDetails.js';

export const SimuladorView: React.FC = () => {
  const [conversasSimulador, setConversasSimulador] = useState<Conversa[]>([]);
  const [conversaAtivaId, setConversaAtivaId] = useState<string | null>(null);
  const [usuariosAutorizados, setUsuariosAutorizados] = useState<UsuarioAutorizado[]>([]);
  const [usuarioSelecionadoId, setUsuarioSelecionadoId] = useState<string>('');
  const [carregando, setCarregando] = useState(true);

  // Estados de streaming
  const [emStreaming, setEmStreaming] = useState(false);
  const [textoStreaming, setTextoStreaming] = useState('');

  // Carrega lista de usuários autorizados do Supabase
  const carregarUsuarios = useCallback(async () => {
    try {
      const res = await fetch('/api/usuarios');
      if (res.ok) {
        const dados: UsuarioAutorizado[] = await res.json();
        setUsuariosAutorizados(dados);
        if (dados.length > 0 && !usuarioSelecionadoId) {
          setUsuarioSelecionadoId(dados[0].id);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar usuarios para o simulador:', err);
    }
  }, [usuarioSelecionadoId]);

  // Carrega conversas do simulador
  const carregarConversasSimulador = useCallback(async () => {
    try {
      setCarregando(true);
      const res = await fetch('/api/conversas?tipo=simulador');
      if (res.ok) {
        const dados: Conversa[] = await res.json();
        setConversasSimulador(dados);
        if (dados.length > 0) {
          setConversaAtivaId(dados[0].id);
        } else {
          setConversaAtivaId(null);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar conversas do simulador:', err);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarUsuarios();
    carregarConversasSimulador();
  }, [carregarUsuarios, carregarConversasSimulador]);

  // Conversa ativa atual
  const conversaAtiva = useMemo(() => {
    return conversasSimulador.find((c) => c.id === conversaAtivaId) || null;
  }, [conversasSimulador, conversaAtivaId]);

  // Criar nova sessão de simulação
  const handleCriarNovaSessao = async () => {
    const usuarioEscolhido = usuariosAutorizados.find((u) => u.id === usuarioSelecionadoId);

    const payload = usuarioEscolhido
      ? {
          usuarioId: usuarioEscolhido.id,
          nome: usuarioEscolhido.nome,
          numero: usuarioEscolhido.numero,
          perfil: usuarioEscolhido.perfil,
          pessoa_id: usuarioEscolhido.pessoa_id,
        }
      : {
          nome: 'Colaborador Simulado',
          numero: '5511999990000',
          perfil: 'comum' as const,
        };

    try {
      const res = await fetch('/api/conversas/simulador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const nova: Conversa = await res.json();
        setConversasSimulador((prev) => [nova, ...prev]);
        setConversaAtivaId(nova.id);
        setTextoStreaming('');
        setEmStreaming(false);
      }
    } catch (err) {
      console.error('Erro ao iniciar simulação:', err);
    }
  };

  // Limpar conversa atual do simulador
  const handleLimparConversaAtual = async () => {
    if (!conversaAtivaId) return;

    try {
      await fetch(`/api/conversas/${conversaAtivaId}`, { method: 'DELETE' });
      const restantes = conversasSimulador.filter((c) => c.id !== conversaAtivaId);
      setConversasSimulador(restantes);
      setConversaAtivaId(restantes.length > 0 ? restantes[0].id : null);
      setTextoStreaming('');
      setEmStreaming(false);
    } catch (err) {
      console.error('Erro ao excluir conversa do simulador:', err);
    }
  };

  // Enviar mensagem no simulador com streaming SSE
  const handleEnviarMensagem = async (texto: string, anexos?: Anexo[], documentoId?: string) => {
    if (!conversaAtiva || emStreaming) return;

    const conversaId = conversaAtiva.id;
    const agora = new Date();
    const horarioAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Mensagem otimista do cliente na tela
    const msgUsuarioOtimista: Mensagem = {
      id: `temp-${Date.now()}`,
      remetente: 'cliente',
      nomeRemetente: conversaAtiva.contato.nome,
      horario: horarioAtual,
      texto: documentoId ? `Consultar: ${texto}` : texto,
      anexos,
    };

    setConversasSimulador((prev) =>
      prev.map((c) => {
        if (c.id === conversaId) {
          return {
            ...c,
            ultimaAtualizacao: new Date().toISOString(),
            mensagens: [...c.mensagens, msgUsuarioOtimista],
          };
        }
        return c;
      })
    );

    setEmStreaming(true);
    setTextoStreaming('');

    try {
      const resposta = await fetch('/api/mensagens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversaId,
          texto,
          anexos,
          documentoId,
        }),
      });

      if (!resposta.ok || !resposta.body) {
        throw new Error('Falha na resposta do servidor.');
      }

      const reader = resposta.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let acumuladorTexto = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunkBruto = decoder.decode(value, { stream: true });
        const linhas = chunkBruto.split('\n');

        for (const linha of linhas) {
          if (linha.startsWith('data: ')) {
            const jsonStr = linha.replace('data: ', '').trim();
            if (!jsonStr) continue;

            try {
              const evento = JSON.parse(jsonStr);

              if (evento.tipo === 'chunk') {
                acumuladorTexto += evento.delta;
                setTextoStreaming(acumuladorTexto);
              } else if (evento.tipo === 'fim') {
                const msgFinal: Mensagem = evento.mensagem;

                setConversasSimulador((prev) =>
                  prev.map((c) => {
                    if (c.id === conversaId) {
                      return {
                        ...c,
                        ultimaAtualizacao: new Date().toISOString(),
                        mensagens: [...c.mensagens, msgFinal],
                      };
                    }
                    return c;
                  })
                );

                setEmStreaming(false);
                setTextoStreaming('');
              } else if (evento.tipo === 'erro') {
                console.error('Erro emitido pelo SSE do simulador:', evento.mensagem);
                setEmStreaming(false);
              }
            } catch {
              // Fragmento JSON incompleto
            }
          }
        }
      }
    } catch (erro) {
      console.error('Erro na requisição SSE do simulador:', erro);
      setEmStreaming(false);
      setTextoStreaming('');
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-wa-bg overflow-hidden text-wa-textPrimary">
      {/* Header do Simulador */}
      <header className="px-6 py-3.5 bg-wa-panel border-b border-wa-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center font-bold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-wa-textPrimary">
                Simulador da VEGA
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-semibold uppercase">
                Ambiente de Testes Isolado
              </span>
            </div>
            <p className="text-xs text-wa-textSecondary">
              Teste o raciocínio, entrega de documentos e permissões sem disparar nenhuma mensagem no WhatsApp real.
            </p>
          </div>
        </div>

        {/* Controles: Escolha de Usuário e Criação de Sessão */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-wa-bg px-3 py-1.5 rounded-xl border border-wa-border text-xs">
            <User className="w-3.5 h-3.5 text-wa-greenLight" />
            <span className="text-wa-textSecondary text-[11px]">Simular como:</span>
            <select
              value={usuarioSelecionadoId}
              onChange={(e) => setUsuarioSelecionadoId(e.target.value)}
              className="bg-transparent text-xs text-wa-textPrimary font-medium focus:outline-none cursor-pointer"
            >
              {usuariosAutorizados.map((u) => (
                <option key={u.id} value={u.id} className="bg-wa-panel text-white">
                  {u.nome} ({u.perfil === 'admin' ? 'Admin / Diretoria' : 'Comum / Geral'})
                </option>
              ))}
              <option value="" className="bg-wa-panel text-white">
                Colaborador Geral (Sem cadastro prévio)
              </option>
            </select>
          </div>

          <button
            onClick={handleCriarNovaSessao}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Simulação</span>
          </button>

          {conversaAtiva && (
            <button
              onClick={handleLimparConversaAtual}
              title="Excluir esta conversa de teste"
              className="p-2 rounded-xl bg-wa-bg hover:bg-rose-500/15 text-wa-textSecondary hover:text-rose-400 border border-wa-border hover:border-rose-500/30 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Área de Trabalho do Simulador */}
      <div className="flex flex-1 h-full overflow-hidden">
        {/* Coluna Esquerda: Sessões de Simulação */}
        <aside className="w-[260px] min-w-[260px] h-full flex flex-col bg-wa-panel/40 border-r border-wa-border">
          <div className="p-3 border-b border-wa-border text-xs font-semibold text-wa-textSecondary flex items-center justify-between">
            <span>Sessões ({conversasSimulador.length})</span>
            <button
              onClick={handleCriarNovaSessao}
              title="Criar nova sessão"
              className="p-1 rounded text-wa-green hover:bg-wa-panel transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-wa-border/30">
            {carregando ? (
              <div className="p-6 text-center text-xs text-wa-textSecondary">
                Carregando sessões do simulador...
              </div>
            ) : conversasSimulador.length === 0 ? (
              <div className="p-6 text-center text-xs text-wa-textSecondary">
                Nenhuma sessão ativa. Clique em "Nova Simulação" acima para testar.
              </div>
            ) : (
              conversasSimulador.map((c) => {
                const isAtiva = c.id === conversaAtivaId;
                const ultimaMsg = c.mensagens[c.mensagens.length - 1];
                const preview = ultimaMsg?.texto || 'Nova sessão';

                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setConversaAtivaId(c.id);
                      setTextoStreaming('');
                      setEmStreaming(false);
                    }}
                    className={`p-3 cursor-pointer transition-colors relative text-xs ${
                      isAtiva
                        ? 'bg-wa-panel border-l-4 border-indigo-500'
                        : 'hover:bg-wa-panel/60 text-wa-textSecondary'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-wa-textPrimary truncate">
                        {c.contato.nome}
                      </span>
                      <span className="text-[10px] text-wa-textMuted">
                        {ultimaMsg?.horario || ''}
                      </span>
                    </div>
                    <p className="text-[11px] truncate text-wa-textSecondary">
                      {preview}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Coluna Central: Chat do Simulador */}
        {conversaAtiva ? (
          <div className="flex-1 h-full flex flex-col overflow-hidden">
            <ChatThread
              conversa={conversaAtiva}
              emStreaming={emStreaming}
              textoStreaming={textoStreaming}
              onEnviarMensagem={handleEnviarMensagem}
              onSelecionarOpcaoDocumento={(docId, titulo) =>
                handleEnviarMensagem(titulo, undefined, docId)
              }
            />
          </div>
        ) : (
          <div className="flex-1 h-full flex flex-col items-center justify-center bg-wa-chat text-wa-textSecondary p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4 text-indigo-400">
              <Sparkles className="w-8 h-8 animate-pulse" />
            </div>
            <h2 className="text-lg font-bold text-wa-textPrimary mb-1">
              Simulador da VEGA Pronto
            </h2>
            <p className="text-xs max-w-sm text-wa-textSecondary mb-4">
              Escolha um usuário no topo ou clique em "Nova Simulação" para começar um diálogo de teste com a inteligência da VEGA.
            </p>
            <button
              onClick={handleCriarNovaSessao}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer"
            >
              Iniciar Primeira Simulação
            </button>
          </div>
        )}

        {/* Coluna Direita: Detalhes do Usuário Simulado */}
        {conversaAtiva && (
          <ContactDetails
            conversa={conversaAtiva}
            onAtualizarContato={async (dados) => {
              // Atualização local na conversa ativa do simulador
              setConversasSimulador((prev) =>
                prev.map((c) => {
                  if (c.id === conversaAtiva.id) {
                    return {
                      ...c,
                      contato: { ...c.contato, ...dados },
                    };
                  }
                  return c;
                })
              );
            }}
          />
        )}
      </div>
    </div>
  );
};
