import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log(' TESTE: PESSOAS NÃO CADASTRADAS VS PREVALÊNCIA DE CONTEXTO (VEGA)');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();

  const titularPrincipal = todosTitulares.find((t: any) => t.tipo !== 'PJ') || todosTitulares[0];

  const contatoTeste: Contato = {
    id: 'user_teste',
    nome: 'João Gabriel',
    telefone: '5514996863115',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    avatarCor: '#2563eb',
  };

  // Histórico prévio com titular cadastrado para verificar se a VEGA substitui ou não
  const historicoComTitularCadastrado: Mensagem[] = [
    {
      id: 'msg-1',
      remetente: 'cliente',
      nomeRemetente: 'João Gabriel',
      horario: '10:00',
      texto: `você tem a certidão de casamento do ${titularPrincipal.nome}?`,
    },
    {
      id: 'msg-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:01',
      texto: `Aqui está a Certidão de Casamento do ${titularPrincipal.nome}, João.`,
      anexos: [
        {
          tipo: 'pdf',
          url: 'certidao.pdf',
          nome: 'certidao.pdf',
          titulo: 'Certidão de Casamento',
        },
      ],
      rastro: {
        mensagemId: 'msg-2',
        usuarioNome: 'João Gabriel',
        usuarioId: 'user_teste',
        mensagemOriginal: 'certidão de casamento',
        perguntaReescrita: 'certidão de casamento',
        intencaoDetectada: 'pedir_arquivo',
        tipoBusca: 'nome_cofre',
        documentosEncontrados: [],
        documentoUsado: 'Certidão de Casamento',
        enviouAnexo: true,
        respostaFinal: 'Aqui está a Certidão de Casamento.',
        modeloUsado: 'Motor Interno',
        tokensTotal: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        custoEstimadoUsd: 0,
        tempoTotalMs: 10,
        etapas: [],
      },
    },
  ];

  let totalAprovados = 0;
  const totalCasos = 3;

  // --------------------------------------------------------------------------
  // CASO 1: Pessoa não cadastrada presente em documento ("Qual o nome da mãe da Nilceia?")
  // Deve responder o dado da Nilceia (Celucia Fanha Ramos) citando a Certidão de Casamento.
  // NUNCA deve responder a mãe do titular do contexto (Lidia Lustri Fabre).
  // --------------------------------------------------------------------------
  console.log('[TESTE 1] Pergunta: "Qual o nome da mãe da Nilceia?" (com contexto de Thomaz ativo)');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'Qual o nome da mãe da Nilceia?',
    historicoRecente: historicoComTitularCadastrado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  const texto1 = res1.textoResposta.toLowerCase();
  const achouMaeCorreta = texto1.includes('celucia') || texto1.includes('fanha');
  const citouCasamento = texto1.includes('casamento');
  const citouMaeErradaDoContexto = texto1.includes('lidia');
  const explicitouPessoa = texto1.includes('nilceia');
  const passou1 = achouMaeCorreta && citouCasamento && explicitouPessoa && !citouMaeErradaDoContexto;

  console.log('Resposta 1:\n', res1.textoResposta);
  console.log('Achou mãe correta (Celucia):', achouMaeCorreta);
  console.log('Citou documento de origem (Casamento):', citouCasamento);
  console.log('Explicitou que o dado é da Nilceia:', explicitouPessoa);
  console.log('Confundiu com mãe do titular do contexto (Lidia):', citouMaeErradaDoContexto);
  console.log(`Resultado Caso 1: ${passou1 ? '✅ APROVADO' : '❌ REPROVADO'}\n`);
  if (passou1) totalAprovados++;

  // --------------------------------------------------------------------------
  // CASO 2: Pessoa inexistente no Cofre ("Qual o nome da mãe do Rodolfo Inexistente?")
  // Deve responder que não encontrou informações sobre a pessoa no Cofre.
  // NUNCA deve responder dados do titular do contexto nem alucinar.
  // --------------------------------------------------------------------------
  console.log('[TESTE 2] Pergunta: "Qual o nome da mãe do Rodolfo Inexistente?" (com contexto de Thomaz ativo)');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'Qual o nome da mãe do Rodolfo Inexistente?',
    historicoRecente: historicoComTitularCadastrado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  const texto2 = res2.textoResposta.toLowerCase();
  const disseNaoEncontrouPessoa = texto2.includes('não encontrei') && (texto2.includes('rodolfo') || texto2.includes('informações') || texto2.includes('documentos'));
  const respondeuDadoContexto2 = texto2.includes('lidia') || texto2.includes('celucia');
  const passou2 = disseNaoEncontrouPessoa && !respondeuDadoContexto2;

  console.log('Resposta 2:\n', res2.textoResposta);
  console.log('Disse que não encontrou a pessoa no Cofre:', disseNaoEncontrouPessoa);
  console.log('Respondeu dados de outra pessoa do contexto:', respondeuDadoContexto2);
  console.log(`Resultado Caso 2: ${passou2 ? '✅ APROVADO' : '❌ REPROVADO'}\n`);
  if (passou2) totalAprovados++;

  // --------------------------------------------------------------------------
  // CASO 3: Data de nascimento de pessoa não cadastrada ("Qual a data de nascimento da Nilceia?")
  // Deve responder com a data de nascimento que consta no documento (02 de junho de 1985).
  // --------------------------------------------------------------------------
  console.log('[TESTE 3] Pergunta: "Qual a data de nascimento da Nilceia?"');
  const res3 = await processarMensagemChat({
    mensagemUsuario: 'Qual a data de nascimento da Nilceia?',
    historicoRecente: historicoComTitularCadastrado,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  const texto3 = res3.textoResposta.toLowerCase();
  const achouDataNilceia = texto3.includes('02 de junho de 1985') || texto3.includes('02/06/1985') || texto3.includes('2 de junho de 1985');
  const confundiuComNascThomaz = texto3.includes('06/10/1984') || texto3.includes('6 de outubro de 1984');
  const passou3 = achouDataNilceia && !confundiuComNascThomaz;

  console.log('Resposta 3:\n', res3.textoResposta);
  console.log('Achou data de nascimento correta (02/06/1985):', achouDataNilceia);
  console.log('Confundiu com nascimento do Thomaz (06/10/1984):', confundiuComNascThomaz);
  console.log(`Resultado Caso 3: ${passou3 ? '✅ APROVADO' : '❌ REPROVADO'}\n`);
  if (passou3) totalAprovados++;

  console.log('================================================================');
  console.log(`RELATÓRIO: ${totalAprovados} de ${totalCasos} aprovados (${Math.round((totalAprovados / totalCasos) * 100)}%)`);
  console.log('================================================================');

  if (totalAprovados !== totalCasos) {
    process.exit(1);
  }
}

rodarTestes().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
