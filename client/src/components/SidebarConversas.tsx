import React, { useState, useMemo } from 'react';
import { Search, MessageSquare, Mic, Paperclip } from 'lucide-react';
import { Conversa } from '../types/chat.js';
import { formatarHorario } from '../utils/dataHoraUtils.js';

interface SidebarConversasProps {
  conversas: Conversa[];
  conversaAtivaId: string | null;
  onSelecionarConversa: (id: string) => void;
}

// Extrai as iniciais do nome
function getIniciais(nome: string): string {
  if (!nome) return '??';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Formatação do telefone para exibição amigável
function formatarTelefone(telefone: string): string {
  if (!telefone) return '';
  const limpo = telefone.replace(/\D/g, '');
  if (limpo.startsWith('55') && limpo.length === 13) {
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 9)}-${limpo.slice(9)}`;
  }
  if (limpo.startsWith('55') && limpo.length === 12) {
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 8)}-${limpo.slice(8)}`;
  }
  return telefone;
}

export const SidebarConversas: React.FC<SidebarConversasProps> = ({
  conversas,
  conversaAtivaId,
  onSelecionarConversa,
}) => {
  const [busca, setBusca] = useState('');

  // Filtra por nome, telefone ou texto da última mensagem
  const conversasFiltradas = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return conversas;
    return conversas.filter(
      (c) =>
        c.contato.nome.toLowerCase().includes(termo) ||
        c.contato.telefone.toLowerCase().includes(termo) ||
        (c.contato.cargo && c.contato.cargo.toLowerCase().includes(termo)) ||
        c.mensagens[c.mensagens.length - 1]?.texto.toLowerCase().includes(termo)
    );
  }, [conversas, busca]);

  return (
    <aside className="w-[320px] min-w-[320px] h-full flex flex-col bg-wa-bg border-r border-wa-border">
      {/* Topo / Header do WhatsApp */}
      <div className="p-3.5 bg-wa-panel flex flex-col gap-2.5 border-b border-wa-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-wa-green/20 text-wa-green flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-wa-textPrimary">
                WhatsApp Real
              </h1>
              <span className="text-[11px] text-wa-textSecondary">
                {conversas.length} {conversas.length === 1 ? 'conversa ativa' : 'conversas ativas'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Ao vivo</span>
          </div>
        </div>

        {/* Campo de Busca */}
        <div className="relative">
          <Search className="w-4 h-4 text-wa-textSecondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar conversa ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-wa-bg rounded-lg text-xs text-wa-textPrimary placeholder:text-wa-textMuted border border-transparent focus:border-wa-green focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Lista de Conversas do WhatsApp */}
      <div className="flex-1 overflow-y-auto divide-y divide-wa-border/30">
        {conversasFiltradas.length === 0 ? (
          <div className="p-6 text-center text-wa-textSecondary text-xs">
            {busca
              ? 'Nenhuma conversa encontrada para esta busca.'
              : 'Nenhuma conversa do WhatsApp recebida ainda.'}
          </div>
        ) : (
          conversasFiltradas.map((conversa) => {
            const isAtiva = conversa.id === conversaAtivaId;
            const ultimaMensagem = conversa.mensagens[conversa.mensagens.length - 1];
            const isAudio =
              ultimaMensagem?.tipoMensagem === 'audio' || Boolean(ultimaMensagem?.audioOriginal);
            const temAnexo =
              Boolean(ultimaMensagem?.anexos && ultimaMensagem.anexos.length > 0);

            const nivel =
              conversa.contato.nivelAcesso || conversa.contato.ficha?.nivelAcesso || 'geral';

            return (
              <div
                key={conversa.id}
                onClick={() => onSelecionarConversa(conversa.id)}
                className={`flex items-center gap-3 p-3.5 cursor-pointer transition-colors relative ${
                  isAtiva
                    ? 'bg-wa-panel border-l-4 border-wa-green'
                    : 'hover:bg-wa-panel/60'
                }`}
              >
                {/* Avatar do Contato */}
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm text-slate-950 flex-shrink-0 shadow-inner relative"
                  style={{ backgroundColor: conversa.contato.avatarCor || '#25D366' }}
                >
                  {getIniciais(conversa.contato.nome)}
                  {nivel === 'diretoria' && (
                    <span
                      title="Administrador / Diretoria"
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center text-[9px] font-black border border-wa-bg"
                    >
                      ★
                    </span>
                  )}
                </div>

                {/* Informações da Conversa */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-semibold text-xs text-wa-textPrimary truncate">
                      {conversa.contato.nome}
                    </span>
                    <span className="text-[10px] text-wa-textMuted flex-shrink-0">
                      {formatarHorario(ultimaMensagem?.timestamp || ultimaMensagem?.horario)}
                    </span>
                  </div>

                  {/* Número de Telefone e Perfil */}
                  <div className="flex items-center gap-1.5 mb-1 text-[11px]">
                    <span className="font-mono text-wa-textSecondary truncate">
                      {formatarTelefone(conversa.contato.telefone)}
                    </span>
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded font-semibold uppercase tracking-wider ${
                        nivel === 'diretoria'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-wa-border/60 text-wa-textMuted'
                      }`}
                    >
                      {nivel === 'diretoria' ? 'Admin' : 'Geral'}
                    </span>
                  </div>

                  {/* Prévia da Última Mensagem com Selo de Áudio/Anexo */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[11px] text-wa-textSecondary truncate">
                      {isAudio && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium flex-shrink-0">
                          <Mic className="w-3 h-3 text-emerald-400" />
                          <span>Áudio:</span>
                        </span>
                      )}

                      {!isAudio && temAnexo && (
                        <span className="inline-flex items-center gap-0.5 text-indigo-400 font-medium flex-shrink-0">
                          <Paperclip className="w-3 h-3 text-indigo-400" />
                          <span>[Anexo]</span>
                        </span>
                      )}

                      <span className="truncate">
                        {ultimaMensagem?.texto || 'Conversa iniciada'}
                      </span>
                    </div>

                    {/* Contador de Mensagens Não Lidas */}
                    {conversa.naoLidas > 0 && (
                      <span className="bg-wa-green text-slate-950 font-bold text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm animate-pulse">
                        {conversa.naoLidas}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
