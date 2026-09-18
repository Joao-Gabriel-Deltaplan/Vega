import React from 'react';
import { Users, Brain, Settings, Bot, ShieldCheck, Bell } from 'lucide-react';

export type AbaNavegacao = 'conversas' | 'conhecimento' | 'admin';

interface NavigationSidebarProps {
  abaAtiva: AbaNavegacao;
  onSelecionarAba: (aba: AbaNavegacao) => void;
  totalNaoLidas?: number;
  totalAlertasVencimento?: number;
  onAbrirAlertas?: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  abaAtiva,
  onSelecionarAba,
  totalNaoLidas = 0,
  totalAlertasVencimento = 0,
  onAbrirAlertas,
}) => {
  return (
    <nav className="w-16 min-w-[64px] h-full bg-[#0c1317] border-r border-wa-border flex flex-col items-center justify-between py-4 z-20 select-none">
      {/* Topo / Logo Delta */}
      <div className="flex flex-col items-center gap-6">
        <div
          className="w-10 h-10 rounded-xl bg-gradient-to-br from-wa-green to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-950/40 text-slate-950 font-bold"
          title="Delta Plan Atendimento"
        >
          <Bot className="w-6 h-6 fill-slate-950" />
        </div>

        {/* Itens de Navegação */}
        <div className="flex flex-col items-center gap-2">
          {/* Botão 1: Usuários e Documentos */}
          <button
            onClick={() => onSelecionarAba('conversas')}
            title="Usuários e Documentos"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group ${
              abaAtiva === 'conversas'
                ? 'bg-wa-panel text-wa-greenLight shadow-md border-l-2 border-wa-green'
                : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-panel/60'
            }`}
          >
            <Users className="w-5 h-5" />
            {totalNaoLidas > 0 && (
              <span className="absolute -top-1 -right-1 bg-wa-green text-slate-950 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {totalNaoLidas}
              </span>
            )}
            <span className="absolute left-16 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
              Usuários e Documentos
            </span>
          </button>

          {/* Botão 2: Base da VEGA (Conhecimento e Documentos) */}
          <button
            onClick={() => onSelecionarAba('conhecimento')}
            title="Base da VEGA"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group ${
              abaAtiva === 'conhecimento'
                ? 'bg-wa-panel text-wa-greenLight shadow-md border-l-2 border-wa-green'
                : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-panel/60'
            }`}
          >
            <Brain className="w-5 h-5" />
            <span className="absolute left-16 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
              Base da VEGA
            </span>
          </button>

          {/* Botão 3: Painel Admin */}
          <button
            onClick={() => onSelecionarAba('admin')}
            title="Painel de Administração"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group ${
              abaAtiva === 'admin'
                ? 'bg-wa-panel text-wa-greenLight shadow-md border-l-2 border-wa-green'
                : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-panel/60'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="absolute left-16 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
              Painel Admin
            </span>
          </button>

          {/* Botão 4: Alertas de Vencimento de Documentos */}
          <button
            onClick={onAbrirAlertas}
            title="Alertas de Vencimento"
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group text-wa-textSecondary hover:text-amber-300 hover:bg-wa-panel/60 cursor-pointer"
          >
            <Bell className="w-5 h-5" />
            {totalAlertasVencimento > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-md animate-pulse">
                {totalAlertasVencimento}
              </span>
            )}
            <span className="absolute left-16 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
              Alertas de Vencimento {totalAlertasVencimento > 0 ? `(${totalAlertasVencimento} novos)` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Rodapé / Status do Usuário */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-9 h-9 rounded-full bg-wa-panel border border-wa-border flex items-center justify-center text-xs font-semibold text-wa-greenLight relative cursor-pointer group"
          title="Administrador Logado"
        >
          <ShieldCheck className="w-4 h-4 text-wa-green" />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-wa-green border-2 border-[#0c1317]"></span>
          <span className="absolute left-16 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
            Delta Admin • Online
          </span>
        </div>
      </div>
    </nav>
  );
};
