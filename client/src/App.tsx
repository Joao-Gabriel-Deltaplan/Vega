import { useState, useEffect, useCallback, useMemo } from 'react';
import { NavigationSidebar, AbaNavegacao } from './components/NavigationSidebar.js';
import { SidebarConversas } from './components/SidebarConversas.js';
import { ChatThread } from './components/ChatThread.js';
import { ContactDetails } from './components/ContactDetails.js';
import { KnowledgeBaseView } from './components/KnowledgeBaseView.js';
import { AdminView } from './components/AdminView.js';
import { ModalAlertasVencimento } from './components/ModalAlertasVencimento.js';
import { Conversa, Contato, Anexo, Mensagem, SetorUsuario, AlertaVencimento } from './types/chat.js';
import { Users } from 'lucide-react';

export function App() {
  const [abaAtiva, setAbaAtiva] = useState<AbaNavegacao>('conversas');
  const [subAbaBaseVega, setSubAbaBaseVega] = useState<'conhecimento' | 'documentos'>('conhecimento');
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [conversaAtivaId, setConversaAtivaId] = useState<string | null>(null);
  const [carregandoConversas, setCarregandoConversas] = useState(true);
  const [carregandoTeste, setCarregandoTeste] = useState(false);

  // Estados de Alertas de Vencimento
  const [alertasVencimento, setAlertasVencimento] = useState<AlertaVencimento[]>([]);
  const [modalAlertasAberto, setModalAlertasAberto] = useState(false);

  const totalAlertasNaoLidos = useMemo(() => {
    return alertasVencimento.filter((a) => !a.lido).length;
  }, [alertasVencimento]);

  const carregarAlertasVencimento = useCallback(async () => {
    try {
      const res = await fetch('/api/vencimentos/alertas');
      if (res.ok) {
        const dados = await res.json();
        setAlertasVencimento(dados.alertas || []);
      }
    } catch (err) {
      console.error('Erro ao carregar alertas de vencimento:', err);
    }
  }, []);

  useEffect(() => {
    carregarAlertasVencimento();
    // Atualiza alertas a cada 60 segundos
    const timer = setInterval(carregarAlertasVencimento, 60000);
    return () => clearInterval(timer);
  }, [carregarAlertasVencimento]);

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

  // Total de mensagens não lidas
  const totalNaoLidas = useMemo(() => {
    return conversas.reduce((acc, curr) => acc + (curr.naoLidas || 0), 0);
  }, [conversas]);

  // Busca lista inicial de conversas
  const carregarConversas = useCallback(async () => {
    try {
      const res = await fetch('/api/conversas');
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
      console.error('Erro ao buscar conversas:', err);
    } finally {
      setCarregandoConversas(false);
    }
  }, []);

  useEffect(() => {
    carregarConversas();
  }, [carregarConversas]);

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

  // Criar nova conversa de teste
  const handleNovaConversaTeste = async () => {
    setCarregandoTeste(true);
    try {
      const res = await fetch('/api/conversas/nova-teste', { method: 'POST' });
      if (res.ok) {
        const nova: Conversa = await res.json();
        setConversas((prev) => [nova, ...prev]);
        setConversaAtivaId(nova.id);
        setTextoStreaming('');
        setEmStreaming(false);
      }
    } catch (err) {
      console.error('Erro ao criar conversa de teste:', err);
    } finally {
      setCarregandoTeste(false);
    }
  };

  // Atualizar perfil do usuário interno (Cargo / Setor / Nível de Acesso / Observações)
  const handleAtualizarContato = async (dadosAtualizados: Partial<Contato>) => {
    if (!conversaAtiva) return;

    const novoNivel = dadosAtualizados.nivelAcesso || dadosAtualizados.ficha?.nivelAcesso || conversaAtiva.contato.nivelAcesso || 'geral';
    const novoCargo = dadosAtualizados.cargo || dadosAtualizados.ficha?.cargo || conversaAtiva.contato.cargo || '';
    const novoSetor = (dadosAtualizados.setor || dadosAtualizados.ficha?.setor || conversaAtiva.contato.setor || 'Administrativo') as SetorUsuario;

    // Atualização otimista no estado local
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

  // Enviar mensagem com Streaming SSE
  const handleEnviarMensagem = async (texto: string, anexos?: Anexo[], documentoId?: string) => {
    if (!conversaAtiva || emStreaming) return;

    const conversaId = conversaAtiva.id;
    const agora = new Date();
    const horarioAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // 1. Mensagem otimista do cliente na tela
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

    // Inicia estado de streaming
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
                // Mensagem final do assistente (já processada e com eventuais PDFs gerados)
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
              // Fragmento incompleto de chunk JSON
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

  return (
    <div className="flex h-screen w-screen bg-wa-bg overflow-hidden font-sans">
      {/* Barra de Navegação Extrema Esquerda (64px) */}
      <NavigationSidebar
        abaAtiva={abaAtiva}
        onSelecionarAba={setAbaAtiva}
        totalNaoLidas={totalNaoLidas}
        totalAlertasVencimento={totalAlertasNaoLidos}
        onAbrirAlertas={() => setModalAlertasAberto(true)}
      />

      {/* Visualização de acordo com a aba selecionada */}
      {abaAtiva === 'conversas' && (
        <div className="flex flex-1 h-full overflow-hidden">
          {/* Coluna 1: Lista de Conversas (~300px) */}
          <SidebarConversas
            conversas={conversas}
            conversaAtivaId={conversaAtivaId}
            onSelecionarConversa={handleSelecionarConversa}
            onNovaConversaTeste={handleNovaConversaTeste}
            carregandoTeste={carregandoTeste}
          />

          {/* Coluna 2: Thread do Chat (flex-1) */}
          {conversaAtiva ? (
            <ChatThread
              conversa={conversaAtiva}
              emStreaming={emStreaming}
              textoStreaming={textoStreaming}
              onEnviarMensagem={handleEnviarMensagem}
              onSelecionarOpcaoDocumento={(docId, titulo) => handleEnviarMensagem(titulo, undefined, docId)}
              onNavegarParaDocumentos={() => {
                setSubAbaBaseVega('documentos');
                setAbaAtiva('conhecimento');
              }}
            />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center bg-wa-chat text-wa-textSecondary p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-wa-green/10 flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-wa-green animate-pulse" />
              </div>
              <h2 className="text-xl font-semibold text-wa-textPrimary mb-1">
                Delta Plan • Cofre Corporativo & VEGA
              </h2>
              <p className="text-sm max-w-md text-wa-textSecondary">
                {carregandoConversas
                  ? 'Carregando usuários...'
                  : 'Selecione um usuário ao lado ou crie um novo usuário de teste para consultar documentos do cofre.'}
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

      {/* Aba 2: Base da VEGA (Conhecimento & Documentos) */}
      {abaAtiva === 'conhecimento' && (
        <KnowledgeBaseView subAbaInicial={subAbaBaseVega} />
      )}

      {/* Aba 3: Painel Admin */}
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
