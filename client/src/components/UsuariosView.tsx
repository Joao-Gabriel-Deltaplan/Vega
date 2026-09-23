import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  RotateCcw,
  UserCheck,
  UserX,
} from 'lucide-react';
import { UsuarioAutorizado } from '../types/chat.js';
import { obterPaletaAvatar, obterIniciais } from '../utils/avatarUtils.js';

interface TitularOpcao {
  id: string;
  nome: string;
}

// Formatação amigável do telefone brasileiro
function formatarTelefoneExibicao(numero: string): string {
  if (!numero) return '';
  const limpo = numero.replace(/\D/g, '');
  if (limpo.startsWith('55') && limpo.length === 13) {
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 9)}-${limpo.slice(9)}`;
  }
  if (limpo.startsWith('55') && limpo.length === 12) {
    return `+55 (${limpo.slice(2, 4)}) ${limpo.slice(4, 8)}-${limpo.slice(8)}`;
  }
  if (limpo.length === 11) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  }
  return `+${limpo}`;
}

export const UsuariosView: React.FC = () => {
  const [usuarios, setUsuarios] = useState<UsuarioAutorizado[]>([]);
  const [titulares, setTitulares] = useState<TitularOpcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroPerfil, setFiltroPerfil] = useState<'todos' | 'admin' | 'comum'>('todos');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  // Estados dos Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [usuarioEmEdicao, setUsuarioEmEdicao] = useState<UsuarioAutorizado | null>(null);

  // Modal de Desativação / Ativação (preserva histórico)
  const [modalDesativarAberto, setModalDesativarAberto] = useState(false);
  const [usuarioParaAlterarStatus, setUsuarioParaAlterarStatus] = useState<UsuarioAutorizado | null>(null);

  // Modal de Exclusão Definitiva (dupla confirmação)
  const [modalExcluirAberto, setModalExcluirAberto] = useState(false);
  const [usuarioParaExcluir, setUsuarioParaExcluir] = useState<UsuarioAutorizado | null>(null);
  const [confirmacaoExclusaoTexto, setConfirmacaoExclusaoTexto] = useState('');

  const [salvando, setSalvando] = useState(false);

  // Campos do formulário
  const [formNome, setFormNome] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formPerfil, setFormPerfil] = useState<'admin' | 'comum'>('comum');
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

  // Carregar titulares cadastrados no Cofre (ordenados por nome)
  const carregarTitulares = useCallback(async () => {
    try {
      const res = await fetch('/api/titulares');
      if (res.ok) {
        const dados = await res.json();
        const ordenados = dados
          .map((t: any) => ({
            id: t.id,
            nome: t.nome,
          }))
          .sort((a: TitularOpcao, b: TitularOpcao) =>
            a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
          );
        setTitulares(ordenados);
      }
    } catch (err) {
      console.error('Erro ao carregar titulares:', err);
    }
  }, []);

  useEffect(() => {
    carregarUsuarios();
    carregarTitulares();
  }, [carregarUsuarios, carregarTitulares]);

  const mostrarMensagemSucesso = (texto: string) => {
    setMensagemSucesso(texto);
    setTimeout(() => setMensagemSucesso(null), 4000);
  };

  const abrirModalNovo = () => {
    setUsuarioEmEdicao(null);
    setFormNome('');
    setFormNumero('');
    setFormPerfil('comum');
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
    setFormAtivo(u.ativo !== false);
    setFormErro(null);
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setUsuarioEmEdicao(null);
    setFormErro(null);
  };

  // Salvar criação ou edição
  const salvarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro(null);

    if (!formNome.trim()) {
      setFormErro('O nome completo é obrigatório.');
      return;
    }

    const numeroLimpo = formNumero.replace(/\D/g, '');
    if (numeroLimpo.length < 10) {
      setFormErro('Informe um número válido com DDD (mínimo 10 dígitos). Ex: 5514996863115');
      return;
    }

    setSalvando(true);

    try {
      const corpo = {
        nome: formNome.trim(),
        numero: numeroLimpo,
        perfil: formPerfil,
        pessoaId: formPessoaId || null,
        lid: formLid ? formLid.trim() : null, // Mantém salvo no banco sem expor
        ativo: formAtivo,
      };

      if (usuarioEmEdicao) {
        const res = await fetch(`/api/usuarios/${usuarioEmEdicao.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.erro || 'Falha ao atualizar usuário.');
        }

        const atualizado = await res.json();
        setUsuarios((prev) =>
          prev.map((item) => (item.id === atualizado.id ? atualizado : item))
        );
        mostrarMensagemSucesso(`Usuário "${atualizado.nome}" atualizado com sucesso.`);
      } else {
        const res = await fetch('/api/usuarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.erro || 'Falha ao cadastrar usuário.');
        }

        const novo = await res.json();
        setUsuarios((prev) => [novo, ...prev]);
        mostrarMensagemSucesso(`Usuário "${novo.nome}" cadastrado com sucesso.`);
      }

      fecharModal();
    } catch (err: any) {
      setFormErro(err.message || 'Erro inesperado ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  // Solicitar desativação ou ativação (com modal de confirmação para desativar)
  const solicitarAlteracaoStatus = (u: UsuarioAutorizado) => {
    if (u.ativo) {
      // Desativar requer confirmação para explicar a preservação do histórico
      setUsuarioParaAlterarStatus(u);
      setModalDesativarAberto(true);
    } else {
      // Reativar direto
      executarAlteracaoStatus(u, true);
    }
  };

  const executarAlteracaoStatus = async (u: UsuarioAutorizado, novoStatus: boolean) => {
    setSalvando(true);
    try {
      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoStatus }),
      });

      if (!res.ok) {
        throw new Error('Falha ao atualizar status do usuário.');
      }

      setUsuarios((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, ativo: novoStatus } : item))
      );

      mostrarMensagemSucesso(
        novoStatus
          ? `Usuário "${u.nome}" foi reativado.`
          : `Usuário "${u.nome}" foi desativado. O histórico foi preservado.`
      );

      setModalDesativarAberto(false);
      setUsuarioParaAlterarStatus(null);
    } catch (err) {
      console.error('Erro ao alternar status do usuário:', err);
    } finally {
      setSalvando(false);
    }
  };

  // Exclusão definitiva com confirmação dupla
  const abrirModalExclusaoDefinitiva = (u: UsuarioAutorizado) => {
    setUsuarioParaExcluir(u);
    setConfirmacaoExclusaoTexto('');
    setModalExcluirAberto(true);
  };

  const executarExclusaoDefinitiva = async () => {
    if (!usuarioParaExcluir) return;

    setSalvando(true);
    try {
      const res = await fetch(`/api/usuarios/${usuarioParaExcluir.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Falha ao excluir usuário definitivamente.');
      }

      setUsuarios((prev) => prev.filter((u) => u.id !== usuarioParaExcluir.id));
      mostrarMensagemSucesso(`Usuário "${usuarioParaExcluir.nome}" foi excluído definitivamente.`);
      setModalExcluirAberto(false);
      setUsuarioParaExcluir(null);
      if (modalAberto) fecharModal();
    } catch (err) {
      console.error('Erro ao excluir usuário definitivamente:', err);
    } finally {
      setSalvando(false);
    }
  };

  // Filtragem e Ordenação Alfabética por Nome (nunca truncado)
  const usuariosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    const filtrados = usuarios.filter((u) => {
      const matchBusca =
        !termo ||
        u.nome.toLowerCase().includes(termo) ||
        u.numero.includes(termo) ||
        (u.nomeTitularVinculado && u.nomeTitularVinculado.toLowerCase().includes(termo));

      const matchPerfil =
        filtroPerfil === 'todos' || u.perfil === filtroPerfil;

      const matchStatus =
        filtroStatus === 'todos'
          ? true
          : filtroStatus === 'ativos'
          ? u.ativo !== false
          : u.ativo === false;

      return matchBusca && matchPerfil && matchStatus;
    });

    // Ordenação alfabética por nome
    return filtrados.sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
    );
  }, [usuarios, busca, filtroPerfil, filtroStatus]);

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f14] overflow-hidden text-slate-100">
      {/* Topo / Header da Tela Limpo (sem dados técnicos) */}
      <header className="px-6 py-4 bg-[#121820] border-b border-[#1e2633] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-100">
                Usuários Autorizados no WhatsApp
              </h1>
              <p className="text-xs text-slate-400">
                Pessoas autorizadas a consultar documentos e interagir com a VEGA
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={carregarUsuarios}
            title="Recarregar lista"
            className="p-2 rounded-xl bg-[#18202b] hover:bg-[#202937] text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={abrirModalNovo}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Novo Usuário</span>
          </button>
        </div>
      </header>

      {/* Alerta de Feedback */}
      {mensagemSucesso && (
        <div className="mx-6 mt-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{mensagemSucesso}</span>
        </div>
      )}

      {/* Barra de Filtros e Busca Padronizada */}
      <div className="px-6 py-3.5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between border-b border-[#1e2633]">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Pesquisar por nome, telefone ou titular vinculado..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[#121820] rounded-xl text-xs text-slate-100 placeholder:text-slate-500 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Filtros de Perfil e Status */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-[#121820] p-1 rounded-xl border border-[#202937]">
            <span className="text-[11px] text-slate-500 px-2 font-medium">Perfil:</span>
            <button
              onClick={() => setFiltroPerfil('todos')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroPerfil === 'todos'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFiltroPerfil('admin')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroPerfil === 'admin'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Admin
            </button>
            <button
              onClick={() => setFiltroPerfil('comum')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroPerfil === 'comum'
                  ? 'bg-[#18202b] text-slate-200 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Comum
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-[#121820] p-1 rounded-xl border border-[#202937]">
            <span className="text-[11px] text-slate-500 px-2 font-medium">Status:</span>
            <button
              onClick={() => setFiltroStatus('todos')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroStatus === 'todos'
                  ? 'bg-[#18202b] text-slate-200 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFiltroStatus('ativos')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroStatus === 'ativos'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ativos
            </button>
            <button
              onClick={() => setFiltroStatus('inativos')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filtroStatus === 'inativos'
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Inativos
            </button>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal: Tabela Limpa */}
      <div className="flex-1 overflow-y-auto p-6">
        {carregando ? (
          /* Skeletons de Linhas da Tabela */
          <div className="bg-[#121820] border border-[#202937] rounded-2xl overflow-hidden p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-3 border-b border-[#1e2633] last:border-b-0 animate-pulse">
                <div className="flex items-center gap-3 w-1/4">
                  <div className="w-9 h-9 rounded-full bg-[#18202b]" />
                  <div className="h-3.5 bg-[#18202b] rounded w-32" />
                </div>
                <div className="h-3 bg-[#18202b] rounded w-28" />
                <div className="h-4 bg-[#18202b] rounded w-16" />
                <div className="h-3 bg-[#18202b] rounded w-28" />
                <div className="h-4 bg-[#18202b] rounded w-14" />
                <div className="h-7 bg-[#18202b] rounded w-24" />
              </div>
            ))}
          </div>
        ) : usuariosFiltrados.length === 0 ? (
          /* Estado Vazio */
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-[#121820] rounded-2xl border border-[#202937]">
            <Users className="w-10 h-10 text-slate-600 mb-2.5" />
            <h3 className="text-sm font-semibold text-slate-200">
              Nenhum usuário encontrado
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {busca
                ? 'Nenhum contato corresponde ao filtro ou busca realizada. Tente outro termo.'
                : 'Nenhum usuário cadastrado até o momento. Clique em "+ Novo Usuário" para autorizar alguém no WhatsApp.'}
            </p>
          </div>
        ) : (
          /* Tabela Limpa e Corporativa */
          <div className="bg-[#121820] border border-[#202937] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead>
                  <tr className="border-b border-[#1e2633] bg-[#18202b]/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider select-none">
                    <th className="py-3.5 px-4">Nome</th>
                    <th className="py-3.5 px-4">WhatsApp</th>
                    <th className="py-3.5 px-4">Perfil</th>
                    <th className="py-3.5 px-4">Titular Vinculado</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2633]">
                  {usuariosFiltrados.map((u) => {
                    const isAdmin = u.perfil === 'admin';
                    const paleta = obterPaletaAvatar(u.nome);

                    return (
                      <tr
                        key={u.id}
                        className={`transition-colors hover:bg-[#18202b]/50 ${
                          !u.ativo ? 'opacity-60 bg-[#0e131a]/40' : ''
                        }`}
                      >
                        {/* 1. Nome (Nunca cortado, com avatar suave) */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 shadow-inner"
                              style={{
                                backgroundColor: paleta.bg,
                                color: paleta.text,
                                border: `1px solid ${paleta.border}`,
                              }}
                            >
                              {obterIniciais(u.nome)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-100 text-xs whitespace-normal break-words leading-snug">
                                {u.nome}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* 2. WhatsApp Formatado */}
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                          {formatarTelefoneExibicao(u.numero)}
                        </td>

                        {/* 3. Perfil Simples (Admin ou Comum) */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium tracking-wide ${
                              isAdmin
                                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                : 'bg-slate-800 text-slate-300 border border-slate-700/50'
                            }`}
                          >
                            {isAdmin ? 'Admin' : 'Comum'}
                          </span>
                        </td>

                        {/* 4. Titular Vinculado */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {u.nomeTitularVinculado ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              <span>{u.nomeTitularVinculado}</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 font-normal">—</span>
                          )}
                        </td>

                        {/* 5. Status */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                              u.ativo
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-slate-800 text-slate-500 border-slate-700'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                u.ativo ? 'bg-emerald-400' : 'bg-slate-500'
                              }`}
                            />
                            <span>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                          </span>
                        </td>

                        {/* 6. Ações (Editar, Desativar/Ativar e Opção Definitiva) */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {/* Botão Editar */}
                            <button
                              onClick={() => abrirModalEditar(u)}
                              title="Editar dados cadastrais"
                              className="px-2.5 py-1 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 border border-[#263345] transition-colors cursor-pointer text-xs font-medium inline-flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Editar</span>
                            </button>

                            {/* Botão Desativar / Reativar (Preserva Histórico) */}
                            <button
                              onClick={() => solicitarAlteracaoStatus(u)}
                              title={
                                u.ativo
                                  ? 'Desativar usuário mantendo o histórico de mensagens'
                                  : 'Reativar atendimento deste usuário'
                              }
                              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer text-xs font-medium inline-flex items-center gap-1 ${
                                u.ativo
                                  ? 'bg-[#18202b] hover:bg-amber-500/10 text-slate-400 hover:text-amber-300 border-[#263345] hover:border-amber-500/30'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {u.ativo ? (
                                <>
                                  <UserX className="w-3 h-3 text-amber-400" />
                                  <span>Desativar</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="w-3 h-3 text-emerald-400" />
                                  <span>Ativar</span>
                                </>
                              )}
                            </button>

                            {/* Exclusão Definitiva (Discreta com Confirmação Dupla) */}
                            <button
                              onClick={() => abrirModalExclusaoDefinitiva(u)}
                              title="Excluir definitivamente do banco de dados (Ação irreversível)"
                              className="p-1 rounded-lg hover:bg-rose-500/10 text-slate-600 hover:text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Rodapé da Tabela */}
            <div className="px-4 py-3 bg-[#18202b]/40 border-t border-[#1e2633] text-[11px] text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                Listando <strong>{usuariosFiltrados.length}</strong> de <strong>{usuarios.length}</strong> usuários cadastrados (ordenados alfabeticamente).
              </span>
              <span className="font-mono text-[10px]">Delta Plan • Gestão de Acessos</span>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* MODAL 1: CRIAÇÃO / EDIÇÃO DE USUÁRIO                           */}
      {/* ============================================================== */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-[#202937] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[#1e2633] flex items-center justify-between bg-[#18202b]">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  {usuarioEmEdicao ? 'Editar Usuário' : 'Novo Usuário Autorizado'}
                </h2>
              </div>
              <button
                onClick={fecharModal}
                className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={salvarUsuario} className="p-5 space-y-3.5">
              {formErro && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-xs text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{formErro}</span>
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Thomaz Fabre"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs text-slate-100 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
                />
              </div>

              {/* WhatsApp */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Número de WhatsApp (DDI + DDD + Número) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 5514996863115"
                  value={formNumero}
                  onChange={(e) => setFormNumero(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs font-mono text-slate-100 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Exemplo: 5514996863115 (sem traços ou parênteses).
                </span>
              </div>

              {/* Perfil & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Perfil de Acesso
                  </label>
                  <select
                    value={formPerfil}
                    onChange={(e) => setFormPerfil(e.target.value as 'admin' | 'comum')}
                    className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs text-slate-100 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
                  >
                    <option value="admin">Admin</option>
                    <option value="comum">Comum</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Status da Autorização
                  </label>
                  <select
                    value={formAtivo ? 'true' : 'false'}
                    onChange={(e) => setFormAtivo(e.target.value === 'true')}
                    className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs text-slate-100 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
                  >
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
              </div>

              {/* Titular Vinculado com Opção "Nenhum" e Instrução Solicitada */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Titular Vinculado (Pasta Pessoal no Cofre)
                </label>
                <select
                  value={formPessoaId}
                  onChange={(e) => setFormPessoaId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs text-slate-100 border border-[#202937] focus:border-emerald-500 focus:outline-none transition-colors"
                >
                  <option value="">Nenhum</option>
                  {titulares.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-400 mt-1.5 block leading-normal">
                  Permite que a pessoa consulte os próprios documentos dizendo 'meu CPF', 'minha CNH'.
                </span>
              </div>

              {/* Botões de Ação */}
              <div className="pt-3 border-t border-[#1e2633] flex items-center justify-between">
                {usuarioEmEdicao ? (
                  <button
                    type="button"
                    onClick={() => abrirModalExclusaoDefinitiva(usuarioEmEdicao)}
                    className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Excluir definitivamente
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fecharModal}
                    disabled={salvando}
                    className="px-4 py-2 rounded-xl bg-[#18202b] hover:bg-[#202937] text-xs text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvando}
                    className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {salvando ? 'Salvando...' : usuarioEmEdicao ? 'Salvar Alterações' : 'Cadastrar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: CONFIRMAÇÃO DE DESATIVAÇÃO (PRESERVA HISTÓRICO)       */}
      {/* ============================================================== */}
      {modalDesativarAberto && usuarioParaAlterarStatus && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-amber-500/30 rounded-2xl w-full max-w-sm shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-2.5 text-amber-400">
              <UserX className="w-5 h-5 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-100">
                Desativar Usuário
              </h2>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Deseja desativar <strong>{usuarioParaAlterarStatus.nome}</strong>?
              <br />
              <span className="text-slate-400 block mt-1.5 text-[11px]">
                ✔ O histórico de mensagens e dados será totalmente preservado no sistema.
                <br />
                ✖ Ele deixará de receber respostas automáticas da VEGA no WhatsApp até ser reativado.
              </span>
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2633]">
              <button
                type="button"
                onClick={() => setModalDesativarAberto(false)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl bg-[#18202b] hover:bg-[#202937] text-xs text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executarAlteracaoStatus(usuarioParaAlterarStatus, false)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {salvando ? 'Desativando...' : 'Confirmar Desativação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: EXCLUSÃO DEFINITIVA (CONFIRMAÇÃO DUPLA)               */}
      {/* ============================================================== */}
      {modalExcluirAberto && usuarioParaExcluir && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-rose-500/40 rounded-2xl w-full max-w-md shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-2.5 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-sm font-bold text-slate-100">
                Atenção: Exclusão Definitiva de Usuário
              </h2>
            </div>

            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-200 mb-3 space-y-1">
              <p className="font-semibold">Esta ação é permanente e irreversível.</p>
              <p className="text-[11px] text-rose-300">
                O registro de <strong>{usuarioParaExcluir.nome}</strong> ({formatarTelefoneExibicao(usuarioParaExcluir.numero)}) será removido definitivamente do banco de dados.
              </p>
            </div>

            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Se você deseja apenas bloquear o atendimento mantendo o histórico de mensagens, recomendamos a opção <strong>Desativar</strong>.
            </p>

            <div className="space-y-1.5 mb-4">
              <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Digite EXCLUIR para confirmar a exclusão permanente:
              </label>
              <input
                type="text"
                placeholder="EXCLUIR"
                value={confirmacaoExclusaoTexto}
                onChange={(e) => setConfirmacaoExclusaoTexto(e.target.value)}
                className="w-full px-3 py-2 bg-[#0b0f14] rounded-xl text-xs font-mono text-rose-200 border border-[#202937] focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2633]">
              <button
                type="button"
                onClick={() => setModalExcluirAberto(false)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl bg-[#18202b] hover:bg-[#202937] text-xs text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executarExclusaoDefinitiva}
                disabled={salvando || confirmacaoExclusaoTexto.trim().toUpperCase() !== 'EXCLUIR'}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
              >
                {salvando ? 'Excluindo...' : 'Excluir Definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
