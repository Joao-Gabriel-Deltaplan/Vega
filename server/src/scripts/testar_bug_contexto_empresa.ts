import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const contatoTeste: Contato = {
  id: 'cont-teste-contexto',
  nome: 'Carlos Eduardo',
  telefone: '11999998888',
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

async function main() {
  console.log('===============================================================');
  console.log('TESTE DE VALIDAÇÃO: BUG DE CONTEXTO (PESSOA VS EMPRESA)');
  console.log('===============================================================\n');

  const documentosDisponiveis = await obterTodosDocumentos();
  const historicoConversa: Mensagem[] = [];

  // -------------------------------------------------------------------------
  // PASSO 1: "qual o CPF do Thomaz?"
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 1: "qual o CPF do Thomaz?"');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o CPF do Thomaz?',
    historicoRecente: [...historicoConversa],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:\n' + res1.textoResposta);
  console.log('Intenção:', res1.intencaoDetectada);
  console.log('Pessoa identificada:', res1.rastro?.pessoa);
  console.log('Origem da pessoa:', res1.rastro?.origemPessoa);
  console.log('Rastro Resposta Final:', res1.rastro?.respostaFinal);
  console.log('---------------------------------------------------------------\n');

  historicoConversa.push(
    { id: 'msg-1', remetente: 'cliente', nomeRemetente: 'Carlos', horario: '10:00', texto: 'qual o CPF do Thomaz?' },
    {
      id: 'msg-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:00',
      texto: res1.textoResposta,
      documentoOferecidoId: res1.documentoOferecidoId,
      rastro: res1.rastro,
    }
  );

  // -------------------------------------------------------------------------
  // PASSO 2: "endereço delta"
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 2: "endereço delta"');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'endereço delta',
    historicoRecente: [...historicoConversa],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:\n' + res2.textoResposta);
  console.log('Intenção:', res2.intencaoDetectada);
  console.log('Pessoa identificada:', res2.rastro?.pessoa || '(nula - correto!)');
  console.log('Origem da pessoa:', res2.rastro?.origemPessoa || '(sem pessoa)');
  console.log('Documento/Instrução Usada:', res2.rastro?.documentoUsado);
  console.log('---------------------------------------------------------------\n');

  historicoConversa.push(
    { id: 'msg-3', remetente: 'cliente', nomeRemetente: 'Carlos', horario: '10:01', texto: 'endereço delta' },
    {
      id: 'msg-4',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:01',
      texto: res2.textoResposta,
      documentoOferecidoId: res2.documentoOferecidoId,
      rastro: res2.rastro,
    }
  );

  // -------------------------------------------------------------------------
  // PASSO 3: "endereço deltaplan"
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 3: "endereço deltaplan"');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'endereço deltaplan',
    historicoRecente: [...historicoConversa],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:\n' + res3.textoResposta);
  console.log('Intenção:', res3.intencaoDetectada);
  console.log('Pessoa identificada:', res3.rastro?.pessoa || '(nula - correto!)');
  console.log('Origem da pessoa:', res3.rastro?.origemPessoa || '(sem pessoa)');
  console.log('Documento/Instrução Usada:', res3.rastro?.documentoUsado);
  console.log('---------------------------------------------------------------\n');

  historicoConversa.push(
    { id: 'msg-5', remetente: 'cliente', nomeRemetente: 'Carlos', horario: '10:02', texto: 'endereço deltaplan' },
    {
      id: 'msg-6',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:02',
      texto: res3.textoResposta,
      documentoOferecidoId: res3.documentoOferecidoId,
      rastro: res3.rastro,
    }
  );

  // -------------------------------------------------------------------------
  // PASSO 4: "e o RG dele?" (deve voltar ao Thomaz)
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 4: "e o RG dele?" (deve voltar ao Thomaz via contexto)');
  const res4 = await processarMensagemChat({
    mensagemUsuario: 'e o RG dele?',
    historicoRecente: [...historicoConversa],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Texto Resposta:\n' + res4.textoResposta);
  console.log('Intenção:', res4.intencaoDetectada);
  console.log('Pessoa identificada:', res4.rastro?.pessoa);
  console.log('Origem da pessoa:', res4.rastro?.origemPessoa);
  console.log('Rastro Resposta Final:', res4.rastro?.respostaFinal);
  const etapaFichaRes4 = res4.rastro?.etapas.find((e) => e.ordem === 2);
  console.log('Rastro - Campos Consultados Gravados:', JSON.stringify(etapaFichaRes4?.detalhes?.camposConsultados, null, 2));
  console.log('Documento Oferecido ID:', res4.documentoOferecidoId);
  console.log('===============================================================');
}

main().catch(console.error);
