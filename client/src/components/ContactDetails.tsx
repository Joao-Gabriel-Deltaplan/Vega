import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone,
  Save,
  Shield,
  Briefcase,
  Building,
  User,
  CheckCircle,
  FileText,
  Download,
  FolderLock,
  Files,
} from 'lucide-react';
import { Conversa, Contato, NivelAcesso, SetorUsuario } from '../types/chat.js';

interface ContactDetailsProps {
  conversa: Conversa;
  onAtualizarContato: (dados: Partial<Contato>) => Promise<void>;
}

const SETORES: SetorUsuario[] = [
  'Diretoria',
  'Administrativo',
  'Obras',
  'Financeiro',
  'Suprimentos',
  'RH',
  'Comercial',
];

function getIniciais(nome: string): string {
  if (!nome) return '??';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export const ContactDetails: React.FC<ContactDetailsProps> = ({
  conversa,
  onAtualizarContato,
}) => {
  const contato = conversa.contato;

  const [nome, setNome] = useState(contato.nome);
  const [cargo, setCargo] = useState(contato.cargo || contato.ficha?.cargo || '');
  const [setor, setSetor] = useState<SetorUsuario>(
    (contato.setor || contato.ficha?.setor || 'Administrativo') as SetorUsuario
  );
  const [nivelAcesso, setNivelAcesso] = useState<NivelAcesso>(
    contato.nivelAcesso || contato.ficha?.nivelAcesso || 'geral'
  );
  const [observacoes, setObservacoes] = useState(contato.ficha?.observacoes || '');
  const [salvando, setSalvando] = useState(false);
  const [salvoComSucesso, setSalvoComSucesso] = useState(false);

  // Sincroniza estado local quando muda a conversa ativa
  useEffect(() => {
    setNome(contato.nome);
    setCargo(contato.cargo || contato.ficha?.cargo || '');
    setSetor(
      (contato.setor || contato.ficha?.setor || 'Administrativo') as SetorUsuario
    );
    setNivelAcesso(contato.nivelAcesso || contato.ficha?.nivelAcesso || 'geral');
    setObservacoes(contato.ficha?.observacoes || '');
  }, [contato.id, contato.nome, contato.cargo, contato.setor, contato.nivelAcesso, contato.ficha]);

  // Documentos entregues pela VEGA nesta conversa
  const documentosEntregues = useMemo(() => {
    const lista: Array<{
      id: string;
      titulo: string;
      nomeArquivo: string;
      url: string;
      horario: string;
      data: string;
      tamanho?: string;
    }> = [];

    for (const msg of conversa.mensagens) {
      if (msg.remetente === 'assistente' && msg.anexos) {
        for (const anexo of msg.anexos) {
          if (anexo.tipo === 'pdf' || anexo.tipo === 'arquivo') {
            lista.push({
              id: `${msg.id}-${anexo.nome?.trim()}`,
              titulo: (anexo.titulo || anexo.nome || '').trim(),
              nomeArquivo: anexo.nome?.trim() || '',
              url: (anexo.url || `/arquivos/${encodeURIComponent(anexo.nome?.trim() || '')}`).trim(),
              horario: msg.horario,
              data: anexo.dataCadastro || '',
              tamanho: anexo.tamanho,
            });
          }
        }
      }
    }
    return lista;
  }, [conversa.mensagens]);

  // Salvar ficha do usuário interno via PATCH /api/contatos/:id
  const handleSalvarFicha = async () => {
    setSalvando(true);
    try {
      await onAtualizarContato({
        nome: nome.trim() || contato.nome,
        cargo: cargo.trim(),
        setor,
        nivelAcesso,
        ficha: {
          cargo: cargo.trim(),
          setor,
          nivelAcesso,
          observacoes: observacoes.trim(),
        },
      });
      setSalvoComSucesso(true);
      setTimeout(() => setSalvoComSucesso(false), 2500);
    } catch (err) {
      console.error('Erro ao salvar ficha do usuário:', err);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <aside className="w-[280px] min-w-[280px] h-full flex flex-col bg-wa-bg border-l border-wa-border overflow-y-auto">
      {/* 1. Topo / Perfil do Usuário */}
      <div className="p-4 bg-wa-panel border-b border-wa-border flex flex-col items-center text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl text-white shadow-lg mb-2.5 relative"
          style={{ backgroundColor: contato.avatarCor || '#00a884' }}
        >
          {getIniciais(nome)}
          {nivelAcesso === 'diretoria' && (
            <span
              title="Membro da Diretoria"
              className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black shadow border border-wa-bg"
            >
              DIR
            </span>
          )}
        </div>

        <h3 className="font-semibold text-base text-wa-textPrimary leading-tight">
          {nome}
        </h3>

        <p className="text-xs text-wa-textSecondary flex items-center gap-1 mt-1">
          <Phone className="w-3 h-3 text-wa-green" />
          <span>{contato.telefone}</span>
        </p>

        <div className="mt-2.5 flex items-center gap-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase flex items-center gap-1 ${
            nivelAcesso === 'diretoria'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-wa-border text-wa-textSecondary'
          }`}>
            <Shield className="w-2.5 h-2.5" />
            <span>Nível: {nivelAcesso}</span>
          </span>
        </div>
      </div>

      <div className="p-3.5 space-y-5">
        {/* 2. Seção: PERFIL DO USUÁRIO */}
        <div className="space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-wa-textPrimary uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-wa-green" />
              PERFIL DO USUÁRIO
            </span>
            {salvoComSucesso && (
              <span className="text-[10px] text-wa-green font-medium animate-fadeIn flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Salvo!
              </span>
            )}
          </div>

          {/* Nome */}
          <div>
            <label className="block text-[11px] text-wa-textSecondary mb-1 font-medium">
              Nome
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-wa-panel border border-wa-border rounded-md text-xs text-wa-textPrimary focus:border-wa-green focus:outline-none transition-colors"
              placeholder="Ex: Carlos Eduardo"
            />
          </div>

          {/* Cargo */}
          <div>
            <label className="block text-[11px] text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
              <Briefcase className="w-3 h-3 text-wa-green" />
              Cargo
            </label>
            <input
              type="text"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-wa-panel border border-wa-border rounded-md text-xs text-wa-textPrimary focus:border-wa-green focus:outline-none transition-colors"
              placeholder="Ex: Diretor, Gerente de Obras, Engenheiro"
            />
          </div>

          {/* Setor */}
          <div>
            <label className="block text-[11px] text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
              <Building className="w-3 h-3 text-wa-green" />
              Setor
            </label>
            <select
              value={setor}
              onChange={(e) => setSetor(e.target.value as SetorUsuario)}
              className="w-full px-2 py-1.5 bg-wa-panel border border-wa-border rounded-md text-xs text-wa-textPrimary focus:border-wa-green focus:outline-none transition-colors font-medium"
            >
              {SETORES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Nível de Acesso */}
          <div>
            <label className="block text-[11px] text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
              <Shield className="w-3 h-3 text-wa-green" />
              Nível de Acesso
            </label>
            <select
              value={nivelAcesso}
              onChange={(e) => setNivelAcesso(e.target.value as NivelAcesso)}
              className="w-full px-2 py-1.5 bg-wa-panel border border-wa-border rounded-md text-xs text-wa-textPrimary focus:border-wa-green focus:outline-none transition-colors font-medium"
            >
              <option value="geral">Geral (Padrão — Documentos Gerais)</option>
              <option value="diretoria">Diretoria (Acesso Total ao Cofre)</option>
            </select>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-[11px] text-wa-textSecondary mb-1 font-medium">
              Observações
            </label>
            <textarea
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Notas internas sobre o usuário..."
              className="w-full px-2.5 py-1.5 bg-wa-panel border border-wa-border rounded-md text-xs text-wa-textPrimary focus:border-wa-green focus:outline-none resize-none leading-relaxed"
            />
          </div>

          {/* Botão Salvar Ficha */}
          <button
            onClick={handleSalvarFicha}
            disabled={salvando}
            className="w-full py-1.5 px-3 bg-wa-panel hover:bg-wa-panelHover border border-wa-green/50 text-wa-greenLight text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors active:scale-98 disabled:opacity-50 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{salvando ? 'Salvando...' : 'Salvar Ficha'}</span>
          </button>
        </div>

        <hr className="border-wa-border/60" />

        {/* 3. Seção: DOCUMENTOS ENTREGUES */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-wa-textPrimary uppercase tracking-wider flex items-center gap-1.5">
              <Files className="w-3.5 h-3.5 text-wa-green" />
              DOCUMENTOS ENTREGUES
            </span>
            <span className="text-[11px] text-wa-green font-medium">
              ({documentosEntregues.length})
            </span>
          </div>

          {documentosEntregues.length > 0 ? (
            <div className="space-y-2">
              {documentosEntregues.map((doc) => (
                <div
                  key={doc.id}
                  className="p-2.5 bg-wa-panel rounded-lg border border-wa-border flex items-center justify-between gap-2 hover:border-wa-green/40 transition-colors"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-wa-green flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium text-xs text-wa-textPrimary truncate leading-snug">
                        {doc.titulo}
                      </p>
                      <p className="text-[10px] text-wa-textMuted mt-0.5">
                        {doc.horario} {doc.tamanho ? `• ${doc.tamanho}` : ''}
                      </p>
                    </div>
                  </div>

                  <a
                    href={doc.url}
                    download={doc.nomeArquivo}
                    title="Baixar novamente"
                    className="p-1.5 rounded-md hover:bg-wa-bg text-wa-greenLight hover:text-wa-green transition-colors flex-shrink-0"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-wa-panel/40 rounded-lg border border-dashed border-wa-border text-center text-xs text-wa-textSecondary flex flex-col items-center gap-1.5">
              <FolderLock className="w-5 h-5 text-wa-textMuted" />
              <span>Nenhum documento entregue ainda.</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
