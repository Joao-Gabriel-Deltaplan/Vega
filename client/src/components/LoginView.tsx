import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';
import { LogoDeltaPlan } from './LogoDeltaPlan.js';

interface LoginViewProps {
  onLoginSucesso: (usuario?: { userId: string; nome: string; role: string }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSucesso }) => {
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senha.trim() || carregando) return;

    setCarregando(true);
    setErro(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senha: senha.trim(),
          usuario: 'admin',
        }),
      });

      const dados = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setBloqueado(true);
        }
        setErro(dados.erro || 'Falha ao autenticar no painel.');
        return;
      }

      // Sucesso
      onLoginSucesso(dados.usuario);
    } catch (err: any) {
      console.error('Erro de conexão ao autenticar:', err);
      setErro('Erro de conexão com o servidor. Verifique sua internet.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0b0f14] text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Sutil iluminação de fundo corporativa */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Card de Login Corporativo */}
      <div className="w-full max-w-sm bg-[#121820] border border-[#202937] rounded-2xl p-8 shadow-2xl relative z-10">
        {/* Cabeçalho com Logo Delta Plan */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="mb-4">
            <LogoDeltaPlan tamanho="lg" />
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-slate-100 flex items-center gap-2">
            Delta Plan <span className="text-emerald-400">VEGA</span>
          </h1>

          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Acesso Restrito • Painel Corporativo
          </p>
        </div>

        {/* Mensagem de Erro / Alerta */}
        {erro && (
          <div
            className={`mb-6 p-3 rounded-xl text-xs flex items-start gap-2.5 border transition-all ${
              bloqueado
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium leading-relaxed">{erro}</div>
          </div>
        )}

        {/* Formulário de Login */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
              Senha de Acesso
            </label>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>

              <input
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Informe a senha master"
                disabled={carregando || bloqueado}
                autoFocus
                className="w-full pl-10 pr-10 py-2.5 bg-[#0b0f14] border border-[#202937] rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-50"
              />

              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={carregando || !senha.trim() || bloqueado}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-500 text-slate-950 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer mt-2"
          >
            {carregando ? (
              <span className="flex items-center gap-2 text-slate-950 font-medium">
                <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                Autenticando...
              </span>
            ) : (
              <>
                <span>Entrar no Painel</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-[#1e2633] text-center">
          <p className="text-[11px] text-slate-500">
            Ambiente seguro Delta Plan • Inteligência VEGA
          </p>
        </div>
      </div>
    </div>
  );
};
