import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import { getSupabaseClient } from './db/supabaseClient.js';
import { obterBufferArquivo, ARQUIVOS_DIR } from './utils/storageUtils.js';
import { analisarDocumentoParaCofre } from './analiseDocumentoService.js';
import {
  extrairTextoDocumento,
  dividirEmTrechos,
  gerarEmbeddingsEmLote,
  salvarCamposSugeridosNoTitular,
} from './indexador/indexadorService.js';
import { atualizarValidadeDocumento } from './vencimentos/alertaVencimentoService.js';
import { enviarTextoEvolution } from './whatsapp/evolutionSenderService.js';
import {
  salvarPendenciaDocumentoWhatsApp,
  TipoPendenciaWhatsApp,
} from './whatsapp/pendenciasWhatsAppService.js';
import {
  adicionarMensagem,
  obterTodosTitulares,
  resolverTitularCadastrado,
} from './storage.js';
import { marcarDocumentoFaltanteComoProvidenciado } from './documentosFaltantesService.js';
import { eventosPainel } from './eventos/eventosService.js';
import { formatarHorarioBrasilia, obterAgoraIsoUtc } from './utils/dataHoraUtils.js';
import { ASSISTENTE } from './config/assistente.js';
import { PdfProtegidoPorSenhaError } from './pdfService.js';

export const MENSAGEM_PDF_PROTEGIDO_SENHA =
  'Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.';

interface ItemFila {
  docId: string;
  tentativas: number;
}

const filaDocumentos: ItemFila[] = [];
let processandoFila = false;

/**
 * Enfileira um documento para processamento completo em segundo plano
 * (análise de IA com OCR/visão, tipo dinâmico, titular estrito e indexação vetorial).
 */
export function enfileirarProcessamentoDocumento(docId: string): void {
  if (!docId) return;

  const jaNaFila = filaDocumentos.some((item) => item.docId === docId);
  if (jaNaFila) {
    console.log(`[Worker Segundo Plano ℹ️] Documento ${docId} já está na fila de processamento.`);
    return;
  }

  filaDocumentos.push({ docId, tentativas: 0 });
  console.log(`[Worker Segundo Plano 📥] Documento ${docId} enfileirado. Total na fila: ${filaDocumentos.length}.`);

  if (!processandoFila) {
    processarProximoDaFila();
  }
}

/**
 * Processador sequencial da fila de documentos em segundo plano
 */
