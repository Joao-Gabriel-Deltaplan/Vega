import React, { useState, useEffect } from 'react';
import { X, User, Pencil, Loader2, Check, Tag } from 'lucide-react';
import { FichaTitular } from '../types/chat.js';

interface ModalEditarTitularProps {
  aberto: boolean;
  titular: FichaTitular | null;
  onFechar: () => void;
  onSalvo: (titularAtualizado: FichaTitular) => void;
}

export const ModalEditarTitular: React.FC<ModalEditarTitularProps> = ({
  aberto,
  titular,
  onFechar,
  onSalvo,
}) => {
  if (!aberto || !titular) return null;

  const [nome, setNome] = useState(titular.nome || '');
  const [apelidosTexto, setApelidosTexto] = useState(
    Array.isArray(titular.apelidos) ? titular.apelidos.join(', ') : ''
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (titular) {
      setNome(titular.nome || '');
      setApelidosTexto(
        Array.isArray(titular.apelidos) ? titular.apelidos.join(', ') : ''
      );
      setErro(null);
    }
  }, [titular]);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErro('O nome do titular é obrigatório.');
      return;
    }

    try {
      setSalvando(true);
      setErro(null);

      const apelidosArray = apelidosTexto
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await fetch(`/api/titulares/${encodeURIComponent(titular.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          apelidos: apelidosArray,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.erro || 'Falha ao atualizar dados do titular.');
      }

      const titularAtualizado: FichaTitular = await res.json();
      onSalvo(titularAtualizado);
      onFechar();
    } catch (err: any) {
      setErro(err.message || 'Erro ao salvar titular.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-[#202937] flex items-center justify-between bg-[#161e29]">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <Pencil className="w-4 h-4" />
            <h3 className="text-sm font-semibold text-slate-100">Editar Titular</h3>
          </div>
          <button
            onClick={onFechar}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#202937] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSalvar} className="p-4 sm:p-6 space-y-4">
          {erro && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {erro}
            </div>
          )}

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Nome Completo do Titular *</span>
            </label>
            <input
              type="text"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Thomaz Lustri Fabre"
              className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Apelidos / Variações */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span>Apelidos e Variações de Nome</span>
            </label>
            <input
              type="text"
              value={apelidosTexto}
              onChange={(e) => setApelidosTexto(e.target.value)}
              placeholder="Ex: Thomas, Tomaz, Thom (separados por vírgula)"
              className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Apelidos e grafias alternativas confirmadas que a VEGA reconhece com precisão exata.
            </p>
          </div>

          {/* Ações */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#202937]">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvando}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-[#18202b] hover:bg-[#202937] border border-[#202937] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !nome.trim()}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg shadow-emerald-500/10"
            >
              {salvando ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Salvar Alterações</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
