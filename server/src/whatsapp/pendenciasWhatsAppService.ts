import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { chamarChatComTelemetria } from '../ai/telemetriaIaService.js';
import { salvarOuAtualizarTitular, obterTodosTitulares, resolverTitularCadastrado } from '../storage.js';
import { formatarHorarioBrasilia } from '../utils/dataHoraUtils.js';

export type TipoPendenciaWhatsApp =
  | 'confirmacao_simples'
  | 'falta_titular'
  | 'falta_tipo'
  | 'falta_ambos'
  | 'novo_titular'
  | 'duplicidade';

export interface PendenciaDocumentoWhatsApp {
  id: string;
  conversa_id: string;
  remetente_numero: string;
  remetente_jid: string;
  documento_id: string;
  tipo_pendencia: TipoPendenciaWhatsApp;
  dados_detectados: {
    tipo?: string;
    titular?: string;
    nomeNoDocumento?: string;
    docExistenteId?: string;
    docExistenteTitulo?: string;
    docExistenteData?: string;
    arquivo?: string;
    [key: string]: any;
  };
  criado_em?: string;
  expira_em: string;
  resolvido: boolean;
}

/**
 * Cria ou atualiza uma pendência de validação de documento no Supabase
 * com TTL estrito de 30 minutos.
 */
export async function salvarPendenciaDocumentoWhatsApp(dados: {
  conversaId: string;
  remetenteNumero: string;
  remetenteJid: string;
  documentoId: string;
  tipoPendencia: TipoPendenciaWhatsApp;
  dadosDetectados: Record<string, any>;
}): Promise<PendenciaDocumentoWhatsApp | null> {
  try {
    const supabase = getSupabaseClient();
    const id = `pend-${dados.conversaId}`;
    const expiraEm = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const registro: PendenciaDocumentoWhatsApp = {
      id,
      conversa_id: dados.conversaId,
      remetente_numero: dados.remetenteNumero,
      remetente_jid: dados.remetenteJid,
      documento_id: dados.documentoId,
      tipo_pendencia: dados.tipoPendencia,
      dados_detectados: dados.dadosDetectados,
      expira_em: expiraEm,
      resolvido: false,
    };

    const { error } = await supabase
      .from('pendencias_documento_whatsapp')
      .upsert(registro, { onConflict: 'id' });

    if (error) {
      console.error('[Pendencias WhatsApp ⚠️] Erro ao salvar pendência:', error);
      return null;
    }

    console.log(
      `[Pendencias WhatsApp 📋] Pendência (${dados.tipoPendencia}) criada para ${dados.conversaId}. Expira em 30 min.`
    );
    return registro;
  } catch (err) {
    console.error('[Pendencias WhatsApp ⚠️] Falha ao persistir pendência no Supabase:', err);
    return null;
  }
}

/**
 * Busca uma pendência ativa e não expirada para a conversa.
 */
export async function buscarPendenciaAtivaWhatsApp(
  conversaId: string
): Promise<PendenciaDocumentoWhatsApp | null> {
  try {
    const supabase = getSupabaseClient();
    const agoraIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('pendencias_documento_whatsapp')
      .select('*')
      .eq('conversa_id', conversaId)
      .eq('resolvido', false)
      .gt('expira_em', agoraIso)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[Pendencias WhatsApp ⚠️] Falha ao consultar pendência ativa:', error);
      return null;
    }

    return (data as PendenciaDocumentoWhatsApp) || null;
  } catch (err) {
    console.warn('[Pendencias WhatsApp ⚠️] Exceção ao consultar pendência ativa:', err);
    return null;
  }
}

/**
 * Marca uma pendência como resolvida no Supabase.
 */
export async function resolverPendenciaWhatsApp(pendenciaId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('pendencias_documento_whatsapp')
      .update({ resolvido: true })
      .eq('id', pendenciaId);
    console.log(`[Pendencias WhatsApp ✔️] Pendência ${pendenciaId} resolvida.`);
  } catch (err) {
    console.warn('[Pendencias WhatsApp ⚠️] Falha ao resolver pendência:', err);
  }
}

/**
 * Interpreta a resposta do usuário no WhatsApp e aplica as ações no Supabase.
 * Retorna a resposta textual que deve ser enviada ao usuário, ou null se a mensagem
 * não tiver relação com a pendência e deve prosseguir para o chat geral.
 */
