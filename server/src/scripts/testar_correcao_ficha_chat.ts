import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares, salvarOuAtualizarTitular } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { Contato, Mensagem } from '../types.js';
import { salvarCamposSugeridosNoTitular } from '../indexador/indexadorService.js';

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES DE VALIDAÇÃO: CORREÇÃO DE FICHA CADASTRAL PELO CHAT');
  console.log('===============================================================\n');

  const titularesIniciais = await obterTodosTitulares();
  const titularAlvo = titularesIniciais.find(t => t.tipo !== 'PJ') || titularesIniciais[0] || {
    id: 'tit_teste',
    nome: 'Titular Teste',
    campos: {} as any,
  };

  const primeiroNome = extrairPrimeiroNome(titularAlvo.nome) || titularAlvo.nome;
  const profissaoOriginal = titularAlvo.campos?.profissao ? { ...titularAlvo.campos.profissao } : null;

  try {
    // Configura profissão inicial para o teste
    if (!titularAlvo.campos) titularAlvo.campos = {} as any;
    titularAlvo.campos.profissao = {
      valor: 'Engenheiro Civil',
      origem: 'doc_teste',
      origemNome: 'Documento Teste',
      origemVisibilidade: 'diretoria',
      conferido: true,
      dataConferencia: '17/09/2026',
    };
    await salvarOuAtualizarTitular(titularAlvo);

    const contatoTeste: Contato = {
      id: 'user-teste-diretoria',
      nome: 'Usuario Teste',
      telefone: '5500000000005',
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
    // PASSO 1: "qual a profissão de [titular]?"
    // -------------------------------------------------------------------------
    const pergunta1 = `qual a profissão de ${primeiroNome}?`;
    console.log(`>>> PASSO 1: "${pergunta1}"`);
    const res1 = await processarMensagemChat({
      mensagemUsuario: pergunta1,
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
        nomeRemetente: 'Usuario Teste',
        horario: '10:00',
        texto: pergunta1,
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
        nomeRemetente: 'Usuario Teste',
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
        nomeRemetente: 'Usuario Teste',
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

    // Verificar se persistiu no Supabase
    const titularesApos = await obterTodosTitulares();
    const titularApos = titularesApos.find(t => t.id === titularAlvo.id);
    console.log('Campo profissao no Supabase:', JSON.stringify(titularApos?.campos.profissao, null, 2));
    console.log('---------------------------------------------------------------\n');

    // -------------------------------------------------------------------------
    // PASSO 4: "qual a profissão de [titular]?" (novamente)
    // -------------------------------------------------------------------------
    console.log(`>>> PASSO 4: "${pergunta1}"`);
    const res4 = await processarMensagemChat({
      mensagemUsuario: pergunta1,
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
    const camposExtraidosTentativa = {
      profissao: 'Engenheiro Mecatrônico'
    };

    await salvarCamposSugeridosNoTitular(
      titularAlvo.nome,
      camposExtraidosTentativa,
      'doc-teste-sobrescrita',
      'Novo Diploma Teste'
    );

    const titularesFinal = await obterTodosTitulares();
    const titularFinal = titularesFinal.find(t => t.id === titularAlvo.id);
    console.log('Valor final da profissão (deve continuar Técnico em Eletrotécnica):', titularFinal?.campos.profissao?.valor);
    console.log('Flag manual:', titularFinal?.campos.profissao?.manual);
    console.log('Origem:', titularFinal?.campos.profissao?.origem);
    console.log('Histórico registrado:', JSON.stringify(titularFinal?.campos.profissao?.historicoCorrecao, null, 2));

    console.log('\n===============================================================');
    console.log('TESTES FINALIZADOS!');
    console.log('===============================================================');
  } finally {
    // Restaura estado original do titular
    console.log('Restaurando estado original do titular...');
    const titularesAtuais = await obterTodosTitulares();
    const titParaRestaurar = titularesAtuais.find(t => t.id === titularAlvo.id);
    if (titParaRestaurar) {
      if (profissaoOriginal) {
        titParaRestaurar.campos.profissao = profissaoOriginal;
      } else {
        delete titParaRestaurar.campos.profissao;
      }
      await salvarOuAtualizarTitular(titParaRestaurar);
      console.log('✅ Estado original restaurado com sucesso.');
    }
  }
}

rodarTestes().catch(err => {
  console.error('Erro ao executar testes:', err);
  process.exit(1);
});
