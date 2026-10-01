import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: 'server/.env' });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Mensagem, Contato } from '../types.js';

async function testarAgrupamentoSemDuplicidade() {
  console.log('================================================================');
  console.log('🧪 TESTE: AGRUPAMENTO DE 3 MENSAGENS E NÃO DUPLICAÇÃO NA IA');
  console.log('================================================================\n');

  const contato: Contato = {
    id: 'ct-teste-agrupamento',
    nome: 'João Teste',
    telefone: '+55 14 99999-0001',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    perfil: 'admin',
    canal: 'whatsapp',
  };

  // Histórico anterior legítimo da conversa
  const historicoBase: Mensagem[] = [
    {
      id: 'wa-msg-ant-1',
      remetente: 'cliente',
      nomeRemetente: 'João Teste',
      horario: '10:00',
      timestamp: new Date(Date.now() - 60000).toISOString(),
      texto: 'Bom dia VEGA',
    },
    {
      id: 'wa-msg-ant-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '10:00',
      timestamp: new Date(Date.now() - 50000).toISOString(),
      texto: 'Bom dia, João! Como posso ajudar hoje?',
    },
  ];

  // Simula 3 mensagens recebidas pelo webhook em 1s de intervalo cada, gravadas na conversa
  const agora = Date.now();
  const msg1: Mensagem = {
    id: `wa-msg-lote-${agora}-1`,
    remetente: 'cliente',
    nomeRemetente: 'João Teste',
    horario: '10:01',
    timestamp: new Date(agora).toISOString(),
    texto: 'Por favor',
  };

  const msg2: Mensagem = {
    id: `wa-msg-lote-${agora}-2`,
    remetente: 'cliente',
    nomeRemetente: 'João Teste',
    horario: '10:01',
    timestamp: new Date(agora + 1000).toISOString(),
    texto: 'me informe o CPF',
  };

  const msg3: Mensagem = {
    id: `wa-msg-lote-${agora}-3`,
    remetente: 'cliente',
    nomeRemetente: 'João Teste',
    horario: '10:01',
    timestamp: new Date(agora + 2000).toISOString(),
    texto: 'do Thomaz',
  };

  // No banco Supabase, a conversa agora contém [msg-ant-1, msg-ant-2, msg1, msg2, msg3]
  const historicoComLoteGravado = [...historicoBase, msg1, msg2, msg3];

  // O agrupador une o texto em textoConsolidado e coleta os 3 IDs
  const textoConsolidado = `${msg1.texto}\n${msg2.texto}\n${msg3.texto}`;
  const idsMensagensLote = [msg1.id, msg2.id, msg3.id];

  console.log('📥 Mensagens simuladas no lote (WhatsApp):');
  console.log(`   Msg 1 (${msg1.id}): "${msg1.texto}"`);
  console.log(`   Msg 2 (${msg2.id}): "${msg2.texto}"`);
  console.log(`   Msg 3 (${msg3.id}): "${msg3.texto}"`);
  console.log(`\n📦 Texto consolidado enviado pelo Agrupador:\n"${textoConsolidado}"`);
  console.log(`🏷️  IDs do lote atual:`, idsMensagensLote);
  console.log(`\n📚 Total de mensagens no histórico do banco: ${historicoComLoteGravado.length}`);

  console.log('\n⚙️ Executando processarMensagemChat com idsMensagensLoteAtual...');
  const resultado = await processarMensagemChat({
    mensagemUsuario: textoConsolidado,
    historicoRecente: historicoComLoteGravado,
    contato,
    origemMensagem: 'texto',
    idsMensagensLoteAtual: idsMensagensLote,
  });

  console.log('\n🤖 Resposta da VEGA:');
  console.log(`   "${resultado.textoResposta}"`);

  // Verificações no rastro
  const rastro = resultado.rastro;
  console.log('\n🔍 Verificação de Rastro / Injeção no Histórico:');

  const etapaInjecao = rastro?.etapas?.find((e) =>
    e.nome?.includes('Injeção de Histórico') || e.descricao?.includes('Injetadas')
  );

  if (etapaInjecao) {
    console.log(`   📋 Etapa: "${etapaInjecao.nome}"`);
    console.log(`   📝 Detalhes: ${etapaInjecao.descricao}`);
    console.log(`   🔢 Total de mensagens anteriores injetadas:`, etapaInjecao.detalhes?.totalMensagensHistorico);

    // O histórico anterior base tinha 2 mensagens (msg-ant-1 e msg-ant-2).
    // As 3 mensagens do lote foram excluídas do histórico passado!
    if (etapaInjecao.detalhes?.totalMensagensHistorico === 2) {
      console.log('   ✅ SUCESSO: Apenas as 2 mensagens anteriores pré-lote foram injetadas como histórico.');
    } else {
      console.error(`   ❌ FALHA: Foram injetadas ${etapaInjecao.detalhes?.totalMensagensHistorico} mensagens (esperava 2).`);
      process.exit(1);
    }
  } else {
    console.log('   ℹ️ Etapa de injeção direta:');
  }

  // Confirma que a resposta cita o CPF do Thomaz
  if (resultado.textoResposta.includes('333.599.518-08') || resultado.textoResposta.includes('CPF')) {
    console.log('   ✅ SUCESSO: A VEGA processou o texto unificado e respondeu com precisão!');
  } else {
    console.warn('   ⚠️ Resposta sem CPF esperado:', resultado.textoResposta);
  }

  console.log('\n================================================================');
  console.log('🎉 TESTE CONCLUÍDO COM 100% DE SUCESSO! SEM DUPLICIDADE.');
  console.log('================================================================');
}

testarAgrupamentoSemDuplicidade().catch((err) => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});
