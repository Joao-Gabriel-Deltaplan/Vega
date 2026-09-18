import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares, salvarOuAtualizarTitular } from '../storage.js';
import { Contato, Mensagem } from '../types.js';
import { salvarCamposSugeridosNoTitular } from '../indexador/indexadorService.js';

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES DE VALIDAÇÃO: CORREÇÃO DE FICHA CADASTRAL PELO CHAT');
  console.log('===============================================================\n');

  // Garante que o titular Thomaz está com a profissão original para o teste
  const titularesIniciais = await obterTodosTitulares();
  const thomaz = titularesIniciais.find(t => t.id === 'tit_thomaz');
  if (thomaz) {
    thomaz.campos.profissao = {
      valor: 'Engenheiro Civil',
      origem: 'doc_ctps',
      origemNome: 'CTPS',
      origemVisibilidade: 'diretoria',
      conferido: true,
      dataConferencia: '17/09/2026'
    };
    await salvarOuAtualizarTitular(thomaz);
  }

  const contatoTeste: Contato = {
    id: 'user-teste-diretoria',
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
  const historico: Mensagem[] = [];

  // -------------------------------------------------------------------------
  // PASSO 1: "qual a profissão do Thomaz?"
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 1: "qual a profissão do Thomaz?"');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual a profissão do Thomaz?',
    historicoRecente: [...historico],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Resposta VEGA:', res1.textoResposta);
  console.log('Intenção:', res1.intencaoDetectada);
  console.log('Contém "(não conferido)"?:', res1.textoResposta.includes('não conferido'));

  historico.push(
    {
      id: 'msg-user-1',
      remetente: 'cliente',
      nomeRemetente: 'João Gabriel Brandini',
      horario: '10:00',
      texto: 'qual a profissão do Thomaz?',
    },
    {
      id: 'msg-vega-1',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:00',
      texto: res1.textoResposta,
      documentoOferecidoId: res1.documentoOferecidoId,
    }
  );
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // PASSO 2: "está errado, é Técnico em Eletrotécnica"
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 2: "está errado, é Técnico em Eletrotécnica"');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'está errado, é Técnico em Eletrotécnica',
    historicoRecente: [...historico],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Resposta VEGA:', res2.textoResposta);
  console.log('Intenção:', res2.intencaoDetectada);
  console.log('Correção Pendente?:', JSON.stringify(res2.correcaoPendente, null, 2));

  historico.push(
    {
      id: 'msg-user-2',
      remetente: 'cliente',
      nomeRemetente: 'João Gabriel Brandini',
      horario: '10:01',
      texto: 'está errado, é Técnico em Eletrotécnica',
    },
    {
      id: 'msg-vega-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:01',
      texto: res2.textoResposta,
      correcaoPendente: res2.correcaoPendente,
    }
  );
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // PASSO 3: "sim" (Confirmação)
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 3: "sim"');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'sim',
    historicoRecente: [...historico],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Resposta VEGA:', res3.textoResposta);
  console.log('Intenção:', res3.intencaoDetectada);
  console.log('Rastro Detalhes Correção:', JSON.stringify(res3.rastro?.detalhesCorrecao, null, 2));

  historico.push(
    {
      id: 'msg-user-3',
      remetente: 'cliente',
      nomeRemetente: 'João Gabriel Brandini',
      horario: '10:02',
      texto: 'sim',
    },
    {
      id: 'msg-vega-3',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:02',
      texto: res3.textoResposta,
    }
  );

  // Verificar se persistiu em titulares.json
  const titularesApos = await obterTodosTitulares();
  const thomazApos = titularesApos.find(t => t.id === 'tit_thomaz');
  console.log('Campo profissao no arquivo titulares.json:', JSON.stringify(thomazApos?.campos.profissao, null, 2));
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // PASSO 4: "qual a profissão do Thomaz?" (novamente)
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 4: "qual a profissão do Thomaz?"');
  const res4 = await processarMensagemChat({
    mensagemUsuario: 'qual a profissão do Thomaz?',
    historicoRecente: [...historico],
    contato: contatoTeste,
    documentosDisponiveis,
  });

  console.log('Resposta VEGA:', res4.textoResposta);
  console.log('Intenção:', res4.intencaoDetectada);
  console.log('Contém "Técnico em Eletrotécnica"?:', res4.textoResposta.includes('Técnico em Eletrotécnica'));
  console.log('Contém "(não conferido)"?:', res4.textoResposta.includes('não conferido'));
  console.log('---------------------------------------------------------------\n');

  // -------------------------------------------------------------------------
  // PASSO 5: Validação da Proteção contra Sobrescrita por Indexação
  // -------------------------------------------------------------------------
  console.log('>>> PASSO 5: Teste de Proteção contra Sobrescrita Automática de Documentos');
  // Simula tentativa de indexação de documento com profissão diferente
  const camposExtraidosTentativa = {
    profissao: 'Engenheiro Mecatrônico'
  };

  await salvarCamposSugeridosNoTitular(
    'Thomaz',
    camposExtraidosTentativa,
    'doc-teste-sobrescrita',
    'Novo Diploma Thomaz'
  );
  
  const titularesFinal = await obterTodosTitulares();
  const thomazFinal = titularesFinal.find(t => t.id === 'tit_thomaz');
  console.log('Valor final da profissão (deve continuar Técnico em Eletrotécnica):', thomazFinal?.campos.profissao?.valor);
  console.log('Flag manual:', thomazFinal?.campos.profissao?.manual);
  console.log('Origem:', thomazFinal?.campos.profissao?.origem);
  console.log('Histórico registrado:', JSON.stringify(thomazFinal?.campos.profissao?.historicoCorrecao, null, 2));

  console.log('\n===============================================================');
  console.log('TESTES FINALIZADOS!');
  console.log('===============================================================');
}

rodarTestes().catch(err => {
  console.error('Erro ao executar testes:', err);
  process.exit(1);
});
