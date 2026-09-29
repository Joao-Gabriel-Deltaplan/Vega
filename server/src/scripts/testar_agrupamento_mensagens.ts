import dotenv from 'dotenv';
dotenv.config();

import {
  adicionarMensagemAoAgrupador,
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

  // Limpeza das conversas de teste geradas no Supabase
  console.log('Limpando conversas temporárias de teste no Supabase...');
  for (const cId of conversasCriadas) {
    try {
      await removerConversa(cId);
    } catch (_) {}
  }
  console.log(`Limpas ${conversasCriadas.length} conversas de teste.`);

  // Restaura configuração padrão de 7 segundos no Supabase
  await salvarConfiguracoesVega({
    promptPersona: 'Você é a assistente VEGA da Delta Plan.',
    temperaturaResposta: 0.1,
    tempoEsperaAgrupamentoSegundos: 7,
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
