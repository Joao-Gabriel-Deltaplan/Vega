import { useState, useEffect, useCallback, useMemo } from 'react';
import { NavigationSidebar, AbaNavegacao } from './components/NavigationSidebar.js';
import { SidebarConversas } from './components/SidebarConversas.js';
import { ChatThread } from './components/ChatThread.js';
import { ContactDetails } from './components/ContactDetails.js';
import { KnowledgeBaseView } from './components/KnowledgeBaseView.js';
import { AdminView } from './components/AdminView.js';
import { UsuariosView } from './components/UsuariosView.js';
import { SimuladorView } from './components/SimuladorView.js';
import { ModalAlertasVencimento } from './components/ModalAlertasVencimento.js';
import { Conversa, Contato, Anexo, Mensagem, SetorUsuario, AlertaVencimento } from './types/chat.js';
import { MessageSquare, Bot } from 'lucide-react';
import { LoginView } from './components/LoginView.js';
import { useSSE } from './hooks/useSSE.js';

export function App() {
  // Estados de Autenticação
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  const [usuarioLogado, setUsuarioLogado] = useState<{ userId: string; nome: string; role: string } | null>(null);

  // Navegação: 'whatsapp' é a aba principal
  const [abaAtiva, setAbaAtiva] = useState<AbaNavegacao>('whatsapp');
  const [subAbaBaseVega, setSubAbaBaseVega] = useState<'conhecimento' | 'documentos'>('conhecimento');

  // Conversas do WhatsApp Real
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [conversaAtivaId, setConversaAtivaId] = useState<string | null>(null);
  const [carregandoConversas, setCarregandoConversas] = useState(true);

  // Estados de Alertas de Vencimento
  const [alertasVencimento, setAlertasVencimento] = useState<AlertaVencimento[]>([]);
  const [modalAlertasAberto, setModalAlertasAberto] = useState(false);

  const totalAlertasNaoLidos = useMemo(() => {
    return alertasVencimento.filter((a) => !a.lido).length;
  }, [alertasVencimento]);

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

  // Atualiza alertas periodicamente se autenticado
  useEffect(() => {
    if (autenticado) {
      carregarAlertasVencimento();
      const timer = setInterval(carregarAlertasVencimento, 60000);
      return () => clearInterval(timer);
    }
  }, [autenticado, carregarAlertasVencimento]);

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
  const carregarConversasWhatsApp = useCallback(async () => {
    try {
      const res = await fetch('/api/conversas?tipo=whatsapp');
      if (res.status === 401) {
        setAutenticado(false);
        return;
      }
      if (res.ok) {
        const dados: Conversa[] = await res.json();
        setConversas(dados);
        // Se nenhuma estiver ativa, ativa a primeira da lista
        setConversaAtivaId((atual) => {
          if (!atual && dados.length > 0) return dados[0].id;
          return atual;
        });
      }
    } catch (err) {
      console.error('Erro ao buscar conversas do WhatsApp:', err);
    } finally {
      setCarregandoConversas(false);
    }
  }, []);

  useEffect(() => {
    if (autenticado) {
      carregarConversasWhatsApp();
    }
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
              const novasMsgs = [...c.mensagens, msg];
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

  // Atualizar perfil do usuário interno
  const handleAtualizarContato = async (dadosAtualizados: Partial<Contato>) => {
    if (!conversaAtiva) return;

    const novoNivel =
      dadosAtualizados.nivelAcesso ||
      dadosAtualizados.ficha?.nivelAcesso ||
      conversaAtiva.contato.nivelAcesso ||
      'geral';
    const novoCargo =
      dadosAtualizados.cargo ||
      dadosAtualizados.ficha?.cargo ||
      conversaAtiva.contato.cargo ||
      '';
    const novoSetor = (dadosAtualizados.setor ||
      dadosAtualizados.ficha?.setor ||
      conversaAtiva.contato.setor ||
      'Administrativo') as SetorUsuario;

    setConversas((prev) =>
      prev.map((c) => {
        if (c.id === conversaAtiva.id) {
          return {
            ...c,
            contato: {
              ...c.contato,
              ...dadosAtualizados,
              cargo: novoCargo,
              setor: novoSetor,
              nivelAcesso: novoNivel,
              ficha: {
                ...c.contato.ficha,
                ...(dadosAtualizados.ficha || {}),
                cargo: novoCargo,
                setor: novoSetor,
                nivelAcesso: novoNivel,
              },
            },
          };
        }
        return c;
      })
    );

    try {
      await fetch(`/api/contatos/${conversaAtiva.contato.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosAtualizados),
      });
    } catch (err) {
      console.error('Erro ao persistir perfil:', err);
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
      <div className="h-screen w-screen bg-[#0b141a] flex flex-col items-center justify-center text-wa-textPrimary select-none">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-wa-green to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-950/50 mb-4 animate-pulse">
          <Bot className="w-9 h-9 text-slate-950" />
        </div>
        <p className="text-sm font-medium text-wa-textSecondary">
          Inicializando VEGA Delta Plan...
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
    <div className="flex h-screen w-screen bg-wa-bg overflow-hidden font-sans">
      {/* Barra de Navegação Extrema Esquerda (64px) */}
      <NavigationSidebar
        abaAtiva={abaAtiva}
        onSelecionarAba={setAbaAtiva}
        totalNaoLidas={totalNaoLidas}
        totalAlertasVencimento={totalAlertasNaoLidos}
        onAbrirAlertas={() => setModalAlertasAberto(true)}
        onLogout={handleLogout}
        nomeUsuario={usuarioLogado?.nome}
      />

      {/* Aba 1: WhatsApp Real em Tempo Real */}
      {abaAtiva === 'whatsapp' && (
        <div className="flex flex-1 h-full overflow-hidden">
          {/* Coluna 1: Lista de Conversas Reais (~320px) */}
          <SidebarConversas
            conversas={conversas}
            conversaAtivaId={conversaAtivaId}
            onSelecionarConversa={handleSelecionarConversa}
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
            <div className="flex-1 h-full flex flex-col items-center justify-center bg-wa-chat text-wa-textSecondary p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-wa-green/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-wa-green animate-pulse" />
              </div>
              <h2 className="text-xl font-semibold text-wa-textPrimary mb-1">
                WhatsApp Delta Plan • VEGA
              </h2>
              <p className="text-sm max-w-md text-wa-textSecondary">
                {carregandoConversas
                  ? 'Carregando conversas do WhatsApp...'
                  : 'Nenhuma conversa selecionada. As mensagens trocadas pelo WhatsApp espelham aqui em tempo real.'}
              </p>
            </div>
          )}

          {/* Coluna 3: Ficha do Contato (~280px) */}
          {conversaAtiva && (
            <ContactDetails
              conversa={conversaAtiva}
              onAtualizarContato={handleAtualizarContato}
            />
          )}
        </div>
      )}

      {/* Aba 2: Simulador da VEGA */}
      {abaAtiva === 'simulador' && <SimuladorView />}

      {/* Aba 3: Gestão de Usuários Autorizados */}
      {abaAtiva === 'usuarios' && <UsuariosView />}

      {/* Aba 4: Base da VEGA (Conhecimento & Documentos) */}
      {abaAtiva === 'conhecimento' && (
        <KnowledgeBaseView subAbaInicial={subAbaBaseVega} />
      )}

      {/* Aba 5: Painel Admin */}
      {abaAtiva === 'admin' && <AdminView conversas={conversas} />}

      {/* Modal de Alertas de Vencimento de Documentos */}
      <ModalAlertasVencimento
        aberto={modalAlertasAberto}
        onFechar={() => setModalAlertasAberto(false)}
        alertas={alertasVencimento}
        totalNaoLidos={totalAlertasNaoLidos}
        onMarcarLido={handleMarcarAlertaLido}
        onMarcarTodosLidos={handleMarcarTodosAlertasLidos}
        onRecarregar={carregarAlertasVencimento}
        onSilenciarDocumento={handleSilenciarDocumentoAlerta}
      />
    </div>
  );
}

export default App;
