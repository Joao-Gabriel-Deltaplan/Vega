import dotenv from 'dotenv';
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosConhecimentos, removerConhecimento } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

const contatoAdmin: Contato = {
  id: 'admin-teste-1',
  nome: 'Administrador Teste',
  telefone: '5511999990001',
  avatarCor: '#10b981',
  cargo: 'Administrador',
  setor: 'Diretoria',
  nivelAcesso: 'diretoria',
  ficha: {
    cargo: 'Administrador',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    observacoes: '',
  },
};

const contatoComum: Contato = {
  id: 'comum-teste-1',
  nome: 'Usuário Comum Teste',
  telefone: '5511999990002',
  avatarCor: '#6b7280',
  cargo: 'Assistente',
  setor: 'Administrativo',
  nivelAcesso: 'geral',
  ficha: {
    cargo: 'Assistente',
    setor: 'Administrativo',
    nivelAcesso: 'geral',
    observacoes: '',
  },
};

async function rodarBateriaTestes() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: CADASTRO NA BASE DE CONHECIMENTO (REGRA 22)');
  console.log('================================================================\n');

  let testesPassaram = 0;
  let totalTestes = 4;
  const idsParaLimpar: string[] = [];

  try {
    // --------------------------------------------------------------------------
    // TESTE 1: Salvar PIX novo com confirmação ("sim")
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 1: Salvar PIX novo com confirmação ("sim")');
    const msg1 = 'Quero que salve, o pix do berna é 43859328832';
    console.log(`   Usuário Admin: "${msg1}"`);

    const res1 = await processarMensagemChat({
      mensagemUsuario: msg1,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res1.textoResposta}"`);
    console.log(`   Intenção: "${res1.intencaoDetectada}"`);

    const pediuConfirmacaoPix =
      res1.intencaoDetectada === 'cadastrar_conhecimento' &&
      res1.textoResposta.toLowerCase().includes('vou salvar') &&
      res1.textoResposta.includes('43859328832') &&
      res1.textoResposta.toLowerCase().includes('confirma') &&
      Boolean(res1.correcaoPendente);

    if (pediuConfirmacaoPix) {
      console.log('   ✅ Proposta de confirmação prévia correta.');
    } else {
      console.error('   ❌ Falha ao solicitar confirmação prévia do PIX.');
    }

    // Agora simula o usuário confirmando com "sim"
    const msgAssistente1: Mensagem = {
      id: 'msg-assist-1',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:00',
      texto: res1.textoResposta,
      correcaoPendente: res1.correcaoPendente,
    };

    console.log('   Usuário Admin: "sim"');
    const res1Conf = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        {
          id: 'msg-user-1',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:00',
          texto: msg1,
        },
        msgAssistente1,
      ],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res1Conf.textoResposta}"`);

    // Verifica se foi gravado na base de conhecimento
    const todosK1 = await obterTodosConhecimentos();
    const itemBerna = todosK1.find(
      (k) =>
        k.tipo === 'pix' &&
        (k.titulo.toLowerCase().includes('berna') || (k.dadosEstruturados as any)?.titular?.toLowerCase().includes('berna'))
    );

    if (itemBerna && res1Conf.textoResposta.toLowerCase().includes('sucesso')) {
      console.log(`   ✅ Chave PIX do Berna salva no banco! ID: ${itemBerna.id}`);
      idsParaLimpar.push(itemBerna.id);
      testesPassaram++;
    } else {
      console.error('   ❌ Item PIX não localizado na Base de Conhecimento após confirmação.');
    }

    console.log('\n----------------------------------------------------------------\n');

    // --------------------------------------------------------------------------
    // TESTE 2: Salvar Telefone novo com confirmação ("sim")
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 2: Salvar telefone com confirmação ("sim")');
    const msg2 = 'anota o telefone do Berna que é 11987654321';
    console.log(`   Usuário Admin: "${msg2}"`);

    const res2 = await processarMensagemChat({
      mensagemUsuario: msg2,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res2.textoResposta}"`);
    console.log(`   Intenção: "${res2.intencaoDetectada}"`);

    const pediuConfirmacaoTel =
      res2.intencaoDetectada === 'cadastrar_conhecimento' &&
      res2.textoResposta.toLowerCase().includes('vou salvar') &&
      res2.textoResposta.includes('11987654321') &&
      Boolean(res2.correcaoPendente);

    if (pediuConfirmacaoTel) {
      console.log('   ✅ Proposta de confirmação prévia de telefone correta.');
    } else {
      console.error('   ❌ Falha ao solicitar confirmação prévia do telefone.');
    }

    const msgAssistente2: Mensagem = {
      id: 'msg-assist-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:05',
      texto: res2.textoResposta,
      correcaoPendente: res2.correcaoPendente,
    };

    console.log('   Usuário Admin: "sim"');
    const res2Conf = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        {
          id: 'msg-user-2',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:05',
          texto: msg2,
        },
        msgAssistente2,
      ],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res2Conf.textoResposta}"`);

    const todosK2 = await obterTodosConhecimentos();
    const itemTelBerna = todosK2.find(
      (k) =>
        k.tipo === 'contato' &&
        (k.titulo.toLowerCase().includes('berna') || (k.dadosEstruturados as any)?.nome?.toLowerCase().includes('berna'))
    );

    if (itemTelBerna && res2Conf.textoResposta.toLowerCase().includes('sucesso')) {
      console.log(`   ✅ Contato do Berna salvo no banco! ID: ${itemTelBerna.id}`);
      idsParaLimpar.push(itemTelBerna.id);
      testesPassaram++;
    } else {
      console.error('   ❌ Contato do Berna não localizado na Base de Conhecimento.');
    }

    console.log('\n----------------------------------------------------------------\n');

    // --------------------------------------------------------------------------
    // TESTE 3: Consultar item inexistente (Regra 22: Blindagem contra entrega divergente)
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 3: Consultar item inexistente (não deve devolver chave de outra pessoa)');
    const msg3 = 'qual o pix do Carlos Roberto?';
    console.log(`   Usuário: "${msg3}"`);

    const res3 = await processarMensagemChat({
      mensagemUsuario: msg3,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res3.textoResposta}"`);

    const respondeuCorretamenteInexistente =
      res3.textoResposta.toLowerCase().includes('não encontrei chave pix') &&
      !res3.textoResposta.includes('43859328832');

    if (respondeuCorretamenteInexistente) {
      console.log('   ✅ VEGA informou que não encontrou o PIX de Carlos Roberto sem vazar chave de terceiros!');
      testesPassaram++;
    } else {
      console.error('   ❌ VEGA falhou ou devolveu chave divergente!');
    }

    console.log('\n----------------------------------------------------------------\n');

    // --------------------------------------------------------------------------
    // TESTE 4: Usuário comum tentando cadastrar (Bloqueio estrito de permissão)
    // --------------------------------------------------------------------------
    console.log('▶️ Teste 4: Usuário comum tentando cadastrar');
    const msg4 = 'salva o pix do Fulano é 12345678901';
    console.log(`   Usuário Comum: "${msg4}"`);

    const res4 = await processarMensagemChat({
      mensagemUsuario: msg4,
      historicoRecente: [],
      contato: contatoComum,
    });

    console.log(`   VEGA: "${res4.textoResposta}"`);

    const bloqueouPermissao =
      res4.textoResposta.includes('Você não tem permissão para cadastrar informações na Base de Conhecimento') &&
      !res4.correcaoPendente;

    if (bloqueouPermissao) {
      console.log('   ✅ Usuário comum bloqueado com sucesso com mensagem padrão!');
      testesPassaram++;
    } else {
      console.error('   ❌ Falha ao bloquear usuário comum!');
    }

    console.log('\n----------------------------------------------------------------\n');

    // --------------------------------------------------------------------------
    // TESTE 5: Item existente na Base de Conhecimento (Pergunta se substitui)
    // --------------------------------------------------------------------------
    totalTestes = 5;
    console.log('▶️ Teste 5: Item existente na Base de Conhecimento (pergunta se substitui)');
    
    // Cadastra um item prévio
    const itemPrevio = await processarMensagemChat({
      mensagemUsuario: 'salva o link do figma https://figma.com/delta',
      historicoRecente: [],
      contato: contatoAdmin,
    });

    const msgConfFigma: Mensagem = {
      id: 'msg-conf-figma',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:10',
      texto: itemPrevio.textoResposta,
      correcaoPendente: itemPrevio.correcaoPendente,
    };

    await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: [
        {
          id: 'u-figma',
          remetente: 'cliente',
          nomeRemetente: contatoAdmin.nome,
          horario: '10:10',
          texto: 'salva o link do figma https://figma.com/delta',
        },
        msgConfFigma,
      ],
      contato: contatoAdmin,
    });

    const todosKFigma = await obterTodosConhecimentos();
    const itemFigmaSalvo = todosKFigma.find((k) => k.titulo.toLowerCase().includes('figma') || (k.dadosEstruturados as any)?.link?.includes('figma'));
    if (itemFigmaSalvo) {
      idsParaLimpar.push(itemFigmaSalvo.id);
    }

    // Tenta cadastrar novamente com nova URL
    const msg5 = 'salva o link do figma https://figma.com/delta-novo';
    console.log(`   Usuário Admin: "${msg5}"`);

    const res5 = await processarMensagemChat({
      mensagemUsuario: msg5,
      historicoRecente: [],
      contato: contatoAdmin,
    });

    console.log(`   VEGA: "${res5.textoResposta}"`);

    const perguntouSeSubstitui =
      res5.textoResposta.toLowerCase().includes('já existe um item cadastrado') &&
      res5.textoResposta.toLowerCase().includes('substituir') &&
      res5.correcaoPendente?.campoId === ('substituir_conhecimento' as any);

    if (perguntouSeSubstitui) {
      console.log('   ✅ VEGA identificou item duplicado e perguntou se substitui!');
      testesPassaram++;
    } else {
      console.error('   ❌ Falha ao identificar duplicidade e perguntar sobre substituição.');
    }

    console.log('\n================================================================');
    console.log(`🏁 RESULTADO FINAL: ${testesPassaram}/${totalTestes} TESTES PASSARAM COM SUCESSO!`);
    console.log('================================================================\n');
  } finally {
    // Limpeza: remove os itens temporários criados nos testes
    if (idsParaLimpar.length > 0) {
      console.log('🧹 Limpando itens criados nos testes da Base de Conhecimento...');
      for (const id of idsParaLimpar) {
        await removerConhecimento(id);
        console.log(`   🗑️ Removido item: ${id}`);
      }
      console.log('✅ Base de Conhecimento limpa com sucesso.\n');
    }
  }

  if (testesPassaram !== totalTestes) {
    process.exit(1);
  }
}

rodarBateriaTestes().catch((err) => {
  console.error('❌ Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
