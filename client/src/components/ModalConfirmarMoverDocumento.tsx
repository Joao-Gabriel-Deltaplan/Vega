import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X, MoveRight } from 'lucide-react';
import { DocumentoRegistro, FichaTitular } from '../types/chat.js';

interface CampoFichaAlimentado {
  chave: string;
  rotulo: string;
  valor: string;
  manual: boolean;
}

interface TitularAfetado {
  titularId: string;
  titularNome: string;
  campos: CampoFichaAlimentado[];
}

interface InfoCamposFicha {
  temCampos: boolean;
  titularesAfetados: TitularAfetado[];
  mensagemResumo?: string;
}

interface ModalConfirmarMoverDocumentoProps {
  aberto: boolean;
  doc: DocumentoRegistro | null;
  novoTitularId: string; // 'empresa' ou ID do titular
  novoTitularNome: string;
  titulares?: FichaTitular[];
  nomeUsuarioLogado?: string;
  onFechar: () => void;
  onConfirmado: (docAtualizado: DocumentoRegistro) => void;
}

export const ModalConfirmarMoverDocumento: React.FC<ModalConfirmarMoverDocumentoProps> = ({
  aberto,
  doc,
  novoTitularId,
  novoTitularNome,
  titulares: _titulares,
  nomeUsuarioLogado,
  onFechar,
  onConfirmado,
}) => {
  if (!aberto || !doc) return null;

  const titularOrigem = doc.titular || 'Documentos da Empresa';
  const [infoCampos, setInfoCampos] = useState<InfoCamposFicha | null>(null);
  const [carregandoCampos, setCarregandoCampos] = useState(false);
  const [acaoCamposFicha, setAcaoCamposFicha] = useState<'mover' | 'remover' | 'manter'>('mover');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    async function carregarCampos() {
      if (!doc?.id) return;
      try {
        setCarregandoCampos(true);
        const res = await fetch(`/api/documentos/${encodeURIComponent(doc.id)}/campos-ficha`);
        if (res.ok) {
          const dados: InfoCamposFicha = await res.json();
          if (ativo) {
            setInfoCampos(dados);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar campos alimentados:', err);
      } finally {
        if (ativo) setCarregandoCampos(false);
      }
    }
    carregarCampos();
    return () => {
      ativo = false;
    };
  }, [doc?.id]);

  const handleConfirmar = async () => {
    try {
      setSalvando(true);
      setErro(null);

      const isSemTitular = novoTitularId === 'sem_titular';
      const isEmpresa = novoTitularId === 'empresa';
      const novoPessoaId = isEmpresa || isSemTitular ? null : novoTitularId;
      const novoNome = isSemTitular ? 'Sem titular' : isEmpresa ? 'Delta Plan' : novoTitularNome;

      const res = await fetch(`/api/documentos/${encodeURIComponent(doc.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titular: novoNome,
          pessoaId: novoPessoaId,
          usuarioAlteracao: nomeUsuarioLogado || 'Painel do Cofre (Mover Rápido)',
          acaoCamposFicha,
        }),
      });

      if (!res.ok) {
        const erroJson = await res.json().catch(() => ({}));
        throw new Error(erroJson.erro || 'Falha ao mover documento.');
      }

      const docAtualizado: DocumentoRegistro = await res.json();
      onConfirmado(docAtualizado);
      onFechar();
    } catch (err: any) {
      setErro(err.message || 'Erro ao mover documento.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 sm:p-5 border-b border-[#202937] flex items-center justify-between bg-[#161e29]">
          <div className="flex items-center gap-2 text-emerald-400">
            <MoveRight className="w-5 h-5" />
            <h3 className="text-sm font-semibold text-slate-100">Confirmar Movimentação</h3>
          </div>
          <button
            onClick={onFechar}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#202937] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {erro && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {erro}
            </div>
          )}

          <div className="text-xs text-slate-200">
            Deseja mover o documento{' '}
            <strong className="text-slate-100 font-semibold">"{doc.titulo}"</strong>?
          </div>

          {/* FLUXO VISUAL DE ORIGEM PARA DESTINO */}
          <div className="p-3.5 bg-[#18202b] border border-[#263345] rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-slate-400 block uppercase tracking-wider">De</span>
              <span className="font-semibold text-slate-200 truncate block">{titularOrigem}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <div className="min-w-0 flex-1 text-right">
              <span className="text-[10px] text-slate-400 block uppercase tracking-wider">Para</span>
              <span className="font-semibold text-emerald-400 truncate block">{novoTitularNome}</span>
            </div>
          </div>

          {/* FEEDBACK DE VERIFICAÇÃO DE CAMPOS */}
          {carregandoCampos && (
            <div className="flex items-center gap-2 p-2.5 bg-[#18202b] rounded-lg text-slate-400 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>Verificando impacto na ficha cadastral...</span>
            </div>
          )}

          {/* CONSISTÊNCIA DE CAMPOS */}
          {infoCampos && infoCampos.temCampos && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-300">Dados da Ficha Cadastral</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">{infoCampos.mensagemResumo}</p>
                </div>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-amber-500/20">
                <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                  <input
                    type="radio"
                    name="acaoCampos"
                    value="mover"
                    checked={acaoCamposFicha === 'mover'}
                    onChange={() => setAcaoCamposFicha('mover')}
                    className="text-emerald-500"
                  />
                  <span>Mover dados para a ficha do novo titular</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                  <input
                    type="radio"
                    name="acaoCampos"
                    value="remover"
                    checked={acaoCamposFicha === 'remover'}
                    onChange={() => setAcaoCamposFicha('remover')}
                    className="text-emerald-500"
                  />
                  <span>Apenas remover da ficha antiga</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                  <input
                    type="radio"
                    name="acaoCampos"
                    value="manter"
                    checked={acaoCamposFicha === 'manter'}
                    onChange={() => setAcaoCamposFicha('manter')}
                    className="text-emerald-500"
                  />
                  <span>Manter na ficha antiga</span>
                </label>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-[#202937] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvando}
              className="px-4 py-2 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-300 text-xs font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={salvando}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-sm"
            >
              {salvando ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Movendo...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirmar Movimentação</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
