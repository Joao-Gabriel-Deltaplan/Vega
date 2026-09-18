import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  obterTodasConversas,
  obterConversaPorId,
  atualizarContato,
  adicionarMensagem,
  marcarComoLida,
  criarConversaTeste,
  obterTodosDocumentos,
  obterDocumentosPorNivelAcesso,
  adicionarDocumento,
  atualizarDocumento,
  removerDocumento,
  obterBuscasSemResultado,
  registrarBuscaSemResultado,
  obterRegistrosUsoIA,
  obterTabelaPrecos,
  salvarTabelaPrecos,
  obterTodosConhecimentos,
  adicionarConhecimento,
  atualizarConhecimento,
  removerConhecimento,
  obterTodosTitulares,
  obterTitularPorId,
  obterTitularPorNome,
  salvarOuAtualizarTitular,
  removerTitular,
} from './storage.js';
import { buscarDocumentos, obterFraseAcompanhamento, verificarConfirmacao } from './busca/motor.js';
import { buscarConhecimento } from './busca/motorConhecimento.js';
import {
  formatarRespostaPedidoGenerico,
  formatarRespostaConsultaCampos,
} from './busca/motorTitulares.js';
import { classificarIntencao } from './busca/intencao.js';
import {
  interpretarComIA,
  isModoSimuladorAtivo,
  obterDataPacifico,
  obterDataPacificoDeIso,
} from './ai/openaiProvider.js';
import { processarMensagemChat } from './chat/chatOrquestrador.js';
import {
  salvarRastro,
  obterRastroPorMensagemId,
  obterRastroPorId,
  limparRastrosAntigos,
} from './rastros/rastroService.js';
import { RastroRegistro } from './types.js';
import { mascararDadosSensiveis } from './utils/segurancaUtils.js';
import {
  indexarDocumentoBackground,
  removerDocumentoSupabaseBackground,
  indexarConhecimentoBackground,
  removerConhecimentoSupabaseBackground,
  sincronizarSupabaseNoStartup,
} from './indexador/indexadorAutomatico.js';
import {
  obterTodosAlertas,
  marcarAlertaComoLido,
  marcarTodosAlertasComoLidos,
  executarRotinaVerificacaoVencimentos,
  sincronizarValidadesDocumentosExistentes,
  zerarAlertasDocumento,
  silenciarAlertasDocumento,
} from './vencimentos/alertaVencimentoService.js';
import {
  detectarBlocoPdf,
  gerarPdfDeMarkdown,
  gerarPdfDemonstracaoSeNecessario,
  assegurarDiretorioArquivos,
  processarEntregaDocumento,
  criarAnexoParaDocumento,
} from './pdfService.js';
import {
  Mensagem,
  Anexo,
  DocumentoRegistro,
  NivelAcesso,
  OpcaoDocumento,
  MetricasUsoIA,
  MotivoBuscaSemResultado,
  ItemConhecimento,
  FichaTitular,
  CampoTitularId,
  CampoTitular,
} from './types.js';
import { ASSISTENTE } from './config/assistente.js';
import { extrairPrimeiroNome } from './utils/nomeUtils.js';
import { analisarDocumentoParaCofre } from './analiseDocumentoService.js';
import { calcularSimilaridade } from './utils/textoUtils.js';
import {
  validarTokenWebhook,
  extrairDadosEvento,
  processarEventoEvolution,
  enviarMensagemWhatsApp,
} from './whatsapp/whatsappWebhookService.js';
import {
  obterBufferArquivo,
  uploadArquivoStorage,
  sanitizarChaveStorage,
} from './utils/storageUtils.js';
import { autenticarPainel, validarTokenSessao } from './auth/authService.js';
import { authMiddleware } from './auth/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega variáveis do .env na raiz
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = parseInt(process.env.PORT || '4301', 10);
const FRONTEND_PORT = process.env.VITE_PORT || '4300';
const ARQUIVOS_DIR = path.resolve(__dirname, '../../arquivos');

// Assegura diretório de arquivos e gera arquivo de demonstração se necessário
assegurarDiretorioArquivos();
gerarPdfDemonstracaoSeNecessario().catch(console.error);

// Middlewares
app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requisições sem origin (como curl, chamadas server-to-server, webhooks ou mesma origem)
      if (!origin) return callback(null, true);
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.endsWith('.railway.app') ||
        origin.endsWith('.up.railway.app')
      ) {
        return callback(null, true);
      }
      // Permite qualquer origem autorizada
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

// ================================================================
// ENDPOINTS PÚBLICOS DE AUTENTICAÇÃO DO PAINEL
// ================================================================

// POST /api/auth/login (Autenticação via senha mestra)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { senha, usuario } = req.body;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const resultado = await autenticarPainel({ senha, usuario, ip });

    if (!resultado.sucesso) {
      const statusHttp = resultado.bloqueado ? 429 : 401;
      return res.status(statusHttp).json({ erro: resultado.erro });
    }

    const isProd =
      process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';

    res.cookie('vega_session', resultado.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
      path: '/',
    });

    return res.status(200).json({
      sucesso: true,
      usuario: resultado.usuario,
    });
  } catch (erro: any) {
    console.error('[Auth ❌] Erro interno ao processar login:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar autenticação.' });
  }
});

