import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  User,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  Phone,
  Link as LinkIcon,
  KeyRound,
  RotateCcw,
} from 'lucide-react';
import { UsuarioAutorizado } from '../types/chat.js';

interface TitularOpcao {
  id: string;
  nome: string;
}

// Formatação visual do telefone
function formatarTelefoneExibicao(numero: string): string {
  if (!numero) return '';
  const limpo = numero.replace(/\D/g, '');
  if (limpo.startsWith('55') && limpo.length === 13) {
    // 55 14 99686 3115
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 9)}-${limpo.slice(9)}`;
  }
  if (limpo.startsWith('55') && limpo.length === 12) {
    // 55 14 9686 3115
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 8)}-${limpo.slice(8)}`;
  }
  if (limpo.length === 11) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  }
  return `+${limpo}`;
}

function getIniciais(nome: string): string {
  if (!nome) return '??';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export const UsuariosView: React.FC = () => {
  const [usuarios, setUsuarios] = useState<UsuarioAutorizado[]>([]);
  const [titulares, setTitulares] = useState<TitularOpcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroPerfil, setFiltroPerfil] = useState<'todos' | 'admin' | 'comum'>('todos');
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  // Estados dos Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [usuarioEmEdicao, setUsuarioEmEdicao] = useState<UsuarioAutorizado | null>(null);
  const [modalExcluirAberto, setModalExcluirAberto] = useState(false);
  const [usuarioParaExcluir, setUsuarioParaExcluir] = useState<UsuarioAutorizado | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Campos do formulário
  const [formNome, setFormNome] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formPerfil, setFormPerfil] = useState<'admin' | 'comum'>('admin');
  const [formPessoaId, setFormPessoaId] = useState<string>('');
  const [formLid, setFormLid] = useState('');
  const [formAtivo, setFormAtivo] = useState(true);
  const [formErro, setFormErro] = useState<string | null>(null);

  // Carregar usuários do Supabase
  const carregarUsuarios = useCallback(async () => {
    try {
      setCarregando(true);
      const res = await fetch('/api/usuarios');
      if (res.ok) {
        const dados = await res.json();
        setUsuarios(dados);
      }
    } catch (err) {
      console.error('Erro ao carregar usuários:', err);
    } finally {
      setCarregando(false);
    }
  }, []);

  // Carregar lista de titulares do cofre para o select
  const carregarTitulares = useCallback(async () => {
    try {
      const res = await fetch('/api/titulares');
      if (res.ok) {
        const dados = await res.json();
        setTitulares(dados || []);
      }
    } catch (err) {
      console.error('Erro ao carregar titulares:', err);
    }
  }, []);

  useEffect(() => {
    carregarUsuarios();
    carregarTitulares();
  }, [carregarUsuarios, carregarTitulares]);

  const mostrarMensagemSucesso = (msg: string) => {
    setMensagemSucesso(msg);
    setTimeout(() => setMensagemSucesso(null), 4000);
  };

  const abrirModalNovo = () => {
    setUsuarioEmEdicao(null);
    setFormNome('');
    setFormNumero('55');
    setFormPerfil('admin');
    setFormPessoaId('');
    setFormLid('');
    setFormAtivo(true);
    setFormErro(null);
    setModalAberto(true);
  };

  const abrirModalEditar = (u: UsuarioAutorizado) => {
    setUsuarioEmEdicao(u);
    setFormNome(u.nome);
    setFormNumero(u.numero);
    setFormPerfil(u.perfil);
    setFormPessoaId(u.pessoa_id || '');
    setFormLid(u.lid || '');
    setFormAtivo(u.ativo);
    setFormErro(null);
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setUsuarioEmEdicao(null);
    setFormErro(null);
  };

  const salvarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro(null);

    const nomeLimpo = formNome.trim();
    const numeroLimpo = formNumero.replace(/\D/g, '');

    if (!nomeLimpo) {
      setFormErro('Informe o nome completo do usuário.');
      return;
    }

    if (numeroLimpo.length < 10) {
      setFormErro('Informe um número de telefone válido com DDD (ex: 5514999990000).');
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        nome: nomeLimpo,
        numero: numeroLimpo,
        perfil: formPerfil,
        pessoa_id: formPessoaId ? formPessoaId : null,
        lid: formLid.trim() || null,
        ativo: formAtivo,
      };

      if (usuarioEmEdicao) {
        // Atualizar
        const res = await fetch(`/api/usuarios/${usuarioEmEdicao.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.erro || 'Falha ao atualizar usuário.');
        }

        const atualizado = await res.json();
        setUsuarios((prev) => prev.map((u) => (u.id === atualizado.id ? atualizado : u)));
        mostrarMensagemSucesso(`Usuário "${atualizado.nome}" atualizado com sucesso!`);
      } else {
        // Criar
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.erro || 'Falha ao cadastrar usuário.');
        }

        const novo = await res.json();
        setUsuarios((prev) => [novo, ...prev]);
        mostrarMensagemSucesso(`Usuário "${novo.nome}" cadastrado com sucesso no Supabase!`);
      }

      fecharModal();
    } catch (err: any) {
      setFormErro(err.message || 'Erro inesperado ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  // Alternar status ativo/inativo direto no card
  const alternarStatusAtivo = async (u: UsuarioAutorizado) => {
    try {
      const novoStatus = !u.ativo;
      setUsuarios((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, ativo: novoStatus } : item))
      );

      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoStatus }),
      });

      if (!res.ok) {
        // Reverte se falhar
        setUsuarios((prev) =>
          prev.map((item) => (item.id === u.id ? { ...item, ativo: u.ativo } : item))
        );
      } else {
        mostrarMensagemSucesso(
          `Usuário ${u.nome} foi ${novoStatus ? 'ativado' : 'desativado'}.`
        );
      }
    } catch (err) {
      console.error('Erro ao alternar status do usuário:', err);
    }
  };

  const confirmarExclusao = (u: UsuarioAutorizado) => {
    setUsuarioParaExcluir(u);
    setModalExcluirAberto(true);
  };

  const executarExclusao = async () => {
    if (!usuarioParaExcluir) return;

    setSalvando(true);
    try {
      const res = await fetch(`/api/usuarios/${usuarioParaExcluir.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Falha ao excluir usuário.');
      }

      setUsuarios((prev) => prev.filter((u) => u.id !== usuarioParaExcluir.id));
      mostrarMensagemSucesso(`Usuário "${usuarioParaExcluir.nome}" removido do Supabase.`);
      setModalExcluirAberto(false);
      setUsuarioParaExcluir(null);
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
    } finally {
      setSalvando(false);
    }
  };

  // Filtragem
  const usuariosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    return usuarios.filter((u) => {
      const matchBusca =
        !termo ||
        u.nome.toLowerCase().includes(termo) ||
        u.numero.includes(termo) ||
        (u.lid && u.lid.includes(termo)) ||
        (u.nomeTitularVinculado && u.nomeTitularVinculado.toLowerCase().includes(termo));

      const matchPerfil =
        filtroPerfil === 'todos' || u.perfil === filtroPerfil;

      return matchBusca && matchPerfil;
    });
  }, [usuarios, busca, filtroPerfil]);

  return (
    <div className="flex-1 h-full flex flex-col bg-wa-bg overflow-hidden text-wa-textPrimary">
      {/* Topo / Header da Tela */}
      <header className="px-6 py-4 bg-wa-panel border-b border-wa-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-wa-green/15 text-wa-green flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-wa-textPrimary">
                Usuários Autorizados no WhatsApp
              </h1>
              <p className="text-xs text-wa-textSecondary">
                Controle de pessoas autorizadas a interagir com a VEGA via WhatsApp (Tabela <code className="text-wa-greenLight bg-wa-bg px-1 py-0.5 rounded">usuarios</code> do Supabase)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={carregarUsuarios}
            title="Recarregar lista"
            className="p-2 rounded-lg bg-wa-bg hover:bg-wa-panel/80 text-wa-textSecondary hover:text-white border border-wa-border transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={abrirModalNovo}
            className="flex items-center gap-2 px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 font-semibold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Novo Usuário Autorizado</span>
          </button>
        </div>
      </header>

      {/* Alerta de Feedback */}
      {mensagemSucesso && (
        <div className="mx-6 mt-3 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{mensagemSucesso}</span>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="px-6 py-3.5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between border-b border-wa-border/50">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-wa-textSecondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar por nome, telefone, LID ou titular..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-wa-panel rounded-xl text-xs text-wa-textPrimary placeholder:text-wa-textMuted border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs">
          <span className="text-wa-textSecondary text-[11px]">Perfil:</span>
          <button
            onClick={() => setFiltroPerfil('todos')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
              filtroPerfil === 'todos'
                ? 'bg-wa-panel text-wa-green border-wa-green'
                : 'bg-wa-bg text-wa-textSecondary border-wa-border hover:bg-wa-panel/60'
            }`}
          >
            Todos ({usuarios.length})
          </button>
          <button
            onClick={() => setFiltroPerfil('admin')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
              filtroPerfil === 'admin'
                ? 'bg-wa-panel text-amber-300 border-amber-500/60'
                : 'bg-wa-bg text-wa-textSecondary border-wa-border hover:bg-wa-panel/60'
            }`}
          >
            Admin ({usuarios.filter((u) => u.perfil === 'admin').length})
          </button>
          <button
            onClick={() => setFiltroPerfil('comum')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
              filtroPerfil === 'comum'
                ? 'bg-wa-panel text-sky-300 border-sky-500/60'
                : 'bg-wa-bg text-wa-textSecondary border-wa-border hover:bg-wa-panel/60'
            }`}
          >
            Comum ({usuarios.filter((u) => u.perfil === 'comum').length})
          </button>
        </div>
      </div>

      {/* Conteúdo Principal: Tabela de Usuários */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          <div className="h-64 flex flex-col items-center justify-center text-wa-textSecondary text-xs">
            <span className="animate-spin text-2xl mb-2">⏳</span>
            <span>Carregando usuários do Supabase...</span>
          </div>
        ) : usuariosFiltrados.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-wa-panel/40 rounded-2xl border border-wa-border/50">
            <Users className="w-12 h-12 text-wa-textSecondary/50 mb-3" />
            <p className="text-sm font-semibold text-wa-textPrimary">
              Nenhum usuário encontrado
            </p>
            <p className="text-xs text-wa-textSecondary mt-1 max-w-sm">
              {busca
                ? 'Nenhum resultado corresponde à sua pesquisa. Tente outro termo.'
                : 'Não há usuários cadastrados. Clique no botão "+ Novo Usuário Autorizado" acima para autorizar um contato do WhatsApp.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {usuariosFiltrados.map((u) => {
              const isAdmin = u.perfil === 'admin';
              return (
                <div
                  key={u.id}
                  className={`bg-wa-panel rounded-2xl border transition-all p-4.5 flex flex-col justify-between shadow-sm relative group ${
                    u.ativo
                      ? 'border-wa-border hover:border-wa-green/60'
                      : 'border-wa-border/40 opacity-70 bg-wa-panel/50'
                  }`}
                >
                  <div>
                    {/* Topo do Card: Avatar, Nome e Perfil */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-inner flex-shrink-0 relative ${
                            isAdmin
                              ? 'bg-gradient-to-br from-amber-600 to-amber-800'
                              : 'bg-gradient-to-br from-sky-600 to-sky-800'
                          }`}
                        >
                          {getIniciais(u.nome)}
                          {isAdmin && (
                            <span
                              title="Diretoria / Administrador"
                              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center text-[10px] font-black border border-wa-bg"
                            >
                              ★
                            </span>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5">
                            <h2 className="text-sm font-semibold text-wa-textPrimary truncate max-w-[170px]">
                              {u.nome}
                            </h2>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider mt-0.5 ${
                              isAdmin
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {isAdmin ? <ShieldCheck className="w-3 h-3" /> : <User className="w-3 h-3" />}
                            {isAdmin ? 'Admin (Diretoria)' : 'Comum (Geral)'}
                          </span>
                        </div>
                      </div>

                      {/* Botão de Toggle Ativo/Inativo */}
                      <button
                        onClick={() => alternarStatusAtivo(u)}
                        title={u.ativo ? 'Clique para desativar' : 'Clique para ativar'}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 cursor-pointer ${
                          u.ativo
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30'
                            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/30'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${u.ativo ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                        <span>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                      </button>
                    </div>

                    {/* Dados Detalhados */}
                    <div className="space-y-1.5 py-2 border-t border-wa-border/50 text-xs">
                      {/* Telefone */}
                      <div className="flex items-center justify-between text-wa-textSecondary">
                        <span className="flex items-center gap-1 text-[11px]">
                          <Phone className="w-3.5 h-3.5 text-wa-greenLight" />
                          <span>WhatsApp:</span>
                        </span>
                        <span className="font-mono text-wa-textPrimary font-medium">
                          {formatarTelefoneExibicao(u.numero)}
                        </span>
                      </div>

                      {/* Titular Vinculado */}
                      <div className="flex items-center justify-between text-wa-textSecondary">
                        <span className="flex items-center gap-1 text-[11px]">
                          <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Titular Cofre:</span>
                        </span>
                        <span
                          className={`font-medium truncate max-w-[150px] ${
                            u.nomeTitularVinculado ? 'text-indigo-300' : 'text-wa-textMuted italic'
                          }`}
                        >
                          {u.nomeTitularVinculado || 'Nenhum vinculado'}
                        </span>
                      </div>

                      {/* LID WhatsApp (se houver) */}
                      {u.lid && (
                        <div className="flex items-center justify-between text-wa-textSecondary">
                          <span className="flex items-center gap-1 text-[11px]">
                            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                            <span>LID:</span>
                          </span>
                          <span className="font-mono text-[11px] text-wa-textMuted truncate max-w-[150px]">
                            {u.lid}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rodapé do Card: Data de cadastro e Ações */}
                  <div className="mt-3 pt-2.5 border-t border-wa-border/40 flex items-center justify-between text-[11px] text-wa-textMuted">
                    <span>
                      {u.dataCadastro ? `Cadastrado em: ${u.dataCadastro}` : 'Ativo no sistema'}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => abrirModalEditar(u)}
                        title="Editar usuário"
                        className="p-1.5 rounded-lg bg-wa-bg hover:bg-wa-panel text-wa-textSecondary hover:text-wa-green border border-wa-border transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => confirmarExclusao(u)}
                        title="Remover usuário"
                        className="p-1.5 rounded-lg bg-wa-bg hover:bg-rose-500/10 text-wa-textSecondary hover:text-rose-400 border border-wa-border hover:border-rose-500/30 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição de Usuário */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-wa-panel border border-wa-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-scaleIn">
            <div className="p-4 border-b border-wa-border flex items-center justify-between bg-wa-bg/60">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-wa-green" />
                <h2 className="text-sm font-bold text-wa-textPrimary">
                  {usuarioEmEdicao ? 'Editar Usuário Autorizado' : 'Novo Usuário Autorizado'}
                </h2>
              </div>
              <button
                onClick={fecharModal}
                className="p-1 text-wa-textSecondary hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={salvarUsuario} className="p-5 space-y-4">
              {formErro && (
                <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center gap-2 text-xs text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{formErro}</span>
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João Silva"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                />
              </div>

              {/* Número de Telefone */}
              <div>
                <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                  Número de Telefone (WhatsApp com DDI e DDD) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 5514996863115"
                  value={formNumero}
                  onChange={(e) => setFormNumero(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs font-mono text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                />
                <span className="text-[11px] text-wa-textMuted mt-1 block">
                  Padrão internacional: código do país (55) + DDD + 9 dígitos. Ex: 5514996863115.
                </span>
              </div>

              {/* Perfil de Acesso */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                    Perfil de Acesso
                  </label>
                  <select
                    value={formPerfil}
                    onChange={(e) => setFormPerfil(e.target.value as 'admin' | 'comum')}
                    className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                  >
                    <option value="admin">Administrador (Diretoria)</option>
                    <option value="comum">Comum (Geral)</option>
                  </select>
                </div>

                {/* Status Ativo */}
                <div>
                  <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                    Status da Autorização
                  </label>
                  <select
                    value={formAtivo ? 'true' : 'false'}
                    onChange={(e) => setFormAtivo(e.target.value === 'true')}
                    className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                  >
                    <option value="true">Ativo (Permitido)</option>
                    <option value="false">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Titular Vinculado (Cofre) */}
              <div>
                <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                  Titular Vinculado (Cofre de Documentos)
                </label>
                <select
                  value={formPessoaId}
                  onChange={(e) => setFormPessoaId(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                >
                  <option value="">Nenhum titular específico vinculado</option>
                  {titulares.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} (ID: {t.id})
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-wa-textMuted mt-1 block">
                  Permite à VEGA identificar prontamente quando o usuário pedir documentos da sua pasta pessoal.
                </span>
              </div>

              {/* LID (Opcional) */}
              <div>
                <label className="block text-xs font-semibold text-wa-textSecondary mb-1">
                  LID do WhatsApp (Identificador Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: 176948374462673"
                  value={formLid}
                  onChange={(e) => setFormLid(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg rounded-xl text-xs font-mono text-wa-textPrimary border border-wa-border focus:border-wa-green focus:outline-none transition-colors"
                />
              </div>

              {/* Botões de Ação */}
              <div className="pt-3 border-t border-wa-border flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={fecharModal}
                  disabled={salvando}
                  className="px-4 py-2 rounded-xl bg-wa-bg hover:bg-wa-panel text-xs text-wa-textSecondary hover:text-white border border-wa-border transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2 rounded-xl bg-wa-green hover:bg-wa-greenHover text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {salvando ? 'Salvando...' : usuarioEmEdicao ? 'Salvar Alterações' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {modalExcluirAberto && usuarioParaExcluir && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-wa-panel border border-rose-500/30 rounded-2xl w-full max-w-md shadow-2xl p-5 animate-scaleIn">
            <div className="flex items-center gap-3 mb-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h2 className="text-sm font-bold text-wa-textPrimary">
                Confirmar Exclusão de Usuário
              </h2>
            </div>

            <p className="text-xs text-wa-textSecondary leading-relaxed mb-4">
              Você tem certeza que deseja remover o usuário <strong>{usuarioParaExcluir.nome}</strong> ({formatarTelefoneExibicao(usuarioParaExcluir.numero)}) da lista de autorizados?
              Ele não conseguirá mais interagir com a VEGA pelo WhatsApp.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-wa-border">
              <button
                type="button"
                onClick={() => setModalExcluirAberto(false)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl bg-wa-bg hover:bg-wa-panel text-xs text-wa-textSecondary hover:text-white border border-wa-border transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executarExclusao}
                disabled={salvando}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {salvando ? 'Excluindo...' : 'Sim, Excluir Usuário'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
