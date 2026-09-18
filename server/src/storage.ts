import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from './db/supabaseClient.js';
import { sanitizarChaveStorage } from './utils/storageUtils.js';
import {
  Conversa,
  Contato,
  Mensagem,
  DocumentoRegistro,
  NivelAcesso,
  SetorUsuario,
  BuscaSemResultadoRegistro,
  RegistroUsoIA,
  TabelaPrecos,
  ItemConhecimento,
  FichaTitular,
  VisibilidadeDoc,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRECOS_FILE = path.resolve(__dirname, '../../config/precos.json');
const PRECOS_FILE_FALLBACK = path.resolve(__dirname, '../../data/precos.json');

const SETORES_VALIDOS: SetorUsuario[] = [
  'Diretoria',
  'Administrativo',
  'Obras',
  'Financeiro',
  'Suprimentos',
  'RH',
  'Comercial',
];

function normalizarSetor(setor?: string): SetorUsuario {
  if (setor && SETORES_VALIDOS.includes(setor as SetorUsuario)) {
    return setor as SetorUsuario;
  }
  return 'Administrativo';
}

// Cache síncrono para intenções e buscas rápidas em memória
let cacheNomesTitulares: string[] = ['Thomaz Lustri Fabre', 'Thomaz', 'RENG ENGENHGARIA'];

function atualizarCacheNomes(nomes: string[]): void {
  if (nomes && nomes.length > 0) {
    cacheNomesTitulares = Array.from(new Set([...cacheNomesTitulares, ...nomes.filter(Boolean)]));
  }
}

// ==========================================
// CONVERSAS (HISTÓRICO NO SUPABASE)
// ==========================================

export async function obterTodasConversas(): Promise<Conversa[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('conversas')
      .select('id, contato, nao_lidas, ultima_atualizacao, mensagens')
      .order('ultima_atualizacao', { ascending: false });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter conversas:', error);
      return [];
    }

    return (data || []).map((c: any) => {
      const contatoRaw = c.contato || {};
      const nivel: NivelAcesso =
        contatoRaw.nivelAcesso === 'diretoria' || contatoRaw.ficha?.nivelAcesso === 'diretoria'
          ? 'diretoria'
          : 'geral';
      const cargo = contatoRaw.cargo || contatoRaw.ficha?.cargo || 'Colaborador';
      const setor = normalizarSetor(contatoRaw.setor || contatoRaw.ficha?.setor);
      const observacoes = contatoRaw.ficha?.observacoes || '';

      return {
        id: c.id,
        contato: {
          id: contatoRaw.id || `cont-${Date.now()}`,
          nome: contatoRaw.nome || 'Usuário Delta',
          telefone: contatoRaw.telefone || '+55 (11) 99999-0000',
          avatarCor: contatoRaw.avatarCor || '#00a884',
          cargo,
          setor,
          nivelAcesso: nivel,
          titularVinculado: contatoRaw.titularVinculado,
          ficha: {
            cargo,
            setor,
            nivelAcesso: nivel,
            observacoes,
            titularVinculado: contatoRaw.titularVinculado,
          },
        },
        naoLidas: c.nao_lidas || 0,
        ultimaAtualizacao: c.ultima_atualizacao || new Date().toISOString(),
        mensagens: c.mensagens || [],
      } as Conversa;
    });
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao ler conversas:', err);
    return [];
  }
}

export async function salvarConversas(conversas: Conversa[]): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const registros = conversas.map((c) => ({
      id: c.id,
      contato: c.contato,
      nao_lidas: c.naoLidas || 0,
      ultima_atualizacao: c.ultimaAtualizacao || new Date().toISOString(),
      mensagens: c.mensagens || [],
    }));

    const { error } = await supabase
      .from('conversas')
      .upsert(registros, { onConflict: 'id' });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao salvar conversas:', error);
    }
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao persistir conversas:', err);
  }
}