// GET /api/auth/status (Verifica validade da sessão atual)
app.get('/api/auth/status', (req, res) => {
  const token = req.cookies?.vega_session;
  if (!token) {
    return res.status(200).json({ autenticado: false });
  }

  const sessao = validarTokenSessao(token);
  if (!sessao) {
    return res.status(200).json({ autenticado: false });
  }

  return res.status(200).json({
    autenticado: true,
    usuario: {
      userId: sessao.userId,
      nome: sessao.nome,
      role: sessao.role,
    },
  });
});

// POST /api/auth/logout (Encerra a sessão e limpa cookie)
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('vega_session', { path: '/' });
  return res.status(200).json({ sucesso: true });
});

// ================================================================
// MIDDLEWARE DE PROTEÇÃO GLOBAL (Exige sessão para /api/* e /arquivos/*)
// ================================================================
app.use(authMiddleware);

// Servir arquivos prioritariamente via Supabase Storage (Apenas com sessão válida)
app.get('/arquivos/:nome', async (req, res) => {
  try {
    const nomeArquivo = decodeURIComponent(path.basename(req.params.nome));
    const arquivoData = await obterBufferArquivo(nomeArquivo);

    if (arquivoData) {
      res.setHeader('Content-Type', arquivoData.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nomeArquivo)}"`);
      return res.send(arquivoData.buffer);
    }

    // Fallback estático caso exista em disco local
    const caminhoArquivo = path.join(ARQUIVOS_DIR, nomeArquivo);
    if (fs.existsSync(caminhoArquivo)) {
      return res.download(caminhoArquivo, nomeArquivo);
    }

    return res.status(404).json({ erro: 'Arquivo não encontrado' });
  } catch (err) {
    console.error('Erro ao servir arquivo:', err);
    if (!res.headersSent) {
      res.status(500).json({ erro: 'Erro ao obter arquivo' });
    }
  }
});

// Fallback estático
app.use('/arquivos', express.static(ARQUIVOS_DIR));

// GET /api/conversas
app.get('/api/conversas', async (req, res) => {
  try {
    const conversas = await obterTodasConversas();
    res.json(conversas);
  } catch (erro) {
    console.error('Erro ao buscar conversas:', erro);
    res.status(500).json({ erro: 'Erro ao buscar conversas' });
  }
});

// GET /api/conversas/:id
app.get('/api/conversas/:id', async (req, res) => {
  try {
    const conversa = await obterConversaPorId(req.params.id);
    if (!conversa) {
      return res.status(404).json({ erro: 'Conversa não encontrada' });
    }
    // Marca como lida ao abrir
    await marcarComoLida(req.params.id);
    res.json(conversa);
  } catch (erro) {
    console.error('Erro ao buscar conversa:', erro);
    res.status(500).json({ erro: 'Erro ao buscar conversa' });
  }
});

// POST /api/conversas/nova-teste
app.post('/api/conversas/nova-teste', async (req, res) => {
  try {
    const novaConversa = await criarConversaTeste();
    res.status(201).json(novaConversa);
  } catch (erro) {
    console.error('Erro ao criar conversa de teste:', erro);
    res.status(500).json({ erro: 'Erro ao criar conversa de teste' });
  }
});

// PATCH /api/contatos/:id (Perfil do Usuário Interno)
app.patch('/api/contatos/:id', async (req, res) => {
  try {
    const contatoId = req.params.id;
    const dadosAtualizados = req.body;
    const conversaAtualizada = await atualizarContato(contatoId, dadosAtualizados);

    if (!conversaAtualizada) {
      return res.status(404).json({ erro: 'Contato não encontrado' });
    }

    res.json(conversaAtualizada);
  } catch (erro) {
    console.error('Erro ao atualizar contato:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar contato' });
  }
});

// GET /api/documentos (Lista documentos do cofre)
app.get('/api/documentos', async (req, res) => {
  try {
    const nivelAcesso = req.query.nivelAcesso as 'diretoria' | 'geral' | undefined;
    const documentos = nivelAcesso
      ? await obterDocumentosPorNivelAcesso(nivelAcesso)
      : await obterTodosDocumentos();
    res.json(documentos);
  } catch (erro) {
    console.error('Erro ao listar documentos:', erro);
    res.status(500).json({ erro: 'Erro ao listar documentos' });
  }
});

// POST /api/documentos/analisar (Analisa arquivo drag & drop e sugere metadados)
app.post('/api/documentos/analisar', async (req, res) => {
  try {
    const { nomeArquivo, mimeType, base64, tamanho } = req.body;
    if (!nomeArquivo) {
      return res.status(400).json({ erro: 'Nome do arquivo é obrigatório para análise.' });
    }

    const sugestoes = await analisarDocumentoParaCofre({
      nomeArquivo,
      mimeType,
      base64,
      tamanho,
    });

    res.json(sugestoes);
  } catch (erro) {
    console.error('Erro ao analisar documento:', erro);
    res.status(500).json({ erro: 'Erro ao analisar documento' });
  }
});

