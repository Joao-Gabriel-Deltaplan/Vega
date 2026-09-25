import { useState, useEffect, useCallback, useMemo } from 'react';
import { NavigationSidebar, AbaNavegacao } from './components/NavigationSidebar.js';
import { SidebarConversas } from './components/SidebarConversas.js';
import { ChatThread } from './components/ChatThread.js';
import { KnowledgeBaseView } from './components/KnowledgeBaseView.js';
import { AdminView } from './components/AdminView.js';
import { UsuariosView } from './components/UsuariosView.js';
import { ModalAlertasVencimento } from './components/ModalAlertasVencimento.js';
import { Conversa, Anexo, Mensagem, AlertaVencimento, AvisoSistemaRegistro } from './types/chat.js';
import { LoginView } from './components/LoginView.js';
import { LogoDeltaPlan } from './components/LogoDeltaPlan.js';
import { ConfiguracoesVegaView } from './components/ConfiguracoesVegaView.js';
import { useSSE } from './hooks/useSSE.js';

export function App() {
  // Estados de Autenticação
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  const [usuarioLogado, setUsuarioLogado] = useState<{ userId: string; nome: string; role: string } | null>(null);

  // Navegação: 'whatsapp' é a aba principal
  const [abaAtiva, setAbaAtiva] = useState<AbaNavegacao>('whatsapp');
  const [subAbaBaseVega, setSubAbaBaseVega] = useState<'conhecimento' | 'documentos' | 'faltantes' | 'sugestoes'>('documentos');

  // Conversas do WhatsApp Real
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [conversaAtivaId, setConversaAtivaId] = useState<string | null>(null);
  const [carregandoConversas, setCarregandoConversas] = useState(true);

  // Estados de Alertas de Vencimento
  const [alertasVencimento, setAlertasVencimento] = useState<AlertaVencimento[]>([]);
  const [modalAlertasAberto, setModalAlertasAberto] = useState(false);

  // Estados de Avisos de Falha e Consumo do Sistema
  const [avisosSistema, setAvisosSistema] = useState<AvisoSistemaRegistro[]>([]);

  const totalAlertasNaoLidos = useMemo(() => {
    return alertasVencimento.filter((a) => !a.lido).length;
  }, [alertasVencimento]);

  const totalAvisosNaoLidos = useMemo(() => {
    return avisosSistema.filter((a) => a.status !== 'lido').length;
  }, [avisosSistema]);

  const carregarAlertasVencimento = useCallback(async () => {
    try {
      const res = await fetch('/api/vencimentos/alertas');
      if (res.status === 401) {
        setAutenticado(false);
        return;
      }
      if (res.ok) {
        const dados = await res.json();
        setAlertasVencimento(dados.alertas || []);
      }
    } catch (err) {
      console.error('Erro ao carregar alertas de vencimento:', err);
    }
  }, []);

  const carregarAvisosSistema = useCallback(async () => {
    try {
      const res = await fetch('/api/avisos?limite=100');
      if (res.status === 401) {
        setAutenticado(false);
        return;
      }
      if (res.ok) {
        const dados = await res.json();
        setAvisosSistema(dados.avisos || []);
      }
    } catch (err) {
      console.error('Erro ao carregar avisos do sistema:', err);
    }
  }, []);

  const executarVerificacaoAlertas = useCallback(async () => {
    try {
      await fetch('/api/vencimentos/executar-verificacao', { method: 'POST' });
      await Promise.all([carregarAlertasVencimento(), carregarAvisosSistema()]);
    } catch (err) {
      console.error('Erro ao executar verificação de alertas e avisos:', err);
    }
  }, [carregarAlertasVencimento, carregarAvisosSistema]);

  // Checagem inicial de status de autenticação
  useEffect(() => {
    const checarAutenticacao = async () => {
      try {
        const res = await fetch('/api/auth/status');
        if (res.ok) {
          const dados = await res.json();
          if (dados.autenticado) {
            setAutenticado(true);
            setUsuarioLogado(dados.usuario || null);
            return;
          }
        }
        setAutenticado(false);
      } catch {
        setAutenticado(false);
      }
    };
    checarAutenticacao();
  }, []);

  // Atualiza alertas e avisos periodicamente se autenticado
  useEffect(() => {
    if (autenticado) {
      carregarAlertasVencimento();
      carregarAvisosSistema();
      const timer = setInterval(() => {
        carregarAlertasVencimento();
        carregarAvisosSistema();
      }, 30000);
      return () => clearInterval(timer);
    }
  }, [autenticado, carregarAlertasVencimento, carregarAvisosSistema]);

  // Protege a aba de configurações da VEGA exclusivamente para perfil admin
  useEffect(() => {
    if (abaAtiva === 'configuracoes_vega' && usuarioLogado && usuarioLogado.role !== 'admin') {
      setAbaAtiva('whatsapp');
    }
  }, [abaAtiva, usuarioLogado]);

  const handleMarcarAlertaLido = async (id: string) => {
    try {
      const res = await fetch(`/api/vencimentos/alertas/${id}/lido`, { method: 'POST' });
      if (res.ok) {
        setAlertasVencimento((prev) =>
          prev.map((a) => (a.id === id ? { ...a, lido: true } : a))
        );
      }
    } catch (err) {
      console.error('Erro ao marcar alerta como lido:', err);
    }
  };

  const handleMarcarTodosAlertasLidos = async () => {
    try {
      const res = await fetch('/api/vencimentos/alertas/marcar-todos-lidos', { method: 'POST' });
      if (res.ok) {
        setAlertasVencimento((prev) => prev.map((a) => ({ ...a, lido: true })));
      }
    } catch (err) {
      console.error('Erro ao marcar todos alertas como lidos:', err);
    }
  };

  const handleMarcarAvisoLido = async (id: string) => {
    try {
      const res = await fetch(`/api/avisos/${id}/lido`, { method: 'POST' });
      if (res.ok) {
        setAvisosSistema((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'lido' } : a))
        );
      }
    } catch (err) {
      console.error('Erro ao marcar aviso como lido:', err);
    }
  };

  const handleMarcarTodosAvisosLidos = async () => {
    try {
      const res = await fetch('/api/avisos/marcar-todos-lidos', { method: 'POST' });
      if (res.ok) {
        setAvisosSistema((prev) => prev.map((a) => ({ ...a, status: 'lido' })));
      }
    } catch (err) {
      console.error('Erro ao marcar todos avisos como lidos:', err);
    }
  };

  const handleSilenciarDocumentoAlerta = async (documentoId: string) => {
    try {
      const res = await fetch(`/api/vencimentos/documentos/${documentoId}/silenciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ silenciar: true }),
      });
      if (res.ok) {
        setAlertasVencimento((prev) => prev.filter((a) => a.documentoId !== documentoId));
      }
    } catch (err) {
      console.error('Erro ao silenciar alertas do documento:', err);
    }
  };

  // Estados de streaming da IA
  const [emStreaming, setEmStreaming] = useState(false);
  const [textoStreaming, setTextoStreaming] = useState('');

  // Total de mensagens não lidas no WhatsApp
  const totalNaoLidas = useMemo(() => {
    return conversas.reduce((acc, curr) => acc + (curr.naoLidas || 0), 0);
  }, [conversas]);

  // Busca lista de conversas reais do WhatsApp
  const carregarConversasWhatsApp = useCallback(async (silencioso = false) => {
    try {
      const res = await fetch('/api/conversas?tipo=whatsapp');
      if (res.status === 401) {
        setAutenticado(false);
        return;
      }
      if (res.ok) {
        const dados: Conversa[] = await res.json();
        setConversas((prev) => {
          // Se não houver dados prévios, adota os recebidos
          if (prev.length === 0) return dados;

          // Mescla para não perder estado instantâneo de streaming ou mensagens locais
          const dadosMap = new Map(dados.map((c) => [c.id, c]));
          const atualizadas = prev.map((c) => {
            const nova = dadosMap.get(c.id);
            if (!nova) return c;
            // Se a versão nova do servidor tiver mais mensagens ou atualização mais recente, usa a do servidor
            if ((nova.mensagens?.length || 0) >= (c.mensagens?.length || 0)) {
              return nova;
            }
            return c;
          });

          // Adiciona conversas novas que não estavam na lista
          for (const d of dados) {
            if (!prev.some((p) => p.id === d.id)) {
              atualizadas.push(d);
            }
          }

          return atualizadas.sort((a, b) => {
            const tA = new Date(a.ultimaAtualizacao || 0).getTime();
            const tB = new Date(b.ultimaAtualizacao || 0).getTime();
            return tB - tA;
          });
        });

        // Se nenhuma estiver ativa, ativa a primeira da lista
        setConversaAtivaId((atual) => {
          if (!atual && dados.length > 0) return dados[0].id;
          return atual;
        });
      }
    } catch (err) {
      if (!silencioso) console.error('Erro ao buscar conversas do WhatsApp:', err);
    } finally {
      setCarregandoConversas(false);
    }
  }, []);

  useEffect(() => {
    if (autenticado) {
      carregarConversasWhatsApp();
    }
  }, [autenticado, carregarConversasWhatsApp]);

  // Sincronização inteligente: revalida ao focar na janela ou voltar para a aba
  useEffect(() => {
    if (!autenticado) return;

    const handleFocus = () => {
      carregarConversasWhatsApp(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        carregarConversasWhatsApp(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    // Polling suave de fallback a cada 8 segundos na aba de conversas
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        carregarConversasWhatsApp(true);
      }
    }, 8000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [autenticado, carregarConversasWhatsApp]);

  // Hook SSE para atualização em tempo real
  useSSE({
    habilitado: Boolean(autenticado),
    onNovaMensagem: (conversaId, msg, conversaAtualizada) => {
      // Processa apenas mensagens do WhatsApp real
      if (!conversaId.startsWith('wa-')) return;

      console.log(`[SSE 💬] Mensagem em tempo real recebida para ${conversaId}:`, msg.texto);

      setConversas((prev) => {
        const existe = prev.some((c) => c.id === conversaId);
        let lista: Conversa[];

        if (existe) {
          lista = prev.map((c) => {
            if (c.id === conversaId) {
              // Evita duplicar se a mensagem com mesmo ID já existir
              const jaExiste = c.mensagens.some((m) => m.id === msg.id);
              const novasMsgs = jaExiste ? c.mensagens : [...c.mensagens, msg];
              const naoLidas =
                conversaId === conversaAtivaId
                  ? 0
                  : msg.remetente === 'cliente'
                  ? (c.naoLidas || 0) + 1
                  : c.naoLidas;

              return {
                ...c,
                ultimaAtualizacao: new Date().toISOString(),
                naoLidas,
                mensagens: novasMsgs,
                contato: conversaAtualizada?.contato || c.contato,
              };
            }
            return c;
          });
        } else if (conversaAtualizada) {
          lista = [conversaAtualizada, ...prev];
        } else {
          return prev;
        }

        // Ordena com a mais recente no topo
        return lista.sort((a, b) => {
          const tA = new Date(a.ultimaAtualizacao || 0).getTime();
          const tB = new Date(b.ultimaAtualizacao || 0).getTime();
          return tB - tA;
        });
      });
    },
    onConversaAtualizada: (conversaAtualizada) => {
      if (!conversaAtualizada.id.startsWith('wa-')) return;
      setConversas((prev) =>
        prev.map((c) => (c.id === conversaAtualizada.id ? conversaAtualizada : c))
      );
    },
    onAlertaVencimento: () => {
      carregarAlertasVencimento();
    },
  });

  // Função para efetuar logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Erro ao deslogar:', err);
    } finally {
      setAutenticado(false);
      setUsuarioLogado(null);
    }
  };

  // Conversa atualmente selecionada
  const conversaAtiva = conversas.find((c) => c.id === conversaAtivaId) || null;

  // Selecionar conversa
  const handleSelecionarConversa = async (id: string) => {
    setConversaAtivaId(id);
    setTextoStreaming('');
    setEmStreaming(false);

    try {
      // Notifica o backend para marcar mensagens como lidas
      const res = await fetch(`/api/conversas/${id}`);
      if (res.ok) {
        const dadosConversa: Conversa = await res.json();
        setConversas((prev) =>
          prev.map((c) => (c.id === id ? { ...dadosConversa, naoLidas: 0 } : c))
        );
      }
    } catch (err) {
      console.error('Erro ao carregar detalhes da conversa:', err);
    }
  };


  // Enviar mensagem no WhatsApp pelo painel
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

    setConversas((prev) =>
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

                setConversas((prev) =>
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
                console.error('Erro emitido pelo SSE:', evento.mensagem);
                setEmStreaming(false);
              }
            } catch {
              // Fragmento JSON incompleto
            }
          }
        }
      }
    } catch (erro) {
      console.error('Erro na requisição SSE:', erro);
      setEmStreaming(false);
      setTextoStreaming('');
    }
  };

  // Renderizações Condicionais de Autenticação
  if (autenticado === null) {
    return (
      <div className="h-screen w-screen bg-[#0b0f14] flex flex-col items-center justify-center text-slate-200 select-none">
        <div className="mb-4 animate-pulse">
          <LogoDeltaPlan tamanho="lg" />
        </div>
        <p className="text-xs font-medium text-slate-400 tracking-wider uppercase">
          Carregando ambiente corporativo...
        </p>
      </div>
    );
  }

  if (autenticado === false) {
    return (
      <LoginView
        onLoginSucesso={(usuario) => {
          setAutenticado(true);
          if (usuario) setUsuarioLogado(usuario);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen bg-[#0b0f14] overflow-hidden font-sans">
      {/* Barra de Navegação Extrema Esquerda (64px) */}
      <NavigationSidebar
        abaAtiva={abaAtiva}
        onSelecionarAba={setAbaAtiva}
        totalNaoLidas={totalNaoLidas}
        totalAlertasVencimento={totalAlertasNaoLidos + totalAvisosNaoLidos}
        onAbrirAlertas={() => setModalAlertasAberto(true)}
        onLogout={handleLogout}
        nomeUsuario={usuarioLogado?.nome}
        roleUsuario={usuarioLogado?.role}
      />

      {/* Aba 1: WhatsApp Real em Tempo Real */}
      {abaAtiva === 'whatsapp' && (
        <div className="flex flex-1 h-full overflow-hidden">
          {/* Coluna 1: Lista de Conversas Reais (~320px) */}
          <SidebarConversas
            conversas={conversas}
            conversaAtivaId={conversaAtivaId}
            onSelecionarConversa={handleSelecionarConversa}
            carregando={carregandoConversas}
          />

          {/* Coluna 2: Thread do Chat (flex-1) */}
          {conversaAtiva ? (
            <ChatThread
              conversa={conversaAtiva}
              emStreaming={emStreaming}
              textoStreaming={textoStreaming}
              onEnviarMensagem={handleEnviarMensagem}
              onSelecionarOpcaoDocumento={(docId, titulo) =>
                handleEnviarMensagem(titulo, undefined, docId)
              }
              onNavegarParaDocumentos={() => {
                setSubAbaBaseVega('documentos');
                setAbaAtiva('conhecimento');
              }}
            />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center bg-[#0b0f14] text-slate-400 p-6 text-center select-none wa-chat-pattern">
              <div className="max-w-md p-8 rounded-2xl bg-[#121820] border border-[#202937] shadow-xl flex flex-col items-center text-center">
                <div className="mb-4">
                  <LogoDeltaPlan tamanho="lg" />
                </div>
                <h2 className="text-lg font-semibold text-slate-100 mb-2">
                  Atendimento WhatsApp • VEGA
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  {carregandoConversas
                    ? 'Carregando histórico de conversas do Supabase...'
                    : 'Selecione uma conversa na lista ao lado para visualizar os diálogos em tempo real e acompanhar as interações com a IA.'}
                </p>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#18202b] border border-[#263345] text-[11px] text-slate-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>Base do Cofre pronta para consultas</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Aba: Gestão de Usuários Autorizados */}
      {abaAtiva === 'usuarios' && <UsuariosView />}

      {/* Aba 4: Base da VEGA (Conhecimento & Documentos) */}
      {abaAtiva === 'conhecimento' && (
        <KnowledgeBaseView subAbaInicial={subAbaBaseVega} />
      )}

      {/* Aba 5: Painel Admin */}
      {abaAtiva === 'admin' && <AdminView conversas={conversas} />}

      {/* Aba 6: Configurações da VEGA (Exclusivo Administradores) */}
      {abaAtiva === 'configuracoes_vega' && usuarioLogado?.role === 'admin' && (
        <ConfiguracoesVegaView />
      )}

      {/* Modal Central de Notificações (Vencimentos & Avisos do Sistema) */}
      <ModalAlertasVencimento
        aberto={modalAlertasAberto}
        onFechar={() => setModalAlertasAberto(false)}
        alertas={alertasVencimento}
        totalNaoLidos={totalAlertasNaoLidos}
        onMarcarLido={handleMarcarAlertaLido}
        onMarcarTodosLidos={handleMarcarTodosAlertasLidos}
        onRecarregar={executarVerificacaoAlertas}
        onSilenciarDocumento={handleSilenciarDocumentoAlerta}
        avisosSistema={avisosSistema}
        onMarcarAvisoLido={handleMarcarAvisoLido}
        onMarcarTodosAvisosLidos={handleMarcarTodosAvisosLidos}
      />
    </div>
  );
}

export default App;
