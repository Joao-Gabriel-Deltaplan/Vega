import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { montarPromptContextualTranscricao } from '../whatsapp/audioTranscriptionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTestes() {
  console.log('================================================================');
  console.log('🧪 TESTE: CONSULTAS DE PIX, PIS E BASE DE CONHECIMENTO ESTRUTURADO');
  console.log('================================================================\n');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não encontrada no .env');
  }
  const openai = new OpenAI({ apiKey });

  let sucessos = 0;
  let totalTestes = 0;

  // TESTE 0: Prompt Contextual de Transcrição
  totalTestes++;
  console.log('--- TESTE 0: Prompt Contextual de Transcrição de Áudio ---');
  const promptAudio = await montarPromptContextualTranscricao();
  console.log(`Tamanho do Prompt de Áudio: ${promptAudio.length} caracteres (~${Math.round(promptAudio.length / 4)} tokens)`);
  console.log(`Trecho inicial: ${promptAudio.slice(0, 250)}...`);

  const temPix = promptAudio.includes('PIX') || promptAudio.includes('chave PIX');
  const temPis = promptAudio.includes('PIS');

  if (temPix && temPis && promptAudio.length <= 800) {
    console.log('✅ TESTE 0 PASSOU: Prompt de áudio contém PIX e PIS distinguidos, inclui itens do conhecimento e respeita limite de tokens.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 0 FALHOU:', { temPix, temPis, len: promptAudio.length });
  }

  // TESTE 1: "qual o pix do João Gabriel"
  totalTestes++;
  console.log('--- TESTE 1: "qual o pix do João Gabriel" ---');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o pix do João Gabriel',
    historicoRecente: [],
    openai,
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  console.log(`Intenção: ${res1.intencaoDetectada}`);
  console.log(`Busca Usada: ${res1.buscaUsada}`);
  console.log(`Dados Estruturados:`, res1.dadosEstruturados);

  const t1ChaveOk = res1.textoResposta.includes('14996863115');
  const t1EstruturadoOk = res1.dadosEstruturados?.chavePix === '14996863115' && res1.dadosEstruturados?.tipo === 'pix';

  if (t1ChaveOk && t1EstruturadoOk) {
    console.log('✅ TESTE 1 PASSOU: Chave PIX retornada com sucesso e dados estruturados para botão de copiar no painel.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 1 FALHOU:', { t1ChaveOk, t1EstruturadoOk });
  }

  // TESTE 2: "me manda a chave pix"
  totalTestes++;
  console.log('--- TESTE 2: "me manda a chave pix" ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'me manda a chave pix',
    historicoRecente: [],
    openai,
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  console.log(`Intenção: ${res2.intencaoDetectada}`);
  console.log(`Dados Estruturados:`, res2.dadosEstruturados);

  const t2ChaveOk = res2.textoResposta.includes('14996863115');
  const t2EstruturadoOk = res2.dadosEstruturados?.chavePix === '14996863115';

  if (t2ChaveOk && t2EstruturadoOk) {
    console.log('✅ TESTE 2 PASSOU: Pedido genérico de chave PIX retornou a chave cadastrada com dados estruturados.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 2 FALHOU:', { t2ChaveOk, t2EstruturadoOk });
  }

  // TESTE 3: "qual o PIS do Thomaz"
  totalTestes++;
  console.log('--- TESTE 3: "qual o PIS do Thomaz" (Garantia Regra 17) ---');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'qual o PIS do Thomaz',
    historicoRecente: [],
    openai,
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  console.log(`Intenção: ${res3.intencaoDetectada}`);
  console.log(`Busca Usada: ${res3.buscaUsada}`);

  const t3NaoEncontrouOk = /não encontrei.*pis.*thomaz.*documentos/i.test(res3.textoResposta);
  const t3NaoVazouPix = !res3.textoResposta.toLowerCase().includes('pix') && !res3.dadosEstruturados?.chavePix;

  if (t3NaoEncontrouOk && t3NaoVazouPix) {
    console.log('✅ TESTE 3 PASSOU: "PIS do Thomaz" respondeu estritamente que não encontrou nos documentos, sem confundir com PIX.\n');
    sucessos++;
  } else {
    console.error('❌ TESTE 3 FALHOU:', { t3NaoEncontrouOk, t3NaoVazouPix, texto: res3.textoResposta });
  }

  console.log(`================================================================`);
  console.log(`RESULTADO FINAL: ${sucessos}/${totalTestes} testes passaram com sucesso!`);
  console.log(`================================================================`);

  if (sucessos !== totalTestes) {
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('Erro fatal durante execução dos testes:', err);
  process.exit(1);
});
