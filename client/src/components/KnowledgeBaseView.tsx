import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Brain,
  Save,
  Trash2,
  FileText,
  Search,
  CheckCircle,
  UploadCloud,
  X,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
  Building2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Edit2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  BellOff,
  FolderLock,
  BookOpen,
  Filter,
  Copy,
  Check,
  CreditCard,
  Globe,
  Phone,
  Mail,
  FileQuestion,
  ClipboardCheck,
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { ASSISTENTE } from '../config/assistente.js';
import {
  DocumentoRegistro,
  FichaTitular,
  ItemConhecimento,
  DadosPix,
  DadosLink,
  DadosContato,
} from '../types/chat.js';
import { obterPaletaAvatar, obterIniciais } from '../utils/avatarUtils.js';
import { DocumentosFaltantesView } from './DocumentosFaltantesView.js';
import { SugestoesDocumentosView } from './SugestoesDocumentosView.js';

interface KnowledgeBaseViewProps {
  subAbaInicial?: 'conhecimento' | 'documentos' | 'faltantes' | 'sugestoes';
}

const FUSO_HORARIO_PADRAO = 'America/Sao_Paulo';

/**
 * Formata qualquer data ou timestamp para DD/MM/AAAA no fuso de Brasília.
 */
function formatarDataBrasilia(dataStr?: string | null): string {
  if (!dataStr || !dataStr.trim()) return '—';
  const limpo = dataStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(limpo)) {
    return limpo;
  }
  const d = new Date(limpo);
  if (isNaN(d.getTime())) return limpo;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_HORARIO_PADRAO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Identifica a situação de validade de um documento.
 */
