import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat, deveMostrarDocumentosCompletos } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES DE VALIDAÇÃO: DOCUMENTOS COMPLETOS NA RESPOSTA E MASCARADOS NO RASTRO');
  console.log('CONFIGURAÇÃO MOSTRAR_DOCUMENTOS_COMPLETOS:', deveMostrarDocumentosCompletos());
  console.log('===============================================================\n');

  const contatoTeste: Contato = {
    id: 'user-teste',
    nome: 'João Gabriel Brandini',
    telefone: '11999999999',
    avatarCor: '#10b981',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  const documentosDisponiveis = await obterTodosDocumentos();

  // -------------------------------------------------------------------------
  // TESTE 1: "quem é a mãe do Thomaz" seguido de "sim"
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 1A: Pergunta "quem é a mãe do Thomaz"');
  const res1A = await processarMensagemChat({
    mensagemUsuario: 'quem é a mãe do Thomaz',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:', res1A.textoResposta);
  console.log('Intenção:', res1A.intencaoDetectada);
  console.log('Anexos enviados?:', res1A.anexos ? res1A.anexos.length : 0);
  console.log('Documento Oferecido ID:', res1A.documentoOferecidoId);
  console.log('---------------------------------------------------------------\n');

  console.log('>>> TESTE 1B: Resposta afirmativa de confirmação "sim"');
  const msgAssistente1A: Mensagem = {
    id: 'msg-assistente-1a',
    remetente: 'assistente',
    nomeRemetente: 'VEGA',
    horario: '10:00',
    texto: res1A.textoResposta,
    documentoOferecidoId: res1A.documentoOferecidoId,
  };

  const res1B = await processarMensagemChat({
    mensagemUsuario: 'sim',
    historicoRecente: [
      { id: 'msg-user-1a', remetente: 'cliente', nomeRemetente: 'João', horario: '09:59', texto: 'quem é a mãe do Thomaz' },
      msgAssistente1A,
    ],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:', res1B.textoResposta);
  console.log('Anexos enviados?:', res1B.anexos ? res1B.anexos.map((a) => a.nome) : 'Nenhum');
  console.log('Rastro - Enviou Anexo:', res1B.rastro?.enviouAnexo);
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 2: "quem é a mãe do Thomaz" seguido de "qual a validade da CNH dele?" (NÃO deve enviar anexo)
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 2: Oferta esquecida -> Pergunta "qual a validade da CNH dele?"');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual a validade da CNH dele?',
    historicoRecente: [
      { id: 'msg-user-1a', remetente: 'cliente', nomeRemetente: 'João', horario: '09:59', texto: 'quem é a mãe do Thomaz' },
      msgAssistente1A,
    ],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:', res2.textoResposta);
  console.log('Anexos enviados?:', res2.anexos ? res2.anexos.map((a) => a.nome) : 'Nenhum (Correto!)');
  console.log('Documento Oferecido ID:', res2.documentoOferecidoId);
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 3: Pergunta com vários campos
  // "me envie esses documentos do thomaz, Endereço, estado civil, RG, profissão."
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 3: "me envie esses documentos do thomaz, Endereço, estado civil, RG, profissão."');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'me envie esses documentos do thomaz, Endereço, estado civil, RG, profissão.',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta ao Usuário:\n' + res3.textoResposta);
  console.log('\n--- VERIFICAÇÃO DO RASTRO (Ver raciocínio) ---');
  console.log('Rastro - Documento Usado (Origens):', res3.rastro?.documentoUsado);
  console.log('Documentos Oferecidos para Envio ID:', res3.documentoOferecidoId);
  console.log('Rastro - Resposta Final Gravada:', res3.rastro?.respostaFinal);
  const etapaFichaRes3 = res3.rastro?.etapas.find((e) => e.ordem === 2);
  console.log('Rastro - Campos Consultados Gravados:', JSON.stringify(etapaFichaRes3?.detalhes?.camposConsultados, null, 2));
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 4: "qual o CPF do Thomaz?"
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 4: Pergunta "qual o CPF do Thomaz?"');
  const res4 = await processarMensagemChat({
    mensagemUsuario: 'qual o CPF do Thomaz?',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta ao Usuário:', res4.textoResposta);
  console.log('--- VERIFICAÇÃO DO RASTRO (Ver raciocínio) ---');
  console.log('Rastro - Resposta Final Gravada:', res4.rastro?.respostaFinal);
  const etapaFichaRes4 = res4.rastro?.etapas.find((e) => e.ordem === 2);
  console.log('Rastro - Campos Consultados Gravados:', JSON.stringify(etapaFichaRes4?.detalhes?.camposConsultados, null, 2));
  console.log('Documento Oferecido ID:', res4.documentoOferecidoId);
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 5: Pedido explícito de documento ("qual é a CNH do Thomaz")
  // -------------------------------------------------------------------------
  console.log('>>> TESTE 5: Pedido explícito "qual é a CNH do Thomaz"');
  const res5 = await processarMensagemChat({
    mensagemUsuario: 'qual é a CNH do Thomaz',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:', res5.textoResposta);
  console.log('Intenção:', res5.intencaoDetectada);
  console.log('Anexos enviados?:', res5.anexos ? res5.anexos.map((a) => a.nome) : 'Nenhum');
  console.log('Rastro - Enviou Anexo:', res5.rastro?.enviouAnexo);
  console.log('===============================================================');
}

rodarTestes().catch(console.error);
