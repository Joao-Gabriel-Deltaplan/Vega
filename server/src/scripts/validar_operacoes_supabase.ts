import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  obterTodosDocumentos,
  obterTodosTitulares,
  obterTodosConhecimentos,
  obterRegistrosUsoIA,
  obterBuscasSemResultado,
} from '../storage.js';
import { obterTodosUsuariosWhatsApp } from '../whatsapp/usuarioWhatsAppService.js';
import { obterTodosAlertas } from '../vencimentos/alertaVencimentoService.js';
import { obterBufferArquivo } from '../utils/storageUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function validar() {
  console.log('=== TESTE DE VALIDAÇÃO DE OPERAÇÕES COM SUPABASE ===\n');

  // 1. Documentos
  const docs = await obterTodosDocumentos();
  console.log(`✔ Documentos recuperados do Supabase: ${docs.length}`);
  for (const d of docs) {
    console.log(`   - [${d.id}] "${d.titulo}" | Validade: ${d.dataValidade || 'sem validade'} | Silenciar: ${d.silenciarAlertas}`);
  }

  // 2. Titulares
  const titulares = await obterTodosTitulares();
  console.log(`\n✔ Titulares recuperados do Supabase: ${titulares.length}`);
  for (const t of titulares) {
    console.log(`   - [${t.id}] ${t.nome} | Campos cadastrados: ${Object.keys(t.campos).length}`);
  }

  // 3. Conhecimento
  const itensK = await obterTodosConhecimentos();
  console.log(`\n✔ Itens de conhecimento recuperados do Supabase: ${itensK.length}`);
  for (const k of itensK) {
    console.log(`   - [${k.id}] ${k.titulo} (${k.categoria}): "${k.conteudo.slice(0, 50)}..."`);
  }

  // 4. Usuários WhatsApp
  const usuarios = await obterTodosUsuariosWhatsApp();
  console.log(`\n✔ Usuários do WhatsApp no Supabase: ${usuarios.length}`);
  for (const u of usuarios) {
    console.log(`   - [${u.id}] ${u.nome} (${u.numero} - ${u.perfil})`);
  }

  // 5. Alertas de Vencimento
  const alertas = await obterTodosAlertas();
  console.log(`\n✔ Alertas de vencimento no Supabase: ${alertas.length}`);
  for (const a of alertas) {
    console.log(`   - [${a.id}] ${a.documentoTitulo} - ${a.dataValidade} | Dias restantes: ${a.diasRestantes} | Lido: ${a.lido}`);
  }

  // 6. Uso IA e Buscas
  const usos = await obterRegistrosUsoIA();
  const buscas = await obterBuscasSemResultado();
  console.log(`\n✔ Telemetria no Supabase: ${usos.length} registros de uso IA | ${buscas.length} buscas registradas`);

  // 7. Supabase Storage: Download de um arquivo para teste de streaming
  console.log('\n--- Testando download do Supabase Storage ---');
  const arqTeste = 'CNH DIGITAL THOMAZ.pdf';
  const bufferResult = await obterBufferArquivo(arqTeste);
  if (bufferResult) {
    console.log(`✔ Download via Supabase Storage funcionou! "${arqTeste}" recebido com ${(bufferResult.buffer.length / 1024).toFixed(1)} KB`);
  } else {
    console.error(`❌ Falha no download do Storage para "${arqTeste}"`);
  }

  // 8. Teste com arquivo com acento
  const arqAcento = 'CARTÃO DE VACINAS.pdf';
  const bufferAcento = await obterBufferArquivo(arqAcento);
  if (bufferAcento) {
    console.log(`✔ Download de arquivo com acento funcionou! "${arqAcento}" recebido com ${(bufferAcento.buffer.length / 1024).toFixed(1)} KB`);
  } else {
    console.error(`❌ Falha no download do Storage para "${arqAcento}"`);
  }

  console.log('\n=== VALIDAÇÃO CONCLUÍDA COM SUCESSO! ===');
}

validar().catch(console.error);