// POST /api/documentos (Upload e registro no cofre com visibilidade)
app.post('/api/documentos', async (req, res) => {
  try {
    const {
      titulo,
      arquivo,
      tipo,
      titular,
      descricao,
      visibilidade,
      apelidos,
      tamanho,
      base64,
      camposTitularConferidos,
    } = req.body;
    if (!titulo || !arquivo) {
      return res.status(400).json({ erro: 'Título e nome de arquivo são obrigatórios.' });
    }

    assegurarDiretorioArquivos();
    const nomeArquivoSanitizado = path.basename(arquivo);
    const caminhoDestino = path.join(ARQUIVOS_DIR, nomeArquivoSanitizado);
    let storagePath: string = sanitizarChaveStorage(nomeArquivoSanitizado);

    if (base64) {
      const base64Limpo = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Limpo, 'base64');
      try {
        fs.writeFileSync(caminhoDestino, buffer);
      } catch {}

      try {
        storagePath = await uploadArquivoStorage(nomeArquivoSanitizado, buffer);
      } catch (errUpload) {
        console.error('[Cofre Storage ⚠️] Erro no upload para Supabase Storage:', errUpload);
      }
    }

    const apelidosArray = Array.isArray(apelidos)
      ? apelidos
      : typeof apelidos === 'string'
      ? apelidos.split(',').map((a: string) => a.trim()).filter(Boolean)
      : [];

    const novoDoc: DocumentoRegistro = {
      id: `doc-${Date.now()}`,
      titulo: titulo.trim(),
      arquivo: nomeArquivoSanitizado,
      tipo: tipo ? tipo.trim() : undefined,
      titular: titular ? titular.trim() : undefined,
      descricao: descricao ? descricao.trim() : '',
      apelidos: apelidosArray,
      visibilidade: visibilidade === 'geral' ? 'geral' : 'diretoria',
      tamanho: tamanho || undefined,
      dataCadastro: new Date().toLocaleDateString('pt-BR'),
      dataValidade: req.body.dataValidade !== undefined ? (req.body.dataValidade ? String(req.body.dataValidade).trim() : null) : undefined,
      origemValidade: req.body.dataValidade ? 'extraído automaticamente' : undefined,
      storagePath,
    };

    novoDoc.statusIndexacao = 'pendente';
    await adicionarDocumento(novoDoc);

    // Dispara a indexação vetorial e extração de campos em background sem travar a resposta HTTP
    indexarDocumentoBackground(novoDoc);

    // Se houver campos de titular conferidos pelo usuário na tela, atualiza a ficha do titular
    if (titular && titular.trim() && camposTitularConferidos && typeof camposTitularConferidos === 'object') {
      const titularNomeTrim = titular.trim();
      let ficha = await obterTitularPorNome(titularNomeTrim);

      if (!ficha) {
        const idSanitizado = `tit_${titularNomeTrim.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        ficha = {
          id: idSanitizado,
          nome: titularNomeTrim,
          campos: {},
          atualizadoEm: new Date().toLocaleDateString('pt-BR'),
        };
      }

      for (const [campoKey, item] of Object.entries(camposTitularConferidos)) {
        const cKey = campoKey as CampoTitularId;
        const cItem = item as { valor?: string; conferido?: boolean };
        if (cItem && cItem.valor && cItem.valor.trim()) {
          const campoAtual = ficha.campos[cKey];
          // REGRA INEGOCIÁVEL: Nunca sobrescrever campos corrigidos manualmente pelo chat
          if (campoAtual && (campoAtual.manual || campoAtual.origem === 'corrigido pelo chat')) {
            continue;
          }
          // REGRA: Apenas campos com conferido === true são marcados como conferidos
          const estaConferido = Boolean(cItem.conferido);
          ficha.campos[cKey] = {
            valor: cItem.valor.trim(),
            origem: novoDoc.id,
            origemNome: novoDoc.titulo || novoDoc.tipo || 'Documento',
            origemVisibilidade: novoDoc.visibilidade,
            conferido: estaConferido,
            dataConferencia: estaConferido ? new Date().toLocaleDateString('pt-BR') : undefined,
          };
        }
      }

      await salvarOuAtualizarTitular(ficha);
    }

    res.status(201).json(novoDoc);
  } catch (erro) {
    console.error('Erro ao cadastrar documento:', erro);
    res.status(500).json({ erro: 'Erro ao cadastrar documento' });
  }
});

// GET /api/titulares (Lista todas as fichas de titulares cadastradas)
app.get('/api/titulares', async (req, res) => {
  try {
    const titulares = await obterTodosTitulares();
    res.json(titulares);
  } catch (erro) {
    console.error('Erro ao listar titulares:', erro);
    res.status(500).json({ erro: 'Erro ao carregar fichas de titulares.' });
  }
});

// GET /api/titulares/:id (Retorna detalhes de um titular específico)
app.get('/api/titulares/:id', async (req, res) => {
  try {
    const titular = await obterTitularPorId(req.params.id);
    if (!titular) {
      return res.status(404).json({ erro: 'Titular não encontrado.' });
    }
    res.json(titular);
  } catch (erro) {
    console.error('Erro ao buscar titular:', erro);
    res.status(500).json({ erro: 'Erro ao buscar titular.' });
  }
});

// POST /api/titulares (Cria nova ficha de titular)
app.post('/api/titulares', async (req, res) => {
  try {
    const { nome, campos } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: 'Nome do titular é obrigatório.' });
    }

    const idSanitizado = `tit_${nome.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const novaFicha: FichaTitular = {
      id: idSanitizado,
      nome: nome.trim(),
      campos: campos || {},
      atualizadoEm: new Date().toLocaleDateString('pt-BR'),
    };

    await salvarOuAtualizarTitular(novaFicha);
    res.status(201).json(novaFicha);
  } catch (erro) {
    console.error('Erro ao cadastrar titular:', erro);
    res.status(500).json({ erro: 'Erro ao salvar ficha de titular.' });
  }
});

// PATCH /api/titulares/:id (Atualiza campos da ficha do titular com reconferência)
app.patch('/api/titulares/:id', async (req, res) => {
  try {
    const fichaExistente = await obterTitularPorId(req.params.id);
    if (!fichaExistente) {
      return res.status(404).json({ erro: 'Titular não encontrado.' });
    }

    const { nome, campos } = req.body;
    if (nome) fichaExistente.nome = nome.trim();
    if (campos && typeof campos === 'object') {
      fichaExistente.campos = {
        ...fichaExistente.campos,
        ...campos,
      };
    }
    fichaExistente.atualizadoEm = new Date().toLocaleDateString('pt-BR');

    await salvarOuAtualizarTitular(fichaExistente);
    res.json(fichaExistente);
  } catch (erro) {
    console.error('Erro ao atualizar titular:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar titular.' });
  }
});

// DELETE /api/titulares/:id (Remove ficha do titular)
app.delete('/api/titulares/:id', async (req, res) => {
  try {
    const sucesso = await removerTitular(req.params.id);
    if (!sucesso) {
      return res.status(404).json({ erro: 'Titular não encontrado para exclusão.' });
    }
    res.json({ sucesso: true, mensagem: 'Ficha do titular excluída com sucesso.' });
  } catch (erro) {
    console.error('Erro ao excluir titular:', erro);
    res.status(500).json({ erro: 'Erro ao excluir titular.' });
  }
});

// PATCH /api/documentos/:id (Editar metadados: título, tipo, titular, descrição, visibilidade, apelidos, validade, silenciarAlertas)
app.patch('/api/documentos/:id', async (req, res) => {
  try {
    const { titulo, tipo, titular, descricao, visibilidade, apelidos, dataValidade, silenciarAlertas, arquivo } = req.body;
    const apelidosArray =
      apelidos !== undefined
        ? Array.isArray(apelidos)
          ? apelidos
          : typeof apelidos === 'string'
          ? apelidos.split(',').map((a: string) => a.trim()).filter(Boolean)
          : []
        : undefined;

    const camposParaAtualizar: Partial<DocumentoRegistro> = {
      titulo,
      tipo,
      titular,
      descricao,
      visibilidade,
      apelidos: apelidosArray,
    };

    if (arquivo !== undefined) {
      camposParaAtualizar.arquivo = arquivo;
      // Se o documento for substituído, os alertas voltam a funcionar
      camposParaAtualizar.silenciarAlertas = false;
    }

    if (silenciarAlertas !== undefined) {
      camposParaAtualizar.silenciarAlertas = Boolean(silenciarAlertas);
    }

    if (dataValidade !== undefined) {
      camposParaAtualizar.dataValidade = dataValidade ? String(dataValidade).trim() : null;
      camposParaAtualizar.origemValidade = 'manual';
    }

    const docAtualizado = await atualizarDocumento(req.params.id, camposParaAtualizar);

    if (!docAtualizado) {
      return res.status(404).json({ erro: 'Documento não encontrado.' });
    }

    if (dataValidade !== undefined || silenciarAlertas === true) {
      await zerarAlertasDocumento(req.params.id);
    }

    // Dispara reindexação em background para atualizar metadados no Supabase
    indexarDocumentoBackground(docAtualizado);

    res.json(docAtualizado);
  } catch (erro) {
    console.error('Erro ao atualizar documento:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar documento.' });
  }
});