export async function salvarConversa(conversa: Conversa): Promise<Conversa> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('conversas')
      .upsert({
        id: conversa.id,
        contato: conversa.contato,
        nao_lidas: conversa.naoLidas || 0,
        ultima_atualizacao: conversa.ultimaAtualizacao || new Date().toISOString(),
        mensagens: conversa.mensagens || [],
      }, { onConflict: 'id' });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao salvar conversa individual:', error);
    }
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao persistir conversa:', err);
  }
  return conversa;
}

export async function obterConversaPorId(id: string): Promise<Conversa | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('conversas')
      .select('id, contato, nao_lidas, ultima_atualizacao, mensagens')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const contatoRaw = data.contato || {};
    const nivel: NivelAcesso =
      contatoRaw.nivelAcesso === 'diretoria' || contatoRaw.ficha?.nivelAcesso === 'diretoria'
        ? 'diretoria'
        : 'geral';
    const cargo = contatoRaw.cargo || contatoRaw.ficha?.cargo || 'Colaborador';
    const setor = normalizarSetor(contatoRaw.setor || contatoRaw.ficha?.setor);

    return {
      id: data.id,
      contato: {
        id: contatoRaw.id || `cont-${Date.now()}`,
        nome: contatoRaw.nome || 'Usuário Delta',
        telefone: contatoRaw.telefone || '+55 (11) 99999-0000',
        avatarCor: contatoRaw.avatarCor || '#00a884',
        cargo,
        setor,
        nivelAcesso: nivel,
        titularVinculado: contatoRaw.titularVinculado,
        ficha: {
          cargo,
          setor,
          nivelAcesso: nivel,
          observacoes: contatoRaw.ficha?.observacoes || '',
          titularVinculado: contatoRaw.titularVinculado,
        },
      },
      naoLidas: data.nao_lidas || 0,
      ultimaAtualizacao: data.ultima_atualizacao || new Date().toISOString(),
      mensagens: data.mensagens || [],
    };
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao buscar conversa por id:', err);
    return null;
  }
}

export async function atualizarContato(
  contatoId: string,
  dadosAtualizados: Partial<Contato>
): Promise<Conversa | null> {
  const conversas = await obterTodasConversas();
  const conversa = conversas.find((c) => c.contato.id === contatoId);

  if (!conversa) {
    return null;
  }

  const contatoAtual = conversa.contato;
  const novoNivel: NivelAcesso =
    dadosAtualizados.nivelAcesso ||
    dadosAtualizados.ficha?.nivelAcesso ||
    contatoAtual.nivelAcesso ||
    'geral';
  const novoCargo =
    dadosAtualizados.cargo ||
    dadosAtualizados.ficha?.cargo ||
    contatoAtual.cargo ||
    '';
  const novoSetor: SetorUsuario = normalizarSetor(
    dadosAtualizados.setor || dadosAtualizados.ficha?.setor || contatoAtual.setor
  );
  const novoNome = dadosAtualizados.nome || contatoAtual.nome;
  const novoTelefone = dadosAtualizados.telefone || contatoAtual.telefone;
  const novasObservacoes =
    dadosAtualizados.ficha?.observacoes !== undefined
      ? dadosAtualizados.ficha.observacoes
      : contatoAtual.ficha?.observacoes || '';

  conversa.contato = {
    id: contatoAtual.id,
    nome: novoNome,
    telefone: novoTelefone,
    avatarCor: contatoAtual.avatarCor,
    cargo: novoCargo,
    setor: novoSetor,
    nivelAcesso: novoNivel,
    titularVinculado: dadosAtualizados.titularVinculado || contatoAtual.titularVinculado,
    ficha: {
      cargo: novoCargo,
      setor: novoSetor,
      nivelAcesso: novoNivel,
      observacoes: novasObservacoes,
      titularVinculado: dadosAtualizados.titularVinculado || contatoAtual.titularVinculado,
    },
  };

  await salvarConversa(conversa);
  return conversa;
}

