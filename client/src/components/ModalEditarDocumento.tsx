import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Pencil,
  FileText,
  Calendar,
  AlertTriangle,
  UserPlus,
  Loader2,
  Check,
  Search,
  Trash2,
} from 'lucide-react';
import { DocumentoRegistro, FichaTitular } from '../types/chat.js';
import { ModalEditarTitular } from './ModalEditarTitular.js';
import { ModalExcluirTitular } from './ModalExcluirTitular.js';

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

interface ModalEditarDocumentoProps {
  aberto: boolean;
  doc: DocumentoRegistro | null;
  titulares: FichaTitular[];
  tiposDisponiveis: string[];
  nomeUsuarioLogado?: string;
  onFechar: () => void;
  onSalvo: (docAtualizado: DocumentoRegistro) => void;
  onTitularCriado?: (novoTitular: FichaTitular) => void;
  onTitularAtualizado?: (titularAtualizado: FichaTitular) => void;
  onTitularExcluido?: (titularId: string) => void;
}

export const ModalEditarDocumento: React.FC<ModalEditarDocumentoProps> = ({
  aberto,
  doc,
  titulares,
  tiposDisponiveis,
  nomeUsuarioLogado,
  onFechar,
  onSalvo,
  onTitularCriado,
  onTitularAtualizado,
  onTitularExcluido,
}) => {
  if (!aberto || !doc) return null;

  // Estados dos campos do documento
  const [titulo, setTitulo] = useState(doc.titulo || '');
  const [tipo, setTipo] = useState(doc.tipo || 'Outros');
  const [outroTipo, setOutroTipo] = useState('');
  const [isOutroTipo, setIsOutroTipo] = useState(false);

  // Titular: ID do titular cadastrado, 'empresa' ou 'sem_titular'
  const titularInicial = useMemo(() => {
    const pId = doc.pessoaId || doc.pessoa_id;
    if (pId) {
      const achadoPorId = titulares.find((t) => t.id === pId);
      if (achadoPorId) return pId;
    }
    if (!doc.titular) return 'sem_titular';
    const tLower = doc.titular.toLowerCase().trim();
    if (tLower === 'sem titular' || tLower === 'sem_titular' || tLower === 'nenhum') {
      return 'sem_titular';
    }
    if (tLower.includes('delta') || tLower.includes('empresa') || tLower === 'corporativo') {
      return 'empresa';
    }
    const achadoPorNome = titulares.find((t) => t.nome.toLowerCase() === doc.titular?.toLowerCase());
    return achadoPorNome ? achadoPorNome.id : 'sem_titular';
  }, [doc, titulares]);

  const [titularSelecionado, setTitularSelecionado] = useState<string>(titularInicial);
  const [buscaTitular, setBuscaTitular] = useState('');

  // Modais de edição e exclusão de titular acionados a partir do documento
  const [titularParaEditarModal, setTitularParaEditarModal] = useState<FichaTitular | null>(null);
  const [titularParaExcluirModal, setTitularParaExcluirModal] = useState<FichaTitular | null>(null);

  const titularSelecionadoObj = useMemo(() => {
    if (titularSelecionado === 'empresa' || titularSelecionado === 'sem_titular') return null;
    return titulares.find((t) => t.id === titularSelecionado) || null;
  }, [titularSelecionado, titulares]);

  // Formulário inline para "+ Criar novo titular"
  const [criandoNovoTitular, setCriandoNovoTitular] = useState(false);
  const [novoNomeTitular, setNovoNomeTitular] = useState('');
  const [novosApelidosTitular, setNovosApelidosTitular] = useState('');
  const [salvandoNovoTitular, setSalvandoNovoTitular] = useState(false);
  const [erroNovoTitular, setErroNovoTitular] = useState<string | null>(null);

  // Validade
  const [validade, setValidade] = useState<string>(() => {
    if (!doc.dataValidade) return '';
    // Converte se estiver em formato pt-BR (DD/MM/YYYY) para ISO (YYYY-MM-DD)
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(doc.dataValidade)) {
      const [dia, mes, ano] = doc.dataValidade.split('/');
      return `${ano}-${mes}-${dia}`;
    }
    return doc.dataValidade.slice(0, 10);
  });

  // Campos cadastrais alimentados por este documento
  const [infoCampos, setInfoCampos] = useState<InfoCamposFicha | null>(null);
  const [carregandoCampos, setCarregandoCampos] = useState(false);
  const [acaoCamposFicha, setAcaoCamposFicha] = useState<'mover' | 'remover' | 'manter'>('mover');

  // Estado de envio
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Inicialização de tipos
  useEffect(() => {
    if (doc) {
      setTitulo(doc.titulo || '');
      const tipoExistente = tiposDisponiveis.includes(doc.tipo || '');
      if (tipoExistente) {
        setTipo(doc.tipo || 'Outros');
        setIsOutroTipo(false);
      } else if (doc.tipo) {
        setTipo('__outro__');
        setOutroTipo(doc.tipo);
        setIsOutroTipo(true);
      } else {
        setTipo('Outros');
        setIsOutroTipo(false);
      }
      setTitularSelecionado(titularInicial);
      setCriandoNovoTitular(false);
      setErro(null);
    }
  }, [doc, titularInicial, tiposDisponiveis]);

  // Carrega campos cadastrais alimentados por este documento
  useEffect(() => {
    let ativo = true;
    async function carregarCamposAlimentados() {
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
        console.warn('Não foi possível carregar campos de ficha do documento:', err);
      } finally {
        if (ativo) setCarregandoCampos(false);
      }
    }
    carregarCamposAlimentados();
    return () => {
      ativo = false;
    };
  }, [doc?.id]);

  // Filtra lista de titulares para a busca rápida
  const titularesFiltrados = useMemo(() => {
    const termo = buscaTitular.toLowerCase().trim();
    if (!termo) return titulares;
    return titulares.filter(
      (t) =>
        t.nome.toLowerCase().includes(termo) ||
        (t.apelidos && t.apelidos.some((a: string) => a.toLowerCase().includes(termo)))
    );
  }, [titulares, buscaTitular]);

  // Verifica se o titular mudou em relação ao inicial
  const titularMudou = titularSelecionado !== titularInicial;

  // Criação rápida de titular inline
  const handleCadastrarNovoTitular = async () => {
    if (!novoNomeTitular.trim()) {
      setErroNovoTitular('Informe o nome completo do titular.');
      return;
    }
    try {
      setSalvandoNovoTitular(true);
      setErroNovoTitular(null);

      const apelidosArray = novosApelidosTitular
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await fetch('/api/titulares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: novoNomeTitular.trim(),
          apelidos: apelidosArray,
        }),
      });

      if (!res.ok) {
        const erroJson = await res.json().catch(() => ({}));
        throw new Error(erroJson.erro || 'Falha ao cadastrar titular.');
      }

      const novoTit: FichaTitular = await res.json();
      onTitularCriado?.(novoTit);
      setTitularSelecionado(novoTit.id);
      setCriandoNovoTitular(false);
      setNovoNomeTitular('');
      setNovosApelidosTitular('');
    } catch (err: any) {
      setErroNovoTitular(err.message || 'Erro ao criar titular.');
    } finally {
      setSalvandoNovoTitular(false);
    }
  };

  // Salvar alterações do documento
  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setErro('O título do documento é obrigatório.');
      return;
    }

    try {
      setSalvando(true);
      setErro(null);

      const tipoFinal = isOutroTipo ? outroTipo.trim() || 'Outros' : tipo;

      let novoTitularNome = 'Delta Plan';
      let novoPessoaId: string | null = null;

      if (titularSelecionado === 'sem_titular') {
        novoTitularNome = 'Sem titular';
        novoPessoaId = null;
      } else if (titularSelecionado !== 'empresa') {
        const titObj = titulares.find((t) => t.id === titularSelecionado);
        if (titObj) {
          novoTitularNome = titObj.nome;
          novoPessoaId = titObj.id;
        }
      }

      // Converte validade se informada
      let validadeFormatada: string | null = null;
      if (validade) {
        const [ano, mes, dia] = validade.split('-');
        validadeFormatada = `${dia}/${mes}/${ano}`;
      }

      const payload = {
        titulo: titulo.trim(),
        tipo: tipoFinal,
        titular: novoTitularNome,
        pessoaId: novoPessoaId,
        dataValidade: validadeFormatada,
        usuarioAlteracao: nomeUsuarioLogado || 'Painel do Cofre',
        acaoCamposFicha,
      };

      const res = await fetch(`/api/documentos/${encodeURIComponent(doc.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const erroJson = await res.json().catch(() => ({}));
        throw new Error(erroJson.erro || 'Falha ao atualizar documento.');
      }

      const docAtualizado: DocumentoRegistro = await res.json();
      onSalvo(docAtualizado);
      onFechar();
    } catch (err: any) {
      setErro(err.message || 'Erro ao salvar alterações do documento.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* CABEÇALHO DO MODAL */}
        <div className="p-4 sm:p-5 border-b border-[#202937] flex items-center justify-between bg-[#161e29]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Editar Documento</h3>
              <p className="text-[11px] text-slate-400 truncate max-w-xs sm:max-w-sm">
                {doc.arquivo}
              </p>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#202937] transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* FORMULÁRIO */}
        <form onSubmit={handleSalvar} className="p-4 sm:p-6 space-y-4">
          {erro && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{erro}</span>
            </div>
          )}

          {/* 1. TÍTULO DO DOCUMENTO */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Título do Documento <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: CNH Thomaz Lustri Fabre"
                className="w-full pl-9 pr-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* 2. TIPO DO DOCUMENTO */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Tipo do Documento
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={isOutroTipo ? '__outro__' : tipo}
                onChange={(e) => {
                  if (e.target.value === '__outro__') {
                    setIsOutroTipo(true);
                  } else {
                    setIsOutroTipo(false);
                    setTipo(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                {tiposDisponiveis.map((t) => (
                  <option key={t} value={t} className="bg-[#18202b] text-slate-100">
                    {t}
                  </option>
                ))}
                <option value="__outro__" className="bg-[#18202b] text-emerald-400 font-medium">
                  + Outro tipo...
                </option>
              </select>

              {isOutroTipo && (
                <input
                  type="text"
                  value={outroTipo}
                  onChange={(e) => setOutroTipo(e.target.value)}
                  placeholder="Especifique o tipo..."
                  className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              )}
            </div>
          </div>

          {/* 3. TITULAR (LISTA PESQUISÁVEL + CRIAR NOVO TITULAR) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300">
                Titular do Documento
              </label>
              {!criandoNovoTitular && (
                <button
                  type="button"
                  onClick={() => setCriandoNovoTitular(true)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Criar novo titular</span>
                </button>
              )}
            </div>

            {/* FORMULÁRIO INLINE PARA CRIAR NOVO TITULAR */}
            {criandoNovoTitular && (
              <div className="p-3 bg-[#18202b] border border-emerald-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    Novo Titular Oficial
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCriandoNovoTitular(false);
                      setErroNovoTitular(null);
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Cancelar
                  </button>
                </div>

                {erroNovoTitular && (
                  <p className="text-[11px] text-rose-400">{erroNovoTitular}</p>
                )}

                <div className="space-y-2">
                  <input
                    type="text"
                    value={novoNomeTitular}
                    onChange={(e) => setNovoNomeTitular(e.target.value)}
                    placeholder="Nome completo (ex.: Nilceia Batista Ramos Fabre)"
                    className="w-full px-3 py-1.5 bg-[#121820] border border-[#202937] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={novosApelidosTitular}
                    onChange={(e) => setNovosApelidosTitular(e.target.value)}
                    placeholder="Apelidos ou grafias conhecidas (ex.: Nil, Nilceia)"
                    className="w-full px-3 py-1.5 bg-[#121820] border border-[#202937] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCadastrarNovoTitular}
                    disabled={salvandoNovoTitular}
                    className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {salvandoNovoTitular ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Salvar Titular e Selecionar</span>
                  </button>
                </div>
              </div>
            )}

            {/* SELETOR DE TITULAR */}
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={buscaTitular}
                  onChange={(e) => setBuscaTitular(e.target.value)}
                  placeholder="Pesquisar titular por nome ou apelido..."
                  className="w-full pl-8 pr-3 py-1.5 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <select
                value={titularSelecionado}
                onChange={(e) => setTitularSelecionado(e.target.value)}
                className="w-full px-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 focus:border-emerald-500 focus:outline-none cursor-pointer"
                size={Math.min(6, titularesFiltrados.length + 2)}
              >
                <option value="sem_titular" className="bg-[#18202b] text-amber-300 py-1 font-semibold">
                  🚫 Sem titular (Desvincular titular)
                </option>
                <option value="empresa" className="bg-[#18202b] text-slate-200 py-1 font-semibold">
                  🏢 Documentos da Empresa (Delta Plan)
                </option>
                {titularesFiltrados.map((tit) => (
                  <option key={tit.id} value={tit.id} className="bg-[#18202b] text-slate-200 py-1">
                    👤 {tit.nome} {tit.apelidos && tit.apelidos.length > 0 ? `(${tit.apelidos.join(', ')})` : ''}
                  </option>
                ))}
              </select>

              {/* Ações do titular selecionado (Editar ou Excluir titular cadastrado) */}
              {titularSelecionadoObj && (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#141b24] border border-[#202937] text-xs">
                  <div className="flex items-center gap-2 text-slate-300 truncate min-w-0">
                    <span className="text-[11px] text-slate-400 flex-shrink-0">Titular selecionado:</span>
                    <span className="font-semibold text-emerald-400 truncate">{titularSelecionadoObj.nome}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setTitularParaEditarModal(titularSelecionadoObj)}
                      className="px-2 py-1 rounded bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 border border-[#263345] text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Editar nome e apelidos deste titular"
                    >
                      <Pencil className="w-3 h-3 text-emerald-400" />
                      <span>Editar titular</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTitularParaExcluirModal(titularSelecionadoObj)}
                      className="px-2 py-1 rounded bg-[#18202b] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#263345] hover:border-rose-500/30 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Excluir o cadastro deste titular"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                      <span>Excluir titular</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* FEEDBACK DE VERIFICAÇÃO DE CAMPOS */}
          {titularMudou && carregandoCampos && (
            <div className="flex items-center gap-2 p-2.5 bg-[#18202b] rounded-lg text-slate-400 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>Verificando impacto na ficha cadastral...</span>
            </div>
          )}

          {/* 4. AVISO DE CONSISTÊNCIA DE CAMPOS CADASTRAIS (Item 3) */}
          {titularMudou && infoCampos && infoCampos.temCampos && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-amber-300">
                    Dados Cadastrais Vinculados
                  </h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    {infoCampos.mensagemResumo ||
                      'Este documento alimentou campos cadastrais no titular anterior.'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    (Campos manuais conferidos nunca são modificados).
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-amber-500/20">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="acaoCamposFicha"
                    value="mover"
                    checked={acaoCamposFicha === 'mover'}
                    onChange={() => setAcaoCamposFicha('mover')}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>
                    Mover esses dados cadastrais para o novo titular (se pessoa física)
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="acaoCamposFicha"
                    value="remover"
                    checked={acaoCamposFicha === 'remover'}
                    onChange={() => setAcaoCamposFicha('remover')}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>Apenas remover esses dados da ficha do titular anterior</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="acaoCamposFicha"
                    value="manter"
                    checked={acaoCamposFicha === 'manter'}
                    onChange={() => setAcaoCamposFicha('manter')}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>Manter como está na ficha anterior</span>
                </label>
              </div>
            </div>
          )}

          {/* 5. VALIDADE (OPCIONAL) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Validade do Documento (Opcional)
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="date"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#18202b] border border-[#263345] rounded-lg text-xs text-slate-100 focus:border-emerald-500 focus:outline-none cursor-pointer"
              />
            </div>
            {validade && (
              <button
                type="button"
                onClick={() => setValidade('')}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Limpar validade (sem validade)
              </button>
            )}
          </div>

          {/* BOTÕES DE AÇÃO */}
          <div className="pt-3 border-t border-[#202937] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvando}
              className="px-4 py-2 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-300 text-xs font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors shadow-sm"
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

      {/* Modal para Editar Titular inline */}
      <ModalEditarTitular
        aberto={!!titularParaEditarModal}
        titular={titularParaEditarModal}
        onFechar={() => setTitularParaEditarModal(null)}
        onSalvo={(titAtualizado) => {
          setTitularParaEditarModal(null);
          onTitularAtualizado?.(titAtualizado);
        }}
      />

      {/* Modal para Excluir Titular inline */}
      <ModalExcluirTitular
        aberto={!!titularParaExcluirModal}
        titular={titularParaExcluirModal}
        totalDocumentos={1}
        onFechar={() => setTitularParaExcluirModal(null)}
        onExcluido={(titId) => {
          setTitularParaExcluirModal(null);
          setTitularSelecionado('sem_titular');
          onTitularExcluido?.(titId);
        }}
      />
    </div>
  );
};