async function processarProximoDaFila(): Promise<void> {
  if (filaDocumentos.length === 0) {
    processandoFila = false;
    return;
  }

  processandoFila = true;
  const item = filaDocumentos.shift();
  if (!item) {
    processandoFila = false;
    return;
  }

  const { docId } = item;
  console.log(`\n[Worker Segundo Plano ⚡] Iniciando processamento do documento: ${docId}`);

  const supabase = getSupabaseClient();
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  try {
    // 1. Busca os dados atuais do documento no Supabase
    const { data: doc, error: errBusca } = await supabase
      .from('documentos')
      .select('*')
      .eq('id', docId)
      .maybeSingle();

    if (errBusca || !doc) {
      throw new Error(`Documento não encontrado no Supabase (id: ${docId})`);
    }

    // 2. Marca status como "processando" no Supabase imediatamente
    await supabase
      .from('documentos')
      .update({
        status_indexacao: 'processando',
        erro_indexacao: null,
      })
      .eq('id', docId);

    // 3. Obtém o buffer do arquivo (do cache local ou baixando do Supabase Storage)
    const arqData = await obterBufferArquivo(doc.arquivo, doc.storage_path);
    if (!arqData || !arqData.buffer) {
      throw new Error(`Arquivo não encontrado localmente nem no Storage (${doc.arquivo})`);
    }

    const { buffer, contentType } = arqData;
    const base64 = buffer.toString('base64');

    // Assegura arquivo no diretório temporário local para manipulação do OCR
    if (!fs.existsSync(ARQUIVOS_DIR)) fs.mkdirSync(ARQUIVOS_DIR, { recursive: true });
    const caminhoLocal = path.join(ARQUIVOS_DIR, path.basename(doc.arquivo));
    try {
      if (!fs.existsSync(caminhoLocal)) {
        fs.writeFileSync(caminhoLocal, buffer);
      }
    } catch {}

    // 4. ETAPA 1: ANÁLISE PROFUNDA COM IA (TIPO DINÂMICO, TITULAR E METADADOS)
    console.log(`[Worker Segundo Plano 🧠] Analisando "${doc.arquivo}" com gpt-5.4-mini...`);
    const analise = await analisarDocumentoParaCofre({
      nomeArquivo: doc.arquivo,
      mimeType: contentType,
      base64,
      tamanho: buffer.length,
    });

    const titularIdentificado = (analise.titularSugerido || '').trim();
    const tipoIdentificado = (analise.tipoSugerido || '').trim();
    const tituloFinal = analise.tituloSugerido || doc.titulo || doc.arquivo;
    const descricaoFinal = analise.descricaoSugerida || doc.descricao || '';
    const apelidosFinais = analise.apelidosSugeridos || doc.apelidos || [];
    const validadeFinal = analise.dataValidadeSugerida || doc.data_validade || null;
    const origemValidadeFinal = validadeFinal ? 'extraído automaticamente' : null;

    const precisaPerguntar =
      !titularIdentificado ||
      !tipoIdentificado ||
      tipoIdentificado.toLowerCase() === 'outros' ||
      !!analise.novoTitularSugerido;

    const metadataAtualizado = {
      ...(doc.metadata || {}),
      nomeNoDocumento: analise.nomeNoDocumento || null,
      novoTitularSugerido: !!analise.novoTitularSugerido,
      precisaPerguntar,
      camposFaltantes: [
        ...(!titularIdentificado ? ['titular'] : []),
        ...(!tipoIdentificado || tipoIdentificado.toLowerCase() === 'outros' ? ['tipo'] : []),
      ],
    };

    const todosTitulares = await obterTodosTitulares();
    const titularVinculado = resolverTitularCadastrado(titularIdentificado, todosTitulares);
    const ehCorporativo = titularIdentificado.toLowerCase().includes('delta') || !titularIdentificado;
    const pessoaId = titularVinculado ? titularVinculado.id : (ehCorporativo ? null : null);
    const titularFinalGravado = titularVinculado ? titularVinculado.nome : (ehCorporativo ? 'Delta Plan' : titularIdentificado);

    // Atualiza metadados no Supabase
    await supabase
      .from('documentos')
      .update({
        titulo: tituloFinal,
        tipo: tipoIdentificado,
        titular: titularFinalGravado,
        pessoa_id: pessoaId,
        descricao: descricaoFinal,
        apelidos: apelidosFinais,
        data_validade: validadeFinal,
        origem_validade: origemValidadeFinal,
        metadata: metadataAtualizado,
      })
      .eq('id', docId);

    // Se houver campos cadastrais sugeridos para o titular existente
    if (analise.camposSugeridosTitular && titularIdentificado) {
      try {
        await salvarCamposSugeridosNoTitular(
          titularIdentificado,
          analise.camposSugeridosTitular as any,
          docId,
          tituloFinal
        );
      } catch (errTit) {
        console.warn('[Worker Segundo Plano ⚠️] Aviso ao salvar campos no titular:', errTit);
      }
    }

    // Se o PDF estiver protegido por senha, não tenta indexação vetorial e registra status específico
    if (analise.protegidoPorSenha) {
      console.log(`[Worker Segundo Plano 🔒] Documento "${doc.arquivo}" está protegido por senha. Definindo status como protegido_senha.`);
      const msgProtegido = MENSAGEM_PDF_PROTEGIDO_SENHA;

      await supabase
        .from('documentos')
        .update({
          status_indexacao: 'protegido_senha',
          erro_indexacao: msgProtegido,
        })
        .eq('id', docId);

      const metadataDoc = doc.metadata || {};
      if (metadataDoc.origem === 'whatsapp' && metadataDoc.remetenteJid) {
        await enviarTextoEvolution(metadataDoc.remetenteJid, msgProtegido);

        if (metadataDoc.conversaId) {
          const msgAssistente: Mensagem = {
            id: `wa-msg-${Date.now()}-vega-senha-doc`,
            remetente: 'assistente',
            nomeRemetente: ASSISTENTE.nomeExibicao,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: msgProtegido,
            origem: 'motor',
          };
          const conversaAtualizada = await adicionarMensagem(metadataDoc.conversaId, msgAssistente);
          if (conversaAtualizada) {
            eventosPainel.emitirNovaMensagem(metadataDoc.conversaId, msgAssistente, conversaAtualizada);
          }
        }
      }

      return;
    }

    // 5. ETAPA 2: INDEXAÇÃO VETORIAL (OCR COMPLETO, CHUNKING E EMBEDDINGS)
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada no .env');
    }

    console.log(`[Worker Segundo Plano 📚] Extraindo trechos e gerando embeddings para "${tituloFinal}"...`);
    const openai = new OpenAI({ apiKey });

    // Limpa trechos anteriores deste documento (regra: nunca apagar o documento)
    await supabase.from('trechos').delete().eq('documento_id', docId);

    const { paginas } = await extrairTextoDocumento(caminhoLocal, openai, {
      titulo: tituloFinal,
      descricao: descricaoFinal,
      titular: titularIdentificado,
    });

    const textoCompleto = paginas.map((p) => p.texto).join('\n\n');
    if (!textoCompleto.trim()) {
      throw new Error('Nenhum texto pôde ser extraído do documento para indexação.');
    }

    const trechos = dividirEmTrechos(paginas);
    if (trechos.length === 0) {
      trechos.push({ conteudo: textoCompleto.slice(0, 2400), pagina: 1 });
    }

    const textosParaEmbedding = trechos.map((t) => t.conteudo);
    const embeddings = await gerarEmbeddingsEmLote(textosParaEmbedding, openai);

    // Insere trechos com embeddings no Supabase (respeitando o schema real da tabela trechos)
    const linhasTrechos = trechos.map((tr, idx) => ({
      documento_id: docId,
      pessoa_id: pessoaId,
      corporativo: ehCorporativo,
      pagina: tr.pagina,
      conteudo: tr.conteudo,
      embedding: embeddings[idx] || null,
    }));

    const { error: errTrechos } = await supabase.from('trechos').insert(linhasTrechos);
    if (errTrechos) {
      throw new Error(`Erro ao salvar trechos vetoriais no Supabase: ${errTrechos.message}`);
    }

    // Blindagem de segurança pós-indexação: nunca permitir status 'indexado' se houver 0 trechos
    const { count: totalTrechosSalvos, error: errCount } = await supabase
      .from('trechos')
      .select('id', { count: 'exact', head: true })
      .eq('documento_id', docId);

    if (errCount || !totalTrechosSalvos || totalTrechosSalvos === 0) {
      throw new Error('Nenhum trecho vetorial foi gerado para este documento.');
    }

    // 6. FINALIZAÇÃO COM SUCESSO: MARCA COMO INDEXADO
    await supabase
      .from('documentos')
      .update({
        status_indexacao: 'indexado',
        erro_indexacao: null,
        pessoa_id: pessoaId,
        titular: titularFinalGravado,
        corporativo: ehCorporativo,
      })
      .eq('id', docId);

    // Dá baixa automática em pedidos de documentos faltantes correspondentes
    const tipoParaBaixa = tipoIdentificado || analise.tipoSugerido;
    if (tipoParaBaixa) {
      marcarDocumentoFaltanteComoProvidenciado(
        tipoParaBaixa,
        pessoaId,
        titularFinalGravado
      ).catch((err) => console.warn('[Worker Segundo Plano ⚠️] Erro ao dar baixa em documento faltante:', err));
    }

    if (validadeFinal) {
      try {
        await atualizarValidadeDocumento(docId, validadeFinal, 'extraído automaticamente');
      } catch {}
    }

    console.log(
      `[Worker Segundo Plano ✅] Documento "${tituloFinal}" processado e indexado com sucesso! (${totalTrechosSalvos} trechos)`
    );

    // 7. Se o documento veio do WhatsApp, aciona notificação e pendência interativa
    const metadataDoc = doc.metadata || {};
    if (metadataDoc.origem === 'whatsapp' && metadataDoc.remetenteJid && metadataDoc.conversaId) {
      await tratarNotificacaoWhatsAppPosProcessamento({
        docId,
        arquivoOriginal: doc.arquivo,
        tituloFinal,
        tipoIdentificado,
        titularIdentificado,
        analise,
        metadataDoc,
      });
    }
  } catch (err: any) {
    const msgErro = err?.message || String(err);
    console.error(`[Worker Segundo Plano ❌] Erro ao processar documento ${docId}:`, msgErro);

    const isSenha =
      err instanceof PdfProtegidoPorSenhaError ||
      err?.name === 'PasswordException' ||
      msgErro.toLowerCase().includes('password') ||
      msgErro.includes('No password given');

    const statusFinal = isSenha ? 'protegido_senha' : 'erro';
    const erroFinal = isSenha ? MENSAGEM_PDF_PROTEGIDO_SENHA : msgErro;

    // Garante que o documento continua no banco com o status correspondente
    try {
      await supabase
        .from('documentos')
        .update({
          status_indexacao: statusFinal,
          erro_indexacao: erroFinal,
        })
        .eq('id', docId);

      // Se veio do WhatsApp, notifica o usuário
      const { data: docErr } = await supabase
        .from('documentos')
        .select('arquivo, metadata')
        .eq('id', docId)
        .maybeSingle();

      if (docErr?.metadata?.origem === 'whatsapp' && docErr.metadata.remetenteJid) {
        let msgFalha = msgOficialSenha;
        if (!isSenha) {
          const motivoAmigavel = traduzirMotivoErroParaUsuario(msgErro);
          msgFalha = `Não consegui processar automaticamente o documento *${docErr.arquivo}* (${motivoAmigavel}). Mas fique tranquilo: o arquivo continua salvo com segurança no Cofre da VEGA com o selo de pendente para que possamos conferir quando quiser.`;
        }

        await enviarTextoEvolution(docErr.metadata.remetenteJid, msgFalha);

        if (docErr.metadata.conversaId) {
          const msgAssistente: Mensagem = {
            id: `wa-msg-${Date.now()}-vega-erro-doc`,
            remetente: 'assistente',
            nomeRemetente: ASSISTENTE.nomeExibicao,
            horario: formatarHorarioBrasilia(),
            timestamp: obterAgoraIsoUtc(),
            texto: msgFalha,
            origem: 'motor',
          };
          const conversaAtualizada = await adicionarMensagem(docErr.metadata.conversaId, msgAssistente);
          if (conversaAtualizada) {
            eventosPainel.emitirNovaMensagem(docErr.metadata.conversaId, msgAssistente, conversaAtualizada);
          }
        }
      }
    } catch (errUpd) {
      console.error('[Worker Segundo Plano ❌] Falha ao gravar status de erro no Supabase:', errUpd);
    }
  } finally {
    // Agenda o próximo da fila
    setTimeout(() => {
      processarProximoDaFila();
    }, 500);
  }
}

