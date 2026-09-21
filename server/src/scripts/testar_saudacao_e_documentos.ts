import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, DocumentoRegistro, Mensagem } from '../types.js';

async function rodarTestes() {
  console.log('====================================================');
  console.log('INICIANDO TESTES DE SAUDAÇÃO E PEDIDOS DE DOCUMENTO');
  console.log('====================================================\n');

  const contatoJoao: Contato = {
    id: 'user-joao',
    nome: 'João Gabriel',
    telefone: '5511999999999',
    avatarCor: '#10b981',
    nivelAcesso: 'diretoria',
    ficha: {
      nome: 'João Gabriel',
      nivelAcesso: 'diretoria',
    } as any,
  };

  const docsDisponiveis: DocumentoRegistro[] = [
    {
      id: 'doc-casamento-1',
      titulo: 'Certidão de Casamento - Thomaz',
      arquivo: 'certidao_casamento_thomaz.pdf',
      tipo: 'Certidão de Casamento',
      titular: 'Thomaz',
      apelidos: ['certidão', 'casamento', 'certidão de casamento'],
      tamanho: '1024 KB',
      visibilidade: 'diretoria',
    },
    {
      id: 'doc-cnh-1',
      titulo: 'CNH - Thomaz',
      arquivo: 'cnh_thomaz.pdf',
      tipo: 'CNH',
      titular: 'Thomaz',
      apelidos: ['cnh', 'habilitação', 'carteira de motorista'],
      tamanho: '2048 KB',
      visibilidade: 'diretoria',
    },
    {
      id: 'doc-crea-1',
      titulo: 'CREA - Thomaz',
      arquivo: 'crea_thomaz.pdf',
      tipo: 'CREA',
      titular: 'Thomaz',
      apelidos: ['crea', 'registro profissional', 'carteira do conselho'],
      tamanho: '3072 KB',
      visibilidade: 'diretoria',
    },
  ];

  const historicoVazio: Mensagem[] = [];

  // TESTE 1: "bom dia, me envia certidão de casamento"
  console.log('--- TESTE 1: "bom dia, me envia certidão de casamento" ---');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'bom dia, me envia certidão de casamento',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res1.textoResposta);
  console.log('Anexos:', res1.anexos?.map((a) => a.nome));
  console.log('Intenção:', res1.intencaoDetectada);
  console.log('OK?', res1.textoResposta.startsWith('Bom dia, João!') && (res1.anexos?.length || 0) > 0 ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 2: "me manda a CNH"
  console.log('--- TESTE 2: "me manda a CNH" ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'me manda a CNH',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res2.textoResposta);
  console.log('Anexos:', res2.anexos?.map((a) => a.nome));
  console.log('Intenção:', res2.intencaoDetectada);
  console.log('OK?', res2.textoResposta.startsWith('Aqui está') && (res2.anexos?.length || 0) > 0 ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 3: "oi, preciso do CREA"
  console.log('--- TESTE 3: "oi, preciso do CREA" ---');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'oi, preciso do CREA',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res3.textoResposta);
  console.log('Anexos:', res3.anexos?.map((a) => a.nome));
  console.log('Intenção:', res3.intencaoDetectada);
  console.log('OK?', res3.textoResposta.startsWith('Olá, João!') && (res3.anexos?.length || 0) > 0 ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 4: Ambiguidade com múltiplos titulares
  console.log('--- TESTE 4: Pedido sem titular quando existem vários titulares ("me envia a certidão de casamento") ---');
  const docsComDoisTitulares: DocumentoRegistro[] = [
    ...docsDisponiveis,
    {
      id: 'doc-casamento-2',
      titulo: 'Certidão de Casamento - André',
      arquivo: 'certidao_casamento_andre.pdf',
      tipo: 'Certidão de Casamento',
      titular: 'André',
      apelidos: ['certidão', 'casamento', 'certidão de casamento'],
      tamanho: '1024 KB',
      visibilidade: 'diretoria',
    },
  ];

  const res4 = await processarMensagemChat({
    mensagemUsuario: 'me envia a certidão de casamento',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsComDoisTitulares,
  });
  console.log('Resposta VEGA:', res4.textoResposta);
  console.log('Opções retornadas:', res4.opcoes);
  console.log('DocumentoOferecidoId:', res4.documentoOferecidoId);
  console.log('OK?', res4.textoResposta.includes('Thomaz') && res4.textoResposta.includes('André') ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 4B: Usuário responde com "1" ou "do Thomaz"
  console.log('--- TESTE 4B: Resolução da escolha pelo usuário ("do thomaz") ---');
  const historicoComPergunta: Mensagem[] = [
    {
      id: 'm1',
      remetente: 'cliente',
      nomeRemetente: 'João',
      horario: '09:00',
      texto: 'me envia a certidão de casamento',
    },
    {
      id: 'm2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '09:00',
      texto: res4.textoResposta,
      documentoOferecidoId: res4.documentoOferecidoId,
    },
  ];

  const res4b = await processarMensagemChat({
    mensagemUsuario: 'do thomaz',
    historicoRecente: historicoComPergunta,
    contato: contatoJoao,
    documentosDisponiveis: docsComDoisTitulares,
  });
  console.log('Resposta VEGA (escolha):', res4b.textoResposta);
  console.log('Anexos:', res4b.anexos?.map((a) => a.nome));
  console.log('OK?', res4b.textoResposta.includes('Thomaz') && (res4b.anexos?.length || 0) === 1 ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 5: Documento inexistente ("me manda o passaporte")
  console.log('--- TESTE 5: Documento inexistente ("me manda o passaporte") ---');
  const res5 = await processarMensagemChat({
    mensagemUsuario: 'me manda o passaporte',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res5.textoResposta);
  console.log('OK?', res5.textoResposta.toLowerCase().includes('não consegui') ? 'SIM' : 'NÃO');
  console.log('\n');
}

rodarTestes().catch(console.error);
