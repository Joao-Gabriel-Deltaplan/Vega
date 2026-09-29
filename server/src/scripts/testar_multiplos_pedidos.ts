import dotenv from 'dotenv';
dotenv.config();

import { processarMensagemChat, classificarEReescreverMensagem } from '../chat/chatOrquestrador.js';
import { obterDocumentosPorNivelAcesso, obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { Contato } from '../types.js';
import OpenAI from 'openai';

async function rodarTestesMultiplosPedidos() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: MÚLTIPLOS PEDIDOS POR LOTE (VEGA)');
  console.log('================================================================\n');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY ausente.');
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey });

  const contatoTeste: Contato = {
    id: 'ct-teste-multi',
    nome: 'João Gabriel',
    telefone: '5511999990001',
    avatarCor: '#25D366',
    cargo: 'Administrador',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
  };

  const docsDisponiveis = await obterTodosDocumentos();

  let passou = 0;
  let falhou = 0;

  // --------------------------------------------------------------------------
  // TESTE 1: Endereço do Escritório da Delta Plan + PIX do João Gabriel (Caso real reportado)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 1: Endereço da Delta Plan + PIX do João Gabriel ---');
  try {
    const msg = 'Eu quero saber onde que fica o escritório da Delta.\nE eu também quero saber o Pix do João Gabriel.';
    
    // Testa o classificador diretamente
    const classif = await classificarEReescreverMensagem(msg, [], openai);
    console.log(`[Classificador] Quantidade de pedidos identificados: ${classif.pedidos?.length || 1}`);
    for (let i = 0; i < (classif.pedidos?.length || 0); i++) {
      const p = classif.pedidos![i];
      console.log(`  Pedido ${i + 1}: [${p.intencao}] - "${p.pergunta_completa}" (termo: "${p.termo_busca}", pessoa: "${p.pessoa || 'n/a'}")`);
    }

    // Testa a execução pelo orquestrador
    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);

    const textoLower = res.textoResposta.toLowerCase();
    const contemEndereco = textoLower.includes('endereço') || textoLower.includes('rua') || textoLower.includes('av') || textoLower.includes('maps') || textoLower.includes('localização');
    const contemPix = textoLower.includes('pix') || textoLower.includes('chave');

    if (classif.pedidos && classif.pedidos.length >= 2 && contemEndereco && contemPix) {
      console.log('✅ TESTE 1 PASSOU: Ambos os pedidos (Endereço + PIX) foram atendidos na mesma resposta!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 1 FALHOU: contemEndereco=${contemEndereco}, contemPix=${contemPix}, pedidos=${classif.pedidos?.length}\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 1 FALHOU com exceção:', err);
    falhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Dois documentos diferentes (CNH do Thomaz + Certidão de Casamento do Thomaz)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 2: Dois documentos diferentes (CNH + Certidão de Casamento) ---');
  try {
    const msg = 'Me manda a CNH do Thomaz e a certidão de casamento dele';
    
    const classif = await classificarEReescreverMensagem(msg, [], openai);
    console.log(`[Classificador] Quantidade de pedidos: ${classif.pedidos?.length || 1}`);
    for (let i = 0; i < (classif.pedidos?.length || 0); i++) {
      const p = classif.pedidos![i];
      console.log(`  Pedido ${i + 1}: [${p.intencao}] - "${p.pergunta_completa}" (doc: "${p.documento_citado}")`);
    }

    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);
    console.log(`[Anexos]: ${res.anexos?.length || 0} anexo(s)`);
    if (res.anexos) {
      res.anexos.forEach((a) => console.log(`  - ${a.nome}`));
    }

    const textoLower = res.textoResposta.toLowerCase();
    const contemCnh = textoLower.includes('cnh');
    const contemCasamento = textoLower.includes('casamento') || textoLower.includes('certidão');
    const temDoisAnexos = (res.anexos?.length || 0) >= 2;

    if (contemCnh && contemCasamento && temDoisAnexos) {
      console.log('✅ TESTE 2 PASSOU: Ambos os documentos atendidos e ambos os anexos incluídos!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 2 FALHOU: contemCnh=${contemCnh}, contemCasamento=${contemCasamento}, anexos=${res.anexos?.length}\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 2 FALHOU com exceção:', err);
    falhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Dado pessoal + Documento (CPF do Thomaz + Certidão de Casamento)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 3: Dado pessoal + Documento (CPF + Certidão de Casamento) ---');
  try {
    const msg = 'Qual o CPF do Thomaz? E me manda a certidão de casamento dele.';
    
    const classif = await classificarEReescreverMensagem(msg, [], openai);
    console.log(`[Classificador] Quantidade de pedidos: ${classif.pedidos?.length || 1}`);
    for (let i = 0; i < (classif.pedidos?.length || 0); i++) {
      const p = classif.pedidos![i];
      console.log(`  Pedido ${i + 1}: [${p.intencao}] - "${p.pergunta_completa}"`);
    }

    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);
    console.log(`[Anexos]: ${res.anexos?.length || 0} anexo(s)`);

    const textoLower = res.textoResposta.toLowerCase();
    const contemCpf = textoLower.includes('cpf') || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(res.textoResposta) || textoLower.includes('***');
    const contemDoc = textoLower.includes('casamento') || textoLower.includes('certidão') || (res.anexos?.length || 0) >= 1;

    if (contemCpf && contemDoc && (res.anexos?.length || 0) >= 1) {
      console.log('✅ TESTE 3 PASSOU: Dado pessoal (CPF) e envio de documento com anexo unificados!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 3 FALHOU: contemCpf=${contemCpf}, contemDoc=${contemDoc}, anexos=${res.anexos?.length}\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 3 FALHOU com exceção:', err);
    falhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Uma pergunta só (não quebrar o caso simples)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 4: Pergunta única simples (PIX do João Gabriel) ---');
  try {
    const msg = 'qual o pix do João Gabriel';
    
    const classif = await classificarEReescreverMensagem(msg, [], openai);
    console.log(`[Classificador] Quantidade de pedidos: ${classif.pedidos?.length || 1}`);

    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);

    const contemPix = res.textoResposta.toLowerCase().includes('pix') || res.textoResposta.toLowerCase().includes('chave');

    if ((classif.pedidos?.length || 1) === 1 && contemPix) {
      console.log('✅ TESTE 4 PASSOU: Caso simples preservado com perfeição!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 4 FALHOU: pedidos=${classif.pedidos?.length}, contemPix=${contemPix}\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 4 FALHOU com exceção:', err);
    falhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Limite de segurança de 5 pedidos
  // --------------------------------------------------------------------------
  console.log('--- TESTE 5: Limite de segurança (> 5 pedidos) ---');
  try {
    const msg = '1. Onde fica o escritório?\n2. Qual o Pix do João Gabriel?\n3. Qual o CPF do Thomaz?\n4. Qual o RG do Thomaz?\n5. Qual a profissão do Thomaz?\n6. Qual o estado civil do Thomaz?';
    
    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);

    const contemAvisoLimite = res.textoResposta.toLowerCase().includes('por segurança, atendi os primeiros 5 pedidos');

    if (contemAvisoLimite) {
      console.log('✅ TESTE 5 PASSOU: Limite de segurança acionado e aviso incluído com sucesso!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 5 FALHOU: Aviso de limite não encontrado.\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 5 FALHOU com exceção:', err);
    falhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Resiliência (Um pedido existente + Um pedido não encontrado)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 6: Resiliência (Um pedido existente + Um pedido inexistente) ---');
  try {
    const msg = 'Qual o CPF do Thomaz? E me manda a certidão de óbito do Thomaz.';
    
    const res = await processarMensagemChat({
      mensagemUsuario: msg,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log('\n[Resposta VEGA]:');
    console.log(res.textoResposta);

    const textoLower = res.textoResposta.toLowerCase();
    const contemCpf = textoLower.includes('cpf') || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(res.textoResposta);
    const contemNaoEncontrado = textoLower.includes('não encontrei') || textoLower.includes('nao encontrei');

    if (contemCpf && contemNaoEncontrado) {
      console.log('✅ TESTE 6 PASSOU: Pedido existente foi respondido e pedido inexistente foi devidamente informado!\n');
      passou++;
    } else {
      console.error(`❌ TESTE 6 FALHOU: contemCpf=${contemCpf}, contemNaoEncontrado=${contemNaoEncontrado}\n`);
      falhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 6 FALHOU com exceção:', err);
    falhou++;
  }

  console.log('================================================================');
  console.log(`📊 RESULTADO FINAL DA BATERIA: ${passou} aprovados, ${falhou} falhas`);
  console.log('================================================================\n');

  if (falhou > 0) {
    process.exit(1);
  }
}

rodarTestesMultiplosPedidos();
