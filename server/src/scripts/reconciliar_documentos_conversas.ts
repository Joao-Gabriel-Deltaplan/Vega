import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { obterTodosDocumentos, obterTodasConversas, obterConversaPorId, salvarConversa } from '../storage.js';
import { obterAgoraIsoUtc, formatarHorarioBrasilia } from '../utils/dataHoraUtils.js';
import { Anexo, Mensagem } from '../types.js';

async function reconciliarDocumentos() {
  console.log('--- RECONCILIAÇÃO DE DOCUMENTOS DO WHATSAPP NO HISTÓRICO DE CONVERSAS ---');
  const docs = await obterTodosDocumentos();
  console.log(`Total de documentos encontrados: ${docs.length}`);
  for (const doc of docs) {
    console.log(`- Doc: "${doc.arquivo}" | Titular: "${doc.titular}" | Origem: "${doc.metadata?.origem || 'sem_origem'}"`);
  }

  const c = await obterConversaPorId('wa-5500000000000');
  if (c && c.mensagens) {
    console.log(`\nÚltimas 15 mensagens da conversa ${c.id}:`);
    for (const m of c.mensagens.slice(-15)) {
      console.log(`[${m.horario}] ${m.remetente}: "${m.texto?.slice(0, 100)}" | Anexos: ${m.anexos?.length || 0} | Tipo: ${m.tipoMensagem || 'nenhum'}`);
    }
  }

  const docsWhatsApp = docs.filter(d => (d.metadata as any)?.origem === 'whatsapp');
  console.log(`\nDocumentos recebidos via WhatsApp: ${docsWhatsApp.length}`);

  let reconciliados = 0;

  for (const doc of docsWhatsApp) {
    const conversaId = (doc.metadata as any)?.conversaId || ((doc.metadata as any)?.remetenteNumero ? `wa-${(doc.metadata as any).remetenteNumero}` : null);
    if (!conversaId) {
      console.log(`Documento "${doc.arquivo}" sem conversaId ou remetenteNumero. Pulando.`);
      continue;
    }

    const conversa = await obterConversaPorId(conversaId);
    if (!conversa) {
      console.log(`Conversa ${conversaId} não encontrada para documento "${doc.arquivo}". Pulando.`);
      continue;
    }

    // Verifica se já existe mensagem contendo esse documento
    const jaExiste = (conversa.mensagens || []).some((m: Mensagem) => {
      const temNoAnexo = m.anexos?.some((a: Anexo) => a.nome === doc.arquivo || a.url?.includes(encodeURIComponent(doc.arquivo)));
      const temNoTexto = m.texto?.includes(doc.arquivo);
      return temNoAnexo || (temNoTexto && m.remetente === 'cliente');
    });

    if (jaExiste) {
      console.log(`Documento "${doc.arquivo}" já consta na conversa ${conversaId}.`);
      continue;
    }

    console.log(`Reconciliando documento "${doc.arquivo}" na conversa ${conversaId}...`);

    const isImagem = doc.arquivo.match(/\.(jpg|jpeg|png|webp)$/i) !== null;
    const anexo: Anexo = {
      tipo: isImagem ? 'imagem' : 'pdf',
      url: `/arquivos/${encodeURIComponent(doc.arquivo)}`,
      nome: doc.arquivo,
      titulo: doc.titulo,
      tamanho: doc.tamanho,
      mimeType: isImagem ? 'image/jpeg' : 'application/pdf',
      visibilidade: 'diretoria',
    };

    const msgCliente: Mensagem = {
      id: `rec-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-user`,
      remetente: 'cliente',
      nomeRemetente: (doc.metadata as any)?.remetenteNome || conversa.contato?.nome || 'Usuário',
      horario: formatarHorarioBrasilia(),
      timestamp: (doc.metadata as any)?.criadoEm || obterAgoraIsoUtc(),
      texto: isImagem ? `[Imagem enviada: ${doc.arquivo}]` : `[Documento enviado: ${doc.arquivo}]`,
      tipoMensagem: isImagem ? 'imagem' : 'documento',
      anexos: [anexo],
    };

    const msgVega: Mensagem = {
      id: `rec-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorarioBrasilia(),
      timestamp: (doc.metadata as any)?.criadoEm || obterAgoraIsoUtc(),
      texto: `Recebi seu documento *${doc.arquivo}*! Já foi salvo no Cofre e estou analisando com IA em segundo plano. Assim que terminar, te aviso aqui.`,
      origem: 'motor',
    };

    conversa.mensagens = conversa.mensagens || [];
    conversa.mensagens.push(msgCliente, msgVega);
    conversa.ultimaAtualizacao = obterAgoraIsoUtc();

    await salvarConversa(conversa);
    reconciliados++;
    console.log(`Documento "${doc.arquivo}" reconciliado com sucesso na conversa ${conversaId}!`);
  }

  console.log(`\nReconciliação finalizada. Total reconciliados: ${reconciliados}`);
}

reconciliarDocumentos().catch(console.error);
