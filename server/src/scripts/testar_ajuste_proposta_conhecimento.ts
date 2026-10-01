import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosConhecimentos, removerConhecimento } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

async function executarTesteSequenciaExata() {
  console.log('================================================================');
  console.log('🧪 TESTE: AJUSTE DURANTE CONFIRMAÇÃO NA BASE DE CONHECIMENTO');
  console.log('================================================================\n');

  const contatoAdmin: Contato = {
    id: 'wa-admin-teste-conhecimento',
    nome: 'João Gabriel Brandini',
    telefone: '5514996863115',
    nivelAcesso: 'diretoria',
    cargo: 'Diretor',
    setor: 'Diretoria',
  };

  // 1. Snapshot do banco de dados antes do teste
  const itensAntes = await obterTodosConhecimentos();
  console.log(`Itens existentes no banco antes do teste: ${itensAntes.length}`);
  const mapaAntes = new Map(itensAntes.map((k) => [k.id, { titulo: k.titulo, conteudo: k.conteudo }]));

  let totalPassou = 0;
  let totalTestes = 0;

  function asserir(condicao: boolean, titulo: string, detalheErro?: string) {
    totalTestes++;
    if (condicao) {
      console.log(`✅ [PASSOU] ${titulo}`);
      totalPassou++;
    } else {
      console.error(`❌ [FALHOU] ${titulo}`);
      if (detalheErro) console.error(`   Detalhe: ${detalheErro}`);
    }
  }

  const historico: Mensagem[] = [];

  // -----------------------------------------------------------------
  // PASSO 1 & 2: Pedido de salvar contato com telefone
  // -----------------------------------------------------------------
  console.log('\n--- 1. Mensagem 1: "Viu, você consegue salvar o contato do João do Pix, é 14998810675" ---');
  const msg1 = 'Viu, você consegue salvar o contato do João do Pix, é 14998810675';
  const res1 = await processarMensagemChat({
    mensagemUsuario: msg1,
    historicoRecente: historico,
    contato: contatoAdmin,
  });

  console.log('   Resposta VEGA:', res1.textoResposta);
  asserir(
    res1.textoResposta.toLowerCase().includes('vou salvar') &&
    res1.textoResposta.toLowerCase().includes('joão do pix') &&
    res1.textoResposta.includes('14998810675') || res1.textoResposta.includes('14 9988 10 675') || res1.textoResposta.includes('14 99881-0675'),
    'Passo 2: VEGA propõe salvar e pede confirmação'
  );

  historico.push(
    { id: 'msg-1', remetente: 'cliente', texto: msg1, timestamp: new Date().toISOString() },
    { id: 'msg-2', remetente: 'assistente', texto: res1.textoResposta, timestamp: new Date().toISOString() }
  );

  // -----------------------------------------------------------------
  // PASSO 3 & 4: Usuário pede ajuste na proposta antes de salvar
  // -----------------------------------------------------------------
  console.log('\n--- 2. Mensagem 2: "Não precisa salvar como contato João do Pix, somente salve como João do Pix" ---');
  const msg2 = 'Não precisa salvar como contato João do Pix, somente salve como João do Pix';
  const res2 = await processarMensagemChat({
    mensagemUsuario: msg2,
    historicoRecente: historico,
    contato: contatoAdmin,
  });

  console.log('   Resposta VEGA:', res2.textoResposta);
  const textoR2 = res2.textoResposta.toLowerCase();

  const ajustouPropostaSemRenomear =
    !textoR2.includes('atualizar o nome') &&
    !textoR2.includes('atualizar o item') &&
    !textoR2.includes('renomear o item') &&
    textoR2.includes('vou salvar') &&
    res2.textoResposta.includes('João do Pix');

  asserir(
    ajustouPropostaSemRenomear,
    'Passo 4: VEGA ajusta proposta para "Vou salvar: João do Pix, telefone ... Confirma?" SEM transformar em atualização de item existente'
  );

  historico.push(
    { id: 'msg-3', remetente: 'cliente', texto: msg2, timestamp: new Date().toISOString() },
    { id: 'msg-4', remetente: 'assistente', texto: res2.textoResposta, timestamp: new Date().toISOString() }
  );

  // -----------------------------------------------------------------
  // PASSO 5: Usuário confirma com "Sim"
  // -----------------------------------------------------------------
  console.log('\n--- 3. Mensagem 3: "Sim" ---');
  const msg3 = 'Sim';
  const res3 = await processarMensagemChat({
    mensagemUsuario: msg3,
    historicoRecente: historico,
    contato: contatoAdmin,
  });

  console.log('   Resposta VEGA:', res3.textoResposta);
  asserir(
    res3.textoResposta.toLowerCase().includes('salvo com sucesso') &&
    res3.textoResposta.includes('João do Pix'),
    'Passo 5: VEGA confirma que o novo item "João do Pix" foi salvo com sucesso'
  );

  // -----------------------------------------------------------------
  // VERIFICAÇÃO NO BANCO DE DADOS: ANTES VS DEPOIS
  // -----------------------------------------------------------------
  console.log('\n--- 4. Verificação de Integridade no Banco de Dados ---');
  const itensDepois = await obterTodosConhecimentos();
  console.log(`Itens existentes no banco após o teste: ${itensDepois.length}`);

  // 4.1. Checa que nenhum item pré-existente foi alterado
  let algumItemExistenteAlterado = false;
  for (const [id, original] of mapaAntes.entries()) {
    const atual = itensDepois.find((k) => k.id === id);
    if (!atual) {
      console.error(`❌ Item pré-existente ${id} foi removido!`);
      algumItemExistenteAlterado = true;
    } else if (atual.titulo !== original.titulo || atual.conteudo !== original.conteudo) {
      console.error(`❌ Item pré-existente ${id} foi alterado! Antes: "${original.titulo}", Depois: "${atual.titulo}"`);
      algumItemExistenteAlterado = true;
    }
  }

  asserir(!algumItemExistenteAlterado, 'Nenhum item pré-existente no banco de dados foi alterado ou renomeado');

  // 4.2. Checa que o novo item foi criado com os dados corretos
  const novoItemCriado = itensDepois.find((k) => !mapaAntes.has(k.id) && k.titulo.includes('João do Pix'));
  asserir(Boolean(novoItemCriado), 'Um novo item com título "João do Pix" foi criado no banco');

  if (novoItemCriado) {
    console.log(`   Novo Item Criado: [${novoItemCriado.id}] "${novoItemCriado.titulo}" -> ${novoItemCriado.conteudo}`);
    const contemTelefoneNovo =
      novoItemCriado.conteudo.includes('14998810675') ||
      novoItemCriado.conteudo.includes('14 9988 10 675') ||
      novoItemCriado.conteudo.includes('14 99881-0675') ||
      (novoItemCriado.dadosEstruturados as any)?.telefone?.includes('14998810675') ||
      (novoItemCriado.dadosEstruturados as any)?.telefone?.includes('14 9988 10 675');
    asserir(Boolean(contemTelefoneNovo), 'O novo item contém o telefone informado (14998810675)');

    // Limpeza apenas do item de teste criado
    console.log(`\n🧹 Limpando item de teste criado (${novoItemCriado.id})...`);
    await removerConhecimento(novoItemCriado.id);
    console.log('   Limpeza concluída.');
  }

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO: ${totalPassou}/${totalTestes} TESTES APROVADOS (${Math.round((totalPassou / totalTestes) * 100)}%)`);
  console.log('================================================================');

  if (totalPassou === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

executarTesteSequenciaExata().catch((err) => {
  console.error('❌ Erro inesperado:', err);
  process.exit(1);
});