export async function adicionarMensagem(
  conversaId: string,
  mensagem: Mensagem
): Promise<Conversa | null> {
  const conversa = await obterConversaPorId(conversaId);
  if (!conversa) {
    return null;
  }

  conversa.mensagens.push(mensagem);
  conversa.ultimaAtualizacao = new Date().toISOString();

  if (mensagem.remetente === 'cliente') {
    conversa.naoLidas = (conversa.naoLidas || 0) + 1;
  }

  await salvarConversa(conversa);
  return conversa;
}

export async function marcarComoLida(conversaId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('conversas')
      .update({ nao_lidas: 0 })
      .eq('id', conversaId);
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao marcar conversa como lida:', err);
  }
}

// ==========================================
// GERENCIAMENTO DE DOCUMENTOS DO COFRE
// ==========================================

function mapearLinhaDocumento(row: any): DocumentoRegistro {
  return {
    id: row.id,
    titulo: row.titulo ? row.titulo.trim() : '',
    arquivo: row.arquivo ? row.arquivo.trim() : '',
    tipo: row.tipo ? row.tipo.trim() : undefined,
    titular: row.titular ? row.titular.trim() : undefined,
    descricao: row.descricao ? row.descricao.trim() : undefined,
    apelidos: row.apelidos || [],
    visibilidade: (row.visibilidade as VisibilidadeDoc) || 'diretoria',
    tamanho: row.tamanho ? row.tamanho.trim() : undefined,
    dataCadastro: row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : undefined,
    statusIndexacao: row.status_indexacao || 'indexado',
    erroIndexacao: row.erro_indexacao || undefined,
    dataValidade: row.data_validade !== undefined ? row.data_validade : null,
    origemValidade: row.origem_validade || undefined,
    historicoValidade: row.historico_validade || undefined,
    silenciarAlertas: Boolean(row.silenciar_alertas),
    trechoValidade: row.trecho_validade || undefined,
    storagePath: row.storage_path ? row.storage_path.trim() : (row.arquivo ? row.arquivo.trim() : ''),
  };
}

export async function obterTodosDocumentos(): Promise<DocumentoRegistro[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('documentos')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter documentos:', error);
      return [];
    }

    const docs = (data || [])
      // Filtra registros que são apenas indexação de texto de conhecimento (ex: txt temporário de base de conhecimento)
      .filter((d: any) => !d.arquivo?.startsWith('conhecimento_') && !d.tipo?.includes('conhecimento'))
      .map(mapearLinhaDocumento);

    // Atualiza cache de nomes de titulares
    const nomes = docs.map((d) => d.titular).filter(Boolean) as string[];
    atualizarCacheNomes(nomes);

    return docs;
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao consultar documentos:', err);
    return [];
  }
}

export async function salvarDocumentos(documentos: DocumentoRegistro[]): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    for (const doc of documentos) {
      await adicionarDocumento(doc);
    }
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro em salvarDocumentos:', err);
  }
}

export async function adicionarDocumento(documento: DocumentoRegistro): Promise<DocumentoRegistro> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = {
      titulo: documento.titulo.trim(),
      arquivo: documento.arquivo.trim(),
      tipo: documento.tipo ? documento.tipo.trim() : 'Documento Pessoal',
      titular: documento.titular ? documento.titular.trim() : null,
      descricao: documento.descricao ? documento.descricao.trim() : null,
      apelidos: documento.apelidos || [],
      visibilidade: documento.visibilidade || 'diretoria',
      tamanho: documento.tamanho ? documento.tamanho.trim() : null,
      status_indexacao: documento.statusIndexacao || 'indexado',
      erro_indexacao: documento.erroIndexacao || null,
      data_validade: documento.dataValidade || null,
      origem_validade: documento.origemValidade || null,
      historico_validade: documento.historicoValidade || null,
      silenciar_alertas: Boolean(documento.silenciarAlertas),
      trecho_validade: documento.trechoValidade || null,
      storage_path: documento.storagePath ? documento.storagePath.trim() : sanitizarChaveStorage(documento.arquivo.trim()),
    };

    // Se já tiver UUID válido, faz upsert pelo ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documento.id);
    if (isUuid) {
      payload.id = documento.id;
    } else {
      payload.metadata = { id_legado: documento.id };
    }

    const { data, error } = await supabase
      .from('documentos')
      .upsert(payload, { onConflict: isUuid ? 'id' : undefined })
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao inserir documento:', error);
    } else if (data) {
      documento.id = data.id;
    }

    if (documento.titular) {
      atualizarCacheNomes([documento.titular]);
    }

    return documento;
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao persistir documento:', err);
    return documento;
  }
}

