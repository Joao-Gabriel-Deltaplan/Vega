import React from 'react';
import {
  MessageSquare,
  Users,
  Brain,
  Settings,
  Bell,
  LogOut,
  Shield,
  Sliders,
} from 'lucide-react';
import { LogoDeltaPlan } from './LogoDeltaPlan.js';

export type AbaNavegacao = 'whatsapp' | 'usuarios' | 'conhecimento' | 'admin' | 'configuracoes_vega';

interface NavigationSidebarProps {
  abaAtiva: AbaNavegacao;
  onSelecionarAba: (aba: AbaNavegacao) => void;
  totalNaoLidas?: number;
  totalAlertasVencimento?: number;
  onAbrirAlertas?: () => void;
  onLogout?: () => void;
  nomeUsuario?: string;
  roleUsuario?: string;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  abaAtiva,
  onSelecionarAba,
  totalNaoLidas = 0,
  totalAlertasVencimento = 0,
  onAbrirAlertas,
  onLogout,
  nomeUsuario,
  roleUsuario,
}) => {
  return (
    <nav className="w-16 min-w-[64px] h-full bg-[#0b0f14] border-r border-[#1e2633] flex flex-col items-center justify-between py-4 z-20 select-none">
      {/* Topo / Logo Delta Plan */}
      <div className="flex flex-col items-center gap-6">
        <div title="Delta Plan • VEGA" className="cursor-pointer">
          <LogoDeltaPlan tamanho="md" />
        </div>

        {/* Itens de Navegação com Tooltips Elegantes */}
        <div className="flex flex-col items-center gap-2">
          {/* Aba 1: WhatsApp Real */}
          <button
            onClick={() => onSelecionarAba('whatsapp')}
            aria-label="Conversas do WhatsApp"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group cursor-pointer ${
              abaAtiva === 'whatsapp'
                ? 'bg-[#18202b] text-emerald-400 shadow-sm border-l-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-[#121820]'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            {totalNaoLidas > 0 && (
              <span className="absolute -top-1 -right-1 bg-emerald-500 text-slate-950 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow">
                {totalNaoLidas}
              </span>
            )}
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Conversas
            </span>
          </button>

          {/* Aba 2: Usuários */}
          <button
            onClick={() => onSelecionarAba('usuarios')}
            aria-label="Usuários Autorizados"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group cursor-pointer ${
              abaAtiva === 'usuarios'
                ? 'bg-[#18202b] text-emerald-400 shadow-sm border-l-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-[#121820]'
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Usuários
            </span>
          </button>

          {/* Aba 3: Base da VEGA */}
          <button
            onClick={() => onSelecionarAba('conhecimento')}
            aria-label="Base da VEGA (Cofre e Conhecimento)"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group cursor-pointer ${
              abaAtiva === 'conhecimento'
                ? 'bg-[#18202b] text-emerald-400 shadow-sm border-l-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-[#121820]'
            }`}
          >
            <Brain className="w-5 h-5" />
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Base da VEGA
            </span>
          </button>

          {/* Aba 4: Configurações & Métricas */}
          <button
            onClick={() => onSelecionarAba('admin')}
            aria-label="Configurações e Métricas"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group cursor-pointer ${
              abaAtiva === 'admin'
                ? 'bg-[#18202b] text-emerald-400 shadow-sm border-l-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-[#121820]'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Configurações & Métricas
            </span>
          </button>

          {/* Aba 5: Configurações da VEGA (Exclusivo Administradores) */}
          {roleUsuario === 'admin' && (
            <button
              onClick={() => onSelecionarAba('configuracoes_vega')}
              aria-label="Configurações da VEGA"
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group cursor-pointer ${
                abaAtiva === 'configuracoes_vega'
                  ? 'bg-[#18202b] text-emerald-400 shadow-sm border-l-2 border-emerald-400'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121820]'
              }`}
            >
              <Sliders className="w-5 h-5" />
              <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
                Configurações da VEGA
              </span>
            </button>
          )}

          {/* Alertas de Vencimento */}
          <button
            onClick={onAbrirAlertas}
            aria-label="Alertas de Vencimento"
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all relative group text-slate-400 hover:text-amber-300 hover:bg-[#121820] cursor-pointer"
          >
            <Bell className="w-5 h-5" />
            {totalAlertasVencimento > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow">
                {totalAlertasVencimento}
              </span>
            )}
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Alertas de Vencimento {totalAlertasVencimento > 0 ? `(${totalAlertasVencimento})` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Rodapé / Administrador Logado e Logout */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl bg-[#121820] border border-[#202937] flex items-center justify-center text-xs font-semibold text-slate-300 relative cursor-default group"
          title="Administrador"
        >
          <Shield className="w-4 h-4 text-emerald-400" />
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-400 border border-[#0b0f14]"></span>
          <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
            {nomeUsuario ? `${nomeUsuario} • Online` : 'Painel (senha única) • Online'}
          </span>
        </div>

        {onLogout && (
          <button
            onClick={onLogout}
            aria-label="Sair do Painel"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all relative group cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span className="absolute left-16 bg-[#18202b] border border-[#263345] text-slate-200 text-xs px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 font-medium">
              Sair do Painel
            </span>
          </button>
        )}
      </div>
    </nav>
  );
};
