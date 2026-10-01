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
  const totalTestes = 6;
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
    // TESTE 2: Cenário (a): "adiciona o contato do João do Pix" -> "O telefone dele é 14 99881-0675" -> "sim" -> Confere no banco "Contato João do Pix"
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 2 (Cenário a): Envio do telefone com frase -> "sim" -> Conferir no banco título "Contato João do Pix"');

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

    // Passo 2.1: Envio do telefone em frase falada/digitada (como no caso real)
    const msg2Num = 'O telefone dele é 14 99885-0675';
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
      !res2Num.textoResposta.toLowerCase().includes('novo item') &&
      res2Num.textoResposta.includes('99885-0675') &&
      res2Num.textoResposta.toLowerCase().includes('confirma?');

    // Checagem rigorosa: NENHUM item com esse telefone pode ser criado no banco antes do "sim"!
    const conhecimentosAntesDoSim = await obterTodosConhecimentos();
    const itemExisteAntesDoSim = conhecimentosAntesDoSim.find((k) =>
      (k.dadosEstruturados as any)?.telefone === '14 99885-0675' || k.conteudo.includes('99885-0675')
    );

    if (!pediuConfirmacao) {
      throw new Error(`Falha no Passo 2.1: VEGA não formulou a confirmação esperada ou usou nome genérico. Resposta: "${res2Num.textoResposta}"`);
    }
    if (itemExisteAntesDoSim) {
      idsParaLimpar.push(itemExisteAntesDoSim.id);
      throw new Error(`Falha no Passo 2.1: O item foi gravado no banco antes do "sim"! ID: ${itemExisteAntesDoSim.id}`);
    }
    console.log('   ✅ Passo 2.1 OK: Pediu confirmação com o nome "João do Pix" (sem "Novo Item") antes do "sim".');

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

    // Agora sim o item DEVE existir no banco de dados com título "Contato João do Pix"!
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
    if (itemSalvoReal.titulo.toLowerCase().includes('novo item')) {
      throw new Error(`Falha no Passo 2.2: O item foi gravado com título genérico "${itemSalvoReal.titulo}" em vez de "Contato João do Pix"!`);
    }

    idsParaLimpar.push(itemSalvoReal.id);
    console.log(`   ✅ Passo 2.2 OK: Item gravado no banco com título EXATO "${itemSalvoReal.titulo}" [ID: ${itemSalvoReal.id}].`);
    testesPassaram++;

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

    // --------------------------------------------------------------------------
    // TESTE 3: Cenários (b) e (c): Correção de nome ("você salvou errado, o nome certo é João do Financeiro") -> "sim" -> banco atualiza para o novo título -> consulta pelo novo nome
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 3 (Cenários b e c): Correção de nome -> "sim" -> banco atualizado -> consulta pelo novo nome');

    // Passo 3.1: Usuário avisa que o nome está errado e passa o nome correto
    const msg3Corr = 'você salvou errado, o nome certo é João do Financeiro';
    console.log(`   [Passo 3.1] Usuário: "${msg3Corr}"`);

    const res3Corr = await processarMensagemChat({
      mensagemUsuario: msg3Corr,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 3.1] VEGA: "${res3Corr.textoResposta}"`);

    const pediuConfirmacaoAtualizacao =
      res3Corr.textoResposta.toLowerCase().includes('atualizar') &&
      (res3Corr.textoResposta.toLowerCase().includes('joão do financeiro') || res3Corr.textoResposta.toLowerCase().includes('joao do financeiro')) &&
      res3Corr.textoResposta.toLowerCase().includes('confirma?');

    if (!pediuConfirmacaoAtualizacao) {
      throw new Error(`Falha no Passo 3.1: VEGA não pediu confirmação da atualização com o novo nome. Resposta: "${res3Corr.textoResposta}"`);
    }
    console.log('   ✅ Passo 3.1 OK: Pediu confirmação para atualizar o nome para "João do Financeiro".');

    historicoFluxo.push(
      {
        id: 'msg-u4',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:03',
        texto: msg3Corr,
      },
      {
        id: 'msg-a4',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:03',
        texto: res3Corr.textoResposta,
      }
    );

    // Passo 3.2: Usuário confirma a atualização com "sim"
    const msg3Sim = 'sim';
    console.log(`   [Passo 3.2] Usuário: "${msg3Sim}"`);

    const res3Sim = await processarMensagemChat({
      mensagemUsuario: msg3Sim,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 3.2] VEGA: "${res3Sim.textoResposta}"`);

    const confirmouAtualizacao =
      res3Sim.textoResposta.toLowerCase().includes('atualizado com sucesso') ||
      res3Sim.textoResposta.toLowerCase().includes('atualizado');

    // Confere no banco se o item real teve seu título atualizado para "Contato João do Financeiro"
    const todosKAposAtualizacao = await obterTodosConhecimentos();
    const itemAtualizadoNoBanco = todosKAposAtualizacao.find((k) => k.id === itemSalvoReal.id);

    if (!confirmouAtualizacao) {
      throw new Error(`Falha no Passo 3.2: VEGA não confirmou a atualização após "sim". Resposta: "${res3Sim.textoResposta}"`);
    }
    if (!itemAtualizadoNoBanco) {
      throw new Error('Falha no Passo 3.2: O item sumiu do banco de dados!');
    }
    const tituloLower = itemAtualizadoNoBanco.titulo.toLowerCase();
    if (!tituloLower.includes('joão do financeiro') && !tituloLower.includes('joao do financeiro')) {
      throw new Error(`Falha no Passo 3.2: O título no banco NÃO foi atualizado! Continua como: "${itemAtualizadoNoBanco.titulo}"`);
    }
    console.log(`   ✅ Passo 3.2 OK: O título do item ${itemSalvoReal.id} no banco foi atualizado de fato para "${itemAtualizadoNoBanco.titulo}".`);

    historicoFluxo.push(
      {
        id: 'msg-u5',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:04',
        texto: msg3Sim,
      },
      {
        id: 'msg-a5',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:04',
        texto: res3Sim.textoResposta,
      }
    );

    // Passo 3.3 (Cenário c): Consulta pelo novo nome -> "qual o telefone do João do Financeiro?" -> retorna o número
    const msg3Consulta = 'qual o telefone do João do Financeiro?';
    console.log(`   [Passo 3.3] Usuário: "${msg3Consulta}"`);

    const res3Consulta = await processarMensagemChat({
      mensagemUsuario: msg3Consulta,
      historicoRecente: historicoFluxo,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 3.3] VEGA: "${res3Consulta.textoResposta}"`);

    const retornouTelefoneNovo =
      res3Consulta.textoResposta.includes('99885-0675') || res3Consulta.textoResposta.includes('998850675');

    if (!retornouTelefoneNovo) {
      throw new Error(`Falha no Passo 3.3: A consulta pelo novo nome não retornou o telefone. Resposta: "${res3Consulta.textoResposta}"`);
    }
    console.log('   ✅ Passo 3.3 OK: A consulta pelo novo nome retornou o telefone perfeitamente.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 3: Checagem de duplicidade ANTES da confirmação (não depois do "sim")
    // --------------------------------------------------------------------------
    // TESTE 4: Checagem de duplicidade ANTES da confirmação (não depois do "sim")
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 4: Checar duplicidade ANTES da confirmação (não depois do "sim")');

    const msg4Anuncio = 'quero adicionar o contato do João do Financeiro';
    const res4Anuncio = await processarMensagemChat({
      mensagemUsuario: msg4Anuncio,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    const msg4NovoNum = '(14) 91111-2222';
    console.log(`   Usuário envia novo número "${msg4NovoNum}" para contato já existente`);

    const res4Duplicado = await processarMensagemChat({
      mensagemUsuario: msg4NovoNum,
      historicoRecente: [
        {
          id: 'dup-u1',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:10',
          texto: msg4Anuncio,
        },
        {
          id: 'dup-a1',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:10',
          texto: res4Anuncio.textoResposta,
        },
      ],
      contato: contatoAdmin,
    });
    console.log(`   VEGA resposta: "${res4Duplicado.textoResposta}"`);

    const detectouDuplicidadeAntes =
      res4Duplicado.textoResposta.toLowerCase().includes('já existe um item') &&
      res4Duplicado.textoResposta.toLowerCase().includes('atualizar o item existente ou criar um novo');

    if (!detectouDuplicidadeAntes) {
      throw new Error(`Falha no Teste 4: VEGA não detectou duplicidade ANTES da confirmação. Resposta: "${res4Duplicado.textoResposta}"`);
    }
    console.log('   ✅ Teste 4 OK: Duplicidade foi apontada ANTES de propor confirmação e antes do "sim".');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 5: Mudança de assunto no meio ("deixa pra lá, qual o CPF do Thomaz?")
    // -> deve responder o CPF e descartar a ação pendente sem gravar nada no banco.
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 5: Mudança de assunto no meio ("deixa pra lá, qual o CPF do Thomaz?")');

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

    const msg5Mudanca = 'deixa pra lá, qual o CPF do Thomaz?';
    console.log(`   Usuário: "${msg5Mudanca}" (mudando de assunto)`);

    const res5Mudanca = await processarMensagemChat({
      mensagemUsuario: msg5Mudanca,
      historicoRecente: historicoMudancaAssunto,
      contato: contatoAdmin,
    });
    console.log(`   VEGA: "${res5Mudanca.textoResposta}"`);

    // Validação: deve responder o CPF do Thomaz e NÃO confirmar o salvamento do Carlos
    const respondeuCpf =
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(res5Mudanca.textoResposta) ||
      res5Mudanca.textoResposta.toLowerCase().includes('cpf do thomaz');

    const naoConfirmouCarlos =
      !res5Mudanca.textoResposta.toLowerCase().includes('carlos da silva salvo') &&
      !res5Mudanca.textoResposta.toLowerCase().includes('carlos da silva foi salvo');

    // Validação no banco: "Carlos da Silva" NUNCA pode ter sido criado!
    const conhecimentosAposMudanca = await obterTodosConhecimentos();
    const itemCarlosCriado = conhecimentosAposMudanca.find((k) =>
      k.titulo.toLowerCase().includes('carlos da silva')
    );

    if (itemCarlosCriado) {
      idsParaLimpar.push(itemCarlosCriado.id);
      throw new Error(`Falha no Teste 5: O contato Carlos da Silva foi criado no banco mesmo com mudança de assunto! ID: ${itemCarlosCriado.id}`);
    }
    if (!respondeuCpf) {
      throw new Error(`Falha no Teste 5: VEGA não respondeu à nova pergunta sobre o CPF do Thomaz. Resposta: "${res5Mudanca.textoResposta}"`);
    }
    if (!naoConfirmouCarlos) {
      throw new Error(`Falha no Teste 5: VEGA confirmou o salvamento cancelado. Resposta: "${res5Mudanca.textoResposta}"`);
    }

    console.log('   ✅ Teste 5 OK: Respondeu o CPF do Thomaz, descartou a ação pendente e nada foi gravado no banco.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 6: Consulta "qual o CPF do Danilo?" por áudio
    // -> continua pedindo para confirmar/digitar o nome (privacidade de nomes em áudio)
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 6: Consulta "qual o CPF do Danilo?" por áudio');

    const msg6Audio = 'qual o CPF do Danilo?';
    console.log(`   Usuário (ÁUDIO): "${msg6Audio}"`);

    const res6Audio = await processarMensagemChat({
      mensagemUsuario: msg6Audio,
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   VEGA: "${res6Audio.textoResposta}"`);

    const resp6Lower = res6Audio.textoResposta.toLowerCase();
    const pediuConfirmarNome =
      resp6Lower.includes('danilo') &&
      (resp6Lower.includes('confirmar o nome') || resp6Lower.includes('digite'));

    const naoVazouCpf = !/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(res6Audio.textoResposta);

    if (!naoVazouCpf) {
      throw new Error(`Falha no Teste 6: VEGA entregou CPF indevido para nome não cadastrado via áudio! Resposta: "${res6Audio.textoResposta}"`);
    }
    if (!pediuConfirmarNome) {
      throw new Error(`Falha no Teste 6: VEGA não pediu para confirmar/digitar o nome na consulta por áudio. Resposta: "${res6Audio.textoResposta}"`);
    }

    console.log('   ✅ Teste 6 OK: A consulta por áudio pediu para confirmar/digitar o nome sem vazar dados.');
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
