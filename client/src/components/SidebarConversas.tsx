import React, { useState, useMemo } from 'react';
import { Search, MessageSquare, Mic, Paperclip, Loader2 } from 'lucide-react';
import { Conversa } from '../types/chat.js';
import { formatarHorario } from '../utils/dataHoraUtils.js';
import { obterPaletaAvatar, obterIniciais } from '../utils/avatarUtils.js';

interface SidebarConversasProps {
  conversas: Conversa[];
  conversaAtivaId: string | null;
  onSelecionarConversa: (id: string) => void;
  carregando?: boolean;
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
  carregando = false,
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
    <aside className="w-[320px] min-w-[320px] h-full flex flex-col bg-[#0f141c] border-r border-[#1e2633]">
      {/* Topo / Header da Lista */}
      <div className="p-3.5 bg-[#121820] flex flex-col gap-2.5 border-b border-[#1e2633]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <div>
              <h1 className="font-semibold text-xs text-slate-100 uppercase tracking-wider">
                Conversas WhatsApp
              </h1>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                {carregando ? (
                  <span className="flex items-center gap-1 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                    Carregando...
                  </span>
                ) : (
                  `${conversas.length} ${conversas.length === 1 ? 'conversa' : 'conversas'}`
                )}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>Ao vivo</span>
          </div>
        </div>

        {/* Campo de Busca */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por contato ou mensagem..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            disabled={carregando}
            className="w-full pl-8 pr-3 py-1.5 bg-[#0b0f14] rounded-lg text-xs text-slate-200 placeholder:text-slate-500 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-50"
          />
        </div>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1e2633]/60">
        {carregando ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-xl animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[#18202b] flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[#18202b] rounded w-28" />
                  <div className="h-2 bg-[#18202b]/60 rounded w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : conversasFiltradas.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            {busca
              ? 'Nenhuma conversa encontrada para esta busca.'
              : 'Nenhuma conversa do WhatsApp registrada ainda.'}
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
            const paletaAvatar = obterPaletaAvatar(conversa.contato.nome);

            return (
              <div
                key={conversa.id}
                onClick={() => onSelecionarConversa(conversa.id)}
                className={`flex items-center gap-3 p-3.5 cursor-pointer transition-colors relative ${
                  isAtiva
                    ? 'bg-[#18202b] border-l-2 border-emerald-400'
                    : 'hover:bg-[#131922]'
                }`}
              >
                {/* Avatar do Contato com Cor Suave Derivada do Nome */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-xs flex-shrink-0 shadow-inner relative"
                  style={{
                    backgroundColor: paletaAvatar.bg,
                    color: paletaAvatar.text,
                    border: `1px solid ${paletaAvatar.border}`,
                  }}
                >
                  {obterIniciais(conversa.contato.nome)}
                  {nivel === 'diretoria' && (
                    <span
                      title="Administrador"
                      className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center text-[8px] font-black border border-[#0b0f14]"
                    >
                      ★
                    </span>
                  )}
                </div>

                {/* Informações da Conversa */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-medium text-xs text-slate-100 truncate">
                      {conversa.contato.nome}
                    </span>
                    <span className="text-[10px] text-slate-500 flex-shrink-0">
                      {formatarHorario(ultimaMensagem?.timestamp || ultimaMensagem?.horario)}
                    </span>
                  </div>

                  {/* Número de Telefone e Perfil */}
                  <div className="flex items-center gap-1.5 mb-1 text-[11px]">
                    <span className="text-slate-400 font-mono text-[10px] truncate">
                      {formatarTelefone(conversa.contato.telefone)}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                        nivel === 'diretoria'
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {nivel === 'diretoria' ? 'Admin' : 'Comum'}
                    </span>
                  </div>

                  {/* Prévia da Última Mensagem */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate">
                      {isAudio && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium flex-shrink-0">
                          <Mic className="w-3 h-3" />
                          <span>Áudio:</span>
                        </span>
                      )}

                      {!isAudio && temAnexo && (
                        <span className="inline-flex items-center gap-0.5 text-sky-400 font-medium flex-shrink-0">
                          <Paperclip className="w-3 h-3" />
                          <span>[Anexo]</span>
                        </span>
                      )}

                      <span className="truncate">
                        {ultimaMensagem?.texto || 'Conversa iniciada'}
                      </span>
                    </div>

                    {/* Contador de Mensagens Não Lidas Discreto */}
                    {conversa.naoLidas > 0 && (
                      <span className="bg-emerald-500 text-slate-950 font-bold text-[10px] min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
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
