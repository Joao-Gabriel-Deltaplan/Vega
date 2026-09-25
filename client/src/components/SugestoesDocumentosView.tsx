import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  AlertTriangle,
  UploadCloud,
  ExternalLink,
  Settings,
  Search,
  Plus,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  X,
  Loader2,
  Check,
  FileQuestion,
  Info,
} from 'lucide-react';
import {
  DocumentoEsperado,
  ChecklistTitularResultado,
  ItemChecklistDocumento,
  CategoriaDocumentoEsperado,
  FichaTitular,
} from '../types/chat.js';

interface SugestoesDocumentosViewProps {
  onDocumentoAdicionado?: () => void;
}

export const SugestoesDocumentosView: React.FC<SugestoesDocumentosViewProps> = ({
  onDocumentoAdicionado,
}) => {
  // Titulares e Checklist
  const [titulares, setTitulares] = useState<FichaTitular[]>([]);
  const [titularSelecionadoId, setTitularSelecionadoId] = useState<string>('');
  const [checklistAtual, setChecklistAtual] = useState<ChecklistTitularResultado | null>(null);
  const [carregandoChecklist, setCarregandoChecklist] = useState<boolean>(false);

  // Filtros rápidos em chips (1 clique)
  const [filtroRapido, setFiltroRapido] = useState<
    'todos' | 'faltando' | 'so_o_dado' | 'completo' | 'nao_se_aplica' | 'prioridade'
  >('todos');
  const [busca, setBusca] = useState<string>('');

  // Upload rápido na linha do checklist
  const [itemParaUpload, setItemParaUpload] = useState<ItemChecklistDocumento | null>(null);
  const [uploadandoLinha, setUploadandoLinha] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal de Dispensa ("Não se aplica")
  const [itemParaDispensar, setItemParaDispensar] = useState<ItemChecklistDocumento | null>(null);
  const [motivoDispensa, setMotivoDispensa] = useState<string>('');
  const [salvandoDispensa, setSalvandoDispensa] = useState<boolean>(false);

  // Feedback Toast
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Modal de Gestão da Lista Mestra de Documentos Esperados
  const [modalConfigAberto, setModalConfigAberto] = useState<boolean>(false);
  const [documentosEsperados, setDocumentosEsperados] = useState<DocumentoEsperado[]>([]);
  const [carregandoEsperados, setCarregandoEsperados] = useState<boolean>(false);
  const [abaConfigCategoria, setAbaConfigCategoria] = useState<CategoriaDocumentoEsperado>('PF');

  // Modal de Edição/Criação de Documento Esperado dentro da Configuração
  const [modalFormEsperado, setModalFormEsperado] = useState<boolean>(false);
  const [editandoDoc, setEditandoDoc] = useState<DocumentoEsperado | null>(null);
  const [formNome, setFormNome] = useState<string>('');
  const [formCategoria, setFormCategoria] = useState<CategoriaDocumentoEsperado>('PF');
  const [formObrigatorio, setFormObrigatorio] = useState<boolean>(true);
  const [formCampos, setFormCampos] = useState<string>('');
  const [formAtivo, setFormAtivo] = useState<boolean>(true);
  const [salvandoFormEsperado, setSalvandoFormEsperado] = useState<boolean>(false);

  const exibirFeedback = (tipo: 'sucesso' | 'erro', texto: string) => {
    setFeedback({ tipo, texto });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Carrega titulares cadastrados
  const carregarTitulares = async () => {
    try {
      const res = await fetch('/api/titulares');
      if (res.ok) {
        const data: FichaTitular[] = await res.json();
        setTitulares(data || []);
        if (data && data.length > 0 && !titularSelecionadoId) {
          setTitularSelecionadoId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar titulares:', err);
    }
  };

  // Carrega documentos esperados cadastrados
  const carregarEsperados = async () => {
    setCarregandoEsperados(true);
    try {
      const res = await fetch('/api/documentos-esperados');
      if (res.ok) {
        const data = await res.json();
        setDocumentosEsperados(data || []);
      }
    } catch (err) {
      console.error('Erro ao carregar documentos esperados:', err);
    } finally {
      setCarregandoEsperados(false);
    }
  };

  // Carrega checklist do titular selecionado
  const carregarChecklistTitular = async (titularId: string) => {
    if (!titularId) return;
    setCarregandoChecklist(true);
    try {
      const res = await fetch(`/api/documentos-esperados/checklist?titularId=${titularId}`);
      if (res.ok) {
        const data = await res.json();
        setChecklistAtual(data);
      }
    } catch (err) {
      console.error('Erro ao calcular checklist do titular:', err);
    } finally {
      setCarregandoChecklist(false);
    }
  };

  useEffect(() => {
    carregarTitulares();
    carregarEsperados();
  }, []);

  useEffect(() => {
    if (titularSelecionadoId) {
      carregarChecklistTitular(titularSelecionadoId);
    }
  }, [titularSelecionadoId]);

  // Upload direto na linha do checklist
  const dispararUploadLinha = (item: ItemChecklistDocumento) => {
    setItemParaUpload(item);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleArquivoLinhaSelecionado = async (file: File) => {
    if (!itemParaUpload || !titularSelecionadoId) return;
    setUploadandoLinha(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;

        // 1. Upload do documento
        const resUpload = await fetch('/api/documentos/upload-direto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nomeArquivo: file.name,
            mimeType: file.type,
            tamanho: file.size,
            base64,
          }),
        });

        if (!resUpload.ok) {
          const erroData = await resUpload.json();
          exibirFeedback('erro', erroData.erro || 'Falha ao fazer upload do documento.');
          setUploadandoLinha(false);
          return;
        }

        const dataUpload = await resUpload.json();
        const docId = dataUpload.documento?.id;

        // 2. Vincula titular e tipo de imediato
        if (docId) {
          const titNome = checklistAtual?.titular.nome || '';
          await fetch(`/api/documentos/${docId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              titular: titNome,
              tipo: itemParaUpload.documentoEsperado.nome,
            }),
          });
        }

        exibirFeedback('sucesso', `"${itemParaUpload.documentoEsperado.nome}" salvo no Cofre com sucesso!`);
        if (onDocumentoAdicionado) onDocumentoAdicionado();

        await carregarChecklistTitular(titularSelecionadoId);
        setUploadandoLinha(false);
        setItemParaUpload(null);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      exibirFeedback('erro', 'Erro ao processar arquivo para upload.');
      setUploadandoLinha(false);
    }
  };

  // Dispensar documento ("Não se aplica")
  const handleSalvarDispensa = async () => {
    if (!itemParaDispensar || !titularSelecionadoId) return;
    setSalvandoDispensa(true);
    try {
      const res = await fetch('/api/documentos-esperados/dispensar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titularId: titularSelecionadoId,
          documentoEsperadoId: itemParaDispensar.documentoEsperado.id,
          motivo: motivoDispensa.trim() || 'Dispensado pelo usuário',
        }),
      });

      if (res.ok) {
        exibirFeedback('sucesso', `"${itemParaDispensar.documentoEsperado.nome}" marcado como Não se Aplica.`);
        setItemParaDispensar(null);
        await carregarChecklistTitular(titularSelecionadoId);
      } else {
        const erro = await res.json();
        exibirFeedback('erro', erro.erro || 'Erro ao registrar dispensa.');
      }
    } catch {
      exibirFeedback('erro', 'Erro ao salvar dispensa.');
    } finally {
      setSalvandoDispensa(false);
    }
  };

  const handleRemoverDispensa = async (documentoEsperadoId: string) => {
    if (!titularSelecionadoId) return;
    try {
      const res = await fetch(
        `/api/documentos-esperados/dispensar/${titularSelecionadoId}/${documentoEsperadoId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        exibirFeedback('sucesso', 'Item reativado no checklist.');
        await carregarChecklistTitular(titularSelecionadoId);
      }
    } catch {
      exibirFeedback('erro', 'Erro ao remover dispensa.');
    }
  };

  // Salvar criação ou edição de documento esperado
  const handleSalvarEsperado = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNome.trim()) return;
    setSalvandoFormEsperado(true);

    try {
      const camposArray = formCampos
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

      const payload = {
        nome: formNome.trim(),
        categoria: formCategoria,
        obrigatorio: formObrigatorio,
        camposFornecidos: camposArray,
        ativo: formAtivo,
      };

      if (editandoDoc) {
        await fetch(`/api/documentos-esperados/${editandoDoc.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/documentos-esperados', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      setModalFormEsperado(false);
      await carregarEsperados();
      if (titularSelecionadoId) await carregarChecklistTitular(titularSelecionadoId);
      exibirFeedback('sucesso', 'Documento esperado salvo com sucesso.');
    } catch {
      exibirFeedback('erro', 'Erro ao salvar documento esperado.');
    } finally {
      setSalvandoFormEsperado(false);
    }
  };

  const handleToggleAtivo = async (doc: DocumentoEsperado) => {
    try {
      await fetch(`/api/documentos-esperados/${doc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !doc.ativo }),
      });
      setDocumentosEsperados((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, ativo: !d.ativo } : d))
      );
      if (titularSelecionadoId) await carregarChecklistTitular(titularSelecionadoId);
    } catch {
      exibirFeedback('erro', 'Erro ao alternar status do documento.');
    }
  };

  const handleExcluirEsperado = async (id: string, nome: string) => {
    if (!window.confirm(`Remover "${nome}" da lista mestra de esperados?`)) return;
    try {
      await fetch(`/api/documentos-esperados/${id}`, { method: 'DELETE' });
      await carregarEsperados();
      if (titularSelecionadoId) await carregarChecklistTitular(titularSelecionadoId);
      exibirFeedback('sucesso', 'Documento removido da lista mestra.');
    } catch {
      exibirFeedback('erro', 'Erro ao excluir documento esperado.');
    }
  };

  const handleReordenar = async (docId: string, direcao: 'subir' | 'descer') => {
    const listaCategoria = documentosEsperados.filter((d) => d.categoria === abaConfigCategoria);
    const idx = listaCategoria.findIndex((d) => d.id === docId);
    if (idx === -1) return;
    if (direcao === 'subir' && idx === 0) return;
    if (direcao === 'descer' && idx === listaCategoria.length - 1) return;

    const targetIdx = direcao === 'subir' ? idx - 1 : idx + 1;
    const temp = listaCategoria[idx];
    listaCategoria[idx] = listaCategoria[targetIdx];
    listaCategoria[targetIdx] = temp;

    const idsOrdenados = listaCategoria.map((d) => d.id);
    try {
      await fetch('/api/documentos-esperados/reordenar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idsOrdenados }),
      });
      await carregarEsperados();
      if (titularSelecionadoId) await carregarChecklistTitular(titularSelecionadoId);
    } catch {
      exibirFeedback('erro', 'Erro ao reordenar documentos.');
    }
  };

  // Itens filtrados para o checklist visual
  const itensFiltrados = useMemo(() => {
    if (!checklistAtual) return [];
    return checklistAtual.itens.filter((item) => {
      // Filtro rápido
      if (filtroRapido === 'faltando' && item.situacao !== 'faltando') return false;
      if (filtroRapido === 'so_o_dado' && item.situacao !== 'so_o_dado') return false;
      if (filtroRapido === 'completo' && item.situacao !== 'completo') return false;
      if (filtroRapido === 'nao_se_aplica' && item.situacao !== 'nao_se_aplica') return false;
      if (filtroRapido === 'prioridade' && !item.prioridade) return false;

      // Busca por texto
      if (busca.trim()) {
        const termo = busca.toLowerCase();
        const nomeDoc = item.documentoEsperado.nome.toLowerCase();
        const campos = item.documentoEsperado.camposFornecidos?.join(' ').toLowerCase() || '';
        return nomeDoc.includes(termo) || campos.includes(termo);
      }

      return true;
    });
  }, [checklistAtual, filtroRapido, busca]);

  const stats = checklistAtual?.estatisticas;

  return (
    <div className="space-y-5 animate-fadeIn pb-12">
      {/* Input de arquivo invisível para upload direto */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleArquivoLinhaSelecionado(e.target.files[0]);
          }
        }}
        accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
        className="hidden"
      />

      {/* FEEDBACK TOAST */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs shadow-md animate-fadeIn ${
            feedback.tipo === 'sucesso'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.tipo === 'sucesso' ? (
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{feedback.texto}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* HEADER PRINCIPAL LIMPO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#202937]">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <span>Checklist do Cofre</span>
          </h2>
          <p className="text-xs text-slate-400">
            Consulte rapidamente o que está completo, o que tem apenas o dado e o que falta arquivar.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            carregarEsperados();
            setModalConfigAberto(true);
          }}
          className="px-3 py-1.5 rounded-xl bg-[#121820] hover:bg-[#18202b] text-slate-300 hover:text-slate-100 border border-[#202937] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span>Configurar Lista Esperada</span>
        </button>
      </div>

      {/* PAINEL DE CONTROLE VISUAL: SELETOR + BARRA DE PROGRESSO + FILTROS */}
      <div className="bg-[#121820] border border-[#202937] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        {/* LINHA 1: SELETOR DO TITULAR & PROGRESSO RESUMIDO */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 max-w-lg">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Titular do Checklist:
            </label>
            <div className="flex items-center gap-2">
              <select
                value={titularSelecionadoId}
                onChange={(e) => setTitularSelecionadoId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-sm font-medium focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                {titulares.map((tit) => (
                  <option key={tit.id} value={tit.id}>
                    {tit.nome}
                  </option>
                ))}
              </select>

              {checklistAtual && (
                <span
                  className={`text-[11px] px-2.5 py-1.5 rounded-xl border font-bold uppercase tracking-wider whitespace-nowrap ${
                    checklistAtual.titular.categoria === 'PJ'
                      ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {checklistAtual.titular.categoria === 'PJ' ? 'Empresa (PJ)' : 'Pessoa Física'}
                </span>
              )}
            </div>
          </div>

          {/* CARD DE PROGRESSO COM PORCENTAGEM */}
          {stats && (
            <div className="flex items-center gap-3 bg-[#0b0f14] border border-[#202937] px-4 py-2.5 rounded-xl self-start md:self-auto">
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Completude do Cofre:</div>
                <div className="text-sm font-bold text-slate-100">
                  {stats.completos} de {stats.totalAplicaveis} documentos
                </div>
              </div>
              <div className="w-11 h-11 rounded-full border-2 border-emerald-500/40 flex items-center justify-center bg-emerald-500/10 text-emerald-400 font-bold text-xs">
                {stats.percentualArquivos}%
              </div>
            </div>
          )}
        </div>

        {/* BARRA DE PROGRESSO COLORIDA */}
        {stats && (
          <div className="space-y-1 pt-1">
            <div className="w-full h-2 bg-[#18202b] rounded-full overflow-hidden flex">
              <div
                style={{ width: `${(stats.completos / stats.totalAplicaveis) * 100}%` }}
                className="bg-emerald-500 transition-all duration-300"
                title={`Completos: ${stats.completos}`}
              />
              <div
                style={{ width: `${(stats.soODado / stats.totalAplicaveis) * 100}%` }}
                className="bg-amber-400 transition-all duration-300"
                title={`Só o dado: ${stats.soODado}`}
              />
              <div
                style={{ width: `${(stats.faltando / stats.totalAplicaveis) * 100}%` }}
                className="bg-rose-500/80 transition-all duration-300"
                title={`Faltando: ${stats.faltando}`}
              />
            </div>
          </div>
        )}

        {/* FILTROS RÁPIDOS EM CHIPS (1 CLIQUE) */}
        {stats && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1e2633]">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFiltroRapido('todos')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filtroRapido === 'todos'
                    ? 'bg-slate-200 text-slate-900 shadow-sm'
                    : 'bg-[#0b0f14] text-slate-400 hover:text-slate-200 border border-[#202937]'
                }`}
              >
                Todos ({checklistAtual?.itens.length || 0})
              </button>

              <button
                type="button"
                onClick={() => setFiltroRapido('faltando')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  filtroRapido === 'faltando'
                    ? 'bg-rose-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-[#0b0f14] text-rose-400 hover:bg-rose-500/10 border border-rose-500/30'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>Faltando ({stats.faltando})</span>
              </button>

              <button
                type="button"
                onClick={() => setFiltroRapido('so_o_dado')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  filtroRapido === 'so_o_dado'
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                    : 'bg-[#0b0f14] text-amber-300 hover:bg-amber-400/10 border border-amber-500/30'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>Só o Dado ({stats.soODado})</span>
              </button>

              <button
                type="button"
                onClick={() => setFiltroRapido('completo')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  filtroRapido === 'completo'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-[#0b0f14] text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>No Cofre ({stats.completos})</span>
              </button>

              {stats.dispensados > 0 && (
                <button
                  type="button"
                  onClick={() => setFiltroRapido('nao_se_aplica')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    filtroRapido === 'nao_se_aplica'
                      ? 'bg-slate-700 text-slate-200'
                      : 'bg-[#0b0f14] text-slate-500 hover:text-slate-300 border border-[#202937]'
                  }`}
                >
                  Não se Aplica ({stats.dispensados})
                </button>
              )}

              {stats.prioritarios > 0 && (
                <button
                  type="button"
                  onClick={() => setFiltroRapido('prioridade')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                    filtroRapido === 'prioridade'
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Pedidos WhatsApp ({stats.prioritarios})</span>
                </button>
              )}
            </div>

            {/* BUSCA RÁPIDA */}
            <div className="relative w-full sm:w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar documento..."
                className="w-full pl-8 pr-2.5 py-1 bg-[#0b0f14] border border-[#202937] rounded-lg text-slate-200 text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* LISTA DO CHECKLIST PRÁTICO E VISUAL */}
      {carregandoChecklist ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-2xl flex flex-col items-center justify-center gap-2.5 shadow-sm">
          <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          <span className="font-medium text-slate-200">Verificando documentos no Cofre...</span>
        </div>
      ) : itensFiltrados.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-2xl flex flex-col items-center justify-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-slate-600 mb-1" />
          <span className="font-semibold text-slate-200 text-sm">Nenhum documento encontrado</span>
          <span className="text-slate-400 max-w-sm">
            Tente selecionar outro filtro ou limpar a busca acima.
          </span>
        </div>
      ) : (
        <div className="bg-[#121820] border border-[#202937] rounded-2xl overflow-hidden shadow-sm divide-y divide-[#1c2430]">
          {itensFiltrados.map((item) => {
            const docEsp = item.documentoEsperado;
            const ehCompleto = item.situacao === 'completo';
            const ehSoODado = item.situacao === 'so_o_dado';
            const ehFaltando = item.situacao === 'faltando';
            const ehDispensado = item.situacao === 'nao_se_aplica';

            return (
              <div
                key={docEsp.id}
                className={`p-3.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  item.prioridade
                    ? 'bg-amber-500/5 hover:bg-amber-500/10'
                    : ehDispensado
                    ? 'opacity-50 hover:bg-[#151c26]'
                    : 'hover:bg-[#151c26]'
                }`}
              >
                {/* LADO ESQUERDO: ÍCONE DE CHECKLIST + NOME + BADGES */}
                <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                  {/* Ícone de Estado Visual */}
                  <div className="mt-0.5 sm:mt-0 flex-shrink-0">
                    {ehCompleto && (
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                    {ehSoODado && (
                      <div
                        className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/40"
                        title="Arquivo ausente, mas os dados constam na ficha cadastral"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {ehFaltando && (
                      <div
                        className="w-6 h-6 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/30"
                        title="Documento ausente no Cofre e sem dados"
                      >
                        <Circle className="w-3 h-3 stroke-[2.5]" />
                      </div>
                    )}
                    {ehDispensado && (
                      <div
                        className="w-6 h-6 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center border border-slate-700"
                        title="Não se aplica para este titular"
                      >
                        <span className="text-[10px] font-bold">—</span>
                      </div>
                    )}
                  </div>

                  {/* Nome e Tags */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-semibold truncate ${
                          ehCompleto
                            ? 'text-slate-100'
                            : ehSoODado
                            ? 'text-amber-200'
                            : ehDispensado
                            ? 'text-slate-400 line-through'
                            : 'text-slate-200'
                        }`}
                      >
                        {docEsp.nome}
                      </span>

                      {/* Tag Obrigatório / Complementar */}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          docEsp.obrigatorio
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {docEsp.obrigatorio ? 'Obrigatório' : 'Complementar'}
                      </span>

                      {/* Badge de Prioridade do WhatsApp */}
                      {item.prioridade && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 animate-pulse">
                          <AlertTriangle className="w-3 h-3" />
                          <span>
                            Pedido no WhatsApp{' '}
                            {item.quantidadePedidosWhatsApp && item.quantidadePedidosWhatsApp > 1
                              ? `(${item.quantidadePedidosWhatsApp}x)`
                              : ''}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Detalhe Direto e Sucinto da Situação */}
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {ehCompleto && item.documentoCofre && (
                        <>
                          <span className="text-emerald-400 font-medium">No Cofre:</span>
                          <span className="truncate max-w-xs">{item.documentoCofre.titulo}</span>
                          <a
                            href={`/arquivos/${item.documentoCofre.arquivo}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-0.5 font-semibold underline underline-offset-2 ml-1"
                          >
                            <span>abrir</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}

                      {ehSoODado && item.dadosFicha && item.dadosFicha.length > 0 && (
                        <>
                          <span className="text-amber-400 font-medium">Na Ficha:</span>
                          <span>
                            {item.dadosFicha[0].campo}: <strong>{item.dadosFicha[0].valor}</strong>
                          </span>
                          {item.dadosFicha[0].origemNome && (
                            <span className="text-slate-500 text-[11px]">
                              (veio de {item.dadosFicha[0].origemNome})
                            </span>
                          )}
                        </>
                      )}

                      {ehFaltando && (
                        <span className="text-rose-400/90">Arquivo físico ausente no Cofre</span>
                      )}

                      {ehDispensado && (
                        <span className="text-slate-500 italic">
                          Dispensado: {item.dispensa?.motivo || 'Não se aplica'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* LADO DIREITO: BOTÕES DE AÇÃO RÁPIDA */}
                <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                  {!ehDispensado && (
                    <button
                      type="button"
                      onClick={() => dispararUploadLinha(item)}
                      disabled={uploadandoLinha}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
                        ehCompleto
                          ? 'bg-[#18202b] hover:bg-[#202937] text-slate-300 border border-[#263345]'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-sm'
                      }`}
                      title={ehCompleto ? 'Subir nova versão do documento' : 'Enviar arquivo para o Cofre'}
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>{ehCompleto ? 'Substituir' : 'Subir Arquivo'}</span>
                    </button>
                  )}

                  {ehDispensado ? (
                    <button
                      type="button"
                      onClick={() => handleRemoverDispensa(docEsp.id)}
                      className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-[#263345] hover:bg-[#18202b] transition-colors cursor-pointer"
                    >
                      Reativar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setItemParaDispensar(item);
                        setMotivoDispensa('');
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-300 px-1.5 py-1 cursor-pointer"
                      title="Marcar como 'Não se aplica' para este titular"
                    >
                      Não se aplica
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MARCAR COMO NÃO SE APLICA (DISPENSA)                               */}
      {/* ========================================================================= */}
      {itemParaDispensar && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-[#202937]">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-amber-400" />
                <span>Marcar como "Não se Aplica"</span>
              </h3>
              <button
                type="button"
                onClick={() => setItemParaDispensar(null)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <p>
                Dispensar <strong>{itemParaDispensar.documentoEsperado.nome}</strong> para o titular{' '}
                <strong className="text-emerald-400">{checklistAtual?.titular.nome}</strong>.
              </p>
              <p className="text-slate-400">
                O documento não será mais considerado pendente para este titular.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Motivo ou Observação:
              </label>
              <input
                type="text"
                value={motivoDispensa}
                onChange={(e) => setMotivoDispensa(e.target.value)}
                placeholder="Ex: Empresa sem Inscrição Estadual / Isento de alistamento..."
                className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202937]">
              <button
                type="button"
                onClick={() => setItemParaDispensar(null)}
                className="px-3 py-1.5 rounded-xl border border-[#202937] text-slate-300 hover:bg-[#18202b] text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarDispensa}
                disabled={salvandoDispensa}
                className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {salvandoDispensa && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirmar Dispensa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIGURAÇÃO DA LISTA MESTRA DE DOCUMENTOS ESPERADOS               */}
      {/* ========================================================================= */}
      {modalConfigAberto && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl animate-scaleUp overflow-hidden">
            {/* Topo do Modal */}
            <div className="p-4 sm:p-5 border-b border-[#202937] flex items-center justify-between bg-[#141a22]">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-emerald-400" />
                  <span>Configurar Lista de Documentos Esperados</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Adicione, edite, ative/desative e reordene os itens que a VEGA cobra no checklist.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditandoDoc(null);
                    setFormNome('');
                    setFormCategoria(abaConfigCategoria);
                    setFormObrigatorio(true);
                    setFormCampos('');
                    setFormAtivo(true);
                    setModalFormEsperado(true);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Documento</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalConfigAberto(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-[#1e2633] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Abas PF / PJ */}
            <div className="flex items-center gap-2 px-5 pt-3 border-b border-[#202937] bg-[#0e1319]">
              <button
                type="button"
                onClick={() => setAbaConfigCategoria('PF')}
                className={`pb-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  abaConfigCategoria === 'PF'
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Pessoa Física ({documentosEsperados.filter((d) => d.categoria === 'PF').length})
              </button>
              <button
                type="button"
                onClick={() => setAbaConfigCategoria('PJ')}
                className={`pb-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                  abaConfigCategoria === 'PJ'
                    ? 'border-indigo-400 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Pessoa Jurídica ({documentosEsperados.filter((d) => d.categoria === 'PJ').length})
              </button>
            </div>

            {/* Lista dos Documentos Esperados da Categoria */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-2 flex-1">
              {carregandoEsperados ? (
                <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                  <span>Carregando...</span>
                </div>
              ) : (
                documentosEsperados
                  .filter((d) => d.categoria === abaConfigCategoria)
                  .map((doc, idx, arr) => (
                    <div
                      key={doc.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-colors ${
                        doc.ativo
                          ? 'bg-[#0b0f14] border-[#202937]'
                          : 'bg-[#0b0f14]/50 border-[#1a212c] opacity-50'
                      }`}
                    >
                      {/* Lado Esquerdo: Ordem + Nome + Tags */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                          <button
                            type="button"
                            onClick={() => handleReordenar(doc.id, 'subir')}
                            disabled={idx === 0}
                            className="hover:text-slate-200 disabled:opacity-20 cursor-pointer p-0.5"
                            title="Subir"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <span>{doc.ordem}</span>
                          <button
                            type="button"
                            onClick={() => handleReordenar(doc.id, 'descer')}
                            disabled={idx === arr.length - 1}
                            className="hover:text-slate-200 disabled:opacity-20 cursor-pointer p-0.5"
                            title="Descer"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100 truncate">{doc.nome}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                doc.obrigatorio
                                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {doc.obrigatorio ? 'Obrigatório' : 'Complementar'}
                            </span>
                          </div>
                          {doc.camposFornecidos && doc.camposFornecidos.length > 0 && (
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">
                              Fornece: {doc.camposFornecidos.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Lado Direito: Toggle Ativo + Editar + Excluir */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleAtivo(doc)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            doc.ativo
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {doc.ativo ? 'Ativo' : 'Inativo'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditandoDoc(doc);
                            setFormNome(doc.nome);
                            setFormCategoria(doc.categoria);
                            setFormObrigatorio(doc.obrigatorio);
                            setFormCampos(doc.camposFornecidos?.join(', ') || '');
                            setFormAtivo(doc.ativo);
                            setModalFormEsperado(true);
                          }}
                          className="p-1 hover:text-emerald-400 text-slate-400 cursor-pointer"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleExcluirEsperado(doc.id, doc.nome)}
                          className="p-1 hover:text-rose-400 text-slate-400 cursor-pointer"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CRIAR / EDITAR DOCUMENTO ESPERADO                                   */}
      {/* ========================================================================= */}
      {modalFormEsperado && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSalvarEsperado}
            className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 animate-scaleUp"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#202937]">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" />
                <span>{editandoDoc ? 'Editar Documento' : 'Novo Documento Esperado'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setModalFormEsperado(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nome do Documento: *
                </label>
                <input
                  type="text"
                  required
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  placeholder="Ex: Passaporte, Cartão CNPJ, Alvará..."
                  className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Categoria:</label>
                  <select
                    value={formCategoria}
                    onChange={(e) => setFormCategoria(e.target.value as CategoriaDocumentoEsperado)}
                    className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-xs focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    <option value="PF">Pessoa Física (PF)</option>
                    <option value="PJ">Pessoa Jurídica (PJ)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Exigência:</label>
                  <select
                    value={formObrigatorio ? 'sim' : 'nao'}
                    onChange={(e) => setFormObrigatorio(e.target.value === 'sim')}
                    className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-xs focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    <option value="sim">Obrigatório</option>
                    <option value="nao">Complementar</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Campos fornecidos (separados por vírgula):
                </label>
                <input
                  type="text"
                  value={formCampos}
                  onChange={(e) => setFormCampos(e.target.value)}
                  placeholder="Ex: rg, filiacao, data_nascimento, cnh, pis"
                  className="w-full px-3 py-2 bg-[#0b0f14] border border-[#202937] rounded-xl text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
                />
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  Usado para marcar "Só o Dado" quando faltar o arquivo físico.
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-ativo-modal"
                  checked={formAtivo}
                  onChange={(e) => setFormAtivo(e.target.checked)}
                  className="rounded bg-[#0b0f14] border-[#202937] text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="chk-ativo-modal" className="text-xs text-slate-300 cursor-pointer">
                  Documento ativo no checklist
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#202937]">
              <button
                type="button"
                onClick={() => setModalFormEsperado(false)}
                className="px-3 py-1.5 rounded-xl border border-[#202937] text-slate-300 hover:bg-[#18202b] text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoFormEsperado}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {salvandoFormEsperado && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Salvar Documento</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