/**
 * Traduz mensagens técnicas e de sistema em linguagem simples e amigável para o usuário do WhatsApp
 */
export function traduzirMotivoErroParaUsuario(erroBruto: string): string {
  const err = (erroBruto || '').toLowerCase();
  if (err.includes('pdftoppm') || err.includes('pdfinfo') || err.includes('not found')) {
    return 'não foi possível converter a página escaneada para leitura visual';
  }
  if (err.includes('trechos') || err.includes('schema') || err.includes('column') || err.includes('supabase')) {
    return 'ocorreu uma oscilação temporária ao salvar o texto indexado no banco';
  }
  if (err.includes('nenhum texto') || err.includes('vazio') || err.includes('empty')) {
    return 'o arquivo parece não conter texto legível ou imagem reconhecível';
  }
  if (err.includes('timeout') || err.includes('timed out') || err.includes('econnreset')) {
    return 'o serviço de inteligência demorou para responder';
  }
  if (err.includes('rate limit') || err.includes('429')) {
    return 'o limite temporário de requisições de IA foi atingido';
  }
  if (erroBruto.length < 80 && !erroBruto.includes('/') && !erroBruto.includes('\\') && !erroBruto.includes('Error:')) {
    return erroBruto.toLowerCase();
  }
  return 'ocorreu uma falha durante a análise de leitura do arquivo';
}