// POST /api/vencimentos/documentos/:id/silenciar (Ativa ou desativa a opção "Não alertar mais" de um documento)
app.post('/api/vencimentos/documentos/:id/silenciar', async (req, res) => {
  try {
    const { id } = req.params;
    const { silenciar } = req.body;
    const doc = await silenciarAlertasDocumento(id, silenciar !== false);
    if (!doc) {
      return res.status(404).json({ erro: 'Documento não encontrado.' });
    }
    res.json({ sucesso: true, documento: doc });
  } catch (erro) {
    console.error('Erro ao silenciar alertas do documento:', erro);
    res.status(500).json({ erro: 'Erro ao alterar configuração de alertas do documento.' });
  }
});

// DELETE /api/documentos/:id (Exclui metadados do JSON e apaga o arquivo físico)
app.delete('/api/documentos/:id', async (req, res) => {
  try {
    const todosDocs = await obterTodosDocumentos();
    const docParaExcluir = todosDocs.find((d) => d.id === req.params.id);

    const sucesso = await removerDocumento(req.params.id);
    if (!sucesso) {
      return res.status(404).json({ erro: 'Documento não encontrado para exclusão.' });
    }

    if (docParaExcluir) {
      removerDocumentoSupabaseBackground(docParaExcluir.arquivo);
    }

    res.json({ sucesso: true, mensagem: 'Documento e arquivo físico excluídos com sucesso.' });
  } catch (erro) {
    console.error('Erro ao excluir documento:', erro);
    res.status(500).json({ erro: 'Erro ao excluir documento.' });
  }
});

// ==========================================
// ROTAS DE ALERTAS DE VENCIMENTO DE DOCUMENTOS
// ==========================================

// GET /api/vencimentos/alertas (Lista todos os alertas de vencimento e quantidade de não lidos)
app.get('/api/vencimentos/alertas', async (req, res) => {
  try {
    const alertas = await obterTodosAlertas();
    const naoLidos = alertas.filter((a) => !a.lido).length;
    res.json({
      alertas,
      total: alertas.length,
      naoLidos,
    });
  } catch (erro) {
    console.error('Erro ao listar alertas de vencimento:', erro);
    res.status(500).json({ erro: 'Erro ao listar alertas de vencimento.' });
  }
});

