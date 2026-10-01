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
  console.log('🧪 BATERIA DE TESTES: BASE DE CONHECIMENTO, MULTI-MENSAGENS E LIMITES');
  console.log('================================================================\n');

  let testesPassaram = 0;
  let totalTestes = 3;
  const idsParaLimpar: string[] = [];

  try {
    // --------------------------------------------------------------------------
    // CENÁRIO A: Fluxo em várias mensagens de anúncio de contato e consulta
    // "adicione o contato do João do Pix, vou te passar o telefone" -> número -> confirmação -> "sim" -> salvo
    // depois "qual o telefone do João do Pix?" deve retornar o número salvo
    // --------------------------------------------------------------------------
    console.log('▶️ Cenário A: Fluxo em várias mensagens (Anúncio -> Número -> Confirmação -> Consulta)');
    
    // Passo 1: Anúncio
    const msgA1 = 'quero que você adicione o contato do João do Pix, eu vou te passar o telefone';
    console.log(`   [Passo 1] Usuário: "${msgA1}"`);

    const resA1 = await processarMensagemChat({
      mensagemUsuario: msgA1,
      historicoRecente: [],
      contato: contatoAdmin,
    });
    console.log(`   [Passo 1] VEGA: "${resA1.textoResposta}"`);

    const historico: Mensagem[] = [
      {
        id: 'msg-u1',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:00',
        texto: msgA1,
      },
      {
        id: 'msg-a1',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:00',
        texto: resA1.textoResposta,
      },
    ];

    // Passo 2: Usuário manda apenas o número
    const msgA2 = '(14) 99888-7766';
    console.log(`\n   [Passo 2] Usuário: "${msgA2}"`);

    const resA2 = await processarMensagemChat({
      mensagemUsuario: msgA2,
      historicoRecente: historico,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 2] VEGA: "${resA2.textoResposta}"`);

    const pediuConfirmacaoCorreta =
      resA2.textoResposta.toLowerCase().includes('vou salvar') &&
      resA2.textoResposta.toLowerCase().includes('joão do pix') &&
      resA2.textoResposta.includes('99888-7766') &&
      resA2.textoResposta.toLowerCase().includes('confirma?');

    if (!pediuConfirmacaoCorreta) {
      throw new Error(`Falha no Passo 2: A VEGA não gerou a frase de confirmação esperada. Resposta: "${resA2.textoResposta}"`);
    }
    console.log('   ✅ Passo 2 OK: Frase de confirmação formulada perfeitamente sem busca indevida no Cofre.');

    historico.push(
      {
        id: 'msg-u2',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:01',
        texto: msgA2,
      },
      {
        id: 'msg-a2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: resA2.textoResposta,
      }
    );

    // Passo 3: Usuário confirma com "sim"
    const msgA3 = 'sim';
    console.log(`\n   [Passo 3] Usuário: "${msgA3}"`);

    const resA3 = await processarMensagemChat({
      mensagemUsuario: msgA3,
      historicoRecente: historico,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 3] VEGA: "${resA3.textoResposta}"`);

    const confirmouSalvamento =
      resA3.textoResposta.toLowerCase().includes('salvo com sucesso') ||
      resA3.textoResposta.toLowerCase().includes('salvo');

    if (!confirmouSalvamento) {
      throw new Error(`Falha no Passo 3: A VEGA não confirmou o salvamento do item. Resposta: "${resA3.textoResposta}"`);
    }
    console.log('   ✅ Passo 3 OK: Item salvo com sucesso após confirmação "sim".');

    // Verifica persistência no storage
    const todosK = await obterTodosConhecimentos();
    const itemSalvo = todosK.find((k) => k.titulo.toLowerCase().includes('joão do pix'));
    if (!itemSalvo) {
      throw new Error('Falha no Passo 3: O item não foi encontrado em obterTodosConhecimentos().');
    }
    idsParaLimpar.push(itemSalvo.id);
    console.log(`   ✅ Item localizado no banco: [${itemSalvo.id}] ${itemSalvo.titulo} -> ${itemSalvo.conteudo}`);

    historico.push(
      {
        id: 'msg-u3',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:02',
        texto: msgA3,
      },
      {
        id: 'msg-a3',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:02',
        texto: resA3.textoResposta,
      }
    );

    // Passo 4: Consulta subsequente pelo telefone do João do Pix
    const msgA4 = 'qual o telefone do João do Pix?';
    console.log(`\n   [Passo 4] Usuário: "${msgA4}"`);

    const resA4 = await processarMensagemChat({
      mensagemUsuario: msgA4,
      historicoRecente: historico,
      contato: contatoAdmin,
    });
    console.log(`   [Passo 4] VEGA: "${resA4.textoResposta}"`);

    const retornouTelefone =
      resA4.textoResposta.includes('99888-7766') || resA4.textoResposta.includes('998887766');

    if (!retornouTelefone) {
      throw new Error(`Falha no Passo 4: A VEGA não retornou o telefone salvo. Resposta: "${resA4.textoResposta}"`);
    }
    console.log('   ✅ Passo 4 OK: O telefone salvo foi retornado com sucesso na consulta!');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // CENÁRIO B: Tentar salvar um contato que já existe -> deve perguntar se atualiza
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Cenário B: Tentar salvar contato que já existe (Verificação de Duplicidade)');
    const msgB1 = 'quero que você adicione o contato do João do Pix, eu vou te passar o telefone';
    const resB1 = await processarMensagemChat({
      mensagemUsuario: msgB1,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    const msgB2 = '(14) 91111-2222';
    console.log(`   Usuário: "${msgB2}" após anúncio de "João do Pix"`);

    const resB2 = await processarMensagemChat({
      mensagemUsuario: msgB2,
      historicoRecente: [
        {
          id: 'b-u1',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:10',
          texto: msgB1,
        },
        {
          id: 'b-a1',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:10',
          texto: resB1.textoResposta,
        },
      ],
      contato: contatoAdmin,
    });

    console.log(`   VEGA confirmação: "${resB2.textoResposta}"`);

    // Usuário confirma com "sim"
    const resB3 = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        {
          id: 'b-u1',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:10',
          texto: msgB1,
        },
        {
          id: 'b-a1',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:10',
          texto: resB1.textoResposta,
        },
        {
          id: 'b-u2',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:11',
          texto: msgB2,
        },
        {
          id: 'b-a2',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:11',
          texto: resB2.textoResposta,
        },
      ],
      contato: contatoAdmin,
    });

    console.log(`   VEGA após "sim": "${resB3.textoResposta}"`);

    const perguntouSeAtualiza =
      resB3.textoResposta.toLowerCase().includes('já existe um item') &&
      resB3.textoResposta.toLowerCase().includes('atualizar o item existente ou criar um novo');

    if (!perguntouSeAtualiza) {
      throw new Error(`Falha no Cenário B: VEGA não perguntou se atualiza o item existente. Resposta: "${resB3.textoResposta}"`);
    }
    console.log('   ✅ Cenário B OK: VEGA detectou duplicidade e perguntou se deseja atualizar ou criar novo.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // CENÁRIO C: Pedir uma ação sem tool (ex: "manda um e-mail pro Thomaz")
    // Deve dizer logo de início que não consegue fazer aquilo pelo chat
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Cenário C: Ação sem ferramenta ("manda um e-mail pro Thomaz")');
    const msgC1 = 'manda um e-mail pro Thomaz';
    console.log(`   Usuário: "${msgC1}"`);

    const resC1 = await processarMensagemChat({
      mensagemUsuario: msgC1,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${resC1.textoResposta}"`);

    const recusouDeInicio =
      resC1.textoResposta.toLowerCase().includes('não consigo enviar e-mails pelo chat') ||
      resC1.textoResposta.toLowerCase().includes('não consigo') && resC1.textoResposta.toLowerCase().includes('e-mail');

    const naoPrometeuFazer =
      !resC1.textoResposta.toLowerCase().includes('vou enviar') &&
      !resC1.textoResposta.toLowerCase().includes('já estou enviando') &&
      !resC1.textoResposta.toLowerCase().includes('e-mail enviado');

    if (recusouDeInicio && naoPrometeuFazer) {
      console.log('   ✅ Cenário C OK: VEGA recusou de início com honestidade e não prometeu o que não tem tool para fazer.');
      testesPassaram++;
    } else {
      throw new Error(`Falha no Cenário C: VEGA não recusou de início adequadamente. Resposta: "${resC1.textoResposta}"`);
    }

  } catch (err: any) {
    console.error('\n❌ ERRO DURANTE A EXECUÇÃO DOS TESTES:', err.message || err);
  } finally {
    // Limpeza dos itens criados durante os testes
    console.log('\n🧹 Limpando itens criados para o teste...');
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
  console.log(`📊 RESULTADO FINAL: ${testesPassaram}/${totalTestes} cenários passaram.`);
  console.log('================================================================');

  if (testesPassaram !== totalTestes) {
    process.exit(1);
  }
}

rodarTestes().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