export async function obterDocumentosPorNivelAcesso(
  nivelAcesso: NivelAcesso = 'geral'
): Promise<DocumentoRegistro[]> {
  const todos = await obterTodosDocumentos();
  if (nivelAcesso === 'diretoria') {
    return todos;
  }
  return todos.filter((d) => d.visibilidade === 'geral');
}

export async function atualizarDocumento(
  id: string,
  dados: Partial<DocumentoRegistro>
): Promise<DocumentoRegistro | null> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = {};

    if (dados.titulo !== undefined) payload.titulo = dados.titulo.trim();
    if (dados.tipo !== undefined) payload.tipo = dados.tipo.trim();
    if (dados.titular !== undefined) payload.titular = dados.titular.trim();
    if (dados.descricao !== undefined) payload.descricao = dados.descricao.trim();
    if (dados.visibilidade !== undefined) payload.visibilidade = dados.visibilidade;
    if (dados.apelidos !== undefined) payload.apelidos = dados.apelidos;
    if (dados.arquivo !== undefined) payload.arquivo = dados.arquivo.trim();
    if (dados.tamanho !== undefined) payload.tamanho = dados.tamanho.trim();
    if (dados.dataValidade !== undefined) payload.data_validade = dados.dataValidade;
    if (dados.origemValidade !== undefined) payload.origem_validade = dados.origemValidade;
    if (dados.historicoValidade !== undefined) payload.historico_validade = dados.historicoValidade;
    if (dados.silenciarAlertas !== undefined) payload.silenciar_alertas = dados.silenciarAlertas;
    if (dados.trechoValidade !== undefined) payload.trecho_validade = dados.trechoValidade;
    if (dados.storagePath !== undefined) payload.storage_path = dados.storagePath.trim();

    // Busca se é UUID ou id_legado
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('documentos').update(payload);

    if (isUuid) {
      query = query.eq('id', id);
    } else {
      query = query.filter('metadata->>id_legado', 'eq', id);
    }

    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      console.error(`[Storage Supabase ⚠️] Erro ao atualizar documento ${id}:`, error);
      return null;
    }

    if (data) {
      return mapearLinhaDocumento(data);
    }

    // Se não encontrou por metadata, tenta por id direto
    const { data: dataFallback } = await supabase
      .from('documentos')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    return dataFallback ? mapearLinhaDocumento(dataFallback) : null;
  } catch (err) {
    console.error(`[Storage Supabase ⚠️] Erro ao atualizar documento ${id}:`, err);
    return null;
  }
}

