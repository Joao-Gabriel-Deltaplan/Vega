import React, { useState } from 'react';
import { X, User, Building2, Loader2, Tag, Plus, FileText, CheckCircle2 } from 'lucide-react';
import { FichaTitular } from '../types/chat.js';

interface ModalCriarTitularProps {
  aberto: boolean;
  onFechar: () => void;
  onCriado: (novoTitular: FichaTitular) => void;
}

export const ModalCriarTitular: React.FC<ModalCriarTitularProps> = ({
  aberto,
  onFechar,
  onCriado,
}) => {
  if (!aberto) return null;

  const [tipo, setTipo] = useState<'pessoa' | 'empresa'>('pessoa');
  const [nome, setNome] = useState('');
  const [apelidosTexto, setApelidosTexto] = useState('');
  const [documentoIdentificador, setDocumentoIdentificador] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const resetForm = () => {
    setNome('');
    setApelidosTexto('');
    setDocumentoIdentificador('');
    setTipo('pessoa');
    setErro(null);
  };

  const handleFechar = () => {
    if (salvando) return;
    resetForm();
    onFechar();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setErro(tipo === 'empresa' ? 'O nome/razão social da empresa é obrigatório.' : 'O nome do titular é obrigatório.');
      return;
    }

    try {
      setSalvando(true);
      setErro(null);

      const apelidosArray = apelidosTexto
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const camposPayload: any = {
        tipoTitular: tipo,
      };

      const docLimpo = documentoIdentificador.trim();
      if (docLimpo) {
        if (tipo === 'empresa') {
          camposPayload.cnpj = {
            valor: docLimpo,
            origem: 'Manual',
            conferido: true,
          };
        } else {
          camposPayload.cpf = {
            valor: docLimpo,
            origem: 'Manual',
            conferido: true,
          };
        }
      }

      const res = await fetch('/api/titulares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          apelidos: apelidosArray,
          campos: camposPayload,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.erro || 'Falha ao cadastrar titular.');
      }

      const titularCriado: FichaTitular = await res.json();
      onCriado(titularCriado);
      resetForm();
      onFechar();
    } catch (err: any) {
      setErro(err.message || 'Erro ao cadastrar titular.');
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
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Novo Titular de Documentos</h3>
              <p className="text-[11px] text-slate-400">Organize documentos por pessoa física ou jurídica</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleFechar}
            disabled={salvando}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#202937] transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {erro && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {erro}
            </div>
          )}

          {/* Seletor de Tipo: Pessoa Física vs Empresa / PJ */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Tipo de Titular</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo('pessoa')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  tipo === 'pessoa'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm shadow-emerald-950/40 ring-1 ring-emerald-500/30'
                    : 'bg-[#18202b] text-slate-400 hover:text-slate-200 border-[#263345] hover:border-[#37475f]'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Pessoa Física</span>
              </button>

              <button
                type="button"
                onClick={() => setTipo('empresa')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  tipo === 'empresa'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm shadow-emerald-950/40 ring-1 ring-emerald-500/30'
                    : 'bg-[#18202b] text-slate-400 hover:text-slate-200 border-[#263345] hover:border-[#37475f]'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Empresa / PJ</span>
              </button>
            </div>
          </div>

          {/* Nome ou Razão Social */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              {tipo === 'empresa' ? (
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <User className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>
                {tipo === 'empresa' ? 'Razão Social ou Nome da Empresa *' : 'Nome Completo da Pessoa *'}
              </span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={tipo === 'empresa' ? 'Ex: ENGCOM SERVIÇOS LTDA ou ENGCOM' : 'Ex: Thomaz Lustri Fabre'}
              className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Apelidos / Nome Fantasia / Siglas */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span>{tipo === 'empresa' ? 'Nome Fantasia / Siglas / Variações' : 'Apelidos e Variações de Nome'}</span>
            </label>
            <input
              type="text"
              value={apelidosTexto}
              onChange={(e) => setApelidosTexto(e.target.value)}
              placeholder={
                tipo === 'empresa'
                  ? 'Ex: ENGCOM, Engcom Engenharia (separados por vírgula)'
                  : 'Ex: Thomas, Tomaz, Thom (separados por vírgula)'
              }
              className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Variações e termos que a VEGA reconhece com prioridade exata quando citados no WhatsApp ou chat.
            </p>
          </div>

          {/* CPF ou CNPJ (Opcional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>{tipo === 'empresa' ? 'CNPJ (opcional)' : 'CPF (opcional)'}</span>
            </label>
            <input
              type="text"
              value={documentoIdentificador}
              onChange={(e) => setDocumentoIdentificador(e.target.value)}
              placeholder={tipo === 'empresa' ? '00.000.000/0000-00' : '000.000.000-00'}
              className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Ações */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#202937]">
            <button
              type="button"
              onClick={handleFechar}
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
                  <span>Cadastrando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Cadastrar Titular</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
