import dotenv from 'dotenv';
dotenv.config();

import {
  adicionarMensagemAoAgrupador,
  notificarPresencaUsuarioNoAgrupador,
  MAX_MENSAGENS_AGRUPADAS,
  ItemMensagemAgrupada,
} from '../whatsapp/agrupadorMensagensService.js';
import { salvarConfiguracoesVega } from '../config/configuracoesVegaService.js';
import { obterConversaPorId, salvarConversa, removerConversa, adicionarMensagem, adicionarDocumento, removerDocumento } from '../storage.js';
import { Contato, Mensagem, DocumentoRegistro } from '../types.js';
import { UsuarioWhatsApp } from '../whatsapp/types.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function aguardarRespostaAssistente(conversaId: string, quantidadeEsperada: number, maxMs = 10000): Promise<Mensagem[]> {
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs) {
    const c = await obterConversaPorId(conversaId);
    const msgs = c?.mensagens.filter((m) => m.remetente === 'assistente') || [];
    if (msgs.length >= quantidadeEsperada) {
      return msgs;
    }
    await esperar(300);
  }
  const c = await obterConversaPorId(conversaId);
  return c?.mensagens.filter((m) => m.remetente === 'assistente') || [];
}

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 INICIANDO BATERIA DE TESTES: AGRUPAMENTO DE MENSAGENS (VEGA)');
  console.log('================================================================\n');

  // Ajusta temporariamente a configuração de tempo de espera para 2 segundos nos testes rápidos
  await salvarConfiguracoesVega({
    promptPersona: 'Você é a assistente VEGA da Delta Plan.',
    temperaturaResposta: 0.1,
    tempoEsperaAgrupamentoSegundos: 2,
    autorNome: 'Script de Teste',
    autorId: 'teste-script',
    gravarHistorico: false,
  });

  const usuarioTeste: UsuarioWhatsApp = {
    id: 'user-teste-agrupador',
    nome: 'Titular Teste',
    numero: '5511999990001',
    perfil: 'admin',
  };

  const contatoTeste: Contato = {
    id: 'ct-teste-agrupador',
    nome: 'Titular Teste',
    telefone: '5511999990001',
    avatarCor: '#25D366',
    cargo: 'Administrador',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
  };

  let totalPassou = 0;
  let totalFalhou = 0;
  const conversasCriadas: string[] = [];

  // --------------------------------------------------------------------------
  // TESTE 1: Duas mensagens de texto em sequência rápida -> 1 única resposta
  // --------------------------------------------------------------------------
  console.log('--- TESTE 1: Duas mensagens de texto consecutivas rápidas ---');
  try {
    const conversaId1 = `wa-teste-conversa-1-${Date.now()}`;
    conversasCriadas.push(conversaId1);
    await salvarConversa({
      id: conversaId1,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    const msg1: ItemMensagemAgrupada = {
      id: `msg-t1-1`,
      texto: 'Bom dia VEGA',
      tipoMensagem: 'texto',
    };
    const msg2: ItemMensagemAgrupada = {
      id: `msg-t1-2`,
      texto: 'Qual é o horário de atendimento?',
      tipoMensagem: 'texto',
    };

    // Grava as mensagens recebidas individualmente (Requisito 6)
    await adicionarMensagem(conversaId1, {
      id: msg1.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:00',
      timestamp: new Date().toISOString(),
      texto: msg1.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId1,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msg1,
    });

    // Envia segunda mensagem 500ms depois (dentro da janela de 2s)
    await esperar(500);

    await adicionarMensagem(conversaId1, {
      id: msg2.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:00',
      timestamp: new Date().toISOString(),
      texto: msg2.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId1,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msg2,
    });

    console.log('Aguardando conclusão do debounce e resposta da VEGA...');
    const msgsAssistente = await aguardarRespostaAssistente(conversaId1, 1);
    const conversaFinal1 = await obterConversaPorId(conversaId1);
    const msgsCliente = conversaFinal1?.mensagens.filter((m) => m.remetente === 'cliente') || [];

    console.log(`Total msgs cliente gravadas: ${msgsCliente.length} (esperado: 2 individualmente)`);
    console.log(`Total msgs assistente geradas: ${msgsAssistente.length} (esperado: 1 única resposta consolidada)`);

    if (msgsCliente.length === 2 && msgsAssistente.length === 1) {
      console.log('✅ TESTE 1 PASSOU: Ambas as mensagens foram gravadas individualmente e a VEGA gerou exatamente 1 resposta unificada!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 1 FALHOU: Esperava 1 resposta do assistente, recebeu ${msgsAssistente.length}\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 1 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Áudio transcrito + texto complementar
  // --------------------------------------------------------------------------
  console.log('--- TESTE 2: Áudio transcrito seguido de texto complementar ---');
  try {
    const conversaId2 = `wa-teste-conversa-2-${Date.now()}`;
    conversasCriadas.push(conversaId2);
    await salvarConversa({
      id: conversaId2,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    const msgAudio: ItemMensagemAgrupada = {
      id: `msg-t2-audio`,
      texto: 'Gostaria de saber uma informação',
      tipoMensagem: 'audio',
      duracaoAudioSegundos: 5,
      custoTranscricaoUsd: 0.0005,
      modeloTranscricao: 'gpt-transcribe',
      tempoTranscricaoMs: 800,
    };

    const msgTextoComplementar: ItemMensagemAgrupada = {
      id: `msg-t2-texto`,
      texto: 'sobre a empresa Delta Plan',
      tipoMensagem: 'texto',
    };

    await adicionarMensagem(conversaId2, {
      id: msgAudio.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:05',
      timestamp: new Date().toISOString(),
      texto: msgAudio.texto,
      tipoMensagem: 'audio',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId2,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgAudio,
    });

    await esperar(500);

    await adicionarMensagem(conversaId2, {
      id: msgTextoComplementar.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:05',
      timestamp: new Date().toISOString(),
      texto: msgTextoComplementar.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId2,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgTextoComplementar,
    });

    console.log('Aguardando conclusão do debounce e resposta da VEGA...');
    const msgsAssistente = await aguardarRespostaAssistente(conversaId2, 1);
    const conversaFinal2 = await obterConversaPorId(conversaId2);
    const msgsCliente = conversaFinal2?.mensagens.filter((m) => m.remetente === 'cliente') || [];

    console.log(`Total msgs cliente: ${msgsCliente.length}, Total assistente: ${msgsAssistente.length}`);

    if (msgsCliente.length === 2 && msgsAssistente.length === 1) {
      console.log('✅ TESTE 2 PASSOU: Áudio e texto unificados com sucesso em 1 única resposta!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 2 FALHOU: Esperava 1 resposta, recebeu ${msgsAssistente.length}\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 2 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Foto/Documento seguido de mensagem de texto ("é a CNH do Thomaz")
  // --------------------------------------------------------------------------
  console.log('--- TESTE 3: Documento seguido de texto ("é a CNH do Thomaz") ---');
  let docCriadoId: string | null = null;
  try {
    const conversaId3 = `wa-teste-conversa-3-${Date.now()}`;
    conversasCriadas.push(conversaId3);
    await salvarConversa({
      id: conversaId3,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    const docInserido = await adicionarDocumento({
      id: `doc-t3-${Date.now()}`,
      titulo: 'foto documento whatsapp',
      arquivo: 'foto_documento.jpg',
      tipo: '',
      titular: '',
      descricao: 'Foto recebida via WhatsApp',
      apelidos: ['foto_documento.jpg'],
      visibilidade: 'diretoria',
      tamanho: '50 KB',
      dataCadastro: new Date().toLocaleDateString('pt-BR'),
      statusIndexacao: 'processando',
      metadata: {
        origem: 'whatsapp',
        conversaId: conversaId3,
      },
    });

    docCriadoId = docInserido.id;

    const msgDoc: ItemMensagemAgrupada = {
      id: `msg-t3-doc`,
      texto: '',
      tipoMensagem: 'imagem',
      documentoId: docCriadoId,
      nomeArquivo: 'foto_documento.jpg',
      mensagemRespostaPadraoDoc: 'Recebi sua foto! Já foi salva no Cofre.',
    };

    const msgTextoLegenda: ItemMensagemAgrupada = {
      id: `msg-t3-legenda`,
      texto: 'é a CNH do Thomaz',
      tipoMensagem: 'texto',
    };

    // 1. Envia documento
    await adicionarMensagem(conversaId3, {
      id: msgDoc.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:10',
      timestamp: new Date().toISOString(),
      texto: 'Foto enviada',
      tipoMensagem: 'imagem',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId3,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgDoc,
    });

    // 2. Envia texto logo em seguida
    await esperar(500);

    await adicionarMensagem(conversaId3, {
      id: msgTextoLegenda.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:10',
      timestamp: new Date().toISOString(),
      texto: msgTextoLegenda.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId3,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgTextoLegenda,
    });

    console.log('Aguardando conclusão do debounce e resposta...');
    const msgsAssistente = await aguardarRespostaAssistente(conversaId3, 1);

    // Confere se o documento foi atualizado no banco
    const supabase = getSupabaseClient();
    const { data: docAtualizado } = await supabase
      .from('documentos')
      .select('*')
      .eq('id', docCriadoId)
      .maybeSingle();

    console.log(`Documento titular identificado: "${docAtualizado?.titular}", tipo: "${docAtualizado?.tipo}"`);
    console.log(`Resposta da VEGA: "${msgsAssistente[0]?.texto}"`);

    const titularIdentificadoOk = docAtualizado?.titular?.toLowerCase().includes('thomaz');
    const tipoIdentificadoOk = docAtualizado?.tipo?.toLowerCase().includes('cnh');
    const respostaUnicaOk = msgsAssistente.length === 1;

    if (titularIdentificadoOk && tipoIdentificadoOk && respostaUnicaOk) {
      console.log('✅ TESTE 3 PASSOU: A mensagem logo após a foto foi associada ao documento, atualizou o titular e tipo, e gerou 1 resposta única!\n');
      totalPassou++;
    } else {
      console.error('❌ TESTE 3 FALHOU:');
      console.error(`- Titular OK: ${titularIdentificadoOk} ("${docAtualizado?.titular}")`);
      console.error(`- Tipo OK: ${tipoIdentificadoOk} ("${docAtualizado?.tipo}")`);
      console.error(`- Resposta única OK: ${respostaUnicaOk} (${msgsAssistente.length})\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 3 ERRO:', err?.message || err);
    totalFalhou++;
  } finally {
    if (docCriadoId) {
      await removerDocumento(docCriadoId).catch(() => {});
    }
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Limite de segurança de 5 mensagens -> disparo imediato
  // --------------------------------------------------------------------------
  console.log('--- TESTE 4: Limite de segurança de 5 mensagens (disparo imediato) ---');
  try {
    const conversaId4 = `wa-teste-conversa-4-${Date.now()}`;
    conversasCriadas.push(conversaId4);
    await salvarConversa({
      id: conversaId4,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    // Envia 5 mensagens quase simultaneamente
    for (let i = 1; i <= MAX_MENSAGENS_AGRUPADAS; i++) {
      const msgItem: ItemMensagemAgrupada = {
        id: `msg-t4-${i}`,
        texto: `Mensagem ${i} de teste`,
        tipoMensagem: 'texto',
      };
      await adicionarMensagem(conversaId4, {
        id: msgItem.id,
        remetente: 'cliente',
        nomeRemetente: contatoTeste.nome,
        horario: '10:15',
        timestamp: new Date().toISOString(),
        texto: msgItem.texto,
        tipoMensagem: 'texto',
      });
      await adicionarMensagemAoAgrupador({
        conversaId: conversaId4,
        destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
        contato: contatoTeste,
        usuarioAutorizado: usuarioTeste,
        item: msgItem,
      });
    }

    const msgsAssistente = await aguardarRespostaAssistente(conversaId4, 1);
    const conversaFinal4 = await obterConversaPorId(conversaId4);
    const msgsCliente = conversaFinal4?.mensagens.filter((m) => m.remetente === 'cliente') || [];

    console.log(`Total cliente: ${msgsCliente.length}, Total assistente: ${msgsAssistente.length}`);

    if (msgsCliente.length === 5 && msgsAssistente.length === 1) {
      console.log('✅ TESTE 4 PASSOU: Ao atingir 5 mensagens, disparou o processamento e gerou 1 resposta única!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 4 FALHOU: Esperava 5 cliente e 1 assistente, obteve ${msgsCliente.length} e ${msgsAssistente.length}\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 4 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Mensagem que chega enquanto a VEGA já está processando (Fila)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 5: Mensagem durante o processamento (Fila pós-processamento) ---');
  try {
    const conversaId5 = `wa-teste-conversa-5-${Date.now()}`;
    conversasCriadas.push(conversaId5);
    await salvarConversa({
      id: conversaId5,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    // Envia lote 1
    const msgLote1: ItemMensagemAgrupada = {
      id: `msg-t5-1`,
      texto: 'Qual é o CNPJ da Delta Plan?',
      tipoMensagem: 'texto',
    };
    await adicionarMensagem(conversaId5, {
      id: msgLote1.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:20',
      timestamp: new Date().toISOString(),
      texto: msgLote1.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId5,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgLote1,
    });

    // Aguarda o timer de 2s disparar a chamada de processamento do Lote 1
    await esperar(2100);

    // Agora a VEGA está em processamento. Enviamos uma nova mensagem!
    const msgLote2: ItemMensagemAgrupada = {
      id: `msg-t5-2`,
      texto: 'E também qual o endereço da sede?',
      tipoMensagem: 'texto',
    };
    await adicionarMensagem(conversaId5, {
      id: msgLote2.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:20',
      timestamp: new Date().toISOString(),
      texto: msgLote2.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId5,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msgLote2,
    });

    console.log('Mensagem 2 enviada durante o processamento da 1. Aguardando conclusão de ambos os lotes...');
    const msgsAssistente = await aguardarRespostaAssistente(conversaId5, 2, 14000);

    console.log(`Total de respostas geradas pela VEGA: ${msgsAssistente.length} (esperado: 2, uma para cada lote)`);

    if (msgsAssistente.length === 2) {
      console.log('✅ TESTE 5 PASSOU: Mensagem enviada durante o processamento entrou na fila e gerou a segunda resposta perfeitamente, sem perda!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 5 FALHOU: Esperava 2 respostas do assistente, recebeu ${msgsAssistente.length}\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 5 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Duas mensagens consecutivas enviadas a 2s de intervalo com espera de 3s
  // --------------------------------------------------------------------------
  console.log('--- TESTE 6: Duas mensagens seguidas com 2s de intervalo (espera de 3s) ---');
  try {
    // Configura formalmente a espera padrão para 3 segundos
    await salvarConfiguracoesVega({
      promptPersona: 'Você é a assistente VEGA da Delta Plan.',
      temperaturaResposta: 0.1,
      tempoEsperaAgrupamentoSegundos: 3,
      autorNome: 'Script de Teste',
      autorId: 'teste-script',
      gravarHistorico: false,
    });

    const conversaId6 = `wa-teste-conversa-6-${Date.now()}`;
    conversasCriadas.push(conversaId6);
    await salvarConversa({
      id: conversaId6,
      contato: contatoTeste,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    const msg6A: ItemMensagemAgrupada = {
      id: `msg-t6-1`,
      texto: 'Olá VEGA, tudo bem?',
      tipoMensagem: 'texto',
    };
    const msg6B: ItemMensagemAgrupada = {
      id: `msg-t6-2`,
      texto: 'Qual é o nome da nossa empresa?',
      tipoMensagem: 'texto',
    };

    // Mensagem 1 enviada em t=0
    await adicionarMensagem(conversaId6, {
      id: msg6A.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:30',
      timestamp: new Date().toISOString(),
      texto: msg6A.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId6,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msg6A,
    });

    console.log('Mensagem 1 enviada. Aguardando exatamente 2000ms (2s) antes de enviar a mensagem 2...');
    await esperar(2000);

    // Mensagem 2 enviada em t=2s (dentro da janela de 3s)
    await adicionarMensagem(conversaId6, {
      id: msg6B.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: '10:30',
      timestamp: new Date().toISOString(),
      texto: msg6B.texto,
      tipoMensagem: 'texto',
    });
    await adicionarMensagemAoAgrupador({
      conversaId: conversaId6,
      destinatario: `${usuarioTeste.numero}@s.whatsapp.net`,
      contato: contatoTeste,
      usuarioAutorizado: usuarioTeste,
      item: msg6B,
    });

    console.log('Mensagem 2 enviada aos 2s de intervalo. Aguardando resposta unificada da VEGA...');
    const msgsAssistente = await aguardarRespostaAssistente(conversaId6, 1, 12000);
    const conversaFinal6 = await obterConversaPorId(conversaId6);
    const msgsCliente = conversaFinal6?.mensagens.filter((m) => m.remetente === 'cliente') || [];

    console.log(`Total msgs cliente: ${msgsCliente.length} (esperado: 2)`);
    console.log(`Total msgs assistente: ${msgsAssistente.length} (esperado: 1 única resposta consolidada)`);

    if (msgsCliente.length === 2 && msgsAssistente.length === 1) {
      console.log('✅ TESTE 6 PASSOU: Mensagens enviadas com 2s de intervalo foram perfeitamente agrupadas em 1 única resposta sob espera de 3s!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 6 FALHOU: Esperava 2 cliente e 1 assistente, obteve ${msgsCliente.length} cliente e ${msgsAssistente.length} assistente\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 6 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Presença do usuário ('composing') segura o lote e 'paused' dispara
  // --------------------------------------------------------------------------
  console.log('--- TESTE 7: Presença do usuário ("composing" aguarda e "paused" dispara) ---');
  try {
    const conversaId7 = `wa-teste-conversa-7-${Date.now()}`;
    const usuarioTeste7: UsuarioWhatsApp = {
      ...usuarioTeste,
      numero: '5511999990007',
    };
    const contatoTeste7: Contato = {
      ...contatoTeste,
      telefone: '5511999990007',
    };
    const destinatario7 = `${usuarioTeste7.numero}@s.whatsapp.net`;
    conversasCriadas.push(conversaId7);
    await salvarConversa({
      id: conversaId7,
      contato: contatoTeste7,
      naoLidas: 0,
      ultimaAtualizacao: new Date().toISOString(),
      mensagens: [],
    });

    const msg7: ItemMensagemAgrupada = {
      id: `msg-t7-1`,
      texto: 'Por favor, me informe o site oficial da Delta Plan.',
      tipoMensagem: 'texto',
    };

    await adicionarMensagem(conversaId7, {
      id: msg7.id,
      remetente: 'cliente',
      nomeRemetente: contatoTeste7.nome,
      horario: '10:35',
      timestamp: new Date().toISOString(),
      texto: msg7.texto,
      tipoMensagem: 'texto',
    });

    // Usuário notifica presença "composing" (está digitando mais coisas)
    notificarPresencaUsuarioNoAgrupador(destinatario7, 'composing');

    await adicionarMensagemAoAgrupador({
      conversaId: conversaId7,
      destinatario: destinatario7,
      contato: contatoTeste7,
      usuarioAutorizado: usuarioTeste7,
      item: msg7,
    });

    console.log('Mensagem enviada com usuário digitando. Aguardando 2.5s para confirmar que não dispara durante a digitação...');
    await esperar(2500);

    let cMeio = await obterConversaPorId(conversaId7);
    let msgsAssistMeio = cMeio?.mensagens.filter((m) => m.remetente === 'assistente') || [];
    console.log(`Respostas aos 2.5s com digitação ativa: ${msgsAssistMeio.length} (esperado: 0 - ainda aguardando)`);

    // Usuário agora parou de digitar (paused)
    console.log('Usuário parou de digitar ("paused"). Notificando agrupador e aguardando reserva de 3s...');
    notificarPresencaUsuarioNoAgrupador(destinatario7, 'paused');

    const msgsAssistente = await aguardarRespostaAssistente(conversaId7, 1, 10000);
    const conversaFinal7 = await obterConversaPorId(conversaId7);
    const msgsCliente = conversaFinal7?.mensagens.filter((m) => m.remetente === 'cliente') || [];

    if (msgsAssistMeio.length === 0 && msgsAssistente.length === 1 && msgsCliente.length === 1) {
      console.log('✅ TESTE 7 PASSOU: Eventos de presença integrados! Lote aguardou enquanto digitando e disparou após pausa com 1 única resposta!\n');
      totalPassou++;
    } else {
      console.error(`❌ TESTE 7 FALHOU: Respostas antes: ${msgsAssistMeio.length}, Respostas finais: ${msgsAssistente.length}\n`);
      totalFalhou++;
    }
  } catch (err: any) {
    console.error('❌ TESTE 7 ERRO:', err?.message || err);
    totalFalhou++;
  }

  // Limpeza das conversas de teste geradas no Supabase
  console.log('Limpando conversas temporárias de teste no Supabase...');
  for (const cId of conversasCriadas) {
    try {
      await removerConversa(cId);
    } catch (_) {}
  }
  console.log(`Limpas ${conversasCriadas.length} conversas de teste.`);

  // Restaura configuração padrão de 3 segundos no Supabase
  await salvarConfiguracoesVega({
    promptPersona: 'Você é a assistente VEGA da Delta Plan.',
    temperaturaResposta: 0.1,
    tempoEsperaAgrupamentoSegundos: 3,
    autorNome: 'Script de Teste',
    autorId: 'teste-script',
    gravarHistorico: false,
  });

  console.log('================================================================');
  console.log(`RESULTADO FINAL: ${totalPassou} PASSOU | ${totalFalhou} FALHOU`);
  console.log('================================================================');

  if (totalFalhou > 0) {
    process.exit(1);
  }
}

rodarTestes().catch((e) => {
  console.error('Erro fatal no executor de testes:', e);
  process.exit(1);
});
