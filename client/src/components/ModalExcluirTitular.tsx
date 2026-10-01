import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2, FileText, Building2, UserX } from 'lucide-react';
import { FichaTitular } from '../types/chat.js';

interface ModalExcluirTitularProps {
  aberto: boolean;
  titular: FichaTitular | null;
  totalDocumentos: number;
  onFechar: () => void;
  onExcluido: (titularId: string) => void;
}

export const ModalExcluirTitular: React.FC<ModalExcluirTitularProps> = ({
  aberto,
  titular,
  totalDocumentos,
  onFechar,
  onExcluido,
}) => {
  if (!aberto || !titular) return null;

  const [destinoDocs, setDestinoDocs] = useState<'desvincular' | 'empresa'>('desvincular');
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleExcluir = async () => {
    try {
      setExcluindo(true);
      setErro(null);

      const queryParams = new URLSearchParams({ destinoDocumentos: destinoDocs });
      const res = await fetch(
        `/api/titulares/${encodeURIComponent(titular.id)}?${queryParams.toString()}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.erro || 'Falha ao excluir o titular.');
      }

      onExcluido(titular.id);
      onFechar();
    } catch (err: any) {
      setErro(err.message || 'Erro ao excluir titular.');
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-[#202937] flex items-center justify-between bg-[#161e29]">
          <div className="flex items-center gap-2.5 text-rose-400">
            <Trash2 className="w-4 h-4" />
            <h3 className="text-sm font-semibold text-slate-100">Excluir Titular</h3>
          </div>
          <button
            onClick={onFechar}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#202937] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-4 sm:p-6 space-y-4">
          {erro && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {erro}
            </div>
          )}

          <div className="text-xs text-slate-200 leading-relaxed">
            Tem certeza que deseja excluir o cadastro do titular{' '}
            <strong className="text-slate-100 font-semibold">"{titular.nome}"</strong>?
          </div>

          {/* Se houver documentos vinculados */}
          {totalDocumentos > 0 ? (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3 text-xs">
              <div className="flex items-start gap-2 text-amber-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-xs text-amber-200">
                    Atenção: {totalDocumentos} documento(s) arquivado(s)
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Este titular possui documentos vinculados. Escolha o que fazer com eles:
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-amber-500/20">
                <label className="flex items-start gap-2.5 p-2 rounded-lg bg-[#18202b]/60 border border-[#263345] hover:border-[#374961] cursor-pointer">
                  <input
                    type="radio"
                    name="destinoDocs"
                    value="desvincular"
                    checked={destinoDocs === 'desvincular'}
                    onChange={() => setDestinoDocs('desvincular')}
                    className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5 text-slate-400" />
                      <span>Deixar como Sem Titular</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Os documentos continuam salvos no Cofre e ficam sem titular atribuído.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2 rounded-lg bg-[#18202b]/60 border border-[#263345] hover:border-[#374961] cursor-pointer">
                  <input
                    type="radio"
                    name="destinoDocs"
                    value="empresa"
                    checked={destinoDocs === 'empresa'}
                    onChange={() => setDestinoDocs('empresa')}
                    className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>Mover para Documentos da Empresa</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Os documentos passam para "Documentos da Empresa (Delta Plan)".
                    </p>
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-[#18202b] border border-[#263345] rounded-xl text-[11px] text-slate-400 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>Nenhum documento do Cofre está vinculado a este titular.</span>
            </div>
          )}

          {/* Ações */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#202937]">
            <button
              type="button"
              onClick={onFechar}
              disabled={excluindo}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-[#18202b] hover:bg-[#202937] border border-[#202937] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExcluir}
              disabled={excluindo}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg shadow-rose-600/20"
            >
              {excluindo ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Definitivamente</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
