import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  extrairTextoDocumento,
  dividirEmTrechos,
  gerarEmbeddingsEmLote,
  extrairCamposSugeridosFicha,
  salvarCamposSugeridosNoTitular,
} from '../indexador/indexadorService.js';
import { obterTodosDocumentos, salvarDocumentos, obterTodosTitulares } from '../storage.js';
import { executarBuscaVetorial, processarMensagemChat } from '../chat/chatOrquestrador.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ARQUIVOS_DIR = path.resolve(__dirname, '../../../arquivos');

function calcularHashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function mascararDados(texto: string): string {
  return texto
    .replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, '***.***.***-**')
    .replace(/\b(\d{11})\b/g, '***********')
    .replace(/\b(\d{1,2})\.?(\d{3})\.?(\d{3})-?([0-9Xx])\b/g, '**.***.***-*');
}

async function main() {
  console.log('================================================================');
  console.log('REINDEXAÇÃO DA CNH DIGITAL REAL & EXTRAÇÃO DE FICHA SUGERIDA');
  console.log('================================================================\n');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente no .env');
  const openai = new OpenAI({ apiKey });
  const supabase = getSupabaseClient();

  // 1. Localiza o documento no cofre
  const docs = await obterTodosDocumentos();
  const docsCnh = docs.filter((d) => d.arquivo === 'CNH DIGITAL THOMAZ.pdf' || d.titulo.toLowerCase().includes('cnh'));

  console.log(`Documentos de CNH encontrados no Cofre: ${docsCnh.length}`);
  if (docsCnh.length === 0) {
    throw new Error('Nenhum documento de CNH encontrado no Cofre.');
  }

  // Mantém apenas o registro ativo mais recente se houvesse duplicata no JSON
  const docAlvo = docsCnh[docsCnh.length - 1];
  console.log(`Documento alvo no Cofre: ID=${docAlvo.id}, Titulo="${docAlvo.titulo}", Arquivo="${docAlvo.arquivo}"`);

  // Remove eventuais duplicatas no JSON
  if (docsCnh.length > 1) {
    console.log('Limpando duplicatas de CNH em data/documentos.json...');
    const docsFiltrados = docs.filter((d) => !docsCnh.some((c) => c.id === d.id) || d.id === docAlvo.id);
    await salvarDocumentos(docsFiltrados);
  }

  // 2. Remove registros antigos e trechos da CNH no Supabase
  console.log('\n2. Removendo versões anteriores da CNH no Supabase...');
  const { data: antigosSupabase } = await supabase
    .from('documentos')
    .select('id, arquivo, titulo')
    .or(`arquivo.eq.${docAlvo.arquivo},titulo.ilike.%cnh%`);

  if (antigosSupabase && antigosSupabase.length > 0) {
    for (const a of antigosSupabase) {
      console.log(`- Apagando documento ${a.id} ("${a.titulo}" / ${a.arquivo}) e seus trechos...`);
      await supabase.from('trechos').delete().eq('documento_id', a.id);
      await supabase.from('documentos').delete().eq('id', a.id);
    }
  }

  // 3. Executa a extração da nova CNH (288 KB) com OCR via visão
  const caminhoCnh = path.join(ARQUIVOS_DIR, docAlvo.arquivo);
  console.log(`\n3. Extraindo texto do arquivo real: ${caminhoCnh}`);
  const tamanhoBytes = fs.statSync(caminhoCnh).size;
  console.log(`Tamanho do arquivo: ${tamanhoBytes} bytes`);

  const buffer = fs.readFileSync(caminhoCnh);
  const hashAtual = calcularHashBuffer(buffer);

  const { paginas, usouOCR } = await extrairTextoDocumento(caminhoCnh, openai, {
    titulo: docAlvo.titulo,
    descricao: docAlvo.descricao,
    titular: docAlvo.titular,
  });

  const textoCompleto = paginas.map((p) => p.texto).join('\n\n');
  console.log(`Extração concluída: ${paginas.length} páginas, ${textoCompleto.length} caracteres, Usou OCR: ${usouOCR ? 'SIM' : 'NÃO'}`);

  // 4. Divisão em Trechos
  const trechos = dividirEmTrechos(paginas);
  console.log(`Quantidade de trechos gerados: ${trechos.length}`);

  // 5. Geração de Embeddings e gravação no Supabase
  console.log('Gerando embeddings em lote com text-embedding-3-small...');
  const textosEmbedding = trechos.map((t) => t.conteudo);
  const embeddings = await gerarEmbeddingsEmLote(textosEmbedding, openai);

  const pessoaId = 'tit_thomaz';
  const { data: novoDocSupabase, error: errInsertDoc } = await supabase
    .from('documentos')
    .insert({
      titulo: docAlvo.titulo,
      arquivo: docAlvo.arquivo,
      hash_arquivo: hashAtual,
      tipo: docAlvo.tipo || 'CNH',
      pessoa_id: pessoaId,
      corporativo: false,
      visibilidade: docAlvo.visibilidade || 'diretoria',
    })
    .select('id')
    .single();

  if (errInsertDoc || !novoDocSupabase) {
    throw new Error(`Erro ao inserir CNH no Supabase: ${errInsertDoc?.message}`);
  }

  const payloadTrechos = trechos.map((t, idx) => ({
    documento_id: novoDocSupabase.id,
    pessoa_id: pessoaId,
    corporativo: false,
    pagina: t.pagina,
    conteudo: t.conteudo,
    embedding: embeddings[idx],
  }));

  const { error: errInsertTrechos } = await supabase.from('trechos').insert(payloadTrechos);
  if (errInsertTrechos) {
    throw new Error(`Erro ao inserir trechos da CNH no Supabase: ${errInsertTrechos.message}`);
  }
  console.log('✅ Documento e trechos salvos no Supabase com sucesso!');

  // Atualiza status no documento do cofre
  docAlvo.statusIndexacao = 'indexado';
  delete docAlvo.erroIndexacao;
  const docsAtuais = await obterTodosDocumentos();
  const indexDocAlvo = docsAtuais.findIndex((d) => d.id === docAlvo.id);
  if (indexDocAlvo >= 0) {
    docsAtuais[indexDocAlvo].statusIndexacao = 'indexado';
    delete docsAtuais[indexDocAlvo].erroIndexacao;
    await salvarDocumentos(docsAtuais);
  }

  // 6. Extração da Ficha Sugerida
  console.log('\n6. Executando extração de ficha sugerida (cnh, categoria, validade)...');
  const camposSugeridos = await extrairCamposSugeridosFicha(textoCompleto, 'CNH', openai);
  console.log('Campos sugeridos extraídos:', JSON.stringify(camposSugeridos, null, 2));

  await salvarCamposSugeridosNoTitular('Thomaz', camposSugeridos, docAlvo.id, docAlvo.titulo);

  // 7. Teste de Busca Vetorial: "qual a validade da CNH do Thomaz?"
  console.log('\n7. Testando busca vetorial para: "qual a validade da CNH do Thomaz?"');
  const perguntaTeste = 'qual a validade da CNH do Thomaz?';
  const trechosEncontrados = await executarBuscaVetorial(perguntaTeste, pessoaId, 5);

  console.log(`Trechos encontrados (${trechosEncontrados.length}):`);
  trechosEncontrados.forEach((t, i) => {
    console.log(`  [${i + 1}] "${t.titulo_documento}" (Página ${t.pagina}) - Similaridade: ${(t.similaridade * 100).toFixed(2)}%`);
  });

  // 8. Teste de Resposta da VEGA via orquestrador
  console.log('\n8. Testando resposta completa da VEGA no Chat:');
  const respChat = await processarMensagemChat({
    mensagemUsuario: perguntaTeste,
    historicoRecente: [],
    contato: {
      id: 'contato_diretoria',
      nome: 'João Gabriel',
      telefone: '11999999999',
      avatarCor: '#22c55e',
      nivelAcesso: 'diretoria',
      cargo: 'Diretor',
      ficha: { cargo: 'Diretor', setor: 'Diretoria', nivelAcesso: 'diretoria', observacoes: '' },
    },
    documentosDisponiveis: [docAlvo],
  });

  console.log(`Origem: ${respChat.origem} | Intenção: ${respChat.intencaoDetectada}`);
  console.log(`Pergunta Reescrita: "${respChat.perguntaReescrita}"`);
  console.log(`Resposta da VEGA: "${respChat.textoResposta}"`);

  // 9. Auditoria de Duplicatas
  console.log('\n9. Verificando ausência de duplicatas:');
  const docsCofreFinais = (await obterTodosDocumentos()).filter((d) => d.arquivo === 'CNH DIGITAL THOMAZ.pdf');
  console.log(`- No Cofre: ${docsCofreFinais.length} registro(s)`);

  const { data: docsSupabaseFinais } = await supabase.from('documentos').select('id, titulo, arquivo').eq('arquivo', 'CNH DIGITAL THOMAZ.pdf');
  console.log(`- No Supabase: ${docsSupabaseFinais?.length} registro(s)`);

  // 10. Mostra os primeiros 300 caracteres extraídos com CPF/RG mascarados
  console.log('\n================================================================');
  console.log('PRIMEIROS 300 CARACTERES EXTRAÍDOS (CPF/RG MASCARADOS):');
  console.log('================================================================');
  console.log(mascararDados(textoCompleto).slice(0, 300));
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Erro no script:', err);
  process.exit(1);
});
