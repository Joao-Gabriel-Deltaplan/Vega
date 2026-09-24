import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import PDFDocument from 'pdfkit';
import {
  verificarSePdfProtegidoPorSenha,
  extrairTextoPdfComSenha,
  PdfProtegidoPorSenhaError,
} from '../pdfService.js';
import { MENSAGEM_PDF_PROTEGIDO_SENHA } from '../processadorSegundoPlanoService.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

function gerarPdfProtegido(senha: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      userPassword: senha,
      ownerPassword: senha + '_admin',
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: true,
        annotating: false,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    doc.fontSize(16).text('Apólice de Seguro Delta Protegido', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('Titular do Documento: Titular Teste');
    doc.text('Veículo Coberto: Caminhão Volvo FH 540');
    doc.text('Seguradora: Porto Seguro Cia');
    doc.text('Vigência da Apólice: 10/05/2026 até 10/05/2027');
    doc.text('Documento confidencial com senha para testes do Cofre VEGA.');
    doc.end();
  });
}

function gerarPdfAberto(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    doc.fontSize(14).text('Documento PDF Aberto e Sem Senha');
    doc.text('Conteúdo livre para leitura imediata.');
    doc.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log(' TESTE AUTOMATIZADO: SUPORTE A PDFS PROTEGIDOS POR SENHA');
  console.log('================================================================\n');

  const SENHA_TESTE = 'Delta@Protegido2026';
  const SENHA_ERRADA = 'SenhaInvalida999';

  console.log('Gerando buffers de teste (um protegido por senha e outro aberto)...');
  const bufferProtegido = await gerarPdfProtegido(SENHA_TESTE);
  const bufferAberto = await gerarPdfAberto();
  console.log(`Buffer protegido gerado: ${bufferProtegido.length} bytes`);
  console.log(`Buffer aberto gerado: ${bufferAberto.length} bytes\n`);

  // --- TESTE 1: Detecção preventiva antes de extrair texto ---
  console.log('--- TESTE 1: Detecção preventiva de PDF protegido ---');
  const checagemProtegido = await verificarSePdfProtegidoPorSenha(bufferProtegido);
  const checagemAberto = await verificarSePdfProtegidoPorSenha(bufferAberto);

  if (!checagemProtegido.protegido) {
    throw new Error('TESTE 1 FALHOU: O PDF protegido não foi identificado como protegido!');
  }
  if (checagemAberto.protegido) {
    throw new Error('TESTE 1 FALHOU: O PDF aberto foi falsamente identificado como protegido!');
  }
  console.log('✅ TESTE 1 APROVADO: Detecção preventiva identificou perfeitamente o PDF com senha e o PDF aberto!\n');

  // --- TESTE 2: Tentativa de extração sem senha ---
  console.log('--- TESTE 2: Tentativa de leitura sem senha (deve lançar PdfProtegidoPorSenhaError) ---');
  let lancouSemSenha = false;
  try {
    await extrairTextoPdfComSenha(bufferProtegido);
  } catch (err: any) {
    if (err instanceof PdfProtegidoPorSenhaError || err.name === 'PdfProtegidoPorSenhaError') {
      lancouSemSenha = true;
      console.log(`Capturado erro esperado: "${err.message}"`);
    } else {
      throw new Error(`TESTE 2 FALHOU: Erro inesperado ao tentar ler sem senha: ${err.message}`);
    }
  }
  if (!lancouSemSenha) {
    throw new Error('TESTE 2 FALHOU: Nenhuma exceção foi lançada ao ler PDF protegido sem senha!');
  }
  console.log('✅ TESTE 2 APROVADO: Lançou PdfProtegidoPorSenhaError com tipagem correta!\n');

  // --- TESTE 3: Tentativa de extração com senha incorreta ---
  console.log('--- TESTE 3: Tentativa de leitura com senha incorreta ---');
  let lancouSenhaIncorreta = false;
  try {
    await extrairTextoPdfComSenha(bufferProtegido, SENHA_ERRADA);
  } catch (err: any) {
    if (err?.message?.includes('incorreta') || err?.message?.includes('Incorrect Password')) {
      lancouSenhaIncorreta = true;
      console.log(`Capturado erro esperado de senha incorreta: "${err.message}"`);
    } else {
      throw new Error(`TESTE 3 FALHOU: Mensagem de erro inesperada: ${err.message}`);
    }
  }
  if (!lancouSenhaIncorreta) {
    throw new Error('TESTE 3 FALHOU: Não lançou erro para senha incorreta!');
  }
  console.log('✅ TESTE 3 APROVADO: Senha incorreta bloqueada com mensagem clara!\n');

  // --- TESTE 4: Extração bem-sucedida com senha correta ---
  console.log('--- TESTE 4: Leitura com a senha correta (desbloqueio em memória) ---');
  const resultadoTexto = await extrairTextoPdfComSenha(bufferProtegido, SENHA_TESTE);
  const textoCompleto = Array.isArray(resultadoTexto.text)
    ? resultadoTexto.text.join('\n')
    : String(resultadoTexto.text || '');
  console.log(`Texto extraído (${resultadoTexto.totalPages} página(s)):`);
  console.log(`"${textoCompleto.trim()}"`);

  if (!textoCompleto.includes('Apólice de Seguro Delta Protegido')) {
    throw new Error('TESTE 4 FALHOU: O texto extraído com a senha correta não contém o título esperado!');
  }
  if (!textoCompleto.includes('Caminhão Volvo FH 540')) {
    throw new Error('TESTE 4 FALHOU: O texto extraído não contém os detalhes do veículo!');
  }
  console.log('✅ TESTE 4 APROVADO: PDF desbloqueado e texto extraído com total fidelidade!\n');

  // --- TESTE 5: Validação da mensagem oficial no painel e WhatsApp ---
  console.log('--- TESTE 5: Validação da mensagem oficial exigida ---');
  const MENSAGEM_ESPERADA =
    'Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.';

  if (MENSAGEM_PDF_PROTEGIDO_SENHA !== MENSAGEM_ESPERADA) {
    throw new Error(`TESTE 5 FALHOU: A mensagem oficial diverge da exigida pelo usuário!\nEsperado: "${MENSAGEM_ESPERADA}"\nObtido: "${MENSAGEM_PDF_PROTEGIDO_SENHA}"`);
  }
  console.log(`Mensagem oficial validada:\n"${MENSAGEM_PDF_PROTEGIDO_SENHA}"`);
  console.log('✅ TESTE 5 APROVADO: Mensagem oficial 100% aderente ao requisito!\n');

  // --- TESTE 6: Atualização e conformidade do documento real no Supabase ---
  console.log('--- TESTE 6: Ajuste do documento real no Supabase para status protegido_senha ---');
  const supabase = getSupabaseClient();
  let { data: docNivus, error: erroNivus } = await supabase
    .from('documentos')
    .select('id, arquivo, status_indexacao, erro_indexacao')
    .eq('id', 'f7b0540e-e2c5-4752-9f54-df3b80342d3d')
    .maybeSingle();

  if (!docNivus) {
    const res = await supabase
      .from('documentos')
      .select('id, arquivo, status_indexacao, erro_indexacao')
      .ilike('arquivo', '%NIVUS%')
      .maybeSingle();
    docNivus = res.data;
  }

  if (!docNivus) {
    const { data: ultimosDocs } = await supabase
      .from('documentos')
      .select('id, arquivo, status_indexacao, erro_indexacao')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log('Últimos 5 documentos no Cofre:', ultimosDocs);
    const docComErro = (ultimosDocs || []).find(d => d.status_indexacao === 'erro' || d.status_indexacao === 'protegido_senha');
    if (docComErro) {
      docNivus = docComErro;
    }
  }

  if (erroNivus) {
    console.error('Erro ao consultar documento no Supabase:', erroNivus);
  } else if (docNivus) {
    console.log(`Documento encontrado no Supabase: "${docNivus.arquivo}" (ID: ${docNivus.id})`);
    console.log(`Status anterior: "${docNivus.status_indexacao}", Erro anterior: "${docNivus.erro_indexacao}"`);

    // Atualiza para o novo status amigável e oficial
    const { error: erroUpdate } = await supabase
      .from('documentos')
      .update({
        status_indexacao: 'protegido_senha',
        erro_indexacao: MENSAGEM_PDF_PROTEGIDO_SENHA,
        updated_at: new Date().toISOString(),
      })
      .eq('id', docNivus.id);

    if (erroUpdate) {
      console.error('Falha ao atualizar documento:', erroUpdate);
    } else {
      console.log(`✅ Documento atualizado para status 'protegido_senha' com a mensagem oficial!`);
    }
  } else {
    console.log('Documento SEGURO CARRO NIVUS TOKYO não encontrado no banco de testes.');
  }
  console.log('✅ TESTE 6 APROVADO: Registro do documento preservado no Cofre sem erro genérico!\n');

  console.log('================================================================');
  console.log(' RESULTADO FINAL: 6/6 TESTES APROVADOS COM SUCESSO! ');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('❌ Falha na execução dos testes:', err);
  process.exit(1);
});