function obterSituacaoValidade(
  dataValidadeStr?: string | null
): 'valido' | 'vencendo' | 'vencido' | 'sem_validade' {
  if (!dataValidadeStr || !dataValidadeStr.trim()) return 'sem_validade';
  const match = dataValidadeStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return 'sem_validade';

  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10) - 1;
  const ano = parseInt(match[3], 10);
  const dValidade = new Date(ano, mes, dia, 0, 0, 0, 0);

  const agora = new Date();
  const ref = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
  const diffMs = dValidade.getTime() - ref.getTime();
  const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= 60) return 'vencendo';
  return 'valido';
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  subAbaInicial = 'documentos',
}) => {
  const [subAba, setSubAba] = useState<'conhecimento' | 'documentos' | 'faltantes' | 'sugestoes'>(subAbaInicial);
  const [totalFaltantesPendentes, setTotalFaltantesPendentes] = useState<number>(0);

  const carregarTotalFaltantes = async () => {
    try {
      const res = await fetch('/api/documentos-faltantes');
      if (res.ok) {
        const data = await res.json();
        const pendentes = (data || []).filter((d: any) => d.status === 'pendente').length;
        setTotalFaltantesPendentes(pendentes);
      }
    } catch {}
  };

  // ==========================================
  // ESTADOS DA SUB-ABA CONHECIMENTO
  // ==========================================
  const [itensConhecimento, setItensConhecimento] = useState<ItemConhecimento[]>([]);
  const [carregandoConhecimento, setCarregandoConhecimento] = useState(true);
  const [buscaConhecimento, setBuscaConhecimento] = useState('');
  const [filtroTipoConhecimento, setFiltroTipoConhecimento] = useState<
    'todos' | 'pix' | 'link' | 'contato' | 'regra'
  >('todos');

  // Entrada única de texto com IA
  const [textoEntradaUnica, setTextoEntradaUnica] = useState('');
  const [estruturandoComIA, setEstruturandoComIA] = useState(false);
  const [erroEstruturacao, setErroEstruturacao] = useState('');
  const [itensSugeridosIA, setItensSugeridosIA] = useState<ItemConhecimento[]>([]);
  const [salvandoItensSugeridos, setSalvandoItensSugeridos] = useState(false);

  // Edição em linha na lista
  const [idEditandoEmLinha, setIdEditandoEmLinha] = useState<string | null>(null);
  const [draftEdicaoLinha, setDraftEdicaoLinha] = useState<ItemConhecimento | null>(null);
  const [salvandoEdicaoLinha, setSalvandoEdicaoLinha] = useState(false);
  const [mensagemSucessoConhecimento, setMensagemSucessoConhecimento] = useState('');

  // Feedback de cópia (ex: Chave PIX)
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // ==========================================
  // ESTADOS DA SUB-ABA DOCUMENTOS (COFRE)
  // ==========================================
  const [documentos, setDocumentos] = useState<DocumentoRegistro[]>([]);
  const [buscaDocumentos, setBuscaDocumentos] = useState('');
  const [filtroTitularDoc, setFiltroTitularDoc] = useState('todos');
  const [filtroTipoDoc, setFiltroTipoDoc] = useState('todos');
  const [filtroValidadeDoc, setFiltroValidadeDoc] = useState('todas');
  const [carregandoDocs, setCarregandoDocs] = useState(true);
  const [carregandoTitulares, setCarregandoTitulares] = useState(true);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const [uploadandoDireto, setUploadandoDireto] = useState(false);
  const [erroUpload, setErroUpload] = useState('');

  // Linha de notificação de upload sem fricção com correção rápida
  const [uploadRecente, setUploadRecente] = useState<{
    docId: string;
    titulo: string;
    titular: string;
    tipo: string;
    precisaPerguntar: boolean;
    camposFaltantes: string[];
    nomeNoDocumento?: string | null;
    novoTitularSugerido?: boolean;
  } | null>(null);
  const [exibirCorrecaoRapida, setExibirCorrecaoRapida] = useState(false);
  const [correcaoTitular, setCorrecaoTitular] = useState('');
  const [correcaoTipo, setCorrecaoTipo] = useState('');
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false);

  // Titulares cadastrados no cofre
  const [titulares, setTitulares] = useState<FichaTitular[]>([]);
  const [titularesExpandidos, setTitularesExpandidos] = useState<Record<string, boolean>>({});

  // Destravamento de PDF protegido por senha
  const [docParaDestravar, setDocParaDestravar] = useState<DocumentoRegistro | null>(null);
  const [senhaDestravar, setSenhaDestravar] = useState('');
  const [mostrarSenhaDestravar, setMostrarSenhaDestravar] = useState(false);
  const [destravandoDoc, setDestravandoDoc] = useState(false);
  const [erroDestravar, setErroDestravar] = useState('');
  const [sucessoDestravar, setSucessoDestravar] = useState('');

  const abrirModalDestravar = (doc: DocumentoRegistro) => {
    setDocParaDestravar(doc);
    setSenhaDestravar('');
    setMostrarSenhaDestravar(false);
    setErroDestravar('');
    setSucessoDestravar('');
  };

  const fecharModalDestravar = () => {
    if (destravandoDoc) return;
    setDocParaDestravar(null);
    setSenhaDestravar('');
    setErroDestravar('');
    setSucessoDestravar('');
  };

  const handleExecutarDestravar = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!docParaDestravar) return;
    if (!senhaDestravar.trim()) {
      setErroDestravar('Por favor, informe a senha do documento.');
      return;
    }

    setDestravandoDoc(true);
    setErroDestravar('');
    setSucessoDestravar('');

    try {
      const res = await fetch(`/api/documentos/${docParaDestravar.id}/destravar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: senhaDestravar.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.erro || 'Falha ao destravar o documento.');
      }

      setSucessoDestravar('Documento destravado e indexado com sucesso!');
      setDocumentos((prev) =>
        prev.map((d) =>
          d.id === docParaDestravar.id
            ? { ...d, statusIndexacao: 'indexado', erroIndexacao: undefined }
            : d
        )
      );

      setTimeout(() => {
        carregarDocumentos(true);
        carregarTitulares();
        fecharModalDestravar();
      }, 1200);
    } catch (err: any) {
      setErroDestravar(err.message || 'Erro ao processar senha.');
    } finally {
      setDestravandoDoc(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==========================================
  // CARREGAMENTO DE DADOS
  // ==========================================
  const carregarConhecimentos = async () => {
    setCarregandoConhecimento(true);
    try {
      const res = await fetch('/api/conhecimento');
      if (res.ok) {
        const dados = await res.json();
        if (Array.isArray(dados)) {
          setItensConhecimento(dados);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar base de conhecimento:', err);
    } finally {
      setCarregandoConhecimento(false);
    }
  };

  const carregarTitulares = async () => {
    setCarregandoTitulares(true);
    try {
      const res = await fetch('/api/titulares');
      if (res.ok) {
        const dados = await res.json();
        if (Array.isArray(dados)) {
          setTitulares(dados);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar titulares:', err);
    } finally {
      setCarregandoTitulares(false);
    }
  };

  const carregarDocumentos = async (silencioso: boolean = false) => {
    if (!silencioso) setCarregandoDocs(true);
    try {
      const res = await fetch('/api/documentos');
      if (res.ok) {
        const dados = await res.json();
        if (Array.isArray(dados)) {
          setDocumentos(dados);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar documentos da Base:', err);
    } finally {
      if (!silencioso) setCarregandoDocs(false);
    }
  };

  useEffect(() => {
    carregarConhecimentos();
    carregarDocumentos();
    carregarTitulares();
    carregarTotalFaltantes();
  }, []);

  // Polling automático e silencioso enquanto houver documentos com status 'processando'
  useEffect(() => {
    const temProcessando = documentos.some((d) => d.statusIndexacao === 'processando');
    if (!temProcessando) return;

    const interval = setInterval(() => {
      carregarDocumentos(true);
      carregarTitulares();
    }, 3000);

    return () => clearInterval(interval);
  }, [documentos]);

  useEffect(() => {
    if (subAbaInicial) {
      setSubAba(subAbaInicial);
    }
  }, [subAbaInicial]);

  // ==========================================
  // 1. UPLOAD DE DOCUMENTO SEM FRICÇÃO
  // ==========================================
  const processarArquivoSemFriccao = async (file: File) => {
    setErroUpload('');
    setUploadRecente(null);
    setExibirCorrecaoRapida(false);

    const LIMITE_BYTES = 50 * 1024 * 1024;
    if (file.size > LIMITE_BYTES) {
      setErroUpload('O arquivo excede o limite máximo permitido de 50MB.');
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!isPdf && !isImg) {
      setErroUpload(
        'Formato não suportado. Por favor envie arquivos PDF ou imagens (.png, .jpg, .jpeg, .webp).'
      );
      return;
    }

    setUploadandoDireto(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;

      try {
        const res = await fetch('/api/documentos/upload-direto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nomeArquivo: file.name,
            mimeType: file.type,
            tamanho: file.size,
            base64,
          }),
        });

        if (res.ok) {
          const resultado = await res.json();
          const docSalvo: DocumentoRegistro = resultado.documento;

          // Atualiza listas do Cofre
          setDocumentos((prev) => [docSalvo, ...prev]);
          await carregarTitulares();

          // Configura estado para notificação e perguntas
          setUploadRecente({
            docId: docSalvo.id,
            titulo: docSalvo.titulo,
            titular: docSalvo.titular || '',
            tipo: docSalvo.tipo || '',
            precisaPerguntar: Boolean(resultado.precisaPerguntar),
            camposFaltantes: resultado.camposFaltantes || [],
            nomeNoDocumento: resultado.nomeNoDocumento || null,
            novoTitularSugerido: !!resultado.novoTitularSugerido,
          });

          setCorrecaoTitular(docSalvo.titular || resultado.nomeNoDocumento || '');
          setCorrecaoTipo(docSalvo.tipo || '');

          if (resultado.precisaPerguntar) {
            setExibirCorrecaoRapida(true);
          }
        } else {
          const erroJson = await res.json().catch(() => ({}));
          setErroUpload(
            erroJson.erro || 'Erro ao salvar documento no cofre. Tente novamente.'
          );
        }
      } catch (err) {
        console.error('Erro no upload direto:', err);
        setErroUpload('Erro de conexão ao enviar documento.');
      } finally {
        setUploadandoDireto(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const handleSalvarCorrecaoRapida = async () => {
    if (!uploadRecente) return;
    setSalvandoCorrecao(true);

    try {
      const res = await fetch(`/api/documentos/${uploadRecente.docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titular: correcaoTitular.trim(),
          tipo: correcaoTipo.trim(),
        }),
      });

      if (res.ok) {
        const docAtualizado: DocumentoRegistro = await res.json();
        setDocumentos((prev) =>
          prev.map((d) => (d.id === docAtualizado.id ? docAtualizado : d))
        );
        setUploadRecente({
          docId: docAtualizado.id,
          titulo: docAtualizado.titulo,
          titular: docAtualizado.titular || '',
          tipo: docAtualizado.tipo || '',
          precisaPerguntar: false,
          camposFaltantes: [],
          nomeNoDocumento: null,
          novoTitularSugerido: false,
        });
        setExibirCorrecaoRapida(false);
        await carregarTitulares();
      }
    } catch (err) {
      console.error('Erro ao salvar correção:', err);
    } finally {
      setSalvandoCorrecao(false);
    }
  };

  const handleExcluirDoc = async (id: string, titulo: string) => {
    const confirmacao = window.confirm(
      `Confirma a exclusão de "${titulo}" do Cofre? Esta ação removerá o arquivo permanentemente.`
    );
    if (!confirmacao) return;

    try {
      const res = await fetch(`/api/documentos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDocumentos((prev) => prev.filter((d) => d.id !== id));
        if (uploadRecente?.docId === id) setUploadRecente(null);
      }
    } catch (err) {
      console.error('Erro ao excluir documento:', err);
    }
  };

  // ==========================================
  // 2. ENTRADA ÚNICA COM IA (ABA CONHECIMENTO)
  // ==========================================
  const handleEstruturarComIA = async () => {
    if (!textoEntradaUnica.trim()) return;
    setErroEstruturacao('');
    setEstruturandoComIA(true);

    try {
      const res = await fetch('/api/conhecimento/estruturar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoEntradaUnica.trim() }),
      });

      if (res.ok) {
        const dados = await res.json();
        if (dados.sucesso && Array.isArray(dados.itens) && dados.itens.length > 0) {
          const itensFormatados: ItemConhecimento[] = dados.itens.map(
            (it: any, index: number) => ({
              id: `temp-${Date.now()}-${index}`,
              titulo: it.titulo,
              categoria: it.categoria,
              conteudo: it.conteudo,
              tipo: it.tipo,
              dadosEstruturados: it.dadosEstruturados,
              dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
            })
          );
          setItensSugeridosIA(itensFormatados);
        } else {
          setErroEstruturacao(
            dados.mensagem || 'Não foi possível estruturar a informação com a IA.'
          );
        }
      } else {
        setErroEstruturacao('Erro ao conectar com a IA para estruturação.');
      }
    } catch (err) {
      console.error('Erro ao estruturar:', err);
      setErroEstruturacao('Erro de conexão ao estruturar conhecimento.');
    } finally {
      setEstruturandoComIA(false);
    }
  };

  const handleSalvarItemSugerido = async (item: ItemConhecimento) => {
    setSalvandoItensSugeridos(true);
    try {
      const res = await fetch('/api/conhecimento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: item.titulo,
          categoria: item.categoria,
          conteudo: item.conteudo,
          tipo: item.tipo,
          dadosEstruturados: item.dadosEstruturados,
        }),
      });

      if (res.ok) {
        const salvo = await res.json();
        setItensConhecimento((prev) => [salvo, ...prev]);
        setItensSugeridosIA((prev) => prev.filter((i) => i.id !== item.id));

        if (itensSugeridosIA.length <= 1) {
          setTextoEntradaUnica('');
        }

        setMensagemSucessoConhecimento(`Item "${salvo.titulo}" salvo com sucesso!`);
        setTimeout(() => setMensagemSucessoConhecimento(''), 3000);
      }
    } catch (err) {
      console.error('Erro ao salvar item sugerido:', err);
    } finally {
      setSalvandoItensSugeridos(false);
    }
  };

  const handleSalvarTodosSugeridos = async () => {
    if (itensSugeridosIA.length === 0) return;
    setSalvandoItensSugeridos(true);

    try {
      for (const item of itensSugeridosIA) {
        const res = await fetch('/api/conhecimento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: item.titulo,
            categoria: item.categoria,
            conteudo: item.conteudo,
            tipo: item.tipo,
            dadosEstruturados: item.dadosEstruturados,
          }),
        });
        if (res.ok) {
          const salvo = await res.json();
          setItensConhecimento((prev) => [salvo, ...prev]);
        }
      }

      setItensSugeridosIA([]);
      setTextoEntradaUnica('');
      setMensagemSucessoConhecimento('Todos os itens foram cadastrados na Base da VEGA!');
      setTimeout(() => setMensagemSucessoConhecimento(''), 3500);
    } catch (err) {
      console.error('Erro ao salvar todos:', err);
    } finally {
      setSalvandoItensSugeridos(false);
    }
  };

  // ==========================================
  // 3. EDIÇÃO EM LINHA (SEM MODAL PESADO)
  // ==========================================
  const handleIniciarEdicaoLinha = (item: ItemConhecimento) => {
    setIdEditandoEmLinha(item.id);
    setDraftEdicaoLinha(JSON.parse(JSON.stringify(item)));
  };

  const handleSalvarEdicaoLinha = async () => {
    if (!draftEdicaoLinha) return;
    setSalvandoEdicaoLinha(true);

    try {
      const res = await fetch(`/api/conhecimento/${draftEdicaoLinha.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: draftEdicaoLinha.titulo,
          categoria: draftEdicaoLinha.categoria,
          conteudo: draftEdicaoLinha.conteudo,
          tipo: draftEdicaoLinha.tipo,
          dadosEstruturados: draftEdicaoLinha.dadosEstruturados,
        }),
      });

      if (res.ok) {
        const atualizado = await res.json();
        setItensConhecimento((prev) =>
          prev.map((i) => (i.id === atualizado.id ? atualizado : i))
        );
        setIdEditandoEmLinha(null);
        setDraftEdicaoLinha(null);
        setMensagemSucessoConhecimento(`"${atualizado.titulo}" atualizado com sucesso!`);
        setTimeout(() => setMensagemSucessoConhecimento(''), 3000);
      }
    } catch (err) {
      console.error('Erro ao salvar edição em linha:', err);
    } finally {
      setSalvandoEdicaoLinha(false);
    }
  };

  const handleExcluirConhecimento = async (id: string, titulo: string) => {
    const confirmacao = window.confirm(`Deseja realmente excluir "${titulo}"?`);
    if (!confirmacao) return;

    try {
      const res = await fetch(`/api/conhecimento/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItensConhecimento((prev) => prev.filter((i) => i.id !== id));
        if (idEditandoEmLinha === id) setIdEditandoEmLinha(null);
      }
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
  };

  const copiarChave = (id: string, chave: string) => {
    if (!chave) return;
    navigator.clipboard.writeText(chave);
    setCopiadoId(id);
    setTimeout(() => setCopiadoId(null), 2000);
  };

  // ==========================================
  // FILTRAGEM DE CONHECIMENTO
  // ==========================================
  const contadoresTipo = useMemo(() => {
    return {
      todos: itensConhecimento.length,
      pix: itensConhecimento.filter((i) => i.tipo === 'pix').length,
      link: itensConhecimento.filter((i) => i.tipo === 'link').length,
      contato: itensConhecimento.filter((i) => i.tipo === 'contato').length,
      regra: itensConhecimento.filter((i) => !i.tipo || i.tipo === 'regra').length,
    };
  }, [itensConhecimento]);

  const itensConhecimentoFiltrados = useMemo(() => {
    return itensConhecimento.filter((item) => {
      const termo = buscaConhecimento.toLowerCase().trim();
      const matchBusca =
        !termo ||
        item.titulo.toLowerCase().includes(termo) ||
        item.conteudo.toLowerCase().includes(termo) ||
        item.categoria.toLowerCase().includes(termo);

      let matchTipo = true;
      if (filtroTipoConhecimento === 'pix') matchTipo = item.tipo === 'pix';
      else if (filtroTipoConhecimento === 'link') matchTipo = item.tipo === 'link';
      else if (filtroTipoConhecimento === 'contato') matchTipo = item.tipo === 'contato';
      else if (filtroTipoConhecimento === 'regra') matchTipo = !item.tipo || item.tipo === 'regra';

      return matchBusca && matchTipo;
    });
  }, [itensConhecimento, buscaConhecimento, filtroTipoConhecimento]);

  // ==========================================
  // HELPERS DO COFRE
  // ==========================================
  const toggleTitularExpandido = (titId: string) => {
    setTitularesExpandidos((prev) => ({
      ...prev,
      [titId]: prev[titId] === undefined ? false : !prev[titId],
    }));
  };

  const isTitularAberto = (titId: string) => titularesExpandidos[titId] !== false;

  const docPertenceAoTitular = (doc: DocumentoRegistro, tit: FichaTitular): boolean => {
    // 1. Vinculação prioritária e canônica pelo ID do cadastro (pessoa_id)
    const pId = doc.pessoaId || doc.pessoa_id;
    if (pId) {
      return pId === tit.id;
    }
    if (!doc.titular) return false;
    const dTit = doc.titular.toLowerCase().trim();
    const tNome = tit.nome.toLowerCase().trim();
    if (dTit === tNome || doc.titular === tit.id) return true;
    const primeiroNomeTit = tNome.split(' ')[0];
    if (primeiroNomeTit.length >= 3 && dTit.includes(primeiroNomeTit)) return true;
    return false;
  };

  const isDocumentoEmpresa = (doc: DocumentoRegistro): boolean => {
    if (!doc.titular || !doc.titular.trim()) return true;
    const t = doc.titular.toLowerCase().trim();
    if (t.includes('delta') || t.includes('empresa') || t.includes('geral') || t === 'corporativo') {
      return true;
    }
    return !titulares.some((tit) => docPertenceAoTitular(doc, tit));
  };

  const tiposDocumentosDisponiveis = useMemo(() => {
    const tipos = new Set<string>();
    tipos.add('Contrato');
    tipos.add('Financeiro');
    tipos.add('Documento Pessoal');
    tipos.add('Normativo');
    tipos.add('Proposta');
    tipos.add('Outros');
    documentos.forEach((d) => {
      if (d.tipo && d.tipo.trim()) tipos.add(d.tipo.trim());
    });
    return Array.from(tipos);
  }, [documentos]);

  const documentosFiltrados = useMemo(() => {
    return documentos.filter((doc) => {
      const termo = buscaDocumentos.toLowerCase().trim();
      const matchBusca =
        !termo ||
        doc.titulo.toLowerCase().includes(termo) ||
        (doc.tipo && doc.tipo.toLowerCase().includes(termo)) ||
        (doc.titular && doc.titular.toLowerCase().includes(termo)) ||
        (doc.descricao && doc.descricao.toLowerCase().includes(termo)) ||
        doc.apelidos?.some((ap) => ap.toLowerCase().includes(termo));

      let matchTitular = true;
      if (filtroTitularDoc === 'empresa') {
        matchTitular = isDocumentoEmpresa(doc);
      } else if (filtroTitularDoc !== 'todos') {
        const titAlvo = titulares.find((t) => t.id === filtroTitularDoc);
        matchTitular = titAlvo ? docPertenceAoTitular(doc, titAlvo) : false;
      }

      const matchTipo =
        filtroTipoDoc === 'todos' ||
        (doc.tipo && doc.tipo.toLowerCase() === filtroTipoDoc.toLowerCase());

      const sitValidade = obterSituacaoValidade(doc.dataValidade);
      let matchValidade = true;
      if (filtroValidadeDoc === 'validos') matchValidade = sitValidade === 'valido';
      else if (filtroValidadeDoc === 'vencendo') matchValidade = sitValidade === 'vencendo';
      else if (filtroValidadeDoc === 'vencidos') matchValidade = sitValidade === 'vencido';
      else if (filtroValidadeDoc === 'sem_validade') matchValidade = sitValidade === 'sem_validade';

      return matchBusca && matchTitular && matchTipo && matchValidade;
    });
  }, [documentos, buscaDocumentos, filtroTitularDoc, filtroTipoDoc, filtroValidadeDoc, titulares]);

  const titularesFiltrados = useMemo(() => {
    if (filtroTitularDoc === 'empresa') return [];
    return titulares
      .filter((tit) => {
        if (filtroTitularDoc !== 'todos' && tit.id !== filtroTitularDoc) return false;
        const termo = buscaDocumentos.toLowerCase().trim();
        if (!termo) return true;
        return tit.nome.toLowerCase().includes(termo) || documentosFiltrados.some((d) => docPertenceAoTitular(d, tit));
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }, [titulares, filtroTitularDoc, buscaDocumentos, documentosFiltrados]);

  const documentosEmpresaFiltrados = useMemo(() => {
    if (filtroTitularDoc !== 'todos' && filtroTitularDoc !== 'empresa') return [];
    return documentosFiltrados.filter((d) => isDocumentoEmpresa(d));
  }, [documentosFiltrados, filtroTitularDoc]);

  // ==========================================
  // RENDERIZADOR DO SELO DE VALIDADE
  // ==========================================
  const renderSeloValidade = (dataValidadeStr?: string | null) => {
    if (!dataValidadeStr || !dataValidadeStr.trim()) {
      return (
        <span className="text-[10px] text-slate-500 font-medium px-2 py-0.5 rounded bg-[#18202b] border border-[#202937]">
          Sem validade
        </span>
      );
    }

    const situacao = obterSituacaoValidade(dataValidadeStr);

    if (situacao === 'vencido') {
      return (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1"
          title={`Vencido em ${dataValidadeStr}`}
        >
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          <span>Vencido ({dataValidadeStr})</span>
        </span>
      );
    }

    if (situacao === 'vencendo') {
      return (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1"
          title={`Vence em breve (${dataValidadeStr})`}
        >
          <Clock className="w-3 h-3 text-amber-400" />
          <span>Vence em breve ({dataValidadeStr})</span>
        </span>
      );
    }

    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 flex items-center gap-1"
        title={`Válido até ${dataValidadeStr}`}
      >
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        <span>Válido até {dataValidadeStr}</span>
      </span>
    );
  };

  // ==========================================
  // RENDERIZADOR DE ITEM COMPACTO DO COFRE
  // ==========================================
  const renderItemDocumentoCompacto = (doc: DocumentoRegistro) => {
    const isPdf = doc.arquivo.toLowerCase().endsWith('.pdf');
    const isImg = /\.(png|jpe?g|webp)$/i.test(doc.arquivo);
    const dataFormatada = formatarDataBrasilia(doc.dataCadastro);

    return (
      <div
        key={doc.id}
        className="group p-3 bg-[#121820] hover:bg-[#161e29] border border-[#202937] hover:border-[#2d3a4f] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0">
            {isPdf ? (
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shadow-sm">
                <FileText className="w-4 h-4" />
              </div>
            ) : isImg ? (
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 overflow-hidden flex items-center justify-center text-sky-400 relative shadow-sm">
                <img
                  src={`/arquivos/${encodeURIComponent(doc.arquivo)}`}
                  alt={doc.titulo}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                <ImageIcon className="w-4 h-4 pointer-events-none absolute" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-sm">
                <FileText className="w-4 h-4" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-semibold text-slate-100 truncate max-w-sm sm:max-w-md">
                {doc.titulo}
              </h4>
              {doc.tipo && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[#18202b] text-slate-300 border border-[#202937]">
                  {doc.tipo}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 mt-1 text-[11px] text-slate-400 flex-wrap">
              <span className="truncate max-w-[200px]" title={doc.arquivo}>
                {doc.arquivo}
              </span>
              <span>•</span>
              <span>Enviado em {dataFormatada}</span>
              {doc.silenciarAlertas && (
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <BellOff className="w-3 h-3 text-amber-400" />
                  <span>Silenciado</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2.5 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#202937]/50">
          {/* Selos de Status de Indexação (Processando, Indexado, Erro) */}
          {doc.statusIndexacao === 'processando' && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center gap-1.5 animate-pulse"
              title="A IA está analisando metadados e indexando o documento em segundo plano."
            >
              <Loader2 className="w-3 h-3 text-sky-400 animate-spin" />
              <span>Processando</span>
            </span>
          )}

          {doc.statusIndexacao === 'indexado' && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1"
              title="Documento totalmente indexado e pronto para consultas da VEGA."
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Indexado</span>
            </span>
          )}

          {doc.statusIndexacao === 'erro' && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 cursor-help"
              title={doc.erroIndexacao || 'Falha no processamento deste documento.'}
            >
              <AlertCircle className="w-3 h-3 text-rose-400" />
              <span>Erro</span>
            </span>
          )}

          {doc.statusIndexacao === 'protegido_senha' && (
            <button
              onClick={() => abrirModalDestravar(doc)}
              className="px-2.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele. Clique para informar a senha e destravar a leitura com IA."
            >
              <Lock className="w-3 h-3 text-amber-400" />
              <span>Protegido por senha</span>
            </button>
          )}

          {renderSeloValidade(doc.dataValidade)}

          <div className="flex items-center gap-1">
            {doc.statusIndexacao === 'protegido_senha' && (
              <button
                onClick={() => abrirModalDestravar(doc)}
                className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 transition-colors cursor-pointer"
                title="Informar senha para destravar leitura com IA"
              >
                <KeyRound className="w-3.5 h-3.5" />
              </button>
            )}

            <a
              href={`/arquivos/${encodeURIComponent((doc.arquivo || '').trim())}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 border border-[#202937] transition-colors"
              title="Visualizar documento em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              onClick={() => handleExcluirDoc(doc.id, doc.titulo)}
              className="p-1.5 rounded-lg bg-[#18202b] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#202937] hover:border-rose-500/30 transition-colors cursor-pointer"
              title="Excluir documento do cofre"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-full bg-[#0b0f14] overflow-y-auto p-6 text-slate-100">
      <div className="max-w-7xl mx-auto space-y-6 pb-16 w-full">
        {/* CABEÇALHO */}
        <div className="border-b border-[#1e2633] pb-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
              <Brain className="w-5 h-5" />
            </div>
            <h1 className="text-base font-semibold text-slate-100">
              Base da {ASSISTENTE.nome}
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Documentos e regras que a VEGA usa para responder
          </p>
        </div>

        {/* ABAS SUBLINHADAS ALINHADAS À ESQUERDA */}
        <div className="flex items-center gap-6 border-b border-[#202937] pt-1">
          <button
            onClick={() => setSubAba('documentos')}
            className={`flex items-center gap-2 pb-3 text-xs sm:text-sm font-medium transition-all relative cursor-pointer ${
              subAba === 'documentos'
                ? 'text-emerald-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderLock className="w-4 h-4" />
            <span>Cofre de Documentos</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-bold ml-1 ${
                subAba === 'documentos'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-[#18202b] text-slate-400 border border-[#202937]'
              }`}
            >
              {carregandoDocs ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : documentos.length}
            </span>
            {subAba === 'documentos' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>

          <button
            onClick={() => setSubAba('conhecimento')}
            className={`flex items-center gap-2 pb-3 text-xs sm:text-sm font-medium transition-all relative cursor-pointer ${
              subAba === 'conhecimento'
                ? 'text-emerald-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Conhecimento & Regras</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-bold ml-1 ${
                subAba === 'conhecimento'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-[#18202b] text-slate-400 border border-[#202937]'
              }`}
            >
              {carregandoConhecimento ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : itensConhecimento.length}
            </span>
            {subAba === 'conhecimento' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>

          <button
            onClick={() => setSubAba('faltantes')}
            className={`flex items-center gap-2 pb-3 text-xs sm:text-sm font-medium transition-all relative cursor-pointer ${
              subAba === 'faltantes'
                ? 'text-amber-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileQuestion className="w-4 h-4" />
            <span>Documentos Faltantes</span>
            {totalFaltantesPendentes > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold ml-1 bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {totalFaltantesPendentes}
              </span>
            )}
            {subAba === 'faltantes' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
            )}
          </button>

          <button
            onClick={() => setSubAba('sugestoes')}
            className={`flex items-center gap-2 pb-3 text-xs sm:text-sm font-medium transition-all relative cursor-pointer ${
              subAba === 'sugestoes'
                ? 'text-emerald-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Sugestões de Documentos</span>
            {subAba === 'sugestoes' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>
        </div>

        {/* ========================================================================= */}
        {/* ABA 1: COFRE DE DOCUMENTOS (UPLOAD SEM FRICÇÃO)                           */}
        {/* ========================================================================= */}
        {subAba === 'documentos' && (
          <div className="space-y-5 animate-fadeIn">
            {totalFaltantesPendentes > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl text-xs flex items-center justify-between gap-2 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <FileQuestion className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    Existem <strong>{totalFaltantesPendentes} {totalFaltantesPendentes === 1 ? 'documento faltante pedido' : 'documentos faltantes pedidos'}</strong> por usuários que ainda não estão no Cofre.
                  </span>
                </div>
                <button
                  onClick={() => setSubAba('faltantes')}
                  className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold rounded-lg border border-amber-500/40 transition-colors cursor-pointer"
                >
                  Ver Lista de Faltantes →
                </button>
              </div>
            )}

            {erroUpload && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{erroUpload}</span>
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  processarArquivoSemFriccao(e.target.files[0]);
                  e.target.value = '';
                }
              }}
              accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
              className="hidden"
            />

            {/* ÁREA DE UPLOAD COM ARRASTAR E SOLTAR */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setArrastandoArquivo(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setArrastandoArquivo(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setArrastandoArquivo(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  processarArquivoSemFriccao(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-6 rounded-xl border border-dashed transition-all text-center cursor-pointer flex flex-col items-center justify-center gap-2 ${
                arrastandoArquivo
                  ? 'bg-emerald-500/10 border-emerald-500/60 scale-[1.005]'
                  : 'bg-[#121820]/70 hover:bg-[#121820] border-[#202937] hover:border-[#2d3a4f]'
              }`}
            >
              {uploadandoDireto ? (
                <div className="flex flex-col items-center gap-2 py-2 text-emerald-400">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <p className="text-xs font-semibold text-slate-100">
                    A IA está analisando e salvando seu documento...
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Extraindo tipo, titular e salvando direto no cofre
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-sm">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      Arraste e solte o arquivo aqui ou{' '}
                      <span className="text-emerald-400 font-semibold underline underline-offset-2">
                        clique para selecionar
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      PDF, PNG, JPG, JPEG ou WEBP (salvamento automático com IA)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* NOTIFICAÇÃO DISCRETA PÓS-UPLOAD OU PERGUNTA DA IA */}
            {uploadRecente && (
              <div
                className={`p-3.5 bg-[#121820] border rounded-xl space-y-3 animate-fadeIn shadow-sm ${
                  uploadRecente.precisaPerguntar
                    ? 'border-amber-500/50 bg-[#141a23]'
                    : 'border-emerald-500/40'
                }`}
              >
                <div className="flex items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    {uploadRecente.precisaPerguntar ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                    <div className="text-slate-200">
                      {uploadRecente.precisaPerguntar ? (
                        <span>
                          {uploadRecente.novoTitularSugerido && uploadRecente.nomeNoDocumento ? (
                            <>
                              Identifiquei o nome{' '}
                              <strong className="text-amber-300">
                                "{uploadRecente.nomeNoDocumento}"
                              </strong>{' '}
                              no documento. Deseja cadastrar como um novo titular ou vincular a um
                              existente?
                            </>
                          ) : (
                            <>
                              Documento salvo no cofre. A IA precisa que você confirme:{' '}
                              <strong className="text-amber-300">
                                {uploadRecente.camposFaltantes.join(', ')}
                              </strong>
                              .
                            </>
                          )}
                        </span>
                      ) : (
                        <span>
                          Salvo como <strong className="text-emerald-400">{uploadRecente.tipo}</strong>{' '}
                          de <strong className="text-slate-100">{uploadRecente.titular}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {!uploadRecente.precisaPerguntar && (
                      <button
                        onClick={() => setExibirCorrecaoRapida(!exibirCorrecaoRapida)}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline underline-offset-2 cursor-pointer"
                      >
                        {exibirCorrecaoRapida ? 'fechar' : 'corrigir'}
                      </button>
                    )}
                    <button
                      onClick={() => setUploadRecente(null)}
                      className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer"
                      title="Dispensar aviso"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* PAINEL DE PERGUNTA / CORREÇÃO RÁPIDA */}
                {(exibirCorrecaoRapida || uploadRecente.precisaPerguntar) && (
                  <div className="pt-3 border-t border-[#202937] space-y-3 text-xs animate-fadeIn">
                    {uploadRecente.novoTitularSugerido && uploadRecente.nomeNoDocumento && (
                      <div className="flex flex-wrap items-center gap-2 bg-[#18202b] p-2.5 rounded-lg border border-[#202937]">
                        <span className="text-slate-300 text-[11px]">Sugestão rápida:</span>
                        <button
                          type="button"
                          onClick={() => setCorrecaoTitular(uploadRecente.nomeNoDocumento || '')}
                          className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          + Cadastrar "{uploadRecente.nomeNoDocumento}"
                        </button>
                        {titulares.map((tit) => (
                          <button
                            key={tit.id}
                            type="button"
                            onClick={() => setCorrecaoTitular(tit.nome)}
                            className="px-2 py-1 bg-[#121820] hover:bg-[#202937] text-slate-300 border border-[#202937] rounded text-[11px] transition-colors cursor-pointer"
                          >
                            Vincular a {tit.nome}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      <div className="flex-1 w-full sm:w-auto">
                        <label className="block text-[10px] text-slate-400 font-medium mb-1">
                          Titular do Documento:
                        </label>
                        <input
                          type="text"
                          list="lista-titulares-sugestoes"
                          value={correcaoTitular}
                          onChange={(e) => setCorrecaoTitular(e.target.value)}
                          placeholder="Digite o nome do titular ou escolha da lista"
                          className="w-full px-2.5 py-1.5 bg-[#0b0f14] border border-[#202937] rounded-lg text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />
                        <datalist id="lista-titulares-sugestoes">
                          {titulares.map((tit) => (
                            <option key={tit.id} value={tit.nome} />
                          ))}
                          <option value="Delta Plan" />
                        </datalist>
                      </div>

                      <div className="flex-1 w-full sm:w-auto">
                        <label className="block text-[10px] text-slate-400 font-medium mb-1">
                          Tipo de Documento:
                        </label>
                        <input
                          type="text"
                          list="lista-tipos-sugestoes"
                          value={correcaoTipo}
                          onChange={(e) => setCorrecaoTipo(e.target.value)}
                          placeholder="Ex: Passaporte, CNH, RG, Contrato Social..."
                          className="w-full px-2.5 py-1.5 bg-[#0b0f14] border border-[#202937] rounded-lg text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />
                        <datalist id="lista-tipos-sugestoes">
                          <option value="Passaporte" />
                          <option value="CNH" />
                          <option value="RG" />
                          <option value="Título de Eleitor" />
                          <option value="Certidão de Nascimento" />
                          <option value="Certidão de Casamento" />
                          <option value="Contrato Social" />
                          <option value="Alvará de Funcionamento" />
                          <option value="Cartão CNPJ" />
                          <option value="Nota Fiscal" />
                          <option value="ART" />
                          <option value="CRT" />
                          <option value="Procuração" />
                          <option value="Comprovante de Endereço" />
                          <option value="Financeiro" />
                          <option value="Normativo" />
                        </datalist>
                      </div>

                      <div className="self-end sm:self-auto pt-2 sm:pt-4">
                        <button
                          onClick={handleSalvarCorrecaoRapida}
                          disabled={salvandoCorrecao}
                          className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg text-xs flex items-center gap-1 shadow cursor-pointer disabled:opacity-50"
                        >
                          {salvandoCorrecao ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          <span>Salvar confirmação</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* FILTROS E BUSCA DO COFRE */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por nome, titular, tipo ou palavra-chave..."
                  value={buscaDocumentos}
                  onChange={(e) => setBuscaDocumentos(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[#121820] border border-[#202937] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-[#121820] border border-[#202937] rounded-lg px-2.5 py-1.5 text-xs">
                  <Filter className="w-3 h-3 text-slate-400" />
                  <select
                    value={filtroTitularDoc}
                    onChange={(e) => setFiltroTitularDoc(e.target.value)}
                    className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="todos" className="bg-[#121820] text-slate-200">
                      Todos os Titulares
                    </option>
                    <option value="empresa" className="bg-[#121820] text-slate-200">
                      Documentos da Empresa
                    </option>
                    {titulares.map((tit) => (
                      <option key={tit.id} value={tit.id} className="bg-[#121820] text-slate-200">
                        {tit.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 bg-[#121820] border border-[#202937] rounded-lg px-2.5 py-1.5 text-xs">
                  <select
                    value={filtroTipoDoc}
                    onChange={(e) => setFiltroTipoDoc(e.target.value)}
                    className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="todos" className="bg-[#121820] text-slate-200">
                      Todos os Tipos
                    </option>
                    {tiposDocumentosDisponiveis.map((t) => (
                      <option key={t} value={t} className="bg-[#121820] text-slate-200">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 bg-[#121820] border border-[#202937] rounded-lg px-2.5 py-1.5 text-xs">
                  <select
                    value={filtroValidadeDoc}
                    onChange={(e) => setFiltroValidadeDoc(e.target.value)}
                    className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="todas" className="bg-[#121820] text-slate-200">
                      Todas as Validades
                    </option>
                    <option value="validos" className="bg-[#121820] text-slate-200">
                      Válidos
                    </option>
                    <option value="vencendo" className="bg-[#121820] text-slate-200">
                      Vencendo em breve
                    </option>
                    <option value="vencidos" className="bg-[#121820] text-slate-200">
                      Vencidos
                    </option>
                    <option value="sem_validade" className="bg-[#121820] text-slate-200">
                      Sem validade
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {/* LISTAGEM DOS DOCUMENTOS */}
            {carregandoDocs || carregandoTitulares ? (
              <div className="p-12 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-xl flex flex-col items-center justify-center gap-2.5 shadow-sm">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                <span className="font-medium text-slate-200">Carregando documentos do cofre...</span>
              </div>
            ) : documentos.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-xl flex flex-col items-center justify-center gap-2">
                <FolderLock className="w-8 h-8 text-slate-500 mb-1" />
                <span className="font-semibold text-slate-200 text-sm">Nenhum documento no Cofre</span>
                <span className="text-slate-400 max-w-sm">
                  Arraste seus arquivos acima para salvá-los automaticamente.
                </span>
              </div>
            ) : (
              <div className="space-y-6">
                {documentosEmpresaFiltrados.length > 0 && (
                  <div className="bg-[#121820] border border-[#202937] rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-[#202937] pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-xs sm:text-sm text-slate-100">
                            Documentos da Empresa (Delta Plan)
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            Contratos corporativos, normas e arquivos institucionais
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 font-medium px-2 py-0.5 rounded-full bg-[#18202b] border border-[#202937]">
                        {documentosEmpresaFiltrados.length} doc(s)
                      </span>
                    </div>

                    <div className="space-y-2">
                      {documentosEmpresaFiltrados.map((doc) => renderItemDocumentoCompacto(doc))}
                    </div>
                  </div>
                )}

                {titularesFiltrados.map((tit) => {
                  const docsDoTitular = documentosFiltrados.filter((d) => docPertenceAoTitular(d, tit));
                  const aberto = isTitularAberto(tit.id);
                  const paleta = obterPaletaAvatar(tit.nome);
                  const iniciais = obterIniciais(tit.nome);

                  return (
                    <div
                      key={tit.id}
                      className="bg-[#121820] border border-[#202937] rounded-xl overflow-hidden shadow-sm transition-all"
                    >
                      <div
                        onClick={() => toggleTitularExpandido(tit.id)}
                        className="p-3.5 sm:p-4 bg-[#121820] hover:bg-[#161e29] border-b border-[#202937]/70 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm"
                            style={{
                              backgroundColor: paleta.bg,
                              color: paleta.text,
                              border: `1px solid ${paleta.border}`,
                            }}
                          >
                            {iniciais}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-xs sm:text-sm text-slate-100 truncate">
                                {tit.nome}
                              </h3>
                              <span className="text-[10px] text-slate-400 px-2 py-0.5 rounded-full bg-[#18202b] border border-[#202937]">
                                {docsDoTitular.length} documento(s)
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleTitularExpandido(tit.id)}
                            className="p-1.5 bg-[#18202b] hover:bg-[#202937] text-slate-300 rounded-lg border border-[#202937] transition-colors cursor-pointer"
                          >
                            {aberto ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {aberto && (
                        <div className="p-4 space-y-2.5 animate-fadeIn bg-[#0e131a]/40">
                          {docsDoTitular.length === 0 ? (
                            <div className="p-5 text-center text-xs text-slate-500 border border-dashed border-[#202937] rounded-lg">
                              Nenhum documento vinculado a este titular até o momento.
                            </div>
                          ) : (
                            docsDoTitular.map((doc) => renderItemDocumentoCompacto(doc))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* ABA 2: CONHECIMENTO & REGRAS (ENTRADA ÚNICA COM IA + ITENS ESTRUTURADOS) */}
        {/* ========================================================================= */}
        {subAba === 'conhecimento' && (
          <div className="space-y-6 animate-fadeIn">
            {mensagemSucessoConhecimento && (
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs flex items-center gap-2 animate-fadeIn">
                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{mensagemSucessoConhecimento}</span>
              </div>
            )}

            {/* ENTRADA ÚNICA: "O QUE A VEGA PRECISA SABER?" */}
            <div className="p-5 bg-[#121820] border border-[#202937] rounded-xl space-y-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <label className="text-xs sm:text-sm font-semibold text-slate-100">
                    O que a VEGA precisa saber?
                  </label>
                </div>
                <span className="text-[11px] text-slate-400">
                  Aceita linguagem natural ou colagem de planilhas Excel
                </span>
              </div>

              <textarea
                rows={3}
                value={textoEntradaUnica}
                onChange={(e) => {
                  setTextoEntradaUnica(e.target.value);
                  setErroEstruturacao('');
                }}
                placeholder="Exemplos:&#10;• 'A chave PIX da Delta Plan é o CNPJ 12.345.678/0001-90 no Banco Santander'&#10;• 'Para acessar o sistema de orçamentos use https://orcamentos.deltaplan.com.br'&#10;• 'Carlos Silva é do suporte técnico, telefone (14) 99888-7766' ou cole linhas de tabelas..."
                className="w-full px-3.5 py-2.5 bg-[#0b0f14] border border-[#202937] rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none resize-none leading-relaxed"
              />

              {erroEstruturacao && (
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                  <span>{erroEstruturacao}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  A IA identifica o tipo (PIX, Link, Contato ou Regra) e sugere os campos em linha.
                </span>

                <button
                  type="button"
                  onClick={handleEstruturarComIA}
                  disabled={estruturandoComIA || !textoEntradaUnica.trim()}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg shadow flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {estruturandoComIA ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{estruturandoComIA ? 'Estruturando com IA...' : 'Estruturar com IA'}</span>
                </button>
              </div>
            </div>

            {/* PRÉVIA DOS ITENS ESTRUTURADOS PELA IA (PARA CONFERÊNCIA EM LINHA) */}
            {itensSugeridosIA.length > 0 && (
              <div className="p-5 bg-[#121820] border border-emerald-500/40 rounded-xl space-y-4 animate-fadeIn shadow-lg">
                <div className="flex items-center justify-between border-b border-[#202937] pb-3">
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-100">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>
                      {itensSugeridosIA.length === 1
                        ? '1 item identificado pela IA (confira antes de salvar):'
                        : `${itensSugeridosIA.length} itens identificados pela IA (confira antes de salvar):`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {itensSugeridosIA.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSalvarTodosSugeridos}
                        disabled={salvandoItensSugeridos}
                        className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        <span>Salvar todos</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setItensSugeridosIA([])}
                      className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                    >
                      Descartar
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {itensSugeridosIA.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3.5 bg-[#0b0f14] border border-[#202937] rounded-xl space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                              item.tipo === 'pix'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : item.tipo === 'link'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : item.tipo === 'contato'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : 'bg-[#18202b] text-slate-300 border border-[#202937]'
                            }`}
                          >
                            {item.tipo === 'pix'
                              ? 'Chave PIX'
                              : item.tipo === 'link'
                              ? 'Link'
                              : item.tipo === 'contato'
                              ? 'Contato'
                              : 'Regra'}
                          </span>
                          <span className="text-xs font-semibold text-slate-100">
                            {item.titulo}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSalvarItemSugerido(item)}
                            disabled={salvandoItensSugeridos}
                            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1 shadow cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />
                            <span>Confirmar e Salvar</span>
                          </button>
                        </div>
                      </div>

                      {/* CAMPOS ESPECÍFICOS DO TIPO PARA AJUSTE INLINE */}
                      {item.tipo === 'pix' && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">
                              Titular:
                            </label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosPix)?.titular || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, titular: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">
                              Tipo da Chave:
                            </label>
                            <select
                              value={(item.dadosEstruturados as DadosPix)?.tipoChave || 'CNPJ'}
                              onChange={(e) => {
                                const val = e.target.value as any;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, tipoChave: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            >
                              <option value="CNPJ">CNPJ</option>
                              <option value="CPF">CPF</option>
                              <option value="Celular">Celular</option>
                              <option value="E-mail">E-mail</option>
                              <option value="Aleatória">Aleatória</option>
                            </select>
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Chave:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosPix)?.chave || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, chave: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-emerald-400 font-mono focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Banco:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosPix)?.banco || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, banco: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.tipo === 'link' && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">
                              Nome do Sistema:
                            </label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosLink)?.nomeSistema || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, nomeSistema: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">URL / Link:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosLink)?.link || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, link: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-sky-400 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">
                              Finalidade:
                            </label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosLink)?.finalidade || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, finalidade: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.tipo === 'contato' && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Nome:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosContato)?.nome || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, nome: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Função:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosContato)?.funcao || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, funcao: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">
                              Telefone:
                            </label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosContato)?.telefone || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, telefone: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">E-mail:</label>
                            <input
                              type="text"
                              value={(item.dadosEstruturados as DadosContato)?.email || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setItensSugeridosIA((prev) =>
                                  prev.map((i, ix) =>
                                    ix === idx
                                      ? {
                                          ...i,
                                          dadosEstruturados: { ...i.dadosEstruturados, email: val },
                                        }
                                      : i
                                  )
                                );
                              }}
                              className="w-full px-2 py-1 bg-[#121820] border border-[#202937] rounded text-slate-100 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {(!item.tipo || item.tipo === 'regra') && (
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">
                            Conteúdo da Regra:
                          </label>
                          <textarea
                            rows={2}
                            value={item.conteudo}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItensSugeridosIA((prev) =>
                                prev.map((i, ix) => (ix === idx ? { ...i, conteudo: val } : i))
                              );
                            }}
                            className="w-full px-2.5 py-1.5 bg-[#121820] border border-[#202937] rounded text-slate-100 text-xs focus:outline-none resize-none"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FILTROS POR TIPO E BUSCA NA LISTA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              {/* Chips de Filtro por Tipo */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFiltroTipoConhecimento('todos')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    filtroTipoConhecimento === 'todos'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-[#121820] hover:bg-[#18202b] text-slate-300 border border-[#202937]'
                  }`}
                >
                  Todos ({contadoresTipo.todos})
                </button>

                <button
                  type="button"
                  onClick={() => setFiltroTipoConhecimento('pix')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    filtroTipoConhecimento === 'pix'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-[#121820] hover:bg-[#18202b] text-slate-300 border border-[#202937]'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>PIX ({contadoresTipo.pix})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFiltroTipoConhecimento('link')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    filtroTipoConhecimento === 'link'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-[#121820] hover:bg-[#18202b] text-slate-300 border border-[#202937]'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Links ({contadoresTipo.link})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFiltroTipoConhecimento('contato')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    filtroTipoConhecimento === 'contato'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-[#121820] hover:bg-[#18202b] text-slate-300 border border-[#202937]'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Contatos ({contadoresTipo.contato})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFiltroTipoConhecimento('regra')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    filtroTipoConhecimento === 'regra'
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'bg-[#121820] hover:bg-[#18202b] text-slate-300 border border-[#202937]'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Regras ({contadoresTipo.regra})</span>
                </button>
              </div>

              {/* Campo de Busca Livre */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filtrar por texto..."
                  value={buscaConhecimento}
                  onChange={(e) => setBuscaConhecimento(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#121820] border border-[#202937] rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* LISTAGEM DOS ITENS COM EDIÇÃO EM LINHA */}
            {carregandoConhecimento ? (
              <div className="p-12 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-xl flex flex-col items-center justify-center gap-2.5 shadow-sm">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                <span className="font-medium text-slate-200">Carregando conhecimento da VEGA...</span>
              </div>
            ) : itensConhecimentoFiltrados.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-xs bg-[#121820] border border-[#202937] rounded-xl flex flex-col items-center justify-center gap-2">
                <BookOpen className="w-7 h-7 text-slate-500 mb-1" />
                <span className="font-semibold text-slate-200 text-sm">Nenhum item encontrado</span>
                <span className="text-slate-400">
                  Escreva na caixa acima para cadastrar chaves PIX, links, contatos ou regras.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {itensConhecimentoFiltrados.map((item) => {
                  const isEditando = idEditandoEmLinha === item.id;
                  const dPix = item.tipo === 'pix' ? (item.dadosEstruturados as DadosPix) : null;
                  const dLink = item.tipo === 'link' ? (item.dadosEstruturados as DadosLink) : null;
                  const dCt = item.tipo === 'contato' ? (item.dadosEstruturados as DadosContato) : null;

                  return (
                    <div
                      key={item.id}
                      className="group p-3.5 bg-[#121820] hover:bg-[#161e29] border border-[#202937] hover:border-[#2d3a4f] rounded-xl transition-all space-y-3"
                    >
                      {/* MODO EDIÇÃO EM LINHA */}
                      {isEditando && draftEdicaoLinha ? (
                        <div className="space-y-3 animate-fadeIn">
                          <div className="flex items-center justify-between gap-2 border-b border-[#202937] pb-2">
                            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Editando em linha: {item.titulo}</span>
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setIdEditandoEmLinha(null);
                                  setDraftEdicaoLinha(null);
                                }}
                                className="px-3 py-1 bg-[#18202b] hover:bg-[#202937] text-slate-300 rounded text-xs cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={handleSalvarEdicaoLinha}
                                disabled={salvandoEdicaoLinha}
                                className="px-3.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                {salvandoEdicaoLinha ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Save className="w-3 h-3" />
                                )}
                                <span>Salvar</span>
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                            <div className="sm:col-span-2">
                              <label className="text-[10px] text-slate-400 block mb-1">Título:</label>
                              <input
                                type="text"
                                value={draftEdicaoLinha.titulo}
                                onChange={(e) =>
                                  setDraftEdicaoLinha({ ...draftEdicaoLinha, titulo: e.target.value })
                                }
                                className="w-full px-2.5 py-1.5 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] text-slate-400 block mb-1">Categoria:</label>
                              <input
                                type="text"
                                value={draftEdicaoLinha.categoria}
                                onChange={(e) =>
                                  setDraftEdicaoLinha({
                                    ...draftEdicaoLinha,
                                    categoria: e.target.value,
                                  })
                                }
                                className="w-full px-2.5 py-1.5 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* CAMPOS ESPECÍFICOS DO TIPO EM EDIÇÃO */}
                          {draftEdicaoLinha.tipo === 'pix' && (
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs pt-1">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Titular:
                                </label>
                                <input
                                  type="text"
                                  value={(draftEdicaoLinha.dadosEstruturados as DadosPix)?.titular || ''}
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        titular: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Tipo da Chave:
                                </label>
                                <select
                                  value={
                                    (draftEdicaoLinha.dadosEstruturados as DadosPix)?.tipoChave || 'CNPJ'
                                  }
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        tipoChave: e.target.value as any,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                >
                                  <option value="CNPJ">CNPJ</option>
                                  <option value="CPF">CPF</option>
                                  <option value="Celular">Celular</option>
                                  <option value="E-mail">E-mail</option>
                                  <option value="Aleatória">Aleatória</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Chave:
                                </label>
                                <input
                                  type="text"
                                  value={(draftEdicaoLinha.dadosEstruturados as DadosPix)?.chave || ''}
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        chave: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-emerald-400 font-mono focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Banco:
                                </label>
                                <input
                                  type="text"
                                  value={(draftEdicaoLinha.dadosEstruturados as DadosPix)?.banco || ''}
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        banco: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}

                          {draftEdicaoLinha.tipo === 'link' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  URL / Link:
                                </label>
                                <input
                                  type="text"
                                  value={(draftEdicaoLinha.dadosEstruturados as DadosLink)?.link || ''}
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        link: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-sky-400 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Finalidade:
                                </label>
                                <input
                                  type="text"
                                  value={
                                    (draftEdicaoLinha.dadosEstruturados as DadosLink)?.finalidade || ''
                                  }
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        finalidade: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}

                          {draftEdicaoLinha.tipo === 'contato' && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Função / Cargo:
                                </label>
                                <input
                                  type="text"
                                  value={
                                    (draftEdicaoLinha.dadosEstruturados as DadosContato)?.funcao || ''
                                  }
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        funcao: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  Telefone:
                                </label>
                                <input
                                  type="text"
                                  value={
                                    (draftEdicaoLinha.dadosEstruturados as DadosContato)?.telefone || ''
                                  }
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        telefone: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">
                                  E-mail:
                                </label>
                                <input
                                  type="text"
                                  value={
                                    (draftEdicaoLinha.dadosEstruturados as DadosContato)?.email || ''
                                  }
                                  onChange={(e) =>
                                    setDraftEdicaoLinha({
                                      ...draftEdicaoLinha,
                                      dadosEstruturados: {
                                        ...draftEdicaoLinha.dadosEstruturados,
                                        email: e.target.value,
                                      },
                                    })
                                  }
                                  className="w-full px-2 py-1 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}

                          {(!draftEdicaoLinha.tipo || draftEdicaoLinha.tipo === 'regra') && (
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-1">
                                Conteúdo da Instrução / Regra:
                              </label>
                              <textarea
                                rows={3}
                                value={draftEdicaoLinha.conteudo}
                                onChange={(e) =>
                                  setDraftEdicaoLinha({
                                    ...draftEdicaoLinha,
                                    conteudo: e.target.value,
                                  })
                                }
                                className="w-full px-2.5 py-1.5 bg-[#0b0f14] border border-[#202937] rounded text-slate-100 text-xs focus:outline-none resize-none"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        /* MODO LEITURA COMPACTO */
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                            {/* Ícone por tipo */}
                            <div className="flex-shrink-0">
                              {item.tipo === 'pix' ? (
                                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-sm">
                                  <CreditCard className="w-4 h-4" />
                                </div>
                              ) : item.tipo === 'link' ? (
                                <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shadow-sm">
                                  <Globe className="w-4 h-4" />
                                </div>
                              ) : item.tipo === 'contato' ? (
                                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shadow-sm">
                                  <Phone className="w-4 h-4" />
                                </div>
                              ) : (
                                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-sm">
                                  <BookOpen className="w-4 h-4" />
                                </div>
                              )}
                            </div>

                            {/* Informações centrais */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-xs sm:text-sm font-semibold text-slate-100 truncate">
                                  {item.titulo}
                                </h4>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                                    item.tipo === 'pix'
                                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                      : item.tipo === 'link'
                                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                      : item.tipo === 'contato'
                                      ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                      : 'bg-[#18202b] text-slate-400 border border-[#202937]'
                                  }`}
                                >
                                  {item.tipo === 'pix'
                                    ? 'PIX'
                                    : item.tipo === 'link'
                                    ? 'Link'
                                    : item.tipo === 'contato'
                                    ? 'Contato'
                                    : item.categoria || 'Regra'}
                                </span>
                              </div>

                              {/* Linha detalhada por tipo */}
                              {item.tipo === 'pix' && dPix ? (
                                <div className="flex items-center gap-2 mt-1 text-xs text-slate-300 flex-wrap">
                                  <span className="font-mono bg-[#0b0f14] px-2 py-0.5 rounded border border-[#202937] text-emerald-400 select-all">
                                    {dPix.chave}
                                  </span>
                                  <button
                                    onClick={() => copiarChave(item.id, dPix.chave)}
                                    className="p-1 rounded bg-[#18202b] hover:bg-[#202937] text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                                    title="Copiar chave PIX"
                                  >
                                    {copiadoId === item.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span className="text-emerald-400 font-medium">Copiado</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Copiar</span>
                                      </>
                                    )}
                                  </button>
                                  {dPix.banco && <span>• Banco: {dPix.banco}</span>}
                                  {dPix.titular && <span>• Titular: {dPix.titular}</span>}
                                </div>
                              ) : item.tipo === 'link' && dLink ? (
                                <div className="flex items-center gap-2 mt-1 text-xs text-slate-300 flex-wrap">
                                  <a
                                    href={dLink.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sky-400 hover:text-sky-300 underline underline-offset-2 flex items-center gap-1"
                                  >
                                    <span>{dLink.link}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                  {dLink.finalidade && (
                                    <span className="text-slate-400">({dLink.finalidade})</span>
                                  )}
                                </div>
                              ) : item.tipo === 'contato' && dCt ? (
                                <div className="flex items-center gap-2.5 mt-1 text-xs text-slate-300 flex-wrap">
                                  {dCt.funcao && (
                                    <span className="text-slate-400">{dCt.funcao}</span>
                                  )}
                                  {dCt.telefone && (
                                    <span className="flex items-center gap-1 text-slate-300">
                                      <Phone className="w-3 h-3 text-purple-400" />
                                      <span>{dCt.telefone}</span>
                                    </span>
                                  )}
                                  {dCt.email && (
                                    <span className="flex items-center gap-1 text-slate-300">
                                      <Mail className="w-3 h-3 text-purple-400" />
                                      <span>{dCt.email}</span>
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400 truncate mt-1 max-w-xl">
                                  {item.conteudo}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Ações à direita */}
                          <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#202937]/50">
                            <span className="text-[11px] text-slate-500 whitespace-nowrap">
                              {formatarDataBrasilia(item.dataAtualizacao)}
                            </span>

                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleIniciarEdicaoLinha(item)}
                                className="p-1.5 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-300 hover:text-emerald-400 border border-[#202937] transition-colors cursor-pointer"
                                title="Editar em linha"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleExcluirConhecimento(item.id, item.titulo)}
                                className="p-1.5 rounded-lg bg-[#18202b] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-[#202937] hover:border-rose-500/30 transition-colors cursor-pointer"
                                title="Excluir item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* ABA 3: DOCUMENTOS FALTANTES                                               */}
        {/* ========================================================================= */}
        {subAba === 'faltantes' && (
          <div className="animate-fadeIn">
            <DocumentosFaltantesView onIrParaCofre={() => setSubAba('documentos')} />
          </div>
        )}

        {/* ========================================================================= */}
        {/* ABA 4: SUGESTÕES DE DOCUMENTOS (CHECKLIST DO COFRE)                       */}
        {/* ========================================================================= */}
        {subAba === 'sugestoes' && (
          <div className="animate-fadeIn">
            <SugestoesDocumentosView
              onDocumentoAdicionado={() => {
                carregarDocumentos(true);
                carregarTitulares();
                carregarTotalFaltantes();
              }}
            />
          </div>
        )}
      </div>

      {/* MODAL: DESTRAVAR PDF COM SENHA */}
      {docParaDestravar && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#121820] border border-[#202937] rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden">
            {/* Cabeçalho */}
            <div className="p-4 sm:p-5 border-b border-[#1e2633] flex items-center justify-between bg-[#18202b]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Destravar Leitura com Senha
                  </h2>
                  <p className="text-xs text-slate-400 truncate max-w-xs sm:max-w-sm">
                    {docParaDestravar.titulo}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={fecharModalDestravar}
                disabled={destravandoDoc}
                className="p-2 rounded-xl bg-[#121820] hover:bg-[#202937] text-slate-400 hover:text-slate-100 border border-[#263345] transition-colors cursor-pointer disabled:opacity-50"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo */}
            <form onSubmit={handleExecutarDestravar} className="p-5 space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed">
                Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Senha do Documento PDF
                </label>
                <div className="relative">
                  <input
                    type={mostrarSenhaDestravar ? 'text' : 'password'}
                    value={senhaDestravar}
                    onChange={(e) => {
                      setSenhaDestravar(e.target.value);
                      if (erroDestravar) setErroDestravar('');
                    }}
                    placeholder="Digite a senha do arquivo..."
                    autoFocus
                    disabled={destravandoDoc}
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-[#0d1219] border border-[#202937] text-slate-100 text-sm focus:outline-none focus:border-amber-500/60 transition-colors disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenhaDestravar(!mostrarSenhaDestravar)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    title={mostrarSenhaDestravar ? 'Ocultar senha' : 'Ver senha'}
                  >
                    {mostrarSenhaDestravar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Aviso de Privacidade e Segurança */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#0b0f14] border border-[#1e2633] text-[11px] text-slate-400 leading-normal">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-300 font-medium">Segurança e Privacidade:</strong> A senha será utilizada estritamente na memória para abrir e indexar o texto com a IA. Ela <strong className="text-amber-300 font-semibold">NÃO será armazenada</strong> em lugar nenhum (nem no banco de dados, nem em arquivos ou logs).
                </span>
              </div>

              {/* Erro */}
              {erroDestravar && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                  <span>{erroDestravar}</span>
                </div>
              )}

              {/* Sucesso */}
              {sucessoDestravar && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                  <span>{sucessoDestravar}</span>
                </div>
              )}

              {/* Ações */}
              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#1e2633]">
                <button
                  type="button"
                  onClick={fecharModalDestravar}
                  disabled={destravandoDoc}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-[#18202b] hover:bg-[#202937] border border-[#202937] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={destravandoDoc || !senhaDestravar.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-900 bg-amber-400 hover:bg-amber-300 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg shadow-amber-500/10"
                >
                  {destravandoDoc ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Destravando e lendo...</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Destravar e Ler com IA</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
