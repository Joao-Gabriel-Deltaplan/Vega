import dotenv from 'dotenv';
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosConhecimentos, removerConhecimento } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

const contatoAdmin: Contato = {
  id: 'admin-teste-conhecimento',
  nome: 'Thomaz Brandini',
  telefone: '5514999990001',
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
  permiteCadastroConhecimento: true,
  permiteExclusao: true,
};

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: BASE DE CONHECIMENTO, ÁUDIO, NOMES E CONFIRMAÇÃO');
  console.log('================================================================\n');

  let testesPassaram = 0;
  const totalTestes = 5;
  const idsParaLimpar: string[] = [];

  try {
    // --------------------------------------------------------------------------
    // TESTE 1: ÁUDIO "adicione o contato do João do Pix pra mim" (sem número)
    // -> deve pedir o telefone, sem gravar nada no banco e sem "não encontrei".
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 1: Áudio "adicione o contato do João do Pix pra mim" (sem número)');
    const msg1 = 'Eu quero que você adicione o contato do João do Pix pra mim.';
    console.log(`   Usuário (ÁUDIO): "${msg1}"`);

    const res1 = await processarMensagemChat({
      mensagemUsuario: msg1,
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   VEGA: "${res1.textoResposta}"`);

    const resp1Lower = res1.textoResposta.toLowerCase();
    const pediuTelefone =
      resp1Lower.includes('telefone') ||
      resp1Lower.includes('número') ||
      resp1Lower.includes('numero') ||
      resp1Lower.includes('pode mandar');

    const naoDisseNaoEncontrei =
      !resp1Lower.includes('não encontrei') &&
      !resp1Lower.includes('nao encontrei');

    const naoAfirmouGravacao =
      !resp1Lower.includes('salvo com sucesso') &&
      !resp1Lower.includes('item salvo');

    // Verifica no banco: nada deve ter sido criado!
    const conhecimentosAposPasso1 = await obterTodosConhecimentos();
    const itemCriadoIndevido1 = conhecimentosAposPasso1.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );

    if (!pediuTelefone) {
      throw new Error(`Falha no Teste 1: VEGA não pediu o telefone ao usuário. Resposta: "${res1.textoResposta}"`);
    }
    if (!naoDisseNaoEncontrei) {
      throw new Error(`Falha no Teste 1: VEGA disparou guardrail de "não encontrei" indevidamente ao cadastrar contato. Resposta: "${res1.textoResposta}"`);
    }
    if (!naoAfirmouGravacao) {
      throw new Error(`Falha no Teste 1: VEGA afirmou que gravou antes de ter o telefone! Resposta: "${res1.textoResposta}"`);
    }
    if (itemCriadoIndevido1) {
      idsParaLimpar.push(itemCriadoIndevido1.id);
      throw new Error(`Falha no Teste 1: Item foi gravado no banco prematuramente sem telefone e sem confirmação! ID: ${itemCriadoIndevido1.id}`);
    }

    console.log('   ✅ Teste 1 OK: VEGA pediu o telefone cordialmente, sem "não encontrei", e nenhum item foi criado no banco.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 2: Envio do número -> Pede confirmação -> "sim" -> Grava no banco
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 2: Envio do número -> Confirmação -> "sim" -> Gravação garantida');

    const historicoFluxo: Mensagem[] = [
      {
        id: 'msg-u1',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:00',
        texto: msg1,
        tipoMensagem: 'audio',
      },
      {
        id: 'msg-a1',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:00',
        texto: res1.textoResposta,
      },
    ];

    // Passo 2.1: Envio do número
    const msg2Num = '(14) 99888-7766';
    console.log(`   [Passo 2.1] Usuário: "${msg2Num}"`);

    const res2Num = await processarMensagemChat({
      mensagemUsuario: msg2Num,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 2.1] VEGA: "${res2Num.textoResposta}"`);

    const pediuConfirmacao =
      res2Num.textoResposta.toLowerCase().includes('vou salvar') &&
      (res2Num.textoResposta.toLowerCase().includes('joão do pix') || res2Num.textoResposta.toLowerCase().includes('joao do pix')) &&
      res2Num.textoResposta.includes('99888-7766') &&
      res2Num.textoResposta.toLowerCase().includes('confirma?');

    // Checagem rigorosa: NENHUM item pode ser criado no banco antes do "sim"!
    const conhecimentosAntesDoSim = await obterTodosConhecimentos();
    const itemExisteAntesDoSim = conhecimentosAntesDoSim.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );

    if (!pediuConfirmacao) {
      throw new Error(`Falha no Passo 2.1: VEGA não formulou a pergunta de confirmação esperada. Resposta: "${res2Num.textoResposta}"`);
    }
    if (itemExisteAntesDoSim) {
      idsParaLimpar.push(itemExisteAntesDoSim.id);
      throw new Error(`Falha no Passo 2.1: O item foi gravado no banco antes do "sim"! ID: ${itemExisteAntesDoSim.id}`);
    }
    console.log('   ✅ Passo 2.1 OK: Pediu confirmação sem gravar nada no banco antes do "sim".');

    historicoFluxo.push(
      {
        id: 'msg-u2',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:01',
        texto: msg2Num,
      },
      {
        id: 'msg-a2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: res2Num.textoResposta,
      }
    );

    // Passo 2.2: Usuário diz "sim"
    const msg2Sim = 'sim';
    console.log(`   [Passo 2.2] Usuário: "${msg2Sim}"`);

    const res2Sim = await processarMensagemChat({
      mensagemUsuario: msg2Sim,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 2.2] VEGA: "${res2Sim.textoResposta}"`);

    const confirmouSalvamento =
      res2Sim.textoResposta.toLowerCase().includes('salvo com sucesso') ||
      res2Sim.textoResposta.toLowerCase().includes('salvo');

    // Agora sim o item DEVE existir no banco de dados!
    const conhecimentosAposSim = await obterTodosConhecimentos();
    const itemSalvoReal = conhecimentosAposSim.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );

    if (!confirmouSalvamento) {
      throw new Error(`Falha no Passo 2.2: VEGA não confirmou salvamento após "sim". Resposta: "${res2Sim.textoResposta}"`);
    }
    if (!itemSalvoReal) {
      throw new Error('Falha no Passo 2.2: O item NÃO foi gravado no banco após o "sim"!');
    }

    idsParaLimpar.push(itemSalvoReal.id);
    console.log(`   ✅ Passo 2.2 OK: Item gravado com sucesso após o "sim" [ID: ${itemSalvoReal.id}].`);

    historicoFluxo.push(
      {
        id: 'msg-u3',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:02',
        texto: msg2Sim,
      },
      {
        id: 'msg-a3',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:02',
        texto: res2Sim.textoResposta,
      }
    );

    // Passo 2.3: Consulta subsequente para comprovar que o conhecimento é acessível
    const msg2Consulta = 'qual o telefone do João do Pix?';
    console.log(`   [Passo 2.3] Usuário: "${msg2Consulta}"`);

    const res2Consulta = await processarMensagemChat({
      mensagemUsuario: msg2Consulta,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 2.3] VEGA: "${res2Consulta.textoResposta}"`);

    if (!res2Consulta.textoResposta.includes('99888-7766') && !res2Consulta.textoResposta.includes('998887766')) {
      throw new Error(`Falha no Passo 2.3: A consulta não retornou o telefone salvo. Resposta: "${res2Consulta.textoResposta}"`);
    }
    console.log('   ✅ Passo 2.3 OK: A consulta subsequente retornou o telefone perfeitamente.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 3: Checagem de duplicidade ANTES da confirmação (não depois do "sim")
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 3: Checar duplicidade ANTES da confirmação (não depois do "sim")');

    const msg3Anuncio = 'quero adicionar o contato do João do Pix';
    const res3Anuncio = await processarMensagemChat({
      mensagemUsuario: msg3Anuncio,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    const msg3NovoNum = '(14) 91111-2222';
    console.log(`   Usuário envia novo número "${msg3NovoNum}" para contato já existente`);

    const res3Duplicado = await processarMensagemChat({
      mensagemUsuario: msg3NovoNum,
      historicoRecente: [
        {
          id: 'dup-u1',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:10',
          texto: msg3Anuncio,
        },
        {
          id: 'dup-a1',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:10',
          texto: res3Anuncio.textoResposta,
        },
      ],
      contato: contatoAdmin,
    });
    console.log(`   VEGA resposta: "${res3Duplicado.textoResposta}"`);

    const detectouDuplicidadeAntes =
      res3Duplicado.textoResposta.toLowerCase().includes('já existe um item') &&
      res3Duplicado.textoResposta.toLowerCase().includes('atualizar o item existente ou criar um novo');

    if (!detectouDuplicidadeAntes) {
      throw new Error(`Falha no Teste 3: VEGA não detectou duplicidade ANTES da confirmação. Resposta: "${res3Duplicado.textoResposta}"`);
    }
    console.log('   ✅ Teste 3 OK: Duplicidade foi apontada ANTES de propor confirmação e antes do "sim".');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 4: Mudança de assunto no meio ("deixa pra lá, qual o CPF do Thomaz?")
    // -> deve responder o CPF e descartar a ação pendente sem gravar nada no banco.
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 4: Mudança de assunto no meio ("deixa pra lá, qual o CPF do Thomaz?")');

    const historicoMudancaAssunto: Mensagem[] = [
      {
        id: 'mud-u1',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:20',
        texto: 'adiciona o contato do Carlos da Silva pra mim',
      },
      {
        id: 'mud-a1',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:20',
        texto: 'Pode mandar o telefone do Carlos da Silva.',
      },
      {
        id: 'mud-u2',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:21',
        texto: '(14) 97777-6666',
      },
      {
        id: 'mud-a2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:21',
        texto: 'Vou salvar: Contato Carlos da Silva, telefone (14) 97777-6666. Confirma?',
      },
    ];

    const msg4Mudanca = 'deixa pra lá, qual o CPF do Thomaz?';
    console.log(`   Usuário: "${msg4Mudanca}" (mudando de assunto)`);

    const res4Mudanca = await processarMensagemChat({
      mensagemUsuario: msg4Mudanca,
      historicoRecente: historicoMudancaAssunto,
      contato: contatoAdmin,
    });
    console.log(`   VEGA: "${res4Mudanca.textoResposta}"`);

    // Validação: deve responder o CPF do Thomaz e NÃO confirmar o salvamento do Carlos
    const respondeuCpf =
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(res4Mudanca.textoResposta) ||
      res4Mudanca.textoResposta.toLowerCase().includes('cpf do thomaz');

    const naoConfirmouCarlos =
      !res4Mudanca.textoResposta.toLowerCase().includes('carlos da silva salvo') &&
      !res4Mudanca.textoResposta.toLowerCase().includes('carlos da silva foi salvo');

    // Validação no banco: "Carlos da Silva" NUNCA pode ter sido criado!
    const conhecimentosAposMudanca = await obterTodosConhecimentos();
    const itemCarlosCriado = conhecimentosAposMudanca.find((k) =>
      k.titulo.toLowerCase().includes('carlos da silva')
    );

    if (itemCarlosCriado) {
      idsParaLimpar.push(itemCarlosCriado.id);
      throw new Error(`Falha no Teste 4: O contato Carlos da Silva foi criado no banco mesmo com mudança de assunto! ID: ${itemCarlosCriado.id}`);
    }
    if (!respondeuCpf) {
      throw new Error(`Falha no Teste 4: VEGA não respondeu à nova pergunta sobre o CPF do Thomaz. Resposta: "${res4Mudanca.textoResposta}"`);
    }
    if (!naoConfirmouCarlos) {
      throw new Error(`Falha no Teste 4: VEGA confirmou o salvamento cancelado. Resposta: "${res4Mudanca.textoResposta}"`);
    }

    console.log('   ✅ Teste 4 OK: Respondeu o CPF do Thomaz, descartou a ação pendente e nada foi gravado no banco.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 5: Consulta "qual o CPF do Danilo?" por áudio
    // -> continua pedindo para confirmar/digitar o nome (privacidade de nomes em áudio)
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 5: Consulta "qual o CPF do Danilo?" por áudio');

    const msg5Audio = 'qual o CPF do Danilo?';
    console.log(`   Usuário (ÁUDIO): "${msg5Audio}"`);

    const res5Audio = await processarMensagemChat({
      mensagemUsuario: msg5Audio,
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   VEGA: "${res5Audio.textoResposta}"`);

    const resp5Lower = res5Audio.textoResposta.toLowerCase();
    const pediuConfirmarNome =
      resp5Lower.includes('danilo') &&
      (resp5Lower.includes('confirmar o nome') || resp5Lower.includes('digite'));

    const naoVazouCpf = !/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(res5Audio.textoResposta);

    if (!naoVazouCpf) {
      throw new Error(`Falha no Teste 5: VEGA entregou CPF indevido para nome não cadastrado via áudio! Resposta: "${res5Audio.textoResposta}"`);
    }
    if (!pediuConfirmarNome) {
      throw new Error(`Falha no Teste 5: VEGA não pediu para confirmar/digitar o nome na consulta por áudio. Resposta: "${res5Audio.textoResposta}"`);
    }

    console.log('   ✅ Teste 5 OK: A consulta por áudio pediu para confirmar/digitar o nome sem vazar dados.');
    testesPassaram++;

  } catch (err: any) {
    console.error('\n❌ ERRO DURANTE A EXECUÇÃO DOS TESTES:', err.message || err);
  } finally {
    // Limpeza de todos os itens criados durante os testes
    console.log('\n🧹 Limpando itens criados para os testes...');
    for (const id of idsParaLimpar) {
      try {
        await removerConhecimento(id);
        console.log(`   Item ${id} removido da Base de Conhecimento.`);
      } catch (errLimpeza: any) {
        console.warn(`   Falha ao remover item ${id}:`, errLimpeza.message || errLimpeza);
      }
    }
  }

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${testesPassaram}/${totalTestes} testes passaram com sucesso.`);
  console.log('================================================================');

  if (testesPassaram !== totalTestes) {
    process.exit(1);
  }
}

rodarTestes().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