// POST /api/vencimentos/alertas/:id/lido (Marca um alerta específico como lido)
app.post('/api/vencimentos/alertas/:id/lido', async (req, res) => {
  try {
    const sucesso = await marcarAlertaComoLido(req.params.id);
    if (!sucesso) {
      return res.status(404).json({ erro: 'Alerta não encontrado.' });
    }
    res.json({ sucesso: true });
  } catch (erro) {
    console.error('Erro ao marcar alerta como lido:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar alerta.' });
  }
});

// POST /api/vencimentos/alertas/marcar-todos-lidos (Marca todos os alertas como lidos)
app.post('/api/vencimentos/alertas/marcar-todos-lidos', async (req, res) => {
  try {
    const totalAlterados = await marcarTodosAlertasComoLidos();
    res.json({ sucesso: true, alterados: totalAlterados });
  } catch (erro) {
    console.error('Erro ao marcar todos alertas como lidos:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar alertas.' });
  }
});

// POST /api/vencimentos/executar-verificacao (Executa manualmente a rotina de checagem)
app.post('/api/vencimentos/executar-verificacao', async (req, res) => {
  try {
    const resultado = await executarRotinaVerificacaoVencimentos();
    res.json(resultado);
  } catch (erro) {
    console.error('Erro ao executar verificação de vencimentos:', erro);
    res.status(500).json({ erro: 'Erro ao executar verificação de vencimentos.' });
  }
});

// GET /api/conhecimento (Lista todos os itens cadastrados na base de conhecimento)
app.get('/api/conhecimento', async (req, res) => {
  try {
    const itens = await obterTodosConhecimentos();
    res.json(itens);
  } catch (erro) {
    console.error('Erro ao buscar base de conhecimento:', erro);
    res.status(500).json({ erro: 'Erro ao carregar base de conhecimento.' });
  }
});

function normalizarTituloConhecimento(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// POST /api/conhecimento (Cadastra novo item de instrução/conhecimento)
app.post('/api/conhecimento', async (req, res) => {
  try {
    const { titulo, categoria, conteudo } = req.body;
    if (!titulo || !conteudo) {
      return res.status(400).json({ erro: 'Título e conteúdo são obrigatórios.' });
    }

    const todosItens = await obterTodosConhecimentos();
    const tituloNorm = normalizarTituloConhecimento(String(titulo));

    const duplicado = todosItens.find(
      (item) => normalizarTituloConhecimento(item.titulo) === tituloNorm
    );

    if (duplicado) {
      return res.status(400).json({
        erro: `Já existe uma instrução com o título "${duplicado.titulo}" na aba Conhecimento. Escolha um título único.`,
      });
    }

    const novoItem: ItemConhecimento = {
      id: `k-${Date.now()}`,
      titulo: String(titulo).trim(),
      categoria: String(categoria || 'Geral').trim(),
      conteudo: String(conteudo).trim(),
      dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
      dataCadastro: new Date().toLocaleDateString('pt-BR'),
    };

    await adicionarConhecimento(novoItem);
    indexarConhecimentoBackground(novoItem);

    res.status(201).json(novoItem);
  } catch (erro) {
    console.error('Erro ao cadastrar item de conhecimento:', erro);
    res.status(500).json({ erro: 'Erro ao salvar instrução na base de conhecimento.' });
  }
});

// PUT /api/conhecimento/:id (Atualiza uma instrução e reindexa em segundo plano)
app.put('/api/conhecimento/:id', async (req, res) => {
  try {
    const { titulo, categoria, conteudo } = req.body;
    const todosItens = await obterTodosConhecimentos();
    const itemExistente = todosItens.find((i) => i.id === req.params.id);

    if (!itemExistente) {
      return res.status(404).json({ erro: 'Item de conhecimento não encontrado.' });
    }

    if (titulo) {
      const tituloNorm = normalizarTituloConhecimento(String(titulo));
      const duplicado = todosItens.find(
        (i) => i.id !== req.params.id && normalizarTituloConhecimento(i.titulo) === tituloNorm
      );

      if (duplicado) {
        return res.status(400).json({
          erro: `Já existe outra instrução com o título "${duplicado.titulo}" na aba Conhecimento. Escolha um título único.`,
        });
      }
    }

    const itemAtualizado = await atualizarConhecimento(req.params.id, {
      ...(titulo ? { titulo: String(titulo).trim() } : {}),
      ...(categoria ? { categoria: String(categoria).trim() } : {}),
      ...(conteudo ? { conteudo: String(conteudo).trim() } : {}),
    });

    if (!itemAtualizado) {
      return res.status(404).json({ erro: 'Item de conhecimento não encontrado.' });
    }

    indexarConhecimentoBackground(itemAtualizado);
    res.json(itemAtualizado);
  } catch (erro) {
    console.error('Erro ao atualizar item de conhecimento:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar instrução na base de conhecimento.' });
  }
});

// DELETE /api/conhecimento/:id (Exclui uma instrução da base de conhecimento e do Supabase)
app.delete('/api/conhecimento/:id', async (req, res) => {
  try {
    const todosItens = await obterTodosConhecimentos();
    const itemAlvo = todosItens.find((i) => i.id === req.params.id);

    const sucesso = await removerConhecimento(req.params.id);
    if (!sucesso) {
      return res.status(404).json({ erro: 'Item de conhecimento não encontrado.' });
    }

    removerConhecimentoSupabaseBackground(req.params.id);

    res.json({ sucesso: true, mensagem: 'Instrução excluída com sucesso.' });
  } catch (erro) {
    console.error('Erro ao excluir item de conhecimento:', erro);
    res.status(500).json({ erro: 'Erro ao excluir item de conhecimento.' });
  }
});

