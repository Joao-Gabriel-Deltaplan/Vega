export interface UsuarioWhatsApp {
  id: string;
  numero: string; // Formato canônico: 55 + DDD + número (ex: 5514996863115)
  nome: string;
  perfil: 'admin' | 'comum';
  pessoa_id: string | null; // Id do titular no Cofre (para restrições futuras)
  ativo?: boolean;
  dataCadastro?: string;
}

export interface EvolutionMessageKey {
  remoteJid: string; // Ex: "5514996863115@s.whatsapp.net" ou "1203630...@g.us"
  fromMe: boolean;
  id: string; // Identificador único da mensagem (ex: "BAE5F1234567890ABCDEF")
  participant?: string; // Presente em grupos: "5514996863115@s.whatsapp.net"
}

export interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
  };
  imageMessage?: {
    caption?: string;
  };
  documentMessage?: {
    caption?: string;
    title?: string;
    fileName?: string;
  };
  audioMessage?: any;
}

export interface EvolutionWebhookData {
  key: EvolutionMessageKey;
  pushName?: string;
  message?: EvolutionMessageContent;
  messageType?: string;
  messageTimestamp?: number | string;
  status?: string;
  instanceId?: string;
  source?: string;
  participant?: string;
}

export interface EvolutionWebhookPayload {
  event?: string; // Ex: "messages.upsert" ou "MESSAGES_UPSERT"
  instance?: string;
  data?: EvolutionWebhookData | EvolutionWebhookData[];
  sender?: string;
  destination?: string;
  date_time?: string;
}

export interface ResultadoProcessamentoWebhook {
  sucesso: boolean;
  status: 'processado' | 'ignorado' | 'recusado' | 'erro';
  motivo?: string;
  resposta?: string;
  destinatario?: string;
  mensagemId?: string;
  usuario?: UsuarioWhatsApp;
  tempoMs?: number;
}
