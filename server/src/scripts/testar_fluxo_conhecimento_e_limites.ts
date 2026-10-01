import dotenv from 'dotenv';
dotenv.config();

import {
  processarMensagemChat,
  acoesConhecimentoPendentes,
  limparAcaoConhecimentoPendenteSupabase,
} from '../chat/chatOrquestrador.js';
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
  console.log('🧪 BATERIA DE TESTES: SEQUÊNCIA REAL, REINÍCIO DE SERVIDOR E IA');
  console.log('================================================================\n');

  let testesPassaram = 0;
  const totalTestes = 7;
  const idsParaLimpar: string[] = [];

  try {
    // --------------------------------------------------------------------------
    // TESTE 1: SEQUÊNCIA EXATA DO TESTE REAL + REINÍCIO DO SERVIDOR NO MEIO
    // Áudio: "Viu, adiciona o contato do João do Pix, por favor, pra mim."
    // VEGA: "Pode mandar o telefone do João do Pix."
    // [SIMULAÇÃO DE DEPLOY NO RAILWAY / REINÍCIO: MEMÓRIA RAM ZERADA]
    // Usuário (digitado, só o número puro): "14998810675"
    // VEGA DEVE responder: "Vou salvar: Contato João do Pix, telefone 14998810675. Confirma?"
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 1: Caso Real Exato com Reinício do Servidor (número puro digitado "14998810675")');
    await limparAcaoConhecimentoPendenteSupabase(contatoAdmin);

    const msg1Real = 'Viu, adiciona o contato do João do Pix, por favor, pra mim.';
    console.log(`   [1.1] Usuário (ÁUDIO): "${msg1Real}"`);

    const res1Real = await processarMensagemChat({
      mensagemUsuario: msg1Real,
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   [1.1] VEGA: "${res1Real.textoResposta}"`);

    const r1Lower = res1Real.textoResposta.toLowerCase();
    if (!r1Lower.includes('telefone') && !r1Lower.includes('pode mandar')) {
      throw new Error(`Falha no Teste 1 (1.1): VEGA não pediu o telefone do contato. Resposta: "${res1Real.textoResposta}"`);
    }

    // SIMULAÇÃO DE REINÍCIO DO SERVIDOR / DEPLOY DO RAILWAY
    console.log('   🔄 Simulação de deploy no Railway: zerando memória RAM (acoesConhecimentoPendentes.clear())...');
    acoesConhecimentoPendentes.clear();
    if (acoesConhecimentoPendentes.size !== 0) {
      throw new Error('Falha ao limpar cache de memória para o teste');
    }

    const historicoAposPasso1: Mensagem[] = [
      {
        id: 'msg-u1',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:00',
        texto: msg1Real,
        tipoMensagem: 'audio',
      },
      {
        id: 'msg-a1',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:00',
        texto: res1Real.textoResposta,
      },
    ];

    // Passo 1.2: Usuário envia apenas os dígitos no WhatsApp (como no caso real)
    const msgNumeroPuro = '14998810675';
    console.log(`   [1.2] Usuário (DIGITADO, só números): "${msgNumeroPuro}"`);

    const resNumeroPuro = await processarMensagemChat({
      mensagemUsuario: msgNumeroPuro,
      historicoRecente: historicoAposPasso1,
      contato: contatoAdmin,
      origemMensagem: 'texto',
    });
    console.log(`   [1.2] VEGA: "${resNumeroPuro.textoResposta}"`);

    const r2Lower = resNumeroPuro.textoResposta.toLowerCase();
    const pediuConfirmacaoNomeCerto =
      r2Lower.includes('vou salvar') &&
      (r2Lower.includes('joão do pix') || r2Lower.includes('joao do pix')) &&
      !r2Lower.includes('novo item') &&
      !r2Lower.includes('mas de quem é') &&
      !r2Lower.includes('mas de quem e') &&
      resNumeroPuro.textoResposta.includes('14998810675') &&
      r2Lower.includes('confirma?');

    if (!pediuConfirmacaoNomeCerto) {
      throw new Error(`Falha no Teste 1 (1.2): VEGA não pediu confirmação para "Contato João do Pix" ou perdeu o nome após o reinício. Resposta: "${resNumeroPuro.textoResposta}"`);
    }

    // Passo 1.3: Usuário responde "sim"
    const historicoAposPasso2 = [
      ...historicoAposPasso1,
      {
        id: 'msg-u2',
        remetente: 'cliente',
        nomeRemetente: contatoAdmin.nome,
        horario: '10:01',
        texto: msgNumeroPuro,
        tipoMensagem: 'texto' as const,
      },
      {
        id: 'msg-a2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: resNumeroPuro.textoResposta,
      },
    ];

    const resSim1 = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: historicoAposPasso2,
      contato: contatoAdmin,
    });
    console.log(`   [1.3] Usuário: "sim" -> VEGA: "${resSim1.textoResposta}"`);

    const todosK1 = await obterTodosConhecimentos();
    const item1Salvo = todosK1.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );

    if (!item1Salvo) {
      throw new Error('Falha no Teste 1: Item não foi gravado no banco após o "sim"!');
    }
    if (item1Salvo.titulo.toLowerCase().includes('novo item')) {
      throw new Error(`Falha no Teste 1: Título genérico "${item1Salvo.titulo}" gravado no banco!`);
    }

    idsParaLimpar.push(item1Salvo.id);
    console.log(`   ✅ Teste 1 OK: Sobreviveu ao reinício, completou pendência do Supabase via IA e gravou "${item1Salvo.titulo}".`);
    testesPassaram++;

    // Limpa para o próximo teste
    await removerConhecimento(item1Salvo.id);
    await limparAcaoConhecimentoPendenteSupabase(contatoAdmin);

    // --------------------------------------------------------------------------
    // TESTE 2: VARIAÇÃO COM NÚMERO FORMATADO COM ESPAÇOS E TRAÇO ("14 99881-0675")
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 2: Variação com número formatado ("14 99881-0675") e reinício do servidor');

    const res2_1 = await processarMensagemChat({
      mensagemUsuario: 'adiciona o contato do João do Pix por favor',
      historicoRecente: [],
      contato: contatoAdmin,
    });
    console.log(`   [2.1] VEGA: "${res2_1.textoResposta}"`);

    // Reinício
    acoesConhecimentoPendentes.clear();

    const hist2 = [
      { id: 'h2-1', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:00', texto: 'adiciona o contato do João do Pix por favor' },
      { id: 'h2-2', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:00', texto: res2_1.textoResposta },
    ];

    const res2_2 = await processarMensagemChat({
      mensagemUsuario: '14 99881-0675',
      historicoRecente: hist2,
      contato: contatoAdmin,
    });
    console.log(`   [2.2] Usuário: "14 99881-0675" -> VEGA: "${res2_2.textoResposta}"`);

    const r2_2Lower = res2_2.textoResposta.toLowerCase();
    if (
      !r2_2Lower.includes('vou salvar') ||
      (!r2_2Lower.includes('joão do pix') && !r2_2Lower.includes('joao do pix')) ||
      r2_2Lower.includes('novo item') ||
      r2_2Lower.includes('de quem é')
    ) {
      throw new Error(`Falha no Teste 2: VEGA não formulou a confirmação esperada para o número formatado. Resposta: "${res2_2.textoResposta}"`);
    }

    const res2_3 = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        ...hist2,
        { id: 'h2-3', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:01', texto: '14 99881-0675' },
        { id: 'h2-4', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:01', texto: res2_2.textoResposta },
      ],
      contato: contatoAdmin,
    });
    console.log(`   [2.3] Usuário: "sim" -> VEGA: "${res2_3.textoResposta}"`);

    const todosK2 = await obterTodosConhecimentos();
    const item2Salvo = todosK2.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );
    if (!item2Salvo) {
      throw new Error('Falha no Teste 2: Item formatado não gravado!');
    }
    idsParaLimpar.push(item2Salvo.id);
    console.log(`   ✅ Teste 2 OK: Número formatado aceito e gravado com sucesso: "${item2Salvo.titulo}".`);
    testesPassaram++;

    await removerConhecimento(item2Salvo.id);
    await limparAcaoConhecimentoPendenteSupabase(contatoAdmin);

    // --------------------------------------------------------------------------
    // TESTE 3: VARIAÇÃO COM NÚMERO ENVIADO VIA ÁUDIO
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 3: Variação com número enviado por ÁUDIO e reinício do servidor');

    const res3_1 = await processarMensagemChat({
      mensagemUsuario: 'Quero cadastrar o contato do João do Pix',
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   [3.1] VEGA: "${res3_1.textoResposta}"`);

    // Reinício
    acoesConhecimentoPendentes.clear();

    const hist3 = [
      { id: 'h3-1', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:00', texto: 'Quero cadastrar o contato do João do Pix', tipoMensagem: 'audio' as const },
      { id: 'h3-2', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:00', texto: res3_1.textoResposta },
    ];

    const res3_2 = await processarMensagemChat({
      mensagemUsuario: 'O número é 14 99881-0675',
      historicoRecente: hist3,
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   [3.2] Usuário (ÁUDIO): "O número é 14 99881-0675" -> VEGA: "${res3_2.textoResposta}"`);

    const r3_2Lower = res3_2.textoResposta.toLowerCase();
    if (
      !r3_2Lower.includes('vou salvar') ||
      (!r3_2Lower.includes('joão do pix') && !r3_2Lower.includes('joao do pix')) ||
      r3_2Lower.includes('novo item')
    ) {
      throw new Error(`Falha no Teste 3: VEGA não pediu confirmação para o áudio com o número. Resposta: "${res3_2.textoResposta}"`);
    }

    const res3_3 = await processarMensagemChat({
      mensagemUsuario: 'confirmo',
      historicoRecente: [
        ...hist3,
        { id: 'h3-3', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:01', texto: 'O número é 14 99881-0675', tipoMensagem: 'audio' as const },
        { id: 'h3-4', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:01', texto: res3_2.textoResposta },
      ],
      contato: contatoAdmin,
    });
    console.log(`   [3.3] Usuário: "confirmo" -> VEGA: "${res3_3.textoResposta}"`);

    const todosK3 = await obterTodosConhecimentos();
    const item3Salvo = todosK3.find((k) =>
      k.titulo.toLowerCase().includes('joão do pix') || k.titulo.toLowerCase().includes('joao do pix')
    );
    if (!item3Salvo) {
      throw new Error('Falha no Teste 3: Item por áudio não gravado!');
    }
    idsParaLimpar.push(item3Salvo.id);
    console.log(`   ✅ Teste 3 OK: Fluxo com áudio completou a pendência e gravou "${item3Salvo.titulo}".`);
    testesPassaram++;

    // Mantém o item3 para o Teste 4 de correção de nome
    // --------------------------------------------------------------------------
    // TESTE 4: CORREÇÃO DE NOME ("você salvou errado, o nome certo é João do Financeiro") -> "sim" -> consulta
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 4: Correção de nome -> "sim" -> banco atualizado -> consulta pelo novo nome');

    const hist4 = [
      { id: 'h4-1', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:00', texto: 'Quero cadastrar o contato do João do Pix' },
      { id: 'h4-2', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:00', texto: res3_1.textoResposta },
      { id: 'h4-3', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:01', texto: '14 99881-0675' },
      { id: 'h4-4', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:01', texto: res3_2.textoResposta },
      { id: 'h4-5', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:02', texto: 'confirmo' },
      { id: 'h4-6', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:02', texto: res3_3.textoResposta },
    ];

    const msgCorr = 'você salvou errado, o nome certo é João do Financeiro';
    console.log(`   [4.1] Usuário: "${msgCorr}"`);
    const resCorr = await processarMensagemChat({
      mensagemUsuario: msgCorr,
      historicoRecente: hist4,
      contato: contatoAdmin,
    });
    console.log(`   [4.1] VEGA: "${resCorr.textoResposta}"`);

    const rCorrLower = resCorr.textoResposta.toLowerCase();
    if (!rCorrLower.includes('atualizar') || (!rCorrLower.includes('joão do financeiro') && !rCorrLower.includes('joao do financeiro'))) {
      throw new Error(`Falha no Teste 4: VEGA não pediu confirmação para corrigir o nome. Resposta: "${resCorr.textoResposta}"`);
    }

    const resSimCorr = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        ...hist4,
        { id: 'h4-7', remetente: 'cliente' as const, nomeRemetente: contatoAdmin.nome, horario: '10:03', texto: msgCorr },
        { id: 'h4-8', remetente: 'assistente' as const, nomeRemetente: 'VEGA', horario: '10:03', texto: resCorr.textoResposta },
      ],
      contato: contatoAdmin,
    });
    console.log(`   [4.2] Usuário: "sim" -> VEGA: "${resSimCorr.textoResposta}"`);

    const todosK4 = await obterTodosConhecimentos();
    const itemAtualizado = todosK4.find((k) => k.id === item3Salvo.id);
    if (!itemAtualizado || !itemAtualizado.titulo.toLowerCase().includes('financeiro')) {
      throw new Error(`Falha no Teste 4: Título no banco não foi atualizado para João do Financeiro! Título atual: "${itemAtualizado?.titulo}"`);
    }

    const resConsulta = await processarMensagemChat({
      mensagemUsuario: 'qual o telefone do João do Financeiro?',
      historicoRecente: [],
      contato: contatoAdmin,
    });
    console.log(`   [4.3] Usuário: "qual o telefone do João do Financeiro?" -> VEGA: "${resConsulta.textoResposta}"`);

    if (!resConsulta.textoResposta.includes('99881-0675') && !resConsulta.textoResposta.includes('998810675')) {
      throw new Error(`Falha no Teste 4: Consulta pelo novo nome não retornou o telefone. Resposta: "${resConsulta.textoResposta}"`);
    }

    console.log('   ✅ Teste 4 OK: Nome corrigido no banco e consultável com sucesso.');
    testesPassaram++;

    await removerConhecimento(item3Salvo.id);
    await limparAcaoConhecimentoPendenteSupabase(contatoAdmin);

    // --------------------------------------------------------------------------
    // TESTE 5: CHECAR DUPLICIDADE ANTES DA CONFIRMAÇÃO
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 5: Checar duplicidade ANTES da confirmação (não depois do "sim")');

    // Cria um item prévio
    const resPrevio = await processarMensagemChat({
      mensagemUsuario: 'salva o contato da Maria do RH telefone 14991112233',
      historicoRecente: [],
      contato: contatoAdmin,
    });
    await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        { id: 'hp-1', remetente: 'cliente', nomeRemetente: contatoAdmin.nome, horario: '10:00', texto: 'salva o contato da Maria do RH telefone 14991112233' },
        { id: 'hp-2', remetente: 'assistente', nomeRemetente: 'VEGA', horario: '10:00', texto: resPrevio.textoResposta },
      ],
      contato: contatoAdmin,
    });
    const itemMaria = (await obterTodosConhecimentos()).find((k) => k.titulo.toLowerCase().includes('maria do rh'));
    if (itemMaria) idsParaLimpar.push(itemMaria.id);

    // Tenta salvar de novo
    const resDup = await processarMensagemChat({
      mensagemUsuario: 'salva o contato da Maria do RH com o telefone 14 99111-2233',
      historicoRecente: [],
      contato: contatoAdmin,
    });
    console.log(`   VEGA duplicidade: "${resDup.textoResposta}"`);

    const indicouDuplicidade =
      resDup.textoResposta.toLowerCase().includes('já existe') ||
      resDup.textoResposta.toLowerCase().includes('ja existe');

    if (!indicouDuplicidade) {
      throw new Error(`Falha no Teste 5: Duplicidade não foi acusada antes da confirmação. Resposta: "${resDup.textoResposta}"`);
    }
    console.log('   ✅ Teste 5 OK: Duplicidade apontada antes de propor confirmação.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 6: MUDANÇA DE ASSUNTO NO MEIO ("deixa pra lá, qual o CPF do Thomaz?")
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 6: Mudança de assunto no meio ("deixa pra lá, qual o CPF do Thomaz?")');

    const resMud1 = await processarMensagemChat({
      mensagemUsuario: 'salva o contato do Carlos da Silva telefone (14) 97777-6666',
      historicoRecente: [],
      contato: contatoAdmin,
    });

    const resMud2 = await processarMensagemChat({
      mensagemUsuario: 'deixa pra lá, qual o CPF do Thomaz?',
      historicoRecente: [
        { id: 'hm-1', remetente: 'cliente', nomeRemetente: contatoAdmin.nome, horario: '10:00', texto: 'salva o contato do Carlos da Silva telefone (14) 97777-6666' },
        { id: 'hm-2', remetente: 'assistente', nomeRemetente: 'VEGA', horario: '10:00', texto: resMud1.textoResposta },
      ],
      contato: contatoAdmin,
    });
    console.log(`   VEGA mudança: "${resMud2.textoResposta}"`);

    const respondeuCpf =
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resMud2.textoResposta) ||
      resMud2.textoResposta.toLowerCase().includes('cpf do thomaz');

    const todosKMud = await obterTodosConhecimentos();
    const itemCarlos = todosKMud.find((k) => k.titulo.toLowerCase().includes('carlos da silva'));
    if (itemCarlos) {
      idsParaLimpar.push(itemCarlos.id);
      throw new Error(`Falha no Teste 6: Contato Carlos da Silva foi gravado indevidamente! ID: ${itemCarlos.id}`);
    }
    if (!respondeuCpf) {
      throw new Error(`Falha no Teste 6: VEGA não respondeu o CPF do Thomaz na mudança de assunto. Resposta: "${resMud2.textoResposta}"`);
    }

    console.log('   ✅ Teste 6 OK: Respondeu a nova pergunta e cancelou a pendência.');
    testesPassaram++;

    // --------------------------------------------------------------------------
    // TESTE 7: CONSULTA POR ÁUDIO DE NOME NÃO CADASTRADO
    // --------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('▶️ Teste 7: Consulta "qual o CPF do Danilo?" por áudio (privacidade estrita)');

    const res7 = await processarMensagemChat({
      mensagemUsuario: 'qual o CPF do Danilo?',
      historicoRecente: [],
      contato: contatoAdmin,
      origemMensagem: 'audio',
    });
    console.log(`   VEGA: "${res7.textoResposta}"`);

    const r7Lower = res7.textoResposta.toLowerCase();
    const pediuConfirmarNome =
      r7Lower.includes('danilo') &&
      (r7Lower.includes('confirmar o nome') || r7Lower.includes('digite'));

    const naoVazouCpf = !/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(res7.textoResposta);

    if (!naoVazouCpf || !pediuConfirmarNome) {
      throw new Error(`Falha no Teste 7: Consulta de áudio não respeitou regra de privacidade. Resposta: "${res7.textoResposta}"`);
    }

    console.log('   ✅ Teste 7 OK: Pediu confirmação sem vazar dados cadastrais.');
    testesPassaram++;

  } catch (err: any) {
    console.error('\n❌ ERRO DURANTE A EXECUÇÃO DOS TESTES:', err.message || err);
  } finally {
    console.log('\n🧹 Limpando itens criados para os testes...');
    for (const id of idsParaLimpar) {
      try {
        await removerConhecimento(id);
        console.log(`   Item ${id} removido da Base de Conhecimento.`);
      } catch (errLimpeza: any) {
        console.warn(`   Falha ao remover item ${id}:`, errLimpeza.message || errLimpeza);
      }
    }
    await limparAcaoConhecimentoPendenteSupabase(contatoAdmin);
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