// GET /api/buscas-sem-resultado (Log dos pedidos sem resultado no cofre)
app.get('/api/buscas-sem-resultado', async (req, res) => {
  try {
    const buscas = await obterBuscasSemResultado();
    res.json(buscas);
  } catch (erro) {
    console.error('Erro ao buscar logs de busca sem resultado:', erro);
    res.status(500).json({ erro: 'Erro ao carregar logs.' });
  }
});

// GET /api/status-ia (Informa se está em modo simulador e qual provedor está ativo)
app.get('/api/status-ia', (req, res) => {
  res.json({
    modoSimulador: isModoSimuladorAtivo(),
    provedor: process.env.AI_PROVIDER || 'openai',
    modelo: process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini',
  });
});

// GET /api/uso-ia/metricas (Agregação de uso, custos e cotas para o painel admin)
app.get('/api/uso-ia/metricas', async (req, res) => {
  try {
    const registros = await obterRegistrosUsoIA();
    const tabelaPrecos = await obterTabelaPrecos();
    const conversas = await obterTodasConversas();

    const limiteRPM = parseInt(process.env.LIMITE_RPM || '10', 10);
    const limiteRPD = parseInt(process.env.LIMITE_RPD || '250', 10);
    const alertaRpdPercentual = parseInt(process.env.ALERTA_RPD_PERCENTUAL || '80', 10);
    const tetoCustoMensal = parseFloat(process.env.TETO_CUSTO_MENSAL || '0');

    const agora = Date.now();
    const agoraDate = new Date(agora);
    const dataHojePac = obterDataPacifico(agoraDate);
    const mesAtual = agoraDate.toISOString().slice(0, 7);

    // 1. Requisições Hoje (Reset no Pacífico)
    const chamadasHoje = registros.filter(
      (r) => obterDataPacificoDeIso(r.data) === dataHojePac
    );
    const requisicoesHoje = chamadasHoje.length;
    const percentualRPD = Math.round((requisicoesHoje / limiteRPD) * 100);
    const alertaRPD = percentualRPD >= alertaRpdPercentual;

    // 2. Requisições no Último Minuto (Janela deslizante de 60s)
    const noUltimoMinuto = registros.filter(
      (r) => agora - new Date(r.data).getTime() < 60000
    );
    const requisicoesUltimoMinuto = noUltimoMinuto.length;
    const alertaRPM = requisicoesUltimoMinuto >= limiteRPM;

    // 3. Eficiência sem IA (últimos 30 dias)
    let totalMensagensAssistente30d = 0;
    let mensagensSemIA30d = 0;

    for (const c of conversas) {
      for (const m of c.mensagens) {
        if (m.remetente === 'assistente') {
          totalMensagensAssistente30d++;
          if (m.origem === 'motor' || !m.origem) {
            mensagensSemIA30d++;
          }
        }
      }
    }

    const percentualSemIA30d =
      totalMensagensAssistente30d > 0
        ? Math.round((mensagensSemIA30d / totalMensagensAssistente30d) * 100)
        : 100;

    // 4. Tokens e Custo do Mês
    const chamadasMes = registros.filter((r) => r.data.slice(0, 7) === mesAtual);
    const tokensEntradaMes = chamadasMes.reduce((acc, r) => acc + (r.tokensEntrada || 0), 0);
    const tokensSaidaMes = chamadasMes.reduce((acc, r) => acc + (r.tokensSaida || 0), 0);
    const totalTokensMes = tokensEntradaMes + tokensSaidaMes;
    const custoEstimadoMes = Number(
      chamadasMes.reduce((acc, r) => acc + (r.custoEstimado || 0), 0).toFixed(4)
    );

    // Verifica se os preços estão zerados (Free tier)
    const modeloAtual = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';
    const configModelo = tabelaPrecos[modeloAtual] || {
      precoEntradaPorMilhao: 0,
      precoSaidaPorMilhao: 0,
    };
    const isFreeTier =
      (configModelo.precoEntradaPorMilhao || 0) === 0 &&
      (configModelo.precoSaidaPorMilhao || 0) === 0;

    const tetoExcedido = tetoCustoMensal > 0 && custoEstimadoMes >= tetoCustoMensal;

    // 5. Gráfico de chamadas por dia nos últimos 30 dias
    const chamadasUltimos30Dias: { data: string; chamadas: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(agora - i * 24 * 60 * 60 * 1000);
      const diaStr = d.toISOString().slice(0, 10);
      const totalDia = registros.filter((r) => r.data.slice(0, 10) === diaStr).length;
      chamadasUltimos30Dias.push({
        data: diaStr,
        chamadas: totalDia,
      });
    }

    // 6. Quebra por motivo
    const motivos = {
      interpretacao: registros.filter((r) => r.motivo === 'interpretacao').length,
      equivalencia: registros.filter((r) => r.motivo === 'equivalencia').length,
      conversa: registros.filter((r) => r.motivo === 'conversa').length,
    };

    // 7. Últimas 50 chamadas (mais recentes primeiro)
    const ultimas50Chamadas = [...registros].reverse().slice(0, 50);

    const metricas: MetricasUsoIA = {
      requisicoesHoje,
      limiteRPD,
      percentualRPD,
      alertaRPD,
      requisicoesUltimoMinuto,
      limiteRPM,
      alertaRPM,
      percentualSemIA30d,
      totalMensagens30d: totalMensagensAssistente30d,
      mensagensSemIA30d,
      tokensEntradaMes,
      tokensSaidaMes,
      totalTokensMes,
      custoEstimadoMes,
      moeda: 'BRL',
      isFreeTier,
      tetoCustoMensal,
      tetoExcedido,
      chamadasUltimos30Dias,
      motivos,
      ultimas50Chamadas,
      tabelaPrecos,
    };

    res.json(metricas);
  } catch (erro) {
    console.error('Erro ao calcular métricas de uso da IA:', erro);
    res.status(500).json({ erro: 'Erro ao calcular métricas de uso da IA.' });
  }
});

