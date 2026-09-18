import React, { useState, useMemo } from 'react';
import { Search, UserPlus, Users } from 'lucide-react';
import { Conversa } from '../types/chat.js';

interface SidebarConversasProps {
  conversas: Conversa[];
  conversaAtivaId: string | null;
  onSelecionarConversa: (id: string) => void;
  onNovaConversaTeste: () => void;
  carregandoTeste: boolean;
}

// Extrai as iniciais do nome
function getIniciais(nome: string): string {
  if (!nome) return '??';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export const SidebarConversas: React.FC<SidebarConversasProps> = ({
  conversas,
  conversaAtivaId,
  onSelecionarConversa,
  onNovaConversaTeste,
  carregandoTeste,
}) => {
  const [busca, setBusca] = useState('');

  // Filtro por nome, telefone, cargo ou setor
  const conversasFiltradas = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return conversas;
    return conversas.filter(
      (c) =>
        c.contato.nome.toLowerCase().includes(termo) ||
        (c.contato.cargo && c.contato.cargo.toLowerCase().includes(termo)) ||
        (c.contato.setor && c.contato.setor.toLowerCase().includes(termo)) ||
        c.contato.telefone.toLowerCase().includes(termo) ||
        c.mensagens[c.mensagens.length - 1]?.texto.toLowerCase().includes(termo)
    );
  }, [conversas, busca]);

  return (
    <aside className="w-[300px] min-w-[300px] h-full flex flex-col bg-wa-bg border-r border-wa-border">
      {/* Topo / Header */}
      <div className="p-3.5 bg-wa-panel flex flex-col gap-2.5 border-b border-wa-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-wa-green" />
            <h1 className="font-semibold text-base text-wa-textPrimary">
              Usuários ({conversas.length})
            </h1>
          </div>
          <button
            onClick={onNovaConversaTeste}
            disabled={carregandoTeste}
            title="Criar novo usuário interno para testar a VEGA"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-wa-green hover:bg-wa-greenHover text-slate-950 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            {carregandoTeste ? (
              <span className="animate-spin text-xs">⏳</span>
            ) : (
              <UserPlus className="w-3.5 h-3.5" />
            )}
            <span>+ Novo usuário de teste</span>
          </button>
        </div>

        {/* Campo de Busca */}
        <div className="relative">
          <Search className="w-4 h-4 text-wa-textSecondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar usuário, cargo ou setor..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-wa-bg rounded-lg text-sm text-wa-textPrimary placeholder:text-wa-textMuted border border-transparent focus:border-wa-green focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Lista de Usuários */}
      <div className="flex-1 overflow-y-auto divide-y divide-wa-border/40">
        {conversasFiltradas.length === 0 ? (
          <div className="p-6 text-center text-wa-textSecondary text-sm">
            Nenhum usuário encontrado.
          </div>
        ) : (
          conversasFiltradas.map((conversa) => {
            const isAtiva = conversa.id === conversaAtivaId;
            const ultimaMensagem = conversa.mensagens[conversa.mensagens.length - 1];
            const textoPreview = ultimaMensagem
              ? ultimaMensagem.anexos && ultimaMensagem.anexos.length > 0 && !ultimaMensagem.texto
                ? `📎 [Documento: ${ultimaMensagem.anexos[0].titulo || ultimaMensagem.anexos[0].nome}]`
                : ultimaMensagem.texto
              : 'Sem mensagens';

            const nivel = conversa.contato.nivelAcesso || conversa.contato.ficha?.nivelAcesso || 'geral';
            const cargo = conversa.contato.cargo || conversa.contato.ficha?.cargo || 'Colaborador';

            return (
              <div
                key={conversa.id}
                onClick={() => onSelecionarConversa(conversa.id)}
                className={`flex items-center gap-3 p-3 cursor-pointer transition-colors relative ${
                  isAtiva
                    ? 'bg-wa-panel border-l-4 border-wa-green'
                    : 'hover:bg-wa-panel/50'
                }`}
              >
                {/* Avatar com iniciais e cor personalizada */}
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center font-semibold text-sm text-white flex-shrink-0 shadow-inner relative"
                  style={{ backgroundColor: conversa.contato.avatarCor || '#00a884' }}
                >
                  {getIniciais(conversa.contato.nome)}
                  {nivel === 'diretoria' && (
                    <span
                      title="Diretoria"
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center text-[9px] font-black border border-wa-bg"
                    >
                      ★
                    </span>
                  )}
                </div>

                {/* Informações da conversa do usuário */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-medium text-sm text-wa-textPrimary truncate">
                      {conversa.contato.nome}
                    </span>
                    <span className="text-[11px] text-wa-textMuted flex-shrink-0">
                      {ultimaMensagem?.horario || ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-wa-bg/80 text-wa-greenLight border border-wa-border/50 truncate max-w-[140px]">
                      {cargo}
                    </span>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-semibold uppercase ${
                      nivel === 'diretoria' ? 'bg-amber-500/20 text-amber-300' : 'bg-wa-border text-wa-textMuted'
                    }`}>
                      {nivel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-wa-textSecondary truncate">
                      {textoPreview}
                    </p>

                    {/* Badge de não lidas */}
                    {conversa.naoLidas > 0 && (
                      <span className="bg-wa-green text-slate-950 font-bold text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center flex-shrink-0">
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
