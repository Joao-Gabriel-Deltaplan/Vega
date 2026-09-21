import { useEffect, useRef } from 'react';
import { Mensagem, Conversa } from '../types/chat.js';

export interface EventoSSEPayload {
  tipo: 'conectado' | 'nova_mensagem' | 'conversa_atualizada' | 'usuario_alterado' | 'alerta_vencimento';
  conversaId?: string;
  mensagem?: Mensagem;
  conversa?: Conversa;
  dados?: any;
  timestamp: string;
}

interface UseSSEOptions {
  habilitado: boolean;
  onNovaMensagem?: (conversaId: string, mensagem: Mensagem, conversa?: Conversa) => void;
  onConversaAtualizada?: (conversa: Conversa) => void;
  onUsuarioAlterado?: (dados: any) => void;
  onAlertaVencimento?: (dados: any) => void;
}

export function useSSE({
  habilitado,
  onNovaMensagem,
  onConversaAtualizada,
  onUsuarioAlterado,
  onAlertaVencimento,
}: UseSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);

  // Armazena callbacks em refs para evitar reconectar desnecessariamente
  const callbacksRef = useRef({
    onNovaMensagem,
    onConversaAtualizada,
    onUsuarioAlterado,
    onAlertaVencimento,
  });

  useEffect(() => {
    callbacksRef.current = {
      onNovaMensagem,
      onConversaAtualizada,
      onUsuarioAlterado,
      onAlertaVencimento,
    };
  }, [onNovaMensagem, onConversaAtualizada, onUsuarioAlterado, onAlertaVencimento]);

  useEffect(() => {
    if (!habilitado) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let encerrado = false;

    const conectar = () => {
      if (encerrado) return;

      const es = new EventSource('/api/eventos', { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log('[SSE 🟢] Conexão em tempo real estabelecida com o servidor.');
      };

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload: EventoSSEPayload = JSON.parse(event.data);

          if (payload.tipo === 'nova_mensagem' && payload.conversaId && payload.mensagem) {
            callbacksRef.current.onNovaMensagem?.(
              payload.conversaId,
              payload.mensagem,
              payload.conversa
            );
          } else if (payload.tipo === 'conversa_atualizada' && payload.conversa) {
            callbacksRef.current.onConversaAtualizada?.(payload.conversa);
          } else if (payload.tipo === 'usuario_alterado') {
            callbacksRef.current.onUsuarioAlterado?.(payload.dados);
          } else if (payload.tipo === 'alerta_vencimento') {
            callbacksRef.current.onAlertaVencimento?.(payload.dados);
          }
        } catch {
          // Ignora mensagens que não sejam JSON (ex: pings de heartbeat)
        }
      };

      es.onerror = () => {
        console.warn('[SSE ⚠️] Conexão SSE interrompida. Tentando reconectar em 3s...');
        es.close();
        if (!encerrado) {
          setTimeout(conectar, 3000);
        }
      };
    };

    conectar();

    return () => {
      encerrado = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [habilitado]);
}