// GET /api/precos (Tabela de preços de tokens)
app.get('/api/precos', async (req, res) => {
  try {
    const precos = await obterTabelaPrecos();
    res.json(precos);
  } catch (erro) {
    console.error('Erro ao buscar tabela de preços:', erro);
    res.status(500).json({ erro: 'Erro ao carregar preços.' });
  }
});

// POST /api/precos (Atualiza a tabela de preços de tokens)
app.post('/api/precos', async (req, res) => {
  try {
    const novaTabela = req.body;
    await salvarTabelaPrecos(novaTabela);
    res.json({ sucesso: true, tabela: novaTabela });
  } catch (erro) {
    console.error('Erro ao atualizar tabela de preços:', erro);
    res.status(500).json({ erro: 'Erro ao salvar preços.' });
  }
});

// GET /api/mensagens/:id/rastro - Retorna o log de raciocínio de uma resposta da VEGA
app.get('/api/mensagens/:id/rastro', async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const rastro = await obterRastroPorMensagemId(id);
    if (!rastro) {
      return res.status(404).json({ erro: 'Rastro de raciocínio não encontrado para esta mensagem.' });
    }
    return res.json(rastro);
  } catch (erro) {
    console.error('Erro ao buscar rastro da mensagem:', erro);
    return res.status(500).json({ erro: 'Erro interno ao consultar rastro.' });
  }
});

// GET /api/rastros/:id - Retorna o rastro pelo seu ID primário
app.get('/api/rastros/:id', async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const rastro = await obterRastroPorId(id);
    if (!rastro) {
      return res.status(404).json({ erro: 'Rastro não localizado.' });
    }
    return res.json(rastro);
  } catch (erro) {
    console.error('Erro ao buscar rastro por ID:', erro);
    return res.status(500).json({ erro: 'Erro interno ao consultar rastro.' });
  }
});

