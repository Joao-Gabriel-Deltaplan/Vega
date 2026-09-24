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

  const contatoTeste: Contato = {
    id: 'user-teste-1',
    nome: 'Usuario Teste',
    telefone: '5500000000005',
    avatarCor: '#10b981',
    nivelAcesso: 'diretoria',
    ficha: {
      nome: 'Usuario Teste',
      nivelAcesso: 'diretoria',
    } as any,
  };

  const titularA = 'Titular Alfa';
  const titularB = 'Titular Beta';

  const docsDisponiveis: DocumentoRegistro[] = [
    {
      id: 'doc-casamento-1',
      titulo: `Certidão de Casamento - ${titularA}`,
      arquivo: 'certidao_casamento_alfa.pdf',
      tipo: 'Certidão de Casamento',
      titular: titularA,
      apelidos: ['certidão', 'casamento', 'certidão de casamento'],
      tamanho: '1024 KB',
      visibilidade: 'diretoria',
    },
    {
      id: 'doc-cnh-1',
      titulo: `CNH - ${titularA}`,
      arquivo: 'cnh_alfa.pdf',
      tipo: 'CNH',
      titular: titularA,
      apelidos: ['cnh', 'habilitação', 'carteira de motorista'],
      tamanho: '2048 KB',
      visibilidade: 'diretoria',
    },
    {
      id: 'doc-crea-1',
      titulo: `CREA - ${titularA}`,
      arquivo: 'crea_alfa.pdf',
      tipo: 'CREA',
      titular: titularA,
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
    contato: contatoTeste,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res1.textoResposta);
  console.log('Anexos:', res1.anexos?.map((a) => a.nome));
  console.log('Intenção:', res1.intencaoDetectada);
  const t1Ok = res1.textoResposta.toLowerCase().includes('bom dia') && (res1.anexos?.length || 0) > 0;
  console.log('OK?', t1Ok ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 2: "me manda a CNH"
  console.log('--- TESTE 2: "me manda a CNH" ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'me manda a CNH',
    historicoRecente: historicoVazio,
    contato: contatoTeste,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res2.textoResposta);
  console.log('Anexos:', res2.anexos?.map((a) => a.nome));
  console.log('Intenção:', res2.intencaoDetectada);
  const t2Ok = (res2.anexos?.length || 0) > 0;
  console.log('OK?', t2Ok ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 3: "oi, preciso do CREA"
  console.log('--- TESTE 3: "oi, preciso do CREA" ---');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'oi, preciso do CREA',
    historicoRecente: historicoVazio,
    contato: contatoTeste,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res3.textoResposta);
  console.log('Anexos:', res3.anexos?.map((a) => a.nome));
  console.log('Intenção:', res3.intencaoDetectada);
  const t3Ok = res3.textoResposta.toLowerCase().includes('olá') || res3.textoResposta.toLowerCase().includes('oi');
  console.log('OK?', t3Ok ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 4: Ambiguidade com múltiplos titulares
  console.log('--- TESTE 4: Pedido sem titular quando existem vários titulares ("me envia a certidão de casamento") ---');
  const docsComDoisTitulares: DocumentoRegistro[] = [
    ...docsDisponiveis,
    {
      id: 'doc-casamento-2',
      titulo: `Certidão de Casamento - ${titularB}`,
      arquivo: 'certidao_casamento_beta.pdf',
      tipo: 'Certidão de Casamento',
      titular: titularB,
      apelidos: ['certidão', 'casamento', 'certidão de casamento'],
      tamanho: '1024 KB',
      visibilidade: 'diretoria',
    },
  ];

  const res4 = await processarMensagemChat({
    mensagemUsuario: 'me envia a certidão de casamento',
    historicoRecente: historicoVazio,
    contato: contatoTeste,
    documentosDisponiveis: docsComDoisTitulares,
  });
  console.log('Resposta VEGA:', res4.textoResposta);
  console.log('Opções retornadas:', res4.opcoes);
  console.log('DocumentoOferecidoId:', res4.documentoOferecidoId);
  const t4Ok = res4.textoResposta.includes(titularA) && res4.textoResposta.includes(titularB);
  console.log('OK?', t4Ok ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 4B: Usuário responde escolhendo um titular
  console.log(`--- TESTE 4B: Resolução da escolha pelo usuário ("do ${titularA}") ---`);
  const historicoComPergunta: Mensagem[] = [
    {
      id: 'm1',
      remetente: 'cliente',
      nomeRemetente: 'Usuario Teste',
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
    mensagemUsuario: `do ${titularA}`,
    historicoRecente: historicoComPergunta,
    contato: contatoTeste,
    documentosDisponiveis: docsComDoisTitulares,
  });
  console.log('Resposta VEGA (escolha):', res4b.textoResposta);
  console.log('Anexos:', res4b.anexos?.map((a) => a.nome));
  const t4bOk = (res4b.anexos?.length || 0) === 1;
  console.log('OK?', t4bOk ? 'SIM' : 'NÃO');
  console.log('\n');

  // TESTE 5: Documento inexistente ("me manda o passaporte")
  console.log('--- TESTE 5: Documento inexistente ("me manda o passaporte") ---');
  const res5 = await processarMensagemChat({
    mensagemUsuario: 'me manda o passaporte',
    historicoRecente: historicoVazio,
    contato: contatoTeste,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', res5.textoResposta);
  const t5Ok = res5.textoResposta.toLowerCase().includes('não encontrei') || res5.textoResposta.toLowerCase().includes('não consegui');
  console.log('OK?', t5Ok ? 'SIM' : 'NÃO');
  console.log('\n');
}

rodarTestes().catch(console.error);
