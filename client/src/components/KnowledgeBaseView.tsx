import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  Plus,
  Save,
  Trash2,
  FileText,
  Search,
  CheckCircle,
  Info,
  UploadCloud,
  FileUp,
  Shield,
  Edit3,
  X,
  Tag,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
  Building2,
  AlertCircle,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Edit,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  BellOff,
} from 'lucide-react';
import { ASSISTENTE } from '../config/assistente.js';
import {
  DocumentoRegistro,
  VisibilidadeDoc,
  AnaliseDocumentoResponse,
  FichaTitular,
} from '../types/chat.js';

interface ItemConhecimento {
  id: string;
  titulo: string;
  categoria: string;
  conteudo: string;
  dataAtualizacao: string;
}

const CONHECIMENTOS_INICIAIS: ItemConhecimento[] = [
  {
    id: 'k-1',
    titulo: 'Regra de Negócio: Proposta Comercial e Orçamentos',
    categoria: 'Comercial',
    conteudo:
      'Ao enviar propostas em PDF, destacar que os projetos de IA da Delta Plan possuem prazo médio de implantação de 10 a 15 dias úteis, com garantia de suporte técnico de 30 dias após o go-live.',
    dataAtualizacao: '14/09/2026',
  },
  {
    id: 'k-2',
    titulo: 'Política de Agendamento de Reuniões',
    categoria: 'Atendimento',
    conteudo:
      'Reuniões de diagnóstico são realizadas de segunda a sexta, das 09h às 18h. Nunca agendar no mesmo dia com menos de 2 horas de antecedência. Sempre solicitar o e-mail do lead para envio do convite do Google Meet.',
    dataAtualizacao: '12/09/2026',
  },
  {
    id: 'k-3',
    titulo: 'Dúvidas Frequentes sobre Segurança de Dados (LGPD)',
    categoria: 'Segurança',
    conteudo:
      'Informar aos clientes que nenhum dado sensível de conversas é utilizado para treinamento de modelos públicos. A Delta Plan segue rigorosamente a LGPD e utiliza servidores com criptografia de ponta a ponta.',
    dataAtualizacao: '10/09/2026',
  },
];