export async function removerDocumento(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // 1. Busca metadados do documento antes de excluir
    let busca = supabase.from('documentos').select('id, arquivo, storage_path');
    if (isUuid) {
      busca = busca.eq('id', id);
    } else {
      busca = busca.filter('metadata->>id_legado', 'eq', id);
    }
    const { data: doc } = await busca.maybeSingle();

    if (!doc) return false;

    const realId = doc.id;
    const chaveStorage = doc.storage_path || sanitizarChaveStorage(doc.arquivo);

    // 2. Remove trechos vetoriais associados
    await supabase.from('trechos').delete().eq('documento_id', realId);

    // 3. Remove alertas associados
    await supabase.from('alertas_vencimento').delete().eq('documento_id', realId);

    // 4. Remove documento da tabela
    const { error: errDel } = await supabase.from('documentos').delete().eq('id', realId);
    if (errDel) {
      console.error(`[Storage Supabase ⚠️] Erro ao deletar documento ${realId}:`, errDel);
      return false;
    }

    // 5. Remove arquivo físico do Supabase Storage
    if (chaveStorage) {
      try {
        await supabase.storage.from('documentos').remove([chaveStorage]);
        console.log(`[Cofre Supabase 🗑️] Arquivo removido do Storage: ${chaveStorage}`);
      } catch (err) {
        console.warn(`[Cofre Supabase ⚠️] Aviso ao remover do Storage (${chaveStorage}):`, err);
      }
    }

    return true;
  } catch (err) {
    console.error(`[Storage Supabase ⚠️] Erro ao remover documento ${id}:`, err);
    return false;
  }
}

// ==========================================
// LOG DE BUSCAS SEM RESULTADO
// ==========================================

export async function obterBuscasSemResultado(): Promise<BuscaSemResultadoRegistro[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('buscas_sem_resultado')
      .select('*')
      .order('data', { ascending: false });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter buscas sem resultado:', error);
      return [];
    }

    return (data || []).map((b: any) => ({
      id: b.id,
      data: b.data,
      contatoId: b.contato_id,
      contatoNome: b.contato_nome,
      textoDoPedido: b.texto_do_pedido,
      motivo: b.motivo,
      iaAcionada: Boolean(b.ia_acionada),
      equivalenteOferecido: b.equivalente_oferecido,
    }));
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro em buscas_sem_resultado:', err);
    return [];
  }
}

export async function salvarBuscasSemResultado(
  buscas: BuscaSemResultadoRegistro[]
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const registros = buscas.map((b) => ({
      id: b.id,
      data: b.data,
      contato_id: b.contatoId,
      contato_nome: b.contatoNome,
      texto_do_pedido: b.textoDoPedido,
      motivo: b.motivo,
      ia_acionada: Boolean(b.iaAcionada),
      equivalente_oferecido: b.equivalenteOferecido || null,
    }));

    await supabase.from('buscas_sem_resultado').upsert(registros, { onConflict: 'id' });
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao salvar buscas sem resultado:', err);
  }
}