// Função auxiliar para emitir chunks de texto simulando streaming SSE
async function streamTextoChunks(res: express.Response, assistenteMsgId: string, texto: string) {
  const pedacos = texto.split(' ');
  for (let i = 0; i < pedacos.length; i++) {
    const pedaco = pedacos[i] + (i < pedacos.length - 1 ? ' ' : '');
    const dados = JSON.stringify({
      tipo: 'chunk',
      delta: pedaco,
      msgId: assistenteMsgId,
    });
    res.write(`data: ${dados}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

// POST /api/mensagens (Pipeline: Motor Determinístico primeiro -> IA só como plano B)
app.post('/api/mensagens', async (req, res) => {
  const { conversaId, texto, anexos, documentoId } = req.body;

  if (!conversaId || (!texto && (!anexos || anexos.length === 0) && !documentoId)) {
    return res.status(400).json({ erro: 'Dados de mensagem incompletos.' });
  }

  const conversa = await obterConversaPorId(conversaId);
  if (!conversa) {
    return res.status(404).json({ erro: 'Conversa não encontrada.' });
  }

  const nivelUsuario: NivelAcesso =
    conversa.contato.nivelAcesso || conversa.contato.ficha?.nivelAcesso || 'geral';
  const primeiroNome = extrairPrimeiroNome(conversa.contato.nome);
  const vocativo = primeiroNome ? `, ${primeiroNome}` : '';

  // 1. Cria a mensagem do usuário (se não for clique direto em documento sem texto)
  const agora = new Date();
  const horarioAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const msgUsuario: Mensagem = {
    id: `msg-${Date.now()}-user`,
    remetente: 'cliente',
    nomeRemetente: conversa.contato.nome,
    horario: horarioAtual,
    texto: texto || (documentoId ? 'Consultar documento selecionado' : ''),
    anexos: anexos || [],
  };

  await adicionarMensagem(conversaId, msgUsuario);

  // 2. Configura Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const assistenteMsgId = `msg-${Date.now()}-assist`;

  try {
    const docsDisponiveis = await obterDocumentosPorNivelAcesso(nivelUsuario);

    // FLUXO ÚNICO: Todas as mensagens passam exclusivamente pelo chatOrquestrador
    const resultadoChat = await processarMensagemChat({
      mensagemUsuario: texto || (documentoId ? `Acessar documento ${documentoId}` : ''),
      historicoRecente: conversa.mensagens,
      contato: conversa.contato,
      documentosDisponiveis: docsDisponiveis,
      documentoIdDireto: documentoId,
    });

    const textoFinal = resultadoChat.textoResposta;
    const anexosGerados: Anexo[] = resultadoChat.anexos || [];
    const opcoesGeradas = resultadoChat.opcoes;
    const origem = resultadoChat.origem;
    const rastroGerado = resultadoChat.rastro;
    const documentoOferecidoId: string | undefined = resultadoChat.documentoOferecidoId;

    // Salva rastro no Supabase caso disponível (resiliente: falha não bloqueia a resposta)
    let rastroIdFinal: string | undefined = undefined;
    if (rastroGerado) {
      try {
        rastroGerado.mensagemId = assistenteMsgId;
        rastroGerado.conversaId = conversaId;
        // Integridade estrita: respostaFinal do rastro é idêntica ao textoFinal exibido no chat
        rastroGerado.respostaFinal = mascararDadosSensiveis(textoFinal);

        const idSalvo = await salvarRastro(rastroGerado);
        if (idSalvo) {
          rastroGerado.id = idSalvo;
          rastroIdFinal = idSalvo;
        }
      } catch (errRastro: any) {
        console.error('[VEGA Chat ⚠️] Erro ao gravar rastro no Supabase (não bloqueante):', errRastro?.message || errRastro);
      }
    }

    // 5. Emite chunks SSE em tempo real
    await streamTextoChunks(res, assistenteMsgId, textoFinal);

    // 6. Persiste mensagem do assistente com metadados e rastro
    const msgAssistente: Mensagem = {
      id: assistenteMsgId,
      remetente: 'assistente',
      nomeRemetente: ASSISTENTE.nomeExibicao,
      horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      texto: textoFinal,
      anexos: anexosGerados.length > 0 ? anexosGerados : undefined,
      origem,
      opcoes: opcoesGeradas && opcoesGeradas.length > 0 ? opcoesGeradas : undefined,
      documentoOferecidoId,
      rastroId: rastroIdFinal,
      rastro: rastroGerado,
    };

    await adicionarMensagem(conversaId, msgAssistente);

    // 7. Encerra o stream SSE informando o objeto final
    res.write(`data: ${JSON.stringify({ tipo: 'fim', mensagem: msgAssistente })}\n\n`);
    res.end();
  } catch (erro: any) {
    console.error('Erro fatal no processamento da mensagem:', erro);
    res.write(`data: ${JSON.stringify({ tipo: 'erro', mensagem: 'Falha no servidor ao processar mensagem.' })}\n\n`);
    res.end();
  }
});

// ============================================================================
// WEBHOOK DO WHATSAPP / EVOLUTION API COM AUTENTICAÇÃO E SEGURANÇA
// ============================================================================
app.post(
  ['/api/webhook/whatsapp', '/api/webhook/evolution', '/webhook/whatsapp', '/webhook/evolution'],
  async (req, res) => {
  // 1. Verificação de Token de Segurança (WEBHOOK_TOKEN)
  if (!validarTokenWebhook(req)) {
    return res.status(401).json({
      erro: 'Não autorizado. Token de webhook inválido ou ausente.',
    });
  }

  try {
    const ipOrigem = (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'desconhecida') as string;
    const eventos = extrairDadosEvento(req.body);

    if (eventos.length === 0) {
      return res.status(200).json({ status: 'ignorado', motivo: 'sem_eventos_de_mensagem' });
    }

    const resultados = [];
    for (const ev of eventos) {
      const resultado = await processarEventoEvolution(ev, ipOrigem);
      resultados.push(resultado);

      // Envio da resposta ao WhatsApp via Evolution API (Texto e Documentos se houver)
      if (resultado.resposta && resultado.destinatario) {
        await enviarMensagemWhatsApp(resultado.destinatario, resultado.resposta, resultado.anexos);
      }
    }

    return res.status(200).json({
      sucesso: true,
      totalEventos: eventos.length,
      resultados,
    });
  } catch (erro: any) {
    console.error('[Webhook WhatsApp ❌] Erro interno ao processar evento:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar evento do webhook.' });
  }
});
// Servir frontend compilado do Vite (produção ou após build local)
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // Fallback SPA para rotas não capturadas por APIs, arquivos ou webhooks
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/arquivos') ||
      req.path.startsWith('/webhook')
    ) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
  console.log(`💻 [Frontend] Servindo arquivos estáticos de: ${clientDistPath}`);
}

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=============================================`);
  console.log(`VEGA DELTA PLAN ATIVADA NA PORTA ${PORT}`);
  console.log(`📡 URL: http://0.0.0.0:${PORT}`);
  console.log(`📁 Arquivos estáticos em: /arquivos`);
  console.log(`=============================================`);

  // Sincronização automática com o Supabase ao iniciar o servidor
  sincronizarSupabaseNoStartup().catch((erro) => {
    console.error('[Startup ❌] Erro ao sincronizar com Supabase:', erro);
  });

  // Limpeza automática de rastros com mais de 30 dias ao iniciar o servidor
  limparRastrosAntigos().catch((erro) => {
    console.warn('[Startup ⚠️] Erro na limpeza de rastros antigos:', erro);
  });

  // Sincronização de validades de documentos e rotina diária de alertas de vencimento ao iniciar
  sincronizarValidadesDocumentosExistentes()
    .then(() => executarRotinaVerificacaoVencimentos())
    .catch((erro) => {
      console.warn('[Vencimentos ⚠️] Erro na inicialização da rotina de vencimentos:', erro);
    });

  // Executa a limpeza de rastros com mais de 30 dias uma vez por dia (a cada 24 horas)
  const INTERVALO_DIARIO_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    limparRastrosAntigos().catch((erro) => {
      console.warn('[RastroService ⚠️] Erro na rotina diária de limpeza de rastros antigos:', erro);
    });
  }, INTERVALO_DIARIO_MS);

  // Executa a checagem de vencimentos diariamente (a cada 24 horas)
  setInterval(() => {
    executarRotinaVerificacaoVencimentos().catch((erro) => {
      console.warn('[Vencimentos ⚠️] Erro na rotina diária de verificação de vencimentos:', erro);
    });
  }, INTERVALO_DIARIO_MS);
});
