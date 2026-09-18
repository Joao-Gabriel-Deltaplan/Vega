import React, { useState } from 'react';
import { Bot, Lock, Eye, EyeOff, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';

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
    <div className="min-h-screen w-full bg-[#0b141a] text-wa-textPrimary flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Luz ambiente de fundo (Glow esmeralda) */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-wa-green/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Card de Login */}
      <div className="w-full max-w-md bg-[#111b21] border border-wa-border/80 rounded-2xl p-8 shadow-2xl relative z-10 backdrop-blur-md">
        {/* Cabeçalho */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-wa-green to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-950/50 mb-4 ring-4 ring-wa-green/20">
            <Bot className="w-9 h-9 text-slate-950" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-wa-textPrimary flex items-center gap-2">
            Delta Plan <span className="text-wa-green">VEGA</span>
          </h1>

          <p className="text-xs text-wa-textSecondary mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-wa-green" />
            Acesso Restrito • Painel Corporativo
          </p>
        </div>

        {/* Mensagem de Erro / Alerta */}
        {erro && (
          <div
            className={`mb-6 p-3.5 rounded-xl text-xs flex items-start gap-3 border transition-all ${
              bloqueado
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium leading-relaxed">{erro}</div>
          </div>
        )}

        {/* Formulário de Login */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-wa-textSecondary mb-2 uppercase tracking-wider">
              Senha do Painel
            </label>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-wa-textSecondary">
                <Lock className="w-4 h-4" />
              </div>

              <input
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Digite a senha mestra..."
                disabled={carregando || bloqueado}
                autoFocus
                className="w-full pl-10 pr-11 py-3 bg-[#202c33] border border-transparent focus:border-wa-green rounded-xl text-sm text-wa-textPrimary placeholder-wa-textSecondary/60 focus:outline-none transition-all"
              />

              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-wa-textSecondary hover:text-wa-textPrimary transition-colors"
                tabIndex={-1}
              >
                {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!senha.trim() || carregando || bloqueado}
            className="w-full py-3 px-4 bg-wa-green hover:bg-wa-green/90 text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {carregando ? (
              <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Acessar Painel</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Rodapé Interno */}
        <div className="mt-8 pt-6 border-t border-wa-border/50 text-center">
          <p className="text-[11px] text-wa-textSecondary/70">
            Inteligência Artificial Corporativa • Cofre & WhatsApp
          </p>
        </div>
      </div>

      {/* Copyright */}
      <footer className="mt-8 text-center text-xs text-wa-textSecondary/50">
        © {new Date().getFullYear()} Delta Plan Obras e Engenharia. Todos os direitos reservados.
      </footer>
    </div>
  );
};