export async function registrarBuscaSemResultado(
  registro: Omit<BuscaSemResultadoRegistro, 'id' | 'data'>
): Promise<BuscaSemResultadoRegistro> {
  const novaBusca: BuscaSemResultadoRegistro = {
    id: `busca-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    data: new Date().toISOString(),
    ...registro,
  };

  try {
    const supabase = getSupabaseClient();
    await supabase.from('buscas_sem_resultado').insert({
      id: novaBusca.id,
      data: novaBusca.data,
      contato_id: novaBusca.contatoId,
      contato_nome: novaBusca.contatoNome,
      texto_do_pedido: novaBusca.textoDoPedido,
      motivo: novaBusca.motivo,
      ia_acionada: Boolean(novaBusca.iaAcionada),
      equivalente_oferecido: novaBusca.equivalenteOferecido || null,
    });
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao registrar busca sem resultado:', err);
  }

  return novaBusca;
}

// ==========================================
// GERADOR DE USUÁRIOS DE TESTE INTERNOS
// ==========================================

const NOMES_BRASILEIROS = [
  'Carlos Eduardo Silva',
  'Mariana Albuquerque',
  'Rodrigo Mendonça',
  'Juliana Castro',
  'Gabriel Silveira',
  'Beatriz Camargo',
  'Felipe Nogueira',
  'Camila Vasconcelos',
  'Thiago Siqueira',
  'Larissa Pires',
  'Lucas Fontana',
  'Fernanda Guimarães',
  'André Sanches',
  'Renata Meireles',
  'Marcelo Fagundes',
];

const CARGOS_TESTE = [
  'Diretor Executivo',
  'Diretora Financeira',
  'Gerente de Obras',
  'Engenheiro Civil Sênior',
  'Coordenador de Suprimentos',
  'Analista de Recursos Humanos',
  'Gerente Administrativo',
  'Supervisor Comercial',
  'Diretor de Novos Negócios',
  'Engenheiro de Planejamento',
];

const CORES_AVATAR = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#06b6d4',
  '#14b8a6',
];

export async function criarConversaTeste(): Promise<Conversa> {
  const nomeAleatorio = NOMES_BRASILEIROS[Math.floor(Math.random() * NOMES_BRASILEIROS.length)];
  const cargoAleatorio = CARGOS_TESTE[Math.floor(Math.random() * CARGOS_TESTE.length)];
  const setorAleatorio = SETORES_VALIDOS[Math.floor(Math.random() * SETORES_VALIDOS.length)];
  const nivelAcessoAleatorio: NivelAcesso = Math.random() < 0.5 ? 'diretoria' : 'geral';
  const sufixoTelefone = Math.floor(1000 + Math.random() * 9000);
  const corAleatoria = CORES_AVATAR[Math.floor(Math.random() * CORES_AVATAR.length)];

  const novoId = `conv-${Date.now()}`;
  const novoContatoId = `cont-${Date.now()}`;

  const mensagemInicial =
    nivelAcessoAleatorio === 'diretoria'
      ? 'Olá Vega, você pode me enviar o Contrato Social consolidado da empresa?'
      : 'Olá Vega, onde encontro o Regimento Interno e Código de Conduta da Delta Plan?';

  const novaConversa: Conversa = {
    id: novoId,
    contato: {
      id: novoContatoId,
      nome: nomeAleatorio,
      telefone: `+55 (11) 9${Math.floor(8000 + Math.random() * 1000)}-${sufixoTelefone}`,
      avatarCor: corAleatoria,
      cargo: cargoAleatorio,
      setor: setorAleatorio,
      nivelAcesso: nivelAcessoAleatorio,
      ficha: {
        cargo: cargoAleatorio,
        setor: setorAleatorio,
        nivelAcesso: nivelAcessoAleatorio,
        observacoes: 'Usuário de teste criado no painel.',
      },
    },
    naoLidas: 0,
    ultimaAtualizacao: new Date().toISOString(),
    mensagens: [
      {
        id: `msg-${Date.now()}-1`,
        remetente: 'cliente',
        nomeRemetente: nomeAleatorio,
        horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        texto: mensagemInicial,
      },
    ],
  };

  await salvarConversa(novaConversa);
  return novaConversa;
}

// ==========================================
// REGISTROS DE USO IA (SUPABASE)
// ==========================================

export async function obterRegistrosUsoIA(): Promise<RegistroUsoIA[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('uso_ia')
      .select('*')
      .order('data', { ascending: false });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter uso_ia:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      data: item.data,
      provedor: item.provedor,
      modelo: item.modelo,
      contatoId: item.contato_id,
      contatoNome: item.contato_nome,
      motivo: item.motivo,
      tokensEntrada: item.tokens_entrada,
      tokensSaida: item.tokens_saida,
      custoEstimado: Number(item.custo_estimado || 0),
      sucesso: Boolean(item.sucesso),
      erro: item.erro,
      estimado: Boolean(item.estimado),
    }));
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao consultar uso_ia:', err);
    return [];
  }
}

export async function adicionarRegistroUsoIA(registro: RegistroUsoIA): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('uso_ia').insert({
      id: registro.id,
      data: registro.data || new Date().toISOString(),
      provedor: registro.provedor,
      modelo: registro.modelo,
      contato_id: registro.contatoId || null,
      contato_nome: registro.contatoNome || null,
      motivo: registro.motivo,
      tokens_entrada: registro.tokensEntrada || 0,
      tokens_saida: registro.tokensSaida || 0,
      custo_estimado: registro.custoEstimado || 0,
      sucesso: registro.sucesso !== undefined ? registro.sucesso : true,
      erro: registro.erro || null,
      estimado: Boolean(registro.estimado),
    });
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao salvar uso_ia:', err);
  }
}

// ==========================================
// TABELA DE PREÇOS (CONFIGURAÇÃO ESTÁTICA)
// ==========================================

const TABELA_PRECOS_PADRAO: TabelaPrecos = {
  'gpt-5.4-mini': {
    precoEntradaPorMilhao: 0.90,
    precoSaidaPorMilhao: 3.60,
    moeda: 'BRL',
  },
  'text-embedding-3-small': {
    precoEntradaPorMilhao: 0.12,
    precoSaidaPorMilhao: 0.12,
    moeda: 'BRL',
  },
  'gpt-transcribe': {
    precoEntradaPorMilhao: 0,
    precoSaidaPorMilhao: 0,
    precoPorMinutoAudio: 0.0045, // $0.0045 por minuto de áudio
    moeda: 'USD',
  },
  'whisper-1': {
    precoEntradaPorMilhao: 0,
    precoSaidaPorMilhao: 0,
    precoPorMinutoAudio: 0.0060, // $0.0060 por minuto de áudio
    moeda: 'USD',
  },
};

export async function obterTabelaPrecos(): Promise<TabelaPrecos> {
  try {
    const arqEfetivo = fs.existsSync(PRECOS_FILE) ? PRECOS_FILE : PRECOS_FILE_FALLBACK;
    if (fs.existsSync(arqEfetivo)) {
      const conteudo = fs.readFileSync(arqEfetivo, 'utf-8');
      const dados = JSON.parse(conteudo);
      return { ...TABELA_PRECOS_PADRAO, ...dados };
    }
  } catch {}
  return TABELA_PRECOS_PADRAO;
}

/**
 * Obtém o preço por minuto para o modelo de áudio a partir da tabela de preços configurada.
 * Se não configurado explicitamente no modelo, utiliza os preços de mercado oficiais.
 */
export async function obterPrecoMinutoAudio(modelo: string): Promise<number> {
  const tabela = await obterTabelaPrecos();
  const config = tabela[modelo];
  if (config?.precoPorMinutoAudio !== undefined) {
    return config.precoPorMinutoAudio;
  }
  if (modelo.includes('gpt-transcribe')) return 0.0045;
  if (modelo.includes('whisper')) return 0.0060;
  return 0.0045;
}

export async function salvarTabelaPrecos(tabela: TabelaPrecos): Promise<void> {
  try {
    const dir = path.dirname(PRECOS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRECOS_FILE, JSON.stringify(tabela, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar precos.json:', err);
  }
}

// ==========================================
// BASE DE CONHECIMENTO (SUPABASE)
// ==========================================

export async function obterTodosConhecimentos(): Promise<ItemConhecimento[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('conhecimento')
      .select('id, titulo, categoria, conteudo, data_atualizacao')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter conhecimento:', error);
      return [];
    }

    return (data || []).map((k: any) => ({
      id: k.id,
      titulo: k.titulo,
      categoria: k.categoria,
      conteudo: k.conteudo,
      dataAtualizacao: k.data_atualizacao || '',
    }));
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao consultar conhecimento:', err);
    return [];
  }
}

export async function adicionarConhecimento(
  dados: Omit<ItemConhecimento, 'id' | 'dataAtualizacao'>
): Promise<ItemConhecimento> {
  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString('pt-BR');

  const novoItem: ItemConhecimento = {
    id: `k-${Date.now()}`,
    titulo: dados.titulo.trim(),
    categoria: dados.categoria.trim() || 'Geral',
    conteudo: dados.conteudo.trim(),
    dataAtualizacao: dataFormatada,
  };

  try {
    const supabase = getSupabaseClient();
    await supabase.from('conhecimento').insert({
      id: novoItem.id,
      titulo: novoItem.titulo,
      categoria: novoItem.categoria,
      conteudo: novoItem.conteudo,
      data_atualizacao: novoItem.dataAtualizacao,
    });
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao adicionar conhecimento:', err);
  }

  return novoItem;
}

export async function removerConhecimento(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('conhecimento').delete().eq('id', id);
    return !error;
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao remover conhecimento:', err);
    return false;
  }
}

export async function atualizarConhecimento(
  id: string,
  dados: Partial<Omit<ItemConhecimento, 'id'>>
): Promise<ItemConhecimento | null> {
  try {
    const supabase = getSupabaseClient();
    const payload: any = {
      data_atualizacao: new Date().toLocaleDateString('pt-BR'),
    };
    if (dados.titulo !== undefined) payload.titulo = dados.titulo.trim();
    if (dados.categoria !== undefined) payload.categoria = dados.categoria.trim();
    if (dados.conteudo !== undefined) payload.conteudo = dados.conteudo.trim();

    const { data, error } = await supabase
      .from('conhecimento')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      titulo: data.titulo,
      categoria: data.categoria,
      conteudo: data.conteudo,
      dataAtualizacao: data.data_atualizacao,
    };
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao atualizar conhecimento:', err);
    return null;
  }
}

// ==========================================
// FICHAS DE TITULARES (SUPABASE)
// ==========================================

export async function obterTodosTitulares(): Promise<FichaTitular[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('titulares')
      .select('id, nome, campos, atualizado_em')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao obter titulares:', error);
      return [];
    }

    const titulares = (data || []).map((t: any) => ({
      id: t.id,
      nome: t.nome,
      campos: t.campos || {},
      atualizadoEm: t.atualizado_em || '',
    }));

    atualizarCacheNomes(titulares.map((t) => t.nome));
    return titulares;
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao consultar titulares:', err);
    return [];
  }
}

export async function obterTitularPorId(id: string): Promise<FichaTitular | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('titulares')
      .select('id, nome, campos, atualizado_em')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      nome: data.nome,
      campos: data.campos || {},
      atualizadoEm: data.atualizado_em || '',
    };
  } catch (err) {
    console.error(`[Storage Supabase ⚠️] Erro ao buscar titular por id ${id}:`, err);
    return null;
  }
}

export async function obterTitularPorNome(nome: string): Promise<FichaTitular | null> {
  if (!nome || !nome.trim()) return null;
  const todos = await obterTodosTitulares();
  const nomeLower = nome.toLowerCase().trim();

  return (
    todos.find(
      (t) =>
        t.nome.toLowerCase().trim() === nomeLower ||
        t.nome.toLowerCase().includes(nomeLower) ||
        nomeLower.includes(t.nome.toLowerCase()) ||
        t.id.toLowerCase().includes(nomeLower)
    ) || null
  );
}

export function obterNomesTitularesCadastrados(): string[] {
  return Array.from(cacheNomesTitulares);
}

export async function salvarOuAtualizarTitular(titular: FichaTitular): Promise<FichaTitular> {
  try {
    const supabase = getSupabaseClient();
    const atualizadoEm = new Date().toLocaleDateString('pt-BR');

    const { error } = await supabase
      .from('titulares')
      .upsert({
        id: titular.id,
        nome: titular.nome,
        campos: titular.campos || {},
        atualizado_em: atualizadoEm,
      }, { onConflict: 'id' });

    if (error) {
      console.error('[Storage Supabase ⚠️] Erro ao salvar titular:', error);
    } else {
      atualizarCacheNomes([titular.nome]);
    }
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao persistir titular:', err);
  }

  return titular;
}

export async function removerTitular(id: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('titulares').delete().eq('id', id);
    return !error;
  } catch (err) {
    console.error('[Storage Supabase ⚠️] Erro ao remover titular:', err);
    return false;
  }
}
