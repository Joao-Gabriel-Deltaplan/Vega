import { Response } from 'express';
import { EventEmitter } from 'events';
import { Mensagem, Conversa } from '../types.js';

export interface EventoPainelPayload {
  tipo: 'nova_mensagem' | 'conversa_atualizada' | 'usuario_alterado' | 'alerta_vencimento';
  conversaId?: string;
  mensagem?: Mensagem;
  conversa?: Conversa;
  dados?: any;
  timestamp: string;
}

class EventosPainelService extends EventEmitter {
  private conexoesAtivas: Set<Response> = new Set();
  private intervaloHeartbeat: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.iniciarHeartbeat();
  }

  /**
   * Mantém o stream HTTP ativo contra timeouts de proxy (ex: Railway, Cloudflare, Nginx)
   * Enviando um ping SSE a cada 25 segundos.
   */
  private iniciarHeartbeat(): void {
    if (this.intervaloHeartbeat) return;
    this.intervaloHeartbeat = setInterval(() => {
      this.enviarParaTodos(': ping\n\n');
    }, 25000);
  }

  /**
   * Registra uma nova conexão SSE de cliente autenticado
   */
  public adicionarCliente(res: Response, usuarioId?: string): void {
    this.conexoesAtivas.add(res);
    console.log(
      `[SSE 🟢] Cliente conectado (${usuarioId || 'admin'}). Total ativos: ${this.conexoesAtivas.size}`
    );

    // Envia evento de boas-vindas confirmando conexão estabelecida
    res.write(`data: ${JSON.stringify({ tipo: 'conectado', timestamp: new Date().toISOString() })}\n\n`);

    // Remove a conexão quando o cliente fechar a aba ou desconectar
    res.on('close', () => {
      this.conexoesAtivas.delete(res);
      console.log(
        `[SSE 🔴] Cliente desconectado (${usuarioId || 'admin'}). Total ativos: ${this.conexoesAtivas.size}`
      );
    });
  }

  /**
   * Envia texto bruto para todas as conexões SSE ativas
   */
  private enviarParaTodos(dadosFormatados: string): void {
    for (const res of this.conexoesAtivas) {
      try {
        res.write(dadosFormatados);
      } catch (err) {
        this.conexoesAtivas.delete(res);
      }
    }
  }

  /**
   * Transmite um evento estruturado para todos os painéis conectados
   */
  public emitirEvento(payload: Omit<EventoPainelPayload, 'timestamp'>): void {
    const eventoCompleto: EventoPainelPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };
    const sseData = `data: ${JSON.stringify(eventoCompleto)}\n\n`;
    this.enviarParaTodos(sseData);
  }

  /**
   * Notifica a chegada de uma nova mensagem no WhatsApp ou no Simulador
   */
  public emitirNovaMensagem(conversaId: string, mensagem: Mensagem, conversa?: Conversa): void {
    this.emitirEvento({
      tipo: 'nova_mensagem',
      conversaId,
      mensagem,
      conversa,
    });
  }

  /**
   * Notifica atualização em conversa (ex: marcada como lida, alteração de contato)
   */
  public emitirConversaAtualizada(conversa: Conversa): void {
    this.emitirEvento({
      tipo: 'conversa_atualizada',
      conversaId: conversa.id,
      conversa,
    });
  }

  /**
   * Notifica alteração na tabela de usuários autorizados
   */
  public emitirUsuarioAlterado(acao: 'criado' | 'atualizado' | 'removido', usuario: any): void {
    this.emitirEvento({
      tipo: 'usuario_alterado',
      dados: { acao, usuario },
    });
  }

  /**
   * Retorna o total de clientes conectados
   */
  public getTotalConectados(): number {
    return this.conexoesAtivas.size;
  }
}

export const eventosPainel = new EventosPainelService();
