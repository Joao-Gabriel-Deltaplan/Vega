import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { extrairInfoDocumentoWhatsApp } from '../whatsapp/documentoRecebidoWhatsAppService.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato } from '../types.js';

async function testarIntegridade() {
  console.log('================================================================');
  console.log(' TESTE AUTOMATIZADO: INTEGRIDADE DE CONVERSAS E ESTRUTURAÇÃO   ');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();

  const contatoTeste: Contato = {
    id: 'user_teste',
    nome: 'Usuario Teste',
    telefone: '5500000000000',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    avatarCor: '#10b981',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  let aprovados = 0;
  let total = 0;

  // TESTE 1: Pedido de link/sistema estruturado da base de conhecimento
  total++;
  console.log('--- TESTE 1: Pedido de link de sistema do conhecimento ---');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'Me passe o app de portfólio das maquinas',
    contato: contatoTeste,
    historicoRecente: [],
    documentosDisponiveis: todosDocs,
  });

  const temLink = res1.textoResposta.includes('http');
  const temDadosEstruturadosLink = Boolean(res1.dadosEstruturados && res1.dadosEstruturados.tipo === 'link');
  console.log(`Resposta: "${res1.textoResposta.slice(0, 100)}..."`);
  console.log(`Possui URL: ${temLink}`);
  console.log(`Possui dadosEstruturados: ${temDadosEstruturadosLink} (Tipo: ${res1.dadosEstruturados?.tipo})`);

  if (temLink && temDadosEstruturadosLink) {
    console.log('✅ TESTE 1 APROVADO: Link retornado com dados estruturados para renderização rica!');
    aprovados++;
  } else {
    console.error('❌ TESTE 1 FALHOU: Link não retornado ou sem dados estruturados.');
  }

  // TESTE 2: Pedido de PIX estruturado
  total++;
  console.log('\n--- TESTE 2: Pedido de chave PIX do conhecimento ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'Qual é o pix da delta plan?',
    contato: contatoTeste,
    historicoRecente: [],
    documentosDisponiveis: todosDocs,
  });

  const temPix = res2.textoResposta.toLowerCase().includes('pix') || res2.textoResposta.includes('@');
  const temDadosEstruturadosPix = Boolean(res2.dadosEstruturados && res2.dadosEstruturados.tipo === 'pix');
  console.log(`Resposta: "${res2.textoResposta.slice(0, 100)}..."`);
  console.log(`Possui dadosEstruturados: ${temDadosEstruturadosPix} (Tipo: ${res2.dadosEstruturados?.tipo})`);

  if (temPix && temDadosEstruturadosPix) {
    console.log('✅ TESTE 2 APROVADO: PIX retornado com dados estruturados para botão Copiar!');
    aprovados++;
  } else {
    console.error('❌ TESTE 2 FALHOU: PIX não retornado ou sem dados estruturados.');
  }

  // TESTE 3: Extração de documento recebido via WhatsApp (PDF)
  total++;
  console.log('\n--- TESTE 3: Detecção e extração de PDF recebido via WhatsApp ---');
  const eventoPdfSimulado = {
    messageType: 'documentMessage',
    message: {
      documentMessage: {
        fileName: 'CONTRATO_OBRA_TESTE.pdf',
        mimetype: 'application/pdf',
        fileLength: 1048576,
      },
    },
  };
  const infoPdf = extrairInfoDocumentoWhatsApp(eventoPdfSimulado);
  console.log(`Arquivo: ${infoPdf.nomeArquivo}, isDocumento: ${infoPdf.isDocumento}, isNaoSuportado: ${infoPdf.isNaoSuportado}`);

  if (infoPdf.isDocumento && !infoPdf.isNaoSuportado && infoPdf.nomeArquivo === 'CONTRATO_OBRA_TESTE.pdf') {
    console.log('✅ TESTE 3 APROVADO: PDF detectado e extraído com sucesso!');
    aprovados++;
  } else {
    console.error('❌ TESTE 3 FALHOU: Falha ao extrair PDF.');
  }

  // TESTE 4: Extração de imagem recebida via WhatsApp (JPEG)
  total++;
  console.log('\n--- TESTE 4: Detecção e extração de Imagem recebida via WhatsApp ---');
  const eventoImgSimulado = {
    messageType: 'imageMessage',
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'Foto da certidão',
        fileLength: 524288,
      },
    },
  };
  const infoImg = extrairInfoDocumentoWhatsApp(eventoImgSimulado);
  console.log(`Arquivo: ${infoImg.nomeArquivo}, isImagem: ${infoImg.isImagem}, legenda: "${infoImg.legenda}"`);

  if (infoImg.isImagem && !infoImg.isNaoSuportado && infoImg.legenda === 'Foto da certidão') {
    console.log('✅ TESTE 4 APROVADO: Imagem detectada e extraída com sucesso!');
    aprovados++;
  } else {
    console.error('❌ TESTE 4 FALHOU: Falha ao extrair imagem.');
  }

  console.log('\n================================================================');
  console.log(` RESULTADO FINAL: ${aprovados}/${total} TESTES APROVADOS `);
  console.log('================================================================');

  if (aprovados !== total) {
    process.exit(1);
  }
}

testarIntegridade().catch((err) => {
  console.error('Erro na suíte de testes:', err);
  process.exit(1);
});