/**
 * Notifica o usuário no WhatsApp após o processamento com IA, verificando se há
 * campos faltantes, se há novo titular ou se há duplicidade com documentos anteriores.
 */
async function tratarNotificacaoWhatsAppPosProcessamento(dados: {
  docId: string;
  arquivoOriginal: string;
  tituloFinal: string;
  tipoIdentificado: string;
  titularIdentificado: string;
  analise: any;
  metadataDoc: Record<string, any>;
}): Promise<void> {
  const {
    docId,
    arquivoOriginal,
    tipoIdentificado,
    titularIdentificado,
    analise,
    metadataDoc,
  } = dados;

  const remetenteJid = metadataDoc.remetenteJid;
  const remetenteNumero = metadataDoc.remetenteNumero;
  const conversaId = metadataDoc.conversaId;

  if (!remetenteJid || !conversaId) return;

  const supabase = getSupabaseClient();
  let tipoPendencia: TipoPendenciaWhatsApp = 'confirmacao_simples';
  let textoMensagem = '';
  let dadosDetectados: Record<string, any> = {
    arquivo: arquivoOriginal,
    tipo: tipoIdentificado,
    titular: titularIdentificado,
    nomeNoDocumento: analise.nomeNoDocumento || null,
  };

  const temTitular = Boolean(titularIdentificado && titularIdentificado.trim());
  const temTipo = Boolean(tipoIdentificado && tipoIdentificado.trim() && tipoIdentificado.toLowerCase() !== 'outros');

  // CASO 1: CAMPOS FALTANTES (Ponto 2)
  if (!temTitular && !temTipo) {
    tipoPendencia = 'falta_ambos';
    textoMensagem = `Recebi seu documento, mas não consegui identificar de quem é nem o tipo do documento. Pode me informar o titular e o tipo?`;
  } else if (!temTitular && temTipo) {
    tipoPendencia = 'falta_titular';
    textoMensagem = `Identifiquei que este documento é um *${tipoIdentificado}*, mas não identifiquei o titular. De quem é este documento?`;
  } else if (temTitular && !temTipo) {
    tipoPendencia = 'falta_tipo';
    textoMensagem = `Identifiquei que este documento é do *${titularIdentificado}*, mas não consegui classificar o tipo. Qual é o tipo deste documento?`;
  }
  // CASO 2: NOVO TITULAR (Ponto 3)
  else if (analise.novoTitularSugerido && analise.nomeNoDocumento) {
    tipoPendencia = 'novo_titular';
    dadosDetectados.nomeNoDocumento = analise.nomeNoDocumento;
    textoMensagem = `Identifiquei este documento como *${tipoIdentificado || 'documento'}* de *${analise.nomeNoDocumento}*, mas *${analise.nomeNoDocumento}* não está cadastrado como titular no Cofre. Deseja cadastrar como novo titular?`;
  }
  // CASO 3 & 4: DUPLICIDADE OU CONFIRMAÇÃO PADRÃO
  else {
    // Verifica se já existe outro documento indexado com o mesmo tipo e titular (Ponto 4)
    const { data: docExistente } = await supabase
      .from('documentos')
      .select('id, titulo, created_at')
      .ilike('titular', titularIdentificado)
      .ilike('tipo', tipoIdentificado)
      .eq('status_indexacao', 'indexado')
      .neq('id', docId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (docExistente) {
      tipoPendencia = 'duplicidade';
      const dataFormatada = docExistente.created_at
        ? new Date(docExistente.created_at).toLocaleDateString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          })
        : 'anteriormente';

      dadosDetectados.docExistenteId = docExistente.id;
      dadosDetectados.docExistenteTitulo = docExistente.titulo;
      dadosDetectados.docExistenteData = dataFormatada;

      textoMensagem = `Já existe um *${tipoIdentificado}* do *${titularIdentificado}* no Cofre (enviado em ${dataFormatada}). Substituo ou mantenho os dois?`;
    } else {
      // CASO 4: CONFIRMAÇÃO PADRÃO (Ponto 1)
      tipoPendencia = 'confirmacao_simples';
      textoMensagem = `Salvei como *${tipoIdentificado}* do *${titularIdentificado}*. Se não for isso, me diga o titular e o tipo correto.`;
    }
  }

  // 1. Salva a pendência no Supabase com expiração em 30 minutos (Ponto 6)
  await salvarPendenciaDocumentoWhatsApp({
    conversaId,
    remetenteNumero,
    remetenteJid,
    documentoId: docId,
    tipoPendencia,
    dadosDetectados,
  });

  // 2. Envia a notificação via WhatsApp
  await enviarTextoEvolution(remetenteJid, textoMensagem);

  // 3. Registra a mensagem na conversa para sincronizar com o painel web
  const msgAssistente: Mensagem = {
    id: `wa-msg-${Date.now()}-vega-pos-doc`,
    remetente: 'assistente',
    nomeRemetente: ASSISTENTE.nomeExibicao,
    horario: formatarHorarioBrasilia(),
    timestamp: obterAgoraIsoUtc(),
    texto: textoMensagem,
    origem: 'motor',
  };

  const conversaAtualizada = await adicionarMensagem(conversaId, msgAssistente);
  if (conversaAtualizada) {
    eventosPainel.emitirNovaMensagem(conversaId, msgAssistente, conversaAtualizada);
  }

  console.log(
    `[Worker Segundo Plano 💬] Notificação WhatsApp enviada para ${remetenteJid} (${tipoPendencia}): "${textoMensagem}"`
  );
}

/**
 * Ao iniciar o servidor (ou após reboot/deploy no Railway), busca documentos
 * que ficaram no estado 'processando' ou 'pendente' e retoma automaticamente.
 */
export async function retomarDocumentosPendentesAoIniciar(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: pendentes, error } = await supabase
      .from('documentos')
      .select('id, titulo, arquivo, status_indexacao')
      .in('status_indexacao', ['processando', 'pendente'])
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[Worker Segundo Plano ⚠️] Falha ao consultar documentos pendentes:', error);
      return;
    }

    if (!pendentes || pendentes.length === 0) {
      console.log('[Worker Segundo Plano 🟢] Nenhum documento pendente ou interrompido para retomar.');
      return;
    }

    console.log(
      `[Worker Segundo Plano 🔄] Encontrados ${pendentes.length} documento(s) pendentes/interrompidos no Supabase. Retomando processamento...`
    );

    for (const doc of pendentes) {
      enfileirarProcessamentoDocumento(doc.id);
    }
  } catch (err) {
    console.error('[Worker Segundo Plano ❌] Erro ao retomar documentos pendentes na inicialização:', err);
  }
}