interface KnowledgeBaseViewProps {
  subAbaInicial?: 'conhecimento' | 'documentos';
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  subAbaInicial = 'conhecimento',
}) => {
  const [subAba, setSubAba] = useState<'conhecimento' | 'documentos'>(subAbaInicial);

  // ==========================================
  // ESTADOS DA SUB-ABA CONHECIMENTO (TEXTO)
  // ==========================================
  const [itensConhecimento, setItensConhecimento] = useState<ItemConhecimento[]>(CONHECIMENTOS_INICIAIS);
  const [buscaConhecimento, setBuscaConhecimento] = useState('');
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novaCategoria, setNovaCategoria] = useState('Geral');
  const [novoConteudo, setNovoConteudo] = useState('');
  const [exibirFormConhecimento, setExibirFormConhecimento] = useState(false);
  const [mensagemSucessoConhecimento, setMensagemSucessoConhecimento] = useState('');
  const [erroConhecimento, setErroConhecimento] = useState('');

  // Edição de item de Conhecimento existente
  const [itemEditandoConhecimento, setItemEditandoConhecimento] = useState<ItemConhecimento | null>(null);
  const [editTituloConhecimento, setEditTituloConhecimento] = useState('');
  const [editCategoriaConhecimento, setEditCategoriaConhecimento] = useState('Geral');
  const [editConteudoConhecimento, setEditConteudoConhecimento] = useState('');
  const [salvandoEdicaoConhecimento, setSalvandoEdicaoConhecimento] = useState(false);
  const [erroEdicaoConhecimento, setErroEdicaoConhecimento] = useState('');

  // ==========================================
  // ESTADOS DA SUB-ABA DOCUMENTOS (COFRE COM TITULARES)
  // ==========================================
  const [documentos, setDocumentos] = useState<DocumentoRegistro[]>([]);
  const [buscaDocumentos, setBuscaDocumentos] = useState('');
  const [carregandoDocs, setCarregandoDocs] = useState(false);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const [analisandoArquivo, setAnalisandoArquivo] = useState(false);
  const [erroUpload, setErroUpload] = useState('');
  const [mensagemSucessoDoc, setMensagemSucessoDoc] = useState('');

  // Titulares agrupados no cofre (fichas e documentos)
  const [titulares, setTitulares] = useState<FichaTitular[]>([]);
  const [titularesExpandidos, setTitularesExpandidos] = useState<Record<string, boolean>>({});
  const [mensagemSucessoTitular, setMensagemSucessoTitular] = useState('');

  // Card de confirmação de cadastro pós-análise com conferência de titular
  const [cardConfirmacao, setCardConfirmacao] = useState<{
    nomeArquivo: string;
    tamanhoFormatado: string;
    base64: string;
    titulo: string;
    tipo: string;
    titular: string;
    apelidos: string;
    visibilidade: VisibilidadeDoc;
    descricao: string;
    camposTitular?: Record<string, { valor: string; conferido: boolean }>;
    dataValidade?: string;
  } | null>(null);
  const [salvandoCadastro, setSalvandoCadastro] = useState(false);

  // Modal de edição de metadados de documento existente
  const [docEditando, setDocEditando] = useState<DocumentoRegistro | null>(null);
  const [editTitulo, setEditTitulo] = useState('');
  const [editTipo, setEditTipo] = useState('');
  const [editTitular, setEditTitular] = useState('');
  const [editDataValidade, setEditDataValidade] = useState('');
  const [editSilenciarAlertas, setEditSilenciarAlertas] = useState(false);
  const [editApelidos, setEditApelidos] = useState('');
  const [editVisibilidade, setEditVisibilidade] = useState<VisibilidadeDoc>('diretoria');
  const [editDescricao, setEditDescricao] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carrega itens da Base de Conhecimento do backend
  const carregarConhecimentos = async () => {
    try {
      const res = await fetch('/api/conhecimento');
      if (res.ok) {
        const dados = await res.json();
        if (Array.isArray(dados) && dados.length > 0) {
          setItensConhecimento(dados);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar base de conhecimento:', err);
    }
  };

  // Carrega titulares do backend
  const carregarTitulares = async () => {
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
    }
  };

  // Carrega documentos do backend
  const carregarDocumentos = async () => {
    setCarregandoDocs(true);
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
      setCarregandoDocs(false);
    }
  };

  useEffect(() => {
    carregarConhecimentos();
    carregarDocumentos();
    carregarTitulares();
  }, []);

  // Ajusta se subAbaInicial mudar externamente
  useEffect(() => {
    if (subAbaInicial) {
      setSubAba(subAbaInicial);
    }
  }, [subAbaInicial]);

  // ==========================================
  // HANDLERS DE CONHECIMENTO
  // ==========================================
  const normalizarTitulo = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');

  const itensFiltradosConhecimento = itensConhecimento.filter(
    (item) =>
      item.titulo.toLowerCase().includes(buscaConhecimento.toLowerCase()) ||
      item.conteudo.toLowerCase().includes(buscaConhecimento.toLowerCase()) ||
      item.categoria.toLowerCase().includes(buscaConhecimento.toLowerCase())
  );

  const handleSalvarNovoConhecimento = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroConhecimento('');
    if (!novoTitulo.trim() || !novoConteudo.trim()) return;

    // Validação de título duplicado na interface (ignorando maiúsculas e espaços)
    const tituloNorm = normalizarTitulo(novoTitulo);
    const duplicado = itensConhecimento.find(
      (item) => normalizarTitulo(item.titulo) === tituloNorm
    );
    if (duplicado) {
      setErroConhecimento(
        `Já existe uma instrução com o título "${duplicado.titulo}" na aba Conhecimento. Escolha um título único.`
      );
      return;
    }

    try {
      const res = await fetch('/api/conhecimento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: novoTitulo.trim(),
          categoria: novaCategoria,
          conteudo: novoConteudo.trim(),
        }),
      });

      if (res.ok) {
        const salvo = await res.json();
        setItensConhecimento((prev) => [salvo, ...prev]);
        setNovoTitulo('');
        setNovoConteudo('');
        setErroConhecimento('');
        setExibirFormConhecimento(false);
        setMensagemSucessoConhecimento('Novo conhecimento registrado com sucesso!');
        setTimeout(() => setMensagemSucessoConhecimento(''), 3000);
      } else {
        const erroJson = await res.json().catch(() => ({ erro: 'Erro ao cadastrar instrução' }));
        setErroConhecimento(erroJson.erro || 'Falha ao salvar instrução na base de conhecimento.');
      }
    } catch (erro) {
      console.error('Erro ao cadastrar conhecimento:', erro);
      setErroConhecimento('Erro de conexão ao salvar instrução.');
    }
  };

  const handleAbrirEdicaoConhecimento = (item: ItemConhecimento) => {
    setItemEditandoConhecimento(item);
    setEditTituloConhecimento(item.titulo);
    setEditCategoriaConhecimento(item.categoria);
    setEditConteudoConhecimento(item.conteudo);
    setErroEdicaoConhecimento('');
  };

  const handleSalvarEdicaoConhecimento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemEditandoConhecimento) return;
    setErroEdicaoConhecimento('');

    if (!editTituloConhecimento.trim() || !editConteudoConhecimento.trim()) {
      setErroEdicaoConhecimento('Título e conteúdo são obrigatórios.');
      return;
    }

    // Validação de duplicata de título na edição
    const tituloNorm = normalizarTitulo(editTituloConhecimento);
    const duplicado = itensConhecimento.find(
      (i) => i.id !== itemEditandoConhecimento.id && normalizarTitulo(i.titulo) === tituloNorm
    );
    if (duplicado) {
      setErroEdicaoConhecimento(
        `Já existe outra instrução com o título "${duplicado.titulo}" na aba Conhecimento. Escolha um título único.`
      );
      return;
    }

    setSalvandoEdicaoConhecimento(true);
    try {
      const res = await fetch(`/api/conhecimento/${itemEditandoConhecimento.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: editTituloConhecimento.trim(),
          categoria: editCategoriaConhecimento.trim(),
          conteudo: editConteudoConhecimento.trim(),
        }),
      });

      if (res.ok) {
        const atualizado = await res.json();
        setItensConhecimento((prev) =>
          prev.map((i) => (i.id === atualizado.id ? atualizado : i))
        );
        setItemEditandoConhecimento(null);
        setMensagemSucessoConhecimento(`Instrução "${atualizado.titulo}" atualizada com sucesso!`);
        setTimeout(() => setMensagemSucessoConhecimento(''), 3000);
      } else {
        const erroJson = await res.json().catch(() => ({ erro: 'Erro ao atualizar instrução' }));
        setErroEdicaoConhecimento(erroJson.erro || 'Falha ao atualizar instrução na base de conhecimento.');
      }
    } catch (erro) {
      console.error('Erro ao editar conhecimento:', erro);
      setErroEdicaoConhecimento('Erro de conexão ao atualizar instrução.');
    } finally {
      setSalvandoEdicaoConhecimento(false);
    }
  };

  const handleExcluirConhecimento = async (id: string) => {
    try {
      const res = await fetch(`/api/conhecimento/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItensConhecimento((prev) => prev.filter((i) => i.id !== id));
      }
    } catch (erro) {
      console.error('Erro ao excluir conhecimento:', erro);
    }
  };

  // ==========================================
  // HELPERS DE TITULARES NO COFRE
  // ==========================================
  const toggleTitularExpandido = (titId: string) => {
    setTitularesExpandidos((prev) => ({
      ...prev,
      [titId]: prev[titId] === undefined ? false : !prev[titId],
    }));
  };

  const isTitularAberto = (titId: string) => {
    return titularesExpandidos[titId] !== false; // Aberto por padrão
  };

  const docPertenceAoTitular = (doc: DocumentoRegistro, tit: FichaTitular): boolean => {
    if (!doc.titular) return false;
    const dTit = doc.titular.toLowerCase().trim();
    const tNome = tit.nome.toLowerCase().trim();
    if (dTit === tNome) return true;
    if (doc.titular === tit.id) return true;
    const primeiroNomeTit = tNome.split(' ')[0];
    if (primeiroNomeTit.length >= 3 && dTit.includes(primeiroNomeTit)) return true;
    return false;
  };

  // ==========================================
  // HANDLERS DE DOCUMENTOS (DRAG & DROP E ANÁLISE)
  // ==========================================
  const processarArquivo = async (file: File) => {
    setErroUpload('');

    // Limite de 50MB
    const LIMITE_BYTES = 50 * 1024 * 1024;
    if (file.size > LIMITE_BYTES) {
      setErroUpload('O arquivo excede o limite máximo permitido de 50MB.');
      return;
    }

    // Aceita apenas PDF ou imagem
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg = file.type.startsWith('image/');
    if (!isPdf && !isImg) {
      setErroUpload('Formato não suportado. Por favor envie arquivos PDF ou imagens (.png, .jpg, .webp).');
      return;
    }

    setAnalisandoArquivo(true);
    const tamanhoFormatado = `${(file.size / 1024).toFixed(1)} KB`;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;

      try {
        // Chama /api/documentos/analisar
        const res = await fetch('/api/documentos/analisar', {
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
          const analise: AnaliseDocumentoResponse = await res.json();
          const camposTit: Record<string, { valor: string; conferido: boolean }> = {};
          if (analise.camposSugeridosTitular) {
            for (const [k, v] of Object.entries(analise.camposSugeridosTitular)) {
              if (v) {
                camposTit[k] = { valor: v, conferido: false };
              }
            }
          }

          setCardConfirmacao({
            nomeArquivo: file.name,
            tamanhoFormatado,
            base64,
            titulo: analise.tituloSugerido || file.name,
            tipo: analise.tipoSugerido || 'Outros',
            titular: analise.titularSugerido || 'Delta Plan',
            apelidos: analise.apelidosSugeridos ? analise.apelidosSugeridos.join(', ') : '',
            visibilidade: analise.visibilidadeSugerida || 'diretoria',
            descricao: analise.descricaoSugerida || '',
            camposTitular: camposTit,
          });
        } else {
          // Fallback se rota falhar
          const nomeLimpo = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
          setCardConfirmacao({
            nomeArquivo: file.name,
            tamanhoFormatado,
            base64,
            titulo: nomeLimpo.charAt(0).toUpperCase() + nomeLimpo.slice(1),
            tipo: 'Outros',
            titular: 'Delta Plan',
            apelidos: '',
            visibilidade: 'diretoria',
            descricao: '',
            camposTitular: {},
          });
        }
      } catch (err) {
        console.error('Erro na análise do arquivo:', err);
        setErroUpload('Erro ao analisar o arquivo. Tente novamente.');
      } finally {
        setAnalisandoArquivo(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastandoArquivo(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastandoArquivo(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastandoArquivo(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processarArquivo(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processarArquivo(e.target.files[0]);
      e.target.value = '';
    }
  };

  // Confirmação do cadastro após edição dos campos sugeridos
  const handleConfirmarCadastroDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardConfirmacao || !cardConfirmacao.titulo.trim()) return;

    setSalvandoCadastro(true);
    try {
      const apelidosArr = cardConfirmacao.apelidos
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await fetch('/api/documentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: cardConfirmacao.titulo.trim(),
          arquivo: cardConfirmacao.nomeArquivo,
          tipo: cardConfirmacao.tipo,
          titular: cardConfirmacao.titular,
          descricao: cardConfirmacao.descricao.trim(),
          visibilidade: cardConfirmacao.visibilidade,
          apelidos: apelidosArr,
          tamanho: cardConfirmacao.tamanhoFormatado,
          base64: cardConfirmacao.base64,
          camposTitularConferidos: cardConfirmacao.camposTitular,
        }),
      });

      if (res.ok) {
        const novoDoc: DocumentoRegistro = await res.json();
        setDocumentos((prev) => [novoDoc, ...prev]);
        await carregarTitulares();
        setCardConfirmacao(null);
        setMensagemSucessoDoc(`Documento "${novoDoc.titulo}" cadastrado com sucesso no cofre!`);
        setTimeout(() => setMensagemSucessoDoc(''), 3500);
      } else {
        setErroUpload('Erro ao salvar documento no cofre.');
      }
    } catch (err) {
      console.error('Erro ao cadastrar documento:', err);
      setErroUpload('Erro ao conectar ao servidor para cadastrar documento.');
    } finally {
      setSalvandoCadastro(false);
    }
  };

  // Abrir modal de edição de metadados
  const abrirEdicaoDoc = (doc: DocumentoRegistro) => {
    setDocEditando(doc);
    setEditTitulo(doc.titulo);
    setEditTipo(doc.tipo || 'Outros');
    setEditTitular(doc.titular || 'Delta Plan');
    setEditDataValidade(doc.dataValidade || '');
    setEditSilenciarAlertas(Boolean(doc.silenciarAlertas));
    setEditApelidos(doc.apelidos ? doc.apelidos.join(', ') : '');
    setEditVisibilidade(doc.visibilidade);
    setEditDescricao(doc.descricao || '');
  };

  // Salvar alterações de metadados
  const handleSalvarEdicaoDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docEditando || !editTitulo.trim()) return;

    setSalvandoEdicao(true);
    try {
      const apelidosArr = editApelidos
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await fetch(`/api/documentos/${docEditando.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: editTitulo.trim(),
          tipo: editTipo.trim(),
          titular: editTitular.trim(),
          descricao: editDescricao.trim(),
          visibilidade: editVisibilidade,
          apelidos: apelidosArr,
          dataValidade: editDataValidade.trim() ? editDataValidade.trim() : null,
          silenciarAlertas: editSilenciarAlertas,
        }),
      });

      if (res.ok) {
        const docAtualizado: DocumentoRegistro = await res.json();
        setDocumentos((prev) =>
          prev.map((d) => (d.id === docAtualizado.id ? docAtualizado : d))
        );
        setDocEditando(null);
        setMensagemSucessoDoc(`Metadados de "${docAtualizado.titulo}" atualizados!`);
        setTimeout(() => setMensagemSucessoDoc(''), 3000);
      }
    } catch (err) {
      console.error('Erro ao editar documento:', err);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  // Excluir documento (registro + arquivo físico)
  const handleExcluirDoc = async (id: string, titulo: string) => {
    const confirmacao = window.confirm(
      `Confirma a exclusão de "${titulo}" do Cofre?\n\nEsta ação removerá o registro e apagará permanentemente o arquivo físico do disco.`
    );
    if (!confirmacao) return;

    try {
      const res = await fetch(`/api/documentos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDocumentos((prev) => prev.filter((d) => d.id !== id));
        setMensagemSucessoDoc(`Documento "${titulo}" e arquivo físico excluídos do cofre.`);
        setTimeout(() => setMensagemSucessoDoc(''), 3500);
      }
    } catch (err) {
      console.error('Erro ao excluir documento:', err);
    }
  };

  // ==========================================
  // HANDLERS DE TITULARES
  // ==========================================
  const handleCriarNovoTitular = async (nome: string) => {
    try {
      const res = await fetch('/api/titulares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      if (res.ok) {
        const novo = await res.json();
        setTitulares((prev) => [...prev, novo]);
        setMensagemSucessoTitular(`Titular "${novo.nome}" cadastrado com sucesso!`);
        setTimeout(() => setMensagemSucessoTitular(''), 3000);
      }
    } catch (err) {
      console.error('Erro ao criar titular:', err);
    }
  };

  const handleExcluirTitular = async (id: string, nome: string) => {
    const confirmacao = window.confirm(`Confirma a exclusão da ficha do titular "${nome}"?`);
    if (!confirmacao) return;

    try {
      const res = await fetch(`/api/titulares/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTitulares((prev) => prev.filter((t) => t.id !== id));
        setMensagemSucessoTitular(`Titular "${nome}" excluído.`);
        setTimeout(() => setMensagemSucessoTitular(''), 3000);
      }
    } catch (err) {
      console.error('Erro ao excluir titular:', err);
    }
  };

  // Filtragem de documentos por título, apelido, tipo ou titular
  const documentosFiltrados = documentos.filter((doc) => {
    const termo = buscaDocumentos.toLowerCase().trim();
    if (!termo) return true;
    const tituloMatch = doc.titulo.toLowerCase().includes(termo);
    const tipoMatch = doc.tipo?.toLowerCase().includes(termo);
    const titularMatch = doc.titular?.toLowerCase().includes(termo);
    const apelidoMatch = doc.apelidos?.some((ap) => ap.toLowerCase().includes(termo));
    const descricaoMatch = doc.descricao?.toLowerCase().includes(termo);
    return tituloMatch || tipoMatch || titularMatch || apelidoMatch || descricaoMatch;
  });

  // Filtragem de titulares no cofre (por nome, dados cadastrais ou se possui documento que case com a busca)
  const titularesFiltrados = titulares.filter((tit) => {
    const termo = buscaDocumentos.toLowerCase().trim();
    if (!termo) return true;
    const matchNome = tit.nome.toLowerCase().includes(termo);
    const matchCampos = Object.entries(tit.campos || {}).some(
      ([k, v]) =>
        k.toLowerCase().includes(termo) ||
        (v?.valor && v.valor.toLowerCase().includes(termo))
    );
    const matchDocs = documentosFiltrados.some((d) => docPertenceAoTitular(d, tit));
    return matchNome || matchCampos || matchDocs;
  });

  // Renderizador do selo colorido de validade do documento
  const renderSeloValidade = (dataValidadeStr?: string | null, origemValidade?: string) => {
    if (!dataValidadeStr || !dataValidadeStr.trim()) return null;

    const match = dataValidadeStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;

    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10) - 1;
    const ano = parseInt(match[3], 10);
    const dValidade = new Date(ano, mes, dia, 0, 0, 0, 0);

    const agora = new Date();
    const ref = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
    const diffMs = dValidade.getTime() - ref.getTime();
    const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diasRestantes < 0) {
      const diasPos = Math.abs(diasRestantes);
      return (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 shadow-sm"
          title={`Vencido em ${dataValidadeStr} (${diasPos} dias atrás) • Origem: ${origemValidade || 'extraído automaticamente'}`}
        >
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          <span>VENCIDO: {dataValidadeStr}</span>
        </span>
      );
    }

    if (diasRestantes === 0) {
      return (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500 text-white flex items-center gap-1 shadow-sm"
          title={`Vence hoje (${dataValidadeStr}) • Origem: ${origemValidade || 'extraído automaticamente'}`}
        >
          <AlertTriangle className="w-3 h-3 text-white" />
          <span>VENCE HOJE!</span>
        </span>
      );
    }

    if (diasRestantes <= 60) {
      return (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm"
          title={`Vence em ${diasRestantes} dias (${dataValidadeStr}) • Origem: ${origemValidade || 'extraído automaticamente'}`}
        >
          <Clock className="w-3 h-3 text-amber-400" />
          <span>VENCE EM {diasRestantes}D ({dataValidadeStr})</span>
        </span>
      );
    }

    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shadow-sm"
        title={`Válido até ${dataValidadeStr} (${diasRestantes} dias restantes) • Origem: ${origemValidade || 'extraído automaticamente'}`}
      >
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        <span>VÁLIDO ATÉ {dataValidadeStr}</span>
      </span>
    );
  };

  // Renderizador reutilizável de cards de documento
  const renderCardDocumento = (doc: DocumentoRegistro) => {
    const isPdf = doc.arquivo.toLowerCase().endsWith('.pdf');

    return (
      <div
        key={doc.id}
        className="p-4 bg-wa-panel border border-wa-border rounded-xl flex flex-col justify-between gap-3 hover:border-wa-border/80 transition-all shadow-sm"
      >
        <div className="space-y-2.5">
          {/* Cabeçalho do Card com Título e Badges */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-wa-bg border border-wa-border flex-shrink-0 mt-0.5">
                {isPdf ? (
                  <FileText className="w-5 h-5 text-rose-400" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-sky-400" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm text-wa-textPrimary truncate" title={doc.titulo}>
                  {doc.titulo}
                </h3>
                <p className="text-[11px] text-wa-textMuted truncate">
                  {doc.arquivo}
                  {doc.dataCadastro ? ` • ${doc.dataCadastro}` : ''}
                </p>
              </div>
            </div>

            {/* Badges Visuais: Status de Indexação e Visibilidade */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {doc.statusIndexacao === 'erro' && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm flex items-center gap-1"
                  title={doc.erroIndexacao || 'Falha na indexação deste documento.'}
                >
                  <AlertCircle className="w-3 h-3 text-rose-400" />
                  <span>NÃO INDEXADO</span>
                </span>
              )}
              {doc.statusIndexacao === 'pendente' && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm flex items-center gap-1"
                  title="Indexando no banco de busca inteligente..."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  <span>INDEXANDO...</span>
                </span>
              )}
              <span
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase flex-shrink-0 ${
                  doc.visibilidade === 'diretoria'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-950/20'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-950/20'
                }`}
              >
                {doc.visibilidade === 'diretoria' ? 'DIRETORIA' : 'GERAL'}
              </span>
            </div>
          </div>

          {/* Metadados adicionais: Tipo, Titular e Selo de Validade */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-wa-textSecondary">
            {doc.tipo && (
              <span className="px-2 py-0.5 bg-wa-bg rounded border border-wa-border text-[10px] font-medium text-wa-textPrimary">
                {doc.tipo}
              </span>
            )}
            {doc.titular && (
              <span className="flex items-center gap-1 text-[11px] text-wa-textMuted">
                <Building2 className="w-3 h-3 text-wa-green" />
                <span>{doc.titular}</span>
              </span>
            )}
            {renderSeloValidade(doc.dataValidade, doc.origemValidade)}
            {doc.silenciarAlertas && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-wa-bg text-wa-textMuted border border-wa-border flex items-center gap-1 shadow-sm"
                title="Alertas de vencimento desativados para este documento"
              >
                <BellOff className="w-3 h-3 text-amber-400" />
                <span>Alertas silenciados</span>
              </span>
            )}
          </div>

          {/* Descrição */}
          {doc.descricao && (
            <p className="text-xs text-wa-textSecondary line-clamp-2 leading-relaxed">
              {doc.descricao}
            </p>
          )}

          {/* Badges de Apelidos */}
          {doc.apelidos && doc.apelidos.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {doc.apelidos.map((ap, i) => (
                <span
                  key={i}
                  className="text-[9px] px-1.5 py-0.2 rounded bg-wa-bg text-wa-textMuted border border-wa-border"
                >
                  #{ap}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Botões de Ação no Rodapé do Card */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-wa-border/50 text-xs">
          {/* Botão Visualizar */}
          <a
            href={`/arquivos/${encodeURIComponent((doc.arquivo || '').trim())}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 rounded-lg bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary border border-wa-border transition-colors flex items-center gap-1.5"
            title="Visualizar documento em nova aba"
          >
            <ExternalLink className="w-3.5 h-3.5 text-wa-greenLight" />
            <span>Visualizar</span>
          </a>

          {/* Botão Editar Metadados */}
          <button
            onClick={() => abrirEdicaoDoc(doc)}
            className="px-2.5 py-1.5 rounded-lg bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary border border-wa-border transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Editar metadados, visibilidade e apelidos"
          >
            <Edit3 className="w-3.5 h-3.5 text-wa-greenLight" />
            <span>Editar</span>
          </button>

          {/* Botão Excluir */}
          <button
            onClick={() => handleExcluirDoc(doc.id, doc.titulo)}
            className="px-2.5 py-1.5 rounded-lg bg-wa-bg hover:bg-rose-500/20 text-wa-textSecondary hover:text-rose-400 border border-wa-border hover:border-rose-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Excluir documento e arquivo físico do cofre"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-full bg-wa-bg overflow-y-auto p-6 text-wa-textPrimary">
      <div className="max-w-5xl mx-auto space-y-6 pb-16">
        {/* Header Principal */}
        <div className="border-b border-wa-border pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl bg-wa-green/20 text-wa-greenLight flex items-center justify-center shadow">
                <Brain className="w-5 h-5 text-wa-green" />
              </div>
              <h1 className="text-xl font-bold text-wa-textPrimary">
                Base da {ASSISTENTE.nome}
              </h1>
            </div>
            <p className="text-xs text-wa-textSecondary">
              Central de inteligência corporativa: configure o conhecimento analítico e os documentos oficiais do cofre.
            </p>
          </div>

          {/* Sub-abas no Topo */}
          <div className="flex items-center gap-1.5 p-1 bg-wa-panel border border-wa-border rounded-xl shadow-inner self-start md:self-auto">
            <button
              onClick={() => setSubAba('conhecimento')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                subAba === 'conhecimento'
                  ? 'bg-wa-green text-slate-950 shadow'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-bg/60'
              }`}
            >
              <span>📘</span>
              <span>Conhecimento</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                subAba === 'conhecimento' ? 'bg-slate-950/20 text-slate-950' : 'bg-wa-bg text-wa-textMuted'
              }`}>
                {itensConhecimento.length}
              </span>
            </button>
            <button
              onClick={() => setSubAba('documentos')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                subAba === 'documentos'
                  ? 'bg-wa-green text-slate-950 shadow'
                  : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-bg/60'
              }`}
            >
              <span>📁</span>
              <span>Cofre de Documentos</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                subAba === 'documentos' ? 'bg-slate-950/20 text-slate-950' : 'bg-wa-bg text-wa-textMuted'
              }`}>
                {documentos.length}
              </span>
            </button>
          </div>
        </div>

        {/* Linha Explicativa da Sub-aba Ativa */}
        <div className="p-3 bg-wa-panel/70 border border-wa-border rounded-xl flex items-center gap-2.5 text-xs text-wa-textSecondary">
          <Info className="w-4 h-4 text-wa-green flex-shrink-0" />
          <p>
            {subAba === 'conhecimento'
              ? 'Regras, diretrizes e orientações analíticas que a VEGA lê para responder às dúvidas da equipe.'
              : 'Documentos oficiais, fichas cadastrais agrupadas por titular e arquivos do cofre corporativo.'}
          </p>
        </div>

        {/* ========================================================================= */}
        {/* SUB-ABA 1: CONHECIMENTO                                                   */}
        {/* ========================================================================= */}
        {subAba === 'conhecimento' && (
          <div className="space-y-6 animate-fadeIn">
            {mensagemSucessoConhecimento && (
              <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs flex items-center gap-2 animate-fadeIn">
                <CheckCircle className="w-4 h-4" />
                <span>{mensagemSucessoConhecimento}</span>
              </div>
            )}

            {erroConhecimento && (
              <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded-lg text-xs flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{erroConhecimento}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-wa-textSecondary absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar no conhecimento cadastrado..."
                  value={buscaConhecimento}
                  onChange={(e) => setBuscaConhecimento(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-wa-panel border border-wa-border rounded-lg text-xs text-wa-textPrimary placeholder:text-wa-textMuted focus:border-wa-green focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  setErroConhecimento('');
                  setExibirFormConhecimento(!exibirFormConhecimento);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 text-xs font-semibold rounded-lg shadow transition-all active:scale-95 self-start sm:self-auto cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{exibirFormConhecimento ? 'Cancelar' : 'Ensinar nova instrução'}</span>
              </button>
            </div>

            {/* Formulário de Adicionar Conhecimento */}
            {exibirFormConhecimento && (
              <form
                onSubmit={handleSalvarNovoConhecimento}
                className="p-5 bg-wa-panel border border-wa-border rounded-xl space-y-4 animate-fadeIn"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-wa-textPrimary border-b border-wa-border pb-3">
                  <Sparkles className="w-4 h-4 text-wa-green" />
                  <span>Cadastrar Nova Regra ou Informação</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="md:col-span-2">
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Título ou Tópico *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Política de Reajuste de Contratos"
                      value={novoTitulo}
                      onChange={(e) => {
                        setNovoTitulo(e.target.value);
                        setErroConhecimento('');
                      }}
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Categoria
                    </label>
                    <select
                      value={novaCategoria}
                      onChange={(e) => setNovaCategoria(e.target.value)}
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                    >
                      <option value="Geral">Geral</option>
                      <option value="Comercial">Comercial</option>
                      <option value="Atendimento">Atendimento</option>
                      <option value="Segurança">Segurança</option>
                      <option value="Operações">Operações</option>
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Conteúdo ou Instrução detalhada *
                    </label>
                    <textarea
                      required
                      rows={4}
                      placeholder="Descreva exatamente o que a VEGA deve saber sobre este assunto..."
                      value={novoConteudo}
                      onChange={(e) => setNovoConteudo(e.target.value)}
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none resize-none leading-relaxed"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExibirFormConhecimento(false);
                      setErroConhecimento('');
                    }}
                    className="px-4 py-2 bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary rounded-lg text-xs font-medium cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Salvar Conhecimento</span>
                  </button>
                </div>
              </form>
            )}

            {/* Lista de Conhecimentos */}
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-wa-textSecondary uppercase tracking-wider">
                Instruções Registradas ({itensFiltradosConhecimento.length})
              </h2>

              {itensFiltradosConhecimento.length === 0 ? (
                <div className="p-8 text-center text-wa-textSecondary text-xs bg-wa-panel border border-dashed border-wa-border rounded-xl">
                  Nenhuma instrução encontrada.
                </div>
              ) : (
                itensFiltradosConhecimento.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 bg-wa-panel border border-wa-border rounded-xl space-y-2 hover:border-wa-border/80 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-wa-green flex-shrink-0" />
                        <h3 className="font-semibold text-sm text-wa-textPrimary">
                          {item.titulo}
                        </h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-wa-bg text-wa-textSecondary border border-wa-border">
                          {item.categoria}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleAbrirEdicaoConhecimento(item)}
                          className="p-1.5 text-wa-textMuted hover:text-wa-green hover:bg-wa-green/10 rounded transition-colors cursor-pointer"
                          title="Editar instrução (título, categoria e conteúdo)"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleExcluirConhecimento(item.id)}
                          className="p-1.5 text-wa-textMuted hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                          title="Excluir regra de conhecimento"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-wa-textSecondary leading-relaxed whitespace-pre-wrap">
                      {item.conteudo}
                    </p>

                    <div className="text-[10px] text-wa-textMuted pt-1 flex items-center justify-between border-t border-wa-border/40">
                      <span>Última atualização: {item.dataAtualizacao}</span>
                      <span className="text-wa-greenLight flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Ativo para a VEGA
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUB-ABA 2: DOCUMENTOS DO COFRE                                            */}
        {/* ========================================================================= */}
        {subAba === 'documentos' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Mensagens de Feedback */}
            {(mensagemSucessoDoc || mensagemSucessoTitular) && (
              <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs flex items-center gap-2 animate-fadeIn">
                <CheckCircle className="w-4 h-4" />
                <span>{mensagemSucessoDoc || mensagemSucessoTitular}</span>
              </div>
            )}
            {erroUpload && (
              <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded-lg text-xs flex items-center gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4" />
                <span>{erroUpload}</span>
              </div>
            )}

            {/* Input oculto para clique */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="application/pdf,image/*"
              className="hidden"
            />

            {/* ÁREA DE UPLOAD DRAG & DROP */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                arrastandoArquivo
                  ? 'border-wa-green bg-wa-green/10 scale-[1.01]'
                  : 'border-wa-border hover:border-wa-green/60 bg-wa-panel/40 hover:bg-wa-panel/80'
              }`}
            >
              {analisandoArquivo ? (
                <div className="flex flex-col items-center gap-3 py-4 text-wa-green">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <div className="text-xs font-medium">
                    <p className="font-semibold text-wa-textPrimary">Analisando documento...</p>
                    <p className="text-wa-textSecondary text-[11px] mt-0.5">
                      Identificando título, tipo, titular, visibilidade e apelidos sugeridos
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-2xl bg-wa-green/20 text-wa-greenLight flex items-center justify-center shadow-inner">
                    <UploadCloud className="w-6 h-6 text-wa-green" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-wa-textPrimary">
                      Arraste e solte o arquivo aqui ou <span className="text-wa-greenLight underline">clique para selecionar</span>
                    </p>
                    <p className="text-xs text-wa-textSecondary mt-1">
                      Aceita documentos PDF e imagens (.png, .jpg, .webp) até <strong>50MB</strong>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* CARD DE CONFIRMAÇÃO DE CADASTRO PÓS-ANÁLISE */}
            {cardConfirmacao && (
              <form
                onSubmit={handleConfirmarCadastroDoc}
                className="p-5 bg-wa-panel border border-wa-green/50 rounded-xl space-y-4 shadow-xl animate-fadeIn"
              >
                <div className="flex items-center justify-between border-b border-wa-border pb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-wa-textPrimary">
                    <Sparkles className="w-4 h-4 text-wa-green" />
                    <span>Confirmar Cadastro no Cofre da VEGA</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardConfirmacao(null)}
                    className="p-1 text-wa-textSecondary hover:text-wa-textPrimary"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 bg-wa-bg rounded-lg border border-wa-border flex items-center gap-3">
                  <FileUp className="w-6 h-6 text-wa-green flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-wa-textPrimary truncate">
                      {cardConfirmacao.nomeArquivo}
                    </p>
                    <p className="text-[11px] text-wa-textSecondary">
                      Tamanho: {cardConfirmacao.tamanhoFormatado} • Análise concluída
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
                  {/* Título */}
                  <div className="md:col-span-2">
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Título do Documento *
                    </label>
                    <input
                      type="text"
                      required
                      value={cardConfirmacao.titulo}
                      onChange={(e) =>
                        setCardConfirmacao({ ...cardConfirmacao, titulo: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none font-medium"
                    />
                  </div>

                  {/* Tipo */}
                  <div>
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Tipo de Documento
                    </label>
                    <select
                      value={cardConfirmacao.tipo}
                      onChange={(e) =>
                        setCardConfirmacao({ ...cardConfirmacao, tipo: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                    >
                      <option value="Contrato">Contrato</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Documento Pessoal">Documento Pessoal</option>
                      <option value="Normativo">Normativo</option>
                      <option value="Proposta">Proposta</option>
                      <option value="Outros">Outros</option>
                    </select>
                  </div>

                  {/* Titular */}
                  <div>
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Titular / Empresa
                    </label>
                    <input
                      type="text"
                      value={cardConfirmacao.titular}
                      onChange={(e) =>
                        setCardConfirmacao({ ...cardConfirmacao, titular: e.target.value })
                      }
                      placeholder="Ex: Delta Plan, Thomaz..."
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                    />
                  </div>

                  {/* Nível de Visibilidade */}
                  <div>
                    <label className="block text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-wa-green" />
                      Visibilidade *
                    </label>
                    <select
                      value={cardConfirmacao.visibilidade}
                      onChange={(e) =>
                        setCardConfirmacao({
                          ...cardConfirmacao,
                          visibilidade: e.target.value as VisibilidadeDoc,
                        })
                      }
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none font-semibold"
                    >
                      <option value="diretoria">DIRETORIA (Restrito à Diretoria)</option>
                      <option value="geral">GERAL (Acesso de Todos)</option>
                    </select>
                  </div>

                  {/* Apelidos / Palavras-chave */}
                  <div className="md:col-span-1">
                    <label className="block text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-wa-green" />
                      Apelidos / Sinônimos
                    </label>
                    <input
                      type="text"
                      value={cardConfirmacao.apelidos}
                      onChange={(e) =>
                        setCardConfirmacao({ ...cardConfirmacao, apelidos: e.target.value })
                      }
                      placeholder="Separados por vírgula"
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                    />
                  </div>

                  {/* Descrição */}
                  <div className="md:col-span-3">
                    <label className="block text-wa-textSecondary mb-1 font-medium">
                      Descrição ou Finalidade (Opcional)
                    </label>
                    <textarea
                      rows={2}
                      value={cardConfirmacao.descricao}
                      onChange={(e) =>
                        setCardConfirmacao({ ...cardConfirmacao, descricao: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none resize-none"
                    />
                  </div>

                  {/* CONFERÊNCIA OBRIGATÓRIA DE DADOS DO TITULAR */}
                  {cardConfirmacao.camposTitular &&
                    Object.keys(cardConfirmacao.camposTitular).length > 0 && (
                      <div className="md:col-span-3 p-4 bg-wa-bg rounded-xl border border-wa-green/30 space-y-3 mt-1">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-wa-border pb-2">
                          <div className="flex items-center gap-2">
                            <UserCheck className="w-4 h-4 text-wa-green" />
                            <span className="font-semibold text-xs text-wa-textPrimary">
                              Conferência de Dados do Titular ({cardConfirmacao.titular || 'Titular'})
                            </span>
                          </div>
                          <span className="text-[11px] text-wa-textSecondary">
                            Marque <strong>"Confere"</strong> para validar cada dado extraído
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {Object.entries(cardConfirmacao.camposTitular).map(([cKey, cItem]) => (
                            <div
                              key={cKey}
                              className={`p-2.5 rounded-lg border transition-all flex items-center gap-3 ${
                                cItem.conferido
                                  ? 'bg-wa-green/10 border-wa-green/40'
                                  : 'bg-wa-panel border-wa-border'
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-wa-textSecondary block mb-1">
                                  {cKey}
                                </label>
                                <input
                                  type="text"
                                  value={cItem.valor}
                                  onChange={(e) => {
                                    const novoValor = e.target.value;
                                    setCardConfirmacao({
                                      ...cardConfirmacao,
                                      camposTitular: {
                                        ...cardConfirmacao.camposTitular,
                                        [cKey]: { ...cItem, valor: novoValor },
                                      },
                                    });
                                  }}
                                  className="w-full px-2.5 py-1 bg-wa-bg border border-wa-border rounded text-xs text-wa-textPrimary font-medium focus:border-wa-green focus:outline-none"
                                />
                              </div>

                              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-wa-bg hover:bg-wa-panelHover rounded-lg border border-wa-border cursor-pointer select-none text-xs font-semibold text-wa-textPrimary">
                                <input
                                  type="checkbox"
                                  checked={cItem.conferido}
                                  onChange={(e) => {
                                    setCardConfirmacao({
                                      ...cardConfirmacao,
                                      camposTitular: {
                                        ...cardConfirmacao.camposTitular,
                                        [cKey]: { ...cItem, conferido: e.target.checked },
                                      },
                                    });
                                  }}
                                  className="w-4 h-4 accent-wa-green rounded cursor-pointer"
                                />
                                <span className={cItem.conferido ? 'text-wa-green' : 'text-wa-textSecondary'}>
                                  Confere
                                </span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-wa-border">
                  <button
                    type="button"
                    onClick={() => setCardConfirmacao(null)}
                    className="px-4 py-2 bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary rounded-lg text-xs font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvandoCadastro || !cardConfirmacao.titulo.trim()}
                    className="px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow disabled:opacity-50"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{salvandoCadastro ? 'Cadastrando...' : 'Confirmar Cadastro no Cofre'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* BARRA DE BUSCA DE DOCUMENTOS */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-wa-textSecondary absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por documento, titular, apelido ou dado cadastral..."
                  value={buscaDocumentos}
                  onChange={(e) => setBuscaDocumentos(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-wa-panel border border-wa-border rounded-lg text-xs text-wa-textPrimary placeholder:text-wa-textMuted focus:border-wa-green focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-wa-textMuted">
                  {documentosFiltrados.length} doc(s) • {titulares.length} titular(es)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nome = window.prompt('Nome completo do novo titular:');
                    if (nome && nome.trim()) {
                      handleCriarNovoTitular(nome.trim());
                    }
                  }}
                  className="px-2.5 py-1.5 bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-green rounded-lg text-xs font-medium border border-wa-border flex items-center gap-1 transition-colors cursor-pointer"
                  title="Cadastrar novo titular manualmente"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Titular</span>
                </button>
              </div>
            </div>

            {/* AGRUPAMENTO NO COFRE: TITULARES E SEUS RESPECTIVOS DOCUMENTOS */}
            {titulares.length === 0 && documentosFiltrados.length === 0 ? (
              <div className="p-8 text-center text-wa-textSecondary text-xs bg-wa-panel border border-dashed border-wa-border rounded-xl">
                {carregandoDocs
                  ? 'Carregando cofre...'
                  : 'Nenhum documento ou titular encontrado com os critérios de busca.'}
              </div>
            ) : (
              <div className="space-y-6">
                {/* 1. SEÇÃO DOS TITULARES (FICHA + DOCUMENTOS) */}
                {titularesFiltrados.map((tit) => {
                  const docsDoTitular = documentosFiltrados.filter((d) => docPertenceAoTitular(d, tit));
                  const aberto = isTitularAberto(tit.id);

                  return (
                    <div
                      key={tit.id}
                      className="bg-wa-panel border border-wa-border rounded-xl overflow-hidden shadow-sm transition-all"
                    >
                      {/* Cabeçalho do Titular (Acordeão) */}
                      <div
                        onClick={() => toggleTitularExpandido(tit.id)}
                        className="p-4 bg-wa-panelHover/40 hover:bg-wa-panelHover/80 border-b border-wa-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-wa-green/15 text-wa-green flex items-center justify-center font-bold text-base border border-wa-green/30 flex-shrink-0">
                            {tit.nome.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-sm text-wa-textPrimary">
                                {tit.nome}
                              </h3>
                              <span className="font-mono text-[10px] text-wa-textMuted px-2 py-0.5 bg-wa-bg rounded border border-wa-border">
                                {tit.id}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-wa-textMuted flex-wrap">
                              <span className="text-wa-textSecondary">
                                📁 <strong>{docsDoTitular.length}</strong> documento(s) no cofre
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleExcluirTitular(tit.id, tit.nome)}
                            className="p-1.5 bg-wa-bg hover:bg-rose-500/20 text-wa-textSecondary hover:text-rose-400 rounded-lg text-xs border border-wa-border hover:border-rose-500/40 transition-colors cursor-pointer"
                            title="Excluir titular"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleTitularExpandido(tit.id)}
                            className="p-1.5 bg-wa-bg hover:bg-wa-panel text-wa-textSecondary hover:text-wa-textPrimary rounded-lg border border-wa-border transition-colors cursor-pointer ml-1"
                            title={aberto ? 'Recolher titular' : 'Expandir titular'}
                          >
                            {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Conteúdo Expandido do Titular: Lista de Documentos */}
                      {aberto && (
                        <div className="p-5 space-y-4 animate-fadeIn">
                          <div className="flex items-center justify-between border-b border-wa-border/60 pb-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-wa-textPrimary uppercase tracking-wider">
                              <FileText className="w-4 h-4 text-wa-green" />
                              <span>Documentos de {tit.nome} ({docsDoTitular.length})</span>
                            </div>
                            <span className="text-[11px] text-wa-textMuted">
                              Arquivos vinculados a este titular
                            </span>
                          </div>

                          {docsDoTitular.length === 0 ? (
                            <div className="p-6 bg-wa-bg/40 rounded-lg border border-dashed border-wa-border text-center text-xs text-wa-textMuted">
                              Nenhum documento cadastrado para este titular ainda. Faça o upload acima indicando "{tit.nome}".
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {docsDoTitular.map((doc) => renderCardDocumento(doc))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 2. SEÇÃO DE DOCUMENTOS CORPORATIVOS / SEM TITULAR ESPECÍFICO */}
                {(() => {
                  const docsCorporativos = documentosFiltrados.filter(
                    (d) => !titulares.some((tit) => docPertenceAoTitular(d, tit))
                  );

                  if (docsCorporativos.length === 0) return null;

                  return (
                    <div className="bg-wa-panel border border-wa-border rounded-xl p-5 space-y-4 shadow-sm">
                      <div className="flex items-center justify-between border-b border-wa-border pb-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-wa-green" />
                          <h3 className="font-bold text-sm text-wa-textPrimary">
                            Documentos Gerais & Corporativos da Delta Plan ({docsCorporativos.length})
                          </h3>
                        </div>
                        <span className="text-xs text-wa-textMuted">Documentos corporativos sem titular pessoal</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {docsCorporativos.map((doc) => renderCardDocumento(doc))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL DE EDIÇÃO DE CONHECIMENTO */}
      {itemEditandoConhecimento && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-wa-panel border border-wa-border rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-wa-border pb-3">
              <div className="flex items-center gap-2 text-wa-textPrimary font-semibold text-sm">
                <Edit className="w-4 h-4 text-wa-green" />
                <span>Editar Instrução de Conhecimento</span>
              </div>
              <button
                onClick={() => setItemEditandoConhecimento(null)}
                className="text-wa-textSecondary hover:text-wa-textPrimary p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {erroEdicaoConhecimento && (
              <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{erroEdicaoConhecimento}</span>
              </div>
            )}

            <form onSubmit={handleSalvarEdicaoConhecimento} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium">
                  Título da Instrução *
                </label>
                <input
                  type="text"
                  required
                  value={editTituloConhecimento}
                  onChange={(e) => {
                    setEditTituloConhecimento(e.target.value);
                    setErroEdicaoConhecimento('');
                  }}
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none font-semibold"
                />
              </div>

              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium">
                  Categoria
                </label>
                <select
                  value={editCategoriaConhecimento}
                  onChange={(e) => setEditCategoriaConhecimento(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                >
                  <option value="Geral">Geral</option>
                  <option value="Comercial">Comercial</option>
                  <option value="Atendimento">Atendimento</option>
                  <option value="Segurança">Segurança</option>
                  <option value="Operações">Operações</option>
                </select>
              </div>

              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium">
                  Conteúdo / Regra da Instrução *
                </label>
                <textarea
                  required
                  rows={6}
                  value={editConteudoConhecimento}
                  onChange={(e) => setEditConteudoConhecimento(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none resize-none leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-wa-border">
                <button
                  type="button"
                  onClick={() => setItemEditandoConhecimento(null)}
                  className="px-4 py-2 bg-wa-bg hover:bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary rounded-lg text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdicaoConhecimento || !editTituloConhecimento.trim()}
                  className="px-4 py-2 bg-wa-green hover:bg-wa-greenHover text-slate-950 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{salvandoEdicaoConhecimento ? 'Salvando...' : 'Salvar Alterações'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO DE METADADOS */}
      {docEditando && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-wa-panel border border-wa-border rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-wa-border pb-3">
              <div className="flex items-center gap-2 text-wa-textPrimary font-semibold text-sm">
                <Edit3 className="w-4 h-4 text-wa-green" />
                <span>Editar Metadados do Documento</span>
              </div>
              <button
                onClick={() => setDocEditando(null)}
                className="text-wa-textSecondary hover:text-wa-textPrimary p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSalvarEdicaoDoc} className="space-y-3.5 text-xs">
              <div className="p-2.5 bg-wa-bg rounded-lg border border-wa-border">
                <span className="text-[10px] text-wa-textMuted">Arquivo físico associado:</span>
                <p className="font-mono text-xs text-wa-greenLight">{docEditando.arquivo}</p>
              </div>

              {/* Título */}
              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium">
                  Título do Documento *
                </label>
                <input
                  type="text"
                  required
                  value={editTitulo}
                  onChange={(e) => setEditTitulo(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Tipo */}
                <div>
                  <label className="block text-wa-textSecondary mb-1 font-medium">
                    Tipo de Documento
                  </label>
                  <select
                    value={editTipo}
                    onChange={(e) => setEditTipo(e.target.value)}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                  >
                    <option value="Contrato">Contrato</option>
                    <option value="Financeiro">Financeiro</option>
                    <option value="Documento Pessoal">Documento Pessoal</option>
                    <option value="Normativo">Normativo</option>
                    <option value="Proposta">Proposta</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>

                {/* Titular */}
                <div>
                  <label className="block text-wa-textSecondary mb-1 font-medium">
                    Titular / Empresa
                  </label>
                  <input
                    type="text"
                    value={editTitular}
                    onChange={(e) => setEditTitular(e.target.value)}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Visibilidade */}
                <div>
                  <label className="block text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-wa-green" />
                    Nível de Visibilidade
                  </label>
                  <select
                    value={editVisibilidade}
                    onChange={(e) => setEditVisibilidade(e.target.value as VisibilidadeDoc)}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none font-semibold"
                  >
                    <option value="diretoria">DIRETORIA (Restrito à Diretoria)</option>
                    <option value="geral">GERAL (Acesso de Todos)</option>
                  </select>
                </div>

                {/* Data de Validade */}
                <div>
                  <label className="block text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    Data de Validade (DD/MM/AAAA)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 26/08/2034 ou em branco"
                    value={editDataValidade}
                    onChange={(e) => setEditDataValidade(e.target.value)}
                    className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                  />
                </div>
              </div>

              {/* Apelidos / Palavras-chave */}
              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-wa-green" />
                  Apelidos / Sinônimos de Busca (separados por vírgula)
                </label>
                <input
                  type="text"
                  value={editApelidos}
                  onChange={(e) => setEditApelidos(e.target.value)}
                  placeholder="Ex: contrato, estatuto, minuta societária"
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-wa-textSecondary mb-1 font-medium">
                  Descrição ou Finalidade
                </label>
                <textarea
                  rows={2}
                  value={editDescricao}
                  onChange={(e) => setEditDescricao(e.target.value)}
                  className="w-full px-3 py-2 bg-wa-bg border border-wa-border rounded-lg text-wa-textPrimary focus:border-wa-green focus:outline-none resize-none"
                />
              </div>

              {/* Opção Não Alertar Mais (Silenciar alertas) */}
              <div className="p-3 bg-wa-bg rounded-xl border border-wa-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
                    <BellOff className="w-4 h-4" />
                  </div>
                  <div>
                    <label
                      htmlFor="check-silenciar-alertas"
                      className="text-xs font-semibold text-wa-textPrimary cursor-pointer block"
                    >
                      Não alertar mais sobre este documento
                    </label>
                    <span className="text-[11px] text-wa-textMuted block">
                      Silencia alertas de vencimento no painel. Se o documento for substituído, os alertas voltam a funcionar.
                    </span>
                  </div>
                </div>
                <input
                  id="check-silenciar-alertas"
                  type="checkbox"
                  checked={editSilenciarAlertas}
                  onChange={(e) => setEditSilenciarAlertas(e.target.checked)}
                  className="w-4 h-4 accent-wa-green cursor-pointer rounded"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-wa-border">
                <button
                  type="button"
                  onClick={() => setDocEditando(null)}
                  className="px-3.5 py-1.5 bg-wa-panelHover text-wa-textSecondary hover:text-wa-textPrimary rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdicao || !editTitulo.trim()}
                  className="px-4 py-1.5 bg-wa-green hover:bg-wa-greenHover text-slate-950 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50 shadow"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{salvandoEdicao ? 'Salvando...' : 'Salvar Alterações'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
