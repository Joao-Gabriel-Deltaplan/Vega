export interface UsuarioWhatsApp {
  id: string;
  numero: string; // Formato canônico: 55 + DDD + número (ex: 5514996863115)
  lid?: string | null; // Identificador @lid do WhatsApp (ex: 176948374462673 ou 176948374462673@lid)
  nome: string;
  perfil: 'admin' | 'comum';
  pessoa_id: string | null; // Id do titular no Cofre (para restrições futuras)
  ativo?: boolean;
  dataCadastro?: string;
}

export interface EvolutionMessageKey {
  remoteJid: string; // Ex: "5514996863115@s.whatsapp.net", "1203630...@g.us" ou "176948374462673@lid"
  fromMe: boolean;
  id: string; // Identificador único da mensagem (ex: "BAE5F1234567890ABCDEF")
  participant?: string; // Presente em grupos: "5514996863115@s.whatsapp.net"
  senderPn?: string; // Número de telefone real quando remoteJid for @lid
  participantPn?: string;
  remoteJidAlt?: string;
  previousRemoteJid?: string;
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