export async function processarRespostaPendenciaWhatsApp(
  pendencia: PendenciaDocumentoWhatsApp,
  textoMensagem: string,
  nomeUsuario: string
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const openai = apiKey ? new OpenAI({ apiKey }) : null;
  const textoLimpo = textoMensagem.trim();
  const tipoPendencia = pendencia.tipo_pendencia;

  console.log(
    `[Pendencias WhatsApp 🔍] Processando resposta para pendência "${tipoPendencia}" de "${nomeUsuario}": "${textoLimpo}"`
  );

  // -------------------------------------------------------------
  // CASO 1: DUPLICIDADE (Substituo ou mantenho os dois?)
  // -------------------------------------------------------------
  if (tipoPendencia === 'duplicidade') {
    const docExistenteId = pendencia.dados_detectados.docExistenteId;
    const tipo = pendencia.dados_detectados.tipo || 'documento';
    const titular = pendencia.dados_detectados.titular || 'titular';

    const ehSubstituicao =
      /^(1|substitu|troca|sim|atualiz|substitui|substituir|o novo|o mais recente)/i.test(textoLimpo) ||
      textoLimpo.toLowerCase().includes('substitu') ||
      textoLimpo.toLowerCase().includes('troca');

    const ehManter =
      /^(2|mant|os dois|ambos|deixa os dois|guarda os dois|n[aã]o|manter|mantem)/i.test(textoLimpo) ||
      textoLimpo.toLowerCase().includes('manter') ||
      textoLimpo.toLowerCase().includes('os dois') ||
      textoLimpo.toLowerCase().includes('ambos');

    if (ehSubstituicao) {
      if (docExistenteId) {
        // Remove trechos do documento antigo para não concorrer na busca semântica
        await supabase.from('trechos').delete().eq('documento_id', docExistenteId);
        // Atualiza status do documento antigo para 'substituido'
        await supabase
          .from('documentos')
          .update({
            status_indexacao: 'substituido',
            erro_indexacao: `Substituído por novo documento enviado em ${formatarHorarioBrasilia()}`,
          })
          .eq('id', docExistenteId);
      }

      await resolverPendenciaWhatsApp(pendencia.id);
      return `Documento anterior substituído com sucesso pelo novo *${tipo}* do *${titular}*!`;
    }

    if (ehManter) {
      await resolverPendenciaWhatsApp(pendencia.id);
      return `Perfeito! Mantive os dois documentos no Cofre.`;
    }

    // Se a intenção for incerta, utiliza a IA para classificar
    if (openai) {
      try {
        const resp = await chamarChatComTelemetria(
          openai,
          {
            model: 'gpt-5.4-mini',
            messages: [
              {
                role: 'system',
                content:
                  'O usuário foi perguntado se prefere "substituir" o documento anterior ou "manter ambos". Classifique a resposta do usuário estritamente em JSON: {"intencao": "substituir" | "manter" | "outro"}',
              },
              { role: 'user', content: textoLimpo },
            ],
            response_format: { type: 'json_object' },
          },
          { motivo: 'whatsapp_pendencia_duplicidade' }
        );

        const intencao = JSON.parse(resp.choices[0]?.message?.content || '{}').intencao;
        if (intencao === 'substituir') {
          if (docExistenteId) {
            await supabase.from('trechos').delete().eq('documento_id', docExistenteId);
            await supabase
              .from('documentos')
              .update({
                status_indexacao: 'substituido',
                erro_indexacao: `Substituído por novo documento em ${formatarHorarioBrasilia()}`,
              })
              .eq('id', docExistenteId);
          }
          await resolverPendenciaWhatsApp(pendencia.id);
          return `Documento anterior substituído com sucesso pelo novo *${tipo}* do *${titular}*!`;
        } else if (intencao === 'manter') {
          await resolverPendenciaWhatsApp(pendencia.id);
          return `Perfeito! Mantive os dois documentos no Cofre.`;
        }
      } catch (err) {
        console.warn('[Pendencias WhatsApp ⚠️] Erro na IA ao classificar duplicidade:', err);
      }
    }

    return `Não entendi se você prefere substituir o anterior ou manter ambos. Pode me responder apenas "Substituir" ou "Manter os dois"?`;
  }

  // -------------------------------------------------------------
  // CASO 2: NOVO TITULAR (Deseja cadastrar como novo titular?)
  // -------------------------------------------------------------
  if (tipoPendencia === 'novo_titular') {
    const nomeNoDoc = pendencia.dados_detectados.nomeNoDocumento;
    const tipo = pendencia.dados_detectados.tipo || 'documento';

    const ehAfirmativo =
      /^(sim|pode|cadastr|cadastre|ok|isso|pode cadastrar|com certeza|claro)/i.test(textoLimpo);

    if (ehAfirmativo && nomeNoDoc) {
      const idTitular = `tit_${nomeNoDoc.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      // Cadastra o novo titular
      await salvarOuAtualizarTitular({
        id: idTitular,
        nome: nomeNoDoc,
        campos: {},
        atualizadoEm: formatarHorarioBrasilia(),
      });

      // Vincula o documento e trechos ao novo titular
      await supabase
        .from('documentos')
        .update({
          titular: nomeNoDoc,
          pessoa_id: idTitular,
          corporativo: false,
        })
        .eq('id', pendencia.documento_id);

      await supabase
        .from('trechos')
        .update({
          titular: nomeNoDoc,
          pessoa_id: idTitular,
        })
        .eq('documento_id', pendencia.documento_id);

      await resolverPendenciaWhatsApp(pendencia.id);
      return `Novo titular *${nomeNoDoc}* cadastrado com sucesso e documento vinculado como *${tipo}*!`;
    }

    // Se o usuário disser que não ou indicar outro nome
    const ehNegativo = /^(n[aã]o|negativo|nao)/i.test(textoLimpo);
    if (ehNegativo && textoLimpo.length < 15) {
      // Muda a pendência para falta_titular
      await salvarPendenciaDocumentoWhatsApp({
        conversaId: pendencia.conversa_id,
        remetenteNumero: pendencia.remetente_numero,
        remetenteJid: pendencia.remetente_jid,
        documentoId: pendencia.documento_id,
        tipoPendencia: 'falta_titular',
        dadosDetectados: { ...pendencia.dados_detectados, titular: '' },
      });
      return `Entendido. De quem é este documento, então?`;
    }

    // Se o usuário já informou outro titular na resposta (ex: "Não, é do Fulano")
    if (openai) {
      try {
        const titulares = await obterTodosTitulares();
        const listaNomes = titulares.map((t) => t.nome).join(', ');

        const resp = await chamarChatComTelemetria(
          openai,
          {
            model: 'gpt-5.4-mini',
            messages: [
              {
                role: 'system',
                content: `O usuário respondeu à pergunta sobre cadastrar um novo titular. Extraia se ele indicou outro titular já cadastrado ou um nome diferente.
Titulares existentes: ${listaNomes}
Retorne estritamente JSON: {"nomeTitular": string | null, "querCadastrarNovo": boolean}`,
              },
              { role: 'user', content: textoLimpo },
            ],
            response_format: { type: 'json_object' },
          },
          { motivo: 'whatsapp_pendencia_titular' }
        );

        const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
        if (parsed.nomeTitular) {
          const titularInformado = parsed.nomeTitular.trim();
          const titularExistente = resolverTitularCadastrado(titularInformado, titulares);
          const titularFinal = titularExistente ? titularExistente.nome : titularInformado;
          const pessoaId = titularExistente
            ? titularExistente.id
            : `tit_${titularFinal.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

          await supabase
            .from('documentos')
            .update({
              titular: titularFinal,
              pessoa_id: pessoaId,
            })
            .eq('id', pendencia.documento_id);

          await supabase
            .from('trechos')
            .update({
              titular: titularFinal,
              pessoa_id: pessoaId,
            })
            .eq('documento_id', pendencia.documento_id);

          await resolverPendenciaWhatsApp(pendencia.id);
          return `Documento vinculado com sucesso ao titular *${titularFinal}*!`;
        }
      } catch (err) {
        console.warn('[Pendencias WhatsApp ⚠️] Erro ao extrair titular da resposta:', err);
      }
    }

    return `Deseja que eu cadastre *${nomeNoDoc}* como novo titular no Cofre? Por favor, responda "Sim" para cadastrar ou me diga de quem é o documento.`;
  }

  // -------------------------------------------------------------
  // CASO 3: FALTA TITULAR, TIPO OU AMBOS
  // -------------------------------------------------------------
  if (
    tipoPendencia === 'falta_titular' ||
    tipoPendencia === 'falta_tipo' ||
    tipoPendencia === 'falta_ambos'
  ) {
    let titularExtraido: string | null = pendencia.dados_detectados.titular || null;
    let tipoExtraido: string | null = pendencia.dados_detectados.tipo || null;

    if (openai) {
      try {
        const titulares = await obterTodosTitulares();
        const listaNomes = titulares.map((t) => t.nome).join(', ');

        const resp = await chamarChatComTelemetria(
          openai,
          {
            model: 'gpt-5.4-mini',
            messages: [
              {
                role: 'system',
                content: `Você está auxiliando no cadastro de um documento no Cofre.
O usuário está informando campos que estavam faltando (${tipoPendencia}).
Titulares cadastrados: ${listaNomes}
Analise a mensagem do usuário e extraia o titular e o tipo de documento informados.
Retorne estritamente JSON:
{
  "titular": string | null,
  "tipo": string | null
}`,
              },
              { role: 'user', content: textoLimpo },
            ],
            response_format: { type: 'json_object' },
          },
          { motivo: 'whatsapp_pendencia_completar' }
        );

        const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
        if (parsed.titular) titularExtraido = parsed.titular.trim();
        if (parsed.tipo) tipoExtraido = parsed.tipo.trim();
      } catch (err) {
        console.warn('[Pendencias WhatsApp ⚠️] Erro ao analisar campos faltantes com IA:', err);
      }
    }

    // Se faltava apenas um e não usamos IA
    if (!titularExtraido && tipoPendencia === 'falta_titular') {
      titularExtraido = textoLimpo.replace(/^(é do|é da|de|da|do|pertence a)\s+/i, '').trim();
    }
    if (!tipoExtraido && tipoPendencia === 'falta_tipo') {
      tipoExtraido = textoLimpo.replace(/^(é um|é uma|tipo|o tipo é)\s+/i, '').trim();
    }

    if (titularExtraido && tipoExtraido) {
      const todosTitulares = await obterTodosTitulares();
      const titRes = resolverTitularCadastrado(titularExtraido, todosTitulares);
      const titularFinal = titRes ? titRes.nome : titularExtraido;
      const pessoaIdFinal = titRes ? titRes.id : null;

      // Verifica se existe duplicidade com os novos dados pelo ID do titular ou titular
      let queryDuplicidade = supabase
        .from('documentos')
        .select('id, titulo, created_at')
        .ilike('tipo', tipoExtraido)
        .eq('status_indexacao', 'indexado')
        .neq('id', pendencia.documento_id)
        .limit(1);

      if (pessoaIdFinal) {
        queryDuplicidade = queryDuplicidade.eq('pessoa_id', pessoaIdFinal);
      } else {
        queryDuplicidade = queryDuplicidade.ilike('titular', titularFinal);
      }

      const { data: existente } = await queryDuplicidade.maybeSingle();

      const tituloAtualizado = `${tipoExtraido} ${titularFinal}`.trim();
      await supabase
        .from('documentos')
        .update({
          titular: titularFinal,
          pessoa_id: pessoaIdFinal,
          tipo: tipoExtraido,
          titulo: tituloAtualizado,
        })
        .eq('id', pendencia.documento_id);

      await supabase
        .from('trechos')
        .update({
          titular: titularFinal,
          pessoa_id: pessoaIdFinal,
          tipo_documento: tipoExtraido,
          documento_titulo: tituloAtualizado,
        })
        .eq('documento_id', pendencia.documento_id);

      if (existente) {
        const dataEnvioFormatada = existente.created_at
          ? new Date(existente.created_at).toLocaleDateString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : 'anteriormente';

        // Atualiza para pendência de duplicidade
        await salvarPendenciaDocumentoWhatsApp({
          conversaId: pendencia.conversa_id,
          remetenteNumero: pendencia.remetente_numero,
          remetenteJid: pendencia.remetente_jid,
          documentoId: pendencia.documento_id,
          tipoPendencia: 'duplicidade',
          dadosDetectados: {
            tipo: tipoExtraido,
            titular: titularExtraido,
            docExistenteId: existente.id,
            docExistenteTitulo: existente.titulo,
            docExistenteData: dataEnvioFormatada,
          },
        });

        return `Já existe um *${tipoExtraido}* do *${titularExtraido}* no Cofre (enviado em ${dataEnvioFormatada}). Substituo ou mantenho os dois?`;
      }

      await resolverPendenciaWhatsApp(pendencia.id);
      return `Documento salvo e indexado com sucesso como *${tipoExtraido}* do *${titularExtraido}*!`;
    }

    // Se ainda faltar algum campo
    if (!titularExtraido && tipoExtraido) {
      await salvarPendenciaDocumentoWhatsApp({
        conversaId: pendencia.conversa_id,
        remetenteNumero: pendencia.remetente_numero,
        remetenteJid: pendencia.remetente_jid,
        documentoId: pendencia.documento_id,
        tipoPendencia: 'falta_titular',
        dadosDetectados: { ...pendencia.dados_detectados, tipo: tipoExtraido },
      });
      return `Identifiquei o tipo como *${tipoExtraido}*. De quem é este documento?`;
    }

    if (titularExtraido && !tipoExtraido) {
      await salvarPendenciaDocumentoWhatsApp({
        conversaId: pendencia.conversa_id,
        remetenteNumero: pendencia.remetente_numero,
        remetenteJid: pendencia.remetente_jid,
        documentoId: pendencia.documento_id,
        tipoPendencia: 'falta_tipo',
        dadosDetectados: { ...pendencia.dados_detectados, titular: titularExtraido },
      });
      return `Identifiquei o titular como *${titularExtraido}*. Qual é o tipo deste documento?`;
    }

    return `Ainda preciso que você informe o titular e o tipo do documento para concluir o salvamento.`;
  }

  // -------------------------------------------------------------
  // CASO 4: CONFIRMAÇÃO SIMPLES ("Salvei como X do Y. Se não for isso...")
  // -------------------------------------------------------------
  if (tipoPendencia === 'confirmacao_simples') {
    const textoSemPontuacao = textoLimpo.toLowerCase().replace(/[^a-záàâãéèêíïóôõöúçñ\s]/gi, '').trim();
    const ehAgradecimentoOuConfirmacao =
      /^(ok|obrigad[oa]|valeu|beleza|perfeito|[oó]timo|show|combinado|maravilha|tudo certo|t[aá] bom|certo|fechou|valeu vega|obrigado vega|obrigada vega|valeu obrigado|ok obrigado|perfeito obrigado)$/i.test(
        textoSemPontuacao
      ) ||
      textoSemPontuacao.split(/\s+/).every((p) =>
        ['ok', 'obrigado', 'obrigada', 'valeu', 'vega', 'beleza', 'perfeito', 'otimo', 'ótimo', 'show', 'combinado', 'certo', 'bom', 'ta', 'tá'].includes(p)
      );

    if (ehAgradecimentoOuConfirmacao) {
      await resolverPendenciaWhatsApp(pendencia.id);
      return `Por nada! Qualquer coisa estou à disposição.`;
    }

    // Verifica se o usuário está corrigindo titular ou tipo
    const pareceCorrecao =
      /^(n[aã]o|corrige|troca|muda|na verdade|[eé] |o tipo [eé]|o titular [eé])/i.test(textoLimpo) ||
      textoLimpo.toLowerCase().includes('não é') ||
      textoLimpo.toLowerCase().includes('na verdade') ||
      textoLimpo.toLowerCase().includes('o tipo') ||
      textoLimpo.toLowerCase().includes('o titular');

    if (pareceCorrecao && openai) {
      try {
        const resp = await chamarChatComTelemetria(
          openai,
          {
            model: 'gpt-5.4-mini',
            messages: [
              {
                role: 'system',
                content: `O documento foi previamente salvo como tipo: "${pendencia.dados_detectados.tipo}" e titular: "${pendencia.dados_detectados.titular}".
O usuário está enviando uma mensagem. Verifique se ele está corrigindo o titular ou o tipo.
Retorne estritamente JSON:
{
  "ehCorrecao": boolean,
  "novoTitular": string | null,
  "novoTipo": string | null
}`,
              },
              { role: 'user', content: textoLimpo },
            ],
            response_format: { type: 'json_object' },
          },
          { motivo: 'whatsapp_pendencia_correcao' }
        );

        const parsed = JSON.parse(resp.choices[0]?.message?.content || '{}');
        if (parsed.ehCorrecao && (parsed.novoTitular || parsed.novoTipo)) {
          const titularFinal = parsed.novoTitular || pendencia.dados_detectados.titular;
          const tipoFinal = parsed.novoTipo || pendencia.dados_detectados.tipo;
          const novoTitulo = `${tipoFinal} ${titularFinal}`.trim();

          await supabase
            .from('documentos')
            .update({
              titular: titularFinal,
              tipo: tipoFinal,
              titulo: novoTitulo,
            })
            .eq('id', pendencia.documento_id);

          await supabase
            .from('trechos')
            .update({
              titular: titularFinal,
              tipo_documento: tipoFinal,
              documento_titulo: novoTitulo,
            })
            .eq('documento_id', pendencia.documento_id);

          await resolverPendenciaWhatsApp(pendencia.id);
          return `Dados corrigidos! O documento agora está salvo no Cofre como *${tipoFinal}* do *${titularFinal}*.`;
        }
      } catch (err) {
        console.warn('[Pendencias WhatsApp ⚠️] Erro ao extrair correção com IA:', err);
      }
    }

    // Se não for agradecimento nem correção, encerra a pendência e deixa passar para a VEGA responder normalmente!
    await resolverPendenciaWhatsApp(pendencia.id);
    return null;
  }

  // Fallback genérico: resolve pendência e deixa mensagem seguir para o chat
  await resolverPendenciaWhatsApp(pendencia.id);
  return null;
}
