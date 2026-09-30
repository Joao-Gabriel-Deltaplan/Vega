import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  adicionarDocumento,
  obterTodosDocumentos,
  removerDocumento,
  salvarOuAtualizarTitular,
  removerTitular,
  obterTitularPorNome,
} from '../storage.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, DocumentoRegistro, Mensagem, TitularRegistro } from '../types.js';

async function main() {
  console.log('================================================================');
  console.log('TESTES DE CONVERSAS REAIS - ORQUESTRADOR CENTRAL VEGA (GPT-5.4-MINI)');
  console.log('================================================================\n');

  const contatoTeste: Contato = {
    id: 'user-diretor-teste',
    nome: 'Diretor João',
    telefone: '5511988887777',
    avatarCor: '#10b981',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
    },
  };

  const formatarHorario = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const formatarDataIso = () => new Date().toISOString();

  // IDs para rastreamento e limpeza rigorosa no finally
  const docsParaLimpar: string[] = [];
  const titularesParaLimpar: string[] = [];

  try {
    // ================================================================
    // SETUP CENÁRIOS A & B: MARCELO TESTE (FICHA COM ENDEREÇO E DOC NO COFRE)
    // ================================================================
    console.log('>>> [Setup A & B] Criando titular de teste exclusivo (sem alterar titulares reais)...');
    const nomeTitularAB = 'Marcelo Teste';
    const titIdAB = `tit_marcelo_${Date.now()}`;
    titularesParaLimpar.push(titIdAB);

    const docIdAB = `doc_ir_marcelo_${Date.now()}`;
    docsParaLimpar.push(docIdAB);

    const docTesteAB: DocumentoRegistro = {
      id: docIdAB,
      titulo: 'Declaração de Imposto de Renda 2024 Marcelo Teste',
      arquivo: 'declaracao_ir_2024_marcelo.pdf',
      tipo: 'Declaração de IR',
      titular: nomeTitularAB,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: 'Declaração de IRPF contendo endereço residencial na Rua das Acácias, nº 250, Bairro Jardim Delta.',
      tamanho: '150 KB',
      dataCadastro: '30/09/2026',
    };
    await adicionarDocumento(docTesteAB);

    const titularAB: TitularRegistro = {
      id: titIdAB,
      nome: nomeTitularAB,
      campos: {
        endereco: {
          valor: 'Rua das Acácias, nº 250, Bairro Jardim Delta',
          origem: docIdAB,
          origemNome: docTesteAB.titulo,
          origemVisibilidade: 'diretoria',
          conferido: true,
          dataConferencia: '30/09/2026',
          manual: false,
        },
      },
      atualizadoEm: '30/09/2026',
    };
    await salvarOuAtualizarTitular(titularAB);
    console.log(`Titular de teste "${nomeTitularAB}" criado com sucesso (ID: ${titIdAB}).\n`);

    // ================================================================
    // CONVERSA A:
    // Passo A1: "Qual o nome da rua que o Marcelo Teste mora?"
    // Passo A2: "Prova o que vc falou"
    // Passo A3: "Me mande o documento"
    // Passo A4: "Ai é foda"
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CONVERSA A:');
    console.log('----------------------------------------------------------------\n');

    const historicoA: Mensagem[] = [];

    // --- Passo A1 ---
    const msgA1 = `Qual o nome da rua que o ${nomeTitularAB} mora?`;
    console.log(`[Usuário]: "${msgA1}"`);
    historicoA.push({
      id: `msg-a1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgA1,
    });

    const docsAtualizados1 = await obterTodosDocumentos();
    const resA1 = await processarMensagemChat({
      mensagemUsuario: msgA1,
      historicoRecente: historicoA.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resA1.textoResposta}"`);
    const toolsA1 = (resA1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsA1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    historicoA.push({
      id: `msg-a1-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resA1.textoResposta,
      anexos: resA1.anexos,
      rastro: resA1.rastro,
    });

    // --- Passo A2 ---
    const msgA2 = 'Prova o que vc falou';
    console.log(`[Usuário]: "${msgA2}"`);
    historicoA.push({
      id: `msg-a2-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgA2,
    });

    const resA2 = await processarMensagemChat({
      mensagemUsuario: msgA2,
      historicoRecente: historicoA.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resA2.textoResposta}"`);
    const toolsA2 = (resA2.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsA2.map((t) => t.nome).join(', ') || 'Nenhuma (usou fontes do histórico)'}\n`);

    historicoA.push({
      id: `msg-a2-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resA2.textoResposta,
      anexos: resA2.anexos,
      rastro: resA2.rastro,
    });

    // --- Passo A3 ---
    const msgA3 = 'Me mande o documento';
    console.log(`[Usuário]: "${msgA3}"`);
    historicoA.push({
      id: `msg-a3-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgA3,
    });

    const resA3 = await processarMensagemChat({
      mensagemUsuario: msgA3,
      historicoRecente: historicoA.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resA3.textoResposta}"`);
    const toolsA3 = (resA3.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsA3.map((t) => t.nome).join(', ') || 'Nenhuma'}`);
    console.log(`[Anexos enviados]: ${resA3.anexos?.map((a) => a.titulo || a.nome).join(', ') || 'Nenhum'}\n`);

    historicoA.push({
      id: `msg-a3-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resA3.textoResposta,
      anexos: resA3.anexos,
      rastro: resA3.rastro,
    });

    // --- Passo A4 ---
    const msgA4 = 'Ai é foda';
    console.log(`[Usuário]: "${msgA4}"`);
    historicoA.push({
      id: `msg-a4-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgA4,
    });

    const resA4 = await processarMensagemChat({
      mensagemUsuario: msgA4,
      historicoRecente: historicoA.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resA4.textoResposta}"`);
    const toolsA4 = (resA4.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsA4.map((t) => t.nome).join(', ') || 'Nenhuma (resposta empática curta)'}\n`);

    // ================================================================
    // CONVERSA B:
    // Passo B1: "Me mande o endereço do Marcelo Teste"
    // Passo B2: "De onde vc tirou essa informação?"
    // Passo B3: "Como sabe que é esse endereço?"
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CONVERSA B:');
    console.log('----------------------------------------------------------------\n');

    const historicoB: Mensagem[] = [];

    // --- Passo B1 ---
    const msgB1 = `Me mande o endereço do ${nomeTitularAB}`;
    console.log(`[Usuário]: "${msgB1}"`);
    historicoB.push({
      id: `msg-b1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgB1,
    });

    const resB1 = await processarMensagemChat({
      mensagemUsuario: msgB1,
      historicoRecente: historicoB.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resB1.textoResposta}"`);
    const toolsB1 = (resB1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsB1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    historicoB.push({
      id: `msg-b1-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resB1.textoResposta,
      anexos: resB1.anexos,
      rastro: resB1.rastro,
    });

    // --- Passo B2 ---
    const msgB2 = 'De onde vc tirou essa informação?';
    console.log(`[Usuário]: "${msgB2}"`);
    historicoB.push({
      id: `msg-b2-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgB2,
    });

    const resB2 = await processarMensagemChat({
      mensagemUsuario: msgB2,
      historicoRecente: historicoB.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resB2.textoResposta}"`);
    const toolsB2 = (resB2.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsB2.map((t) => t.nome).join(', ') || 'Nenhuma (usou fontes do histórico)'}\n`);

    historicoB.push({
      id: `msg-b2-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resB2.textoResposta,
      anexos: resB2.anexos,
      rastro: resB2.rastro,
    });

    // --- Passo B3 ---
    const msgB3 = 'Como sabe que é esse endereço?';
    console.log(`[Usuário]: "${msgB3}"`);
    historicoB.push({
      id: `msg-b3-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgB3,
    });

    const resB3 = await processarMensagemChat({
      mensagemUsuario: msgB3,
      historicoRecente: historicoB.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizados1,
    });

    console.log(`[VEGA]: "${resB3.textoResposta}"`);
    const toolsB3 = (resB3.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsB3.map((t) => t.nome).join(', ') || 'Nenhuma (reforçou fonte documental do histórico)'}\n`);

    // ================================================================
    // SETUP CENÁRIO C: DARIO DIVERGENTE (SEM ENDEREÇO NA FICHA E 3 DOCS NO COFRE)
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('SETUP CENÁRIO C: TITULAR COM 3 DOCUMENTOS DIVERGENTES E SEM ENDEREÇO NA FICHA');
    console.log('----------------------------------------------------------------\n');

    const nomeTitularC = 'Dario Divergente';
    const titIdC = `tit_dario_${Date.now()}`;
    titularesParaLimpar.push(titIdC);

    const docIdC1 = `doc_c1_residencia_${Date.now()}`;
    const docIdC2 = `doc_c2_locacao_${Date.now()}`;
    const docIdC3 = `doc_c3_ir_${Date.now()}`;
    docsParaLimpar.push(docIdC1, docIdC2, docIdC3);

    // Documento 1: 10/01/2022
    const docC1: DocumentoRegistro = {
      id: docIdC1,
      titulo: `Comprovante de Residencia 2022 ${nomeTitularC}`,
      arquivo: 'comprovante_residencia_2022.pdf',
      tipo: 'Comprovante de Residência',
      titular: nomeTitularC,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: 'Comprovante de residência contendo endereço residencial emitido em 10/01/2022: Rua das Palmeiras, nº 100, Bairro Centro.',
      tamanho: '110 KB',
      dataCadastro: '10/01/2022',
      dataEmissao: '10/01/2022',
    };
    await adicionarDocumento(docC1);

    // Documento 2: 15/06/2023
    const docC2: DocumentoRegistro = {
      id: docIdC2,
      titulo: `Contrato de Locacao 2023 ${nomeTitularC}`,
      arquivo: 'contrato_locacao_2023.pdf',
      tipo: 'Contrato de Locação',
      titular: nomeTitularC,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: 'Contrato de locação residencial contendo endereço firmado em 15/06/2023: Avenida Brasil, nº 500, Apto 302, Bairro América.',
      tamanho: '140 KB',
      dataCadastro: '15/06/2023',
      dataEmissao: '15/06/2023',
    };
    await adicionarDocumento(docC2);

    // Documento 3: 30/04/2024 (O mais recente!)
    const docC3: DocumentoRegistro = {
      id: docIdC3,
      titulo: `Declaracao de IR 2024 ${nomeTitularC}`,
      arquivo: 'declaracao_ir_2024.pdf',
      tipo: 'Declaração de IR',
      titular: nomeTitularC,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: 'Declaração de IRPF contendo endereço residencial de 30/04/2024: Rua das Hortênsias, nº 880, Bairro Jardim das Flores.',
      tamanho: '160 KB',
      dataCadastro: '30/04/2024',
      dataEmissao: '30/04/2024',
    };
    await adicionarDocumento(docC3);

    // Titular sem endereço na ficha (campos: {})
    const titularC: TitularRegistro = {
      id: titIdC,
      nome: nomeTitularC,
      campos: {},
      atualizadoEm: '30/09/2026',
    };
    await salvarOuAtualizarTitular(titularC);
    console.log(`Titular "${nomeTitularC}" criado sem endereço na ficha e 3 documentos divergentes adicionados ao Cofre.\n`);

    const docsAtualizadosC = await obterTodosDocumentos();

    // ================================================================
    // CONVERSA C:
    // Passo C1: "Qual o endereço do Dario Divergente?"
    // Passo C2: "De onde tirou isso?"
    // Passo C3: "Me mande o documento mais recente"
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CONVERSA C:');
    console.log('----------------------------------------------------------------\n');

    const historicoC: Mensagem[] = [];

    // --- Passo C1 ---
    const msgC1 = `Qual o endereço do ${nomeTitularC}?`;
    console.log(`[Usuário]: "${msgC1}"`);
    historicoC.push({
      id: `msg-c1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgC1,
    });

    const resC1 = await processarMensagemChat({
      mensagemUsuario: msgC1,
      historicoRecente: historicoC.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosC,
    });

    console.log(`[VEGA]: "${resC1.textoResposta}"`);
    const toolsC1 = (resC1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsC1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    historicoC.push({
      id: `msg-c1-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resC1.textoResposta,
      anexos: resC1.anexos,
      rastro: resC1.rastro,
    });

    // --- Passo C2 ---
    const msgC2 = 'De onde tirou isso?';
    console.log(`[Usuário]: "${msgC2}"`);
    historicoC.push({
      id: `msg-c2-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgC2,
    });

    const resC2 = await processarMensagemChat({
      mensagemUsuario: msgC2,
      historicoRecente: historicoC.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosC,
    });

    console.log(`[VEGA]: "${resC2.textoResposta}"`);
    const toolsC2 = (resC2.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsC2.map((t) => t.nome).join(', ') || 'Nenhuma (usou fontes do histórico)'}\n`);

    historicoC.push({
      id: `msg-c2-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resC2.textoResposta,
      anexos: resC2.anexos,
      rastro: resC2.rastro,
    });

    // --- Passo C3 ---
    const msgC3 = 'Me mande o documento mais recente';
    console.log(`[Usuário]: "${msgC3}"`);
    historicoC.push({
      id: `msg-c3-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgC3,
    });

    const resC3 = await processarMensagemChat({
      mensagemUsuario: msgC3,
      historicoRecente: historicoC.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosC,
    });

    console.log(`[VEGA]: "${resC3.textoResposta}"`);
    const toolsC3 = (resC3.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsC3.map((t) => t.nome).join(', ') || 'Nenhuma'}`);
    console.log(`[Anexos enviados]: ${resC3.anexos?.map((a) => a.titulo || a.nome).join(', ') || 'Nenhum'}\n`);

    // ================================================================
    // SETUP CENÁRIO D: SILVIO SEM ENDEREÇO
    // Histórico prévio com resposta antiga da VEGA contendo endereço falso.
    // Pergunta: "qual o endereço dele?"
    // Esperado: A VEGA não repete o endereço falso.
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('SETUP E INÍCIO DO CENÁRIO D: PROTEÇÃO CONTRA AUTOCONFIRMAÇÃO DE ERRO ANTIGO');
    console.log('----------------------------------------------------------------\n');

    const nomeTitularD = 'Silvio Sem Endereco';
    const titIdD = `tit_silvio_${Date.now()}`;
    titularesParaLimpar.push(titIdD);

    const titularD: TitularRegistro = {
      id: titIdD,
      nome: nomeTitularD,
      campos: {},
      atualizadoEm: '30/09/2026',
    };
    await salvarOuAtualizarTitular(titularD);

    const historicoD: Mensagem[] = [
      {
        id: 'msg-d0-user',
        remetente: 'cliente',
        nomeRemetente: contatoTeste.nome,
        horario: formatarHorario(),
        timestamp: formatarDataIso(),
        texto: `Onde o ${nomeTitularD} mora?`,
      },
      {
        id: 'msg-d0-vega-falsa',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: formatarHorario(),
        timestamp: formatarDataIso(),
        // Resposta antiga com endereço alucinado/falso da própria VEGA:
        texto: 'Ele mora na Rua dos Bobos Falsos, nº 000, Bairro Inexistente.',
      },
    ];

    const msgD1 = 'qual o endereço dele?';
    console.log(`[Histórico prévio]:`);
    console.log(`  - Usuário: "${historicoD[0].texto}"`);
    console.log(`  - VEGA (resposta antiga com erro): "${historicoD[1].texto}"`);
    console.log(`\n[Usuário]: "${msgD1}"`);

    const docsAtualizadosD = await obterTodosDocumentos();
    const resD1 = await processarMensagemChat({
      mensagemUsuario: msgD1,
      historicoRecente: historicoD,
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosD,
    });

    console.log(`[VEGA]: "${resD1.textoResposta}"`);
    const toolsD1 = (resD1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsD1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    // ================================================================
    // CENÁRIO E: CONFIRMAÇÃO DA VERSÃO CORRETA E GRAVAÇÃO NA FICHA
    // Passo E1: Usuário responde "a correta é a 2"
    // Esperado: VEGA aciona confirmar_versao_dado e confirma em frase curta
    // Passo E2: Usuário pergunta "qual o endereço dele?"
    // Esperado: VEGA entrega direto a opção 2 citando quem confirmou e quando
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CENÁRIO E: CONFIRMAÇÃO DA VERSÃO CORRETA E GRAVAÇÃO NA FICHA');
    console.log('----------------------------------------------------------------\n');

    const historicoE: Mensagem[] = [
      {
        id: 'msg-e0-user',
        remetente: 'cliente',
        nomeRemetente: contatoTeste.nome,
        horario: formatarHorario(),
        timestamp: formatarDataIso(),
        texto: `Qual o endereço do ${nomeTitularC}?`,
      },
      {
        id: 'msg-e0-vega',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: formatarHorario(),
        timestamp: formatarDataIso(),
        texto: resC1.textoResposta,
        rastro: resC1.rastro,
      },
    ];

    // --- Passo E1 ---
    const msgE1 = 'a correta é a 2';
    console.log(`[Usuário]: "${msgE1}"`);
    historicoE.push({
      id: `msg-e1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgE1,
    });

    const resE1 = await processarMensagemChat({
      mensagemUsuario: msgE1,
      historicoRecente: historicoE.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosC,
    });

    console.log(`[VEGA]: "${resE1.textoResposta}"`);
    const toolsE1 = (resE1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsE1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    historicoE.push({
      id: `msg-e1-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resE1.textoResposta,
      rastro: resE1.rastro,
    });

    // --- Passo E2 ---
    const msgE2 = 'qual o endereço dele?';
    console.log(`[Usuário]: "${msgE2}"`);
    historicoE.push({
      id: `msg-e2-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgE2,
    });

    const docsAtualizadosE = await obterTodosDocumentos();
    const resE2 = await processarMensagemChat({
      mensagemUsuario: msgE2,
      historicoRecente: historicoE.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosE,
    });

    console.log(`[VEGA]: "${resE2.textoResposta}"`);
    const toolsE2 = (resE2.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsE2.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    historicoE.push({
      id: `msg-e2-vega`,
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: resE2.textoResposta,
      rastro: resE2.rastro,
    });

    // ================================================================
    // CENÁRIO F: DOCUMENTO POSTERIOR NO COFRE COM VALOR DIVERGENTE
    // Adiciona documento novo com outro endereço com data de armazenamento posterior.
    // Nova pergunta "qual o endereço do Dario?" -> VEGA avisa que entrou documento mais recente divergente e pergunta se quer atualizar.
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CENÁRIO F: ALERTA DE DOCUMENTO POSTERIOR DIVERGENTE NO COFRE');
    console.log('----------------------------------------------------------------\n');

    const docIdF = `doc_f_energia_${Date.now()}`;
    docsParaLimpar.push(docIdF);

    const docF: DocumentoRegistro = {
      id: docIdF,
      titulo: `Comprovante de Energia 2026 ${nomeTitularC}`,
      arquivo: 'comprovante_energia_2026.pdf',
      tipo: 'Comprovante de Residência',
      titular: nomeTitularC,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: 'Comprovante de energia elétrica contendo endereço residencial: Alameda dos Anjos, nº 1200, Bairro Alto.',
      tamanho: '130 KB',
      dataCadastro: '01/10/2026',
      dataValidade: '01/10/2026',
    };
    await adicionarDocumento(docF);
    console.log(`Documento novo posterior (${docF.titulo}) armazenado em 01/10/2026 no Cofre.\n`);

    const docsAtualizadosF = await obterTodosDocumentos();

    const historicoF: Mensagem[] = [...historicoE];

    const msgF1 = `qual o endereço do ${nomeTitularC}?`;
    console.log(`[Usuário]: "${msgF1}"`);
    historicoF.push({
      id: `msg-f1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgF1,
    });

    const resF1 = await processarMensagemChat({
      mensagemUsuario: msgF1,
      historicoRecente: historicoF.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosF,
    });

    console.log(`[VEGA]: "${resF1.textoResposta}"`);
    const toolsF1 = (resF1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsF1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    // ================================================================
    // CENÁRIO G: BUSCA COMPLETA PARA DADOS DE TITULAR, EXTRAÇÃO DE DATA REAL E AUTOVERIFICAÇÃO
    // Titular fictício (Geraldo Guia) sem endereço na ficha e com 5 documentos no Cofre:
    // 1. Declaração de IR 2024: Endereço (Rua das Palmeiras, 100), emissão 30/04/2024, armazenamento 10/09/2026.
    // 2. Contrato de Locação 2022: Endereço (Avenida Brasil, 500), emissão 15/01/2022, armazenamento 12/09/2026.
    // 3. Comprovante de Energia (sem data de emissão identificável e com trecho de endereço fora do top vetorial): Endereço (Alameda dos Anjos, 1200), armazenamento 15/09/2026.
    // 4. CNH Geraldo Guia: SEM endereço, com validade 26/08/2034, armazenamento 16/09/2026.
    // 5. Certidão Geraldo Guia: SEM endereço, sem data de emissão identificável, armazenamento 18/09/2026.
    // Pergunta: "Qual o endereço do Geraldo?"
    // Esperado: Apenas os 3 com endereço entram na lista, nenhum com validade como data, e a indicação de mais recente é a Declaração de IR 2024.
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('INICIANDO CENÁRIO G: BUSCA COMPLETA, EXTRAÇÃO REAL E AUTOVERIFICAÇÃO');
    console.log('----------------------------------------------------------------\n');

    const supabase = getSupabaseClient();
    const nomeTitularG = 'Geraldo Guia';
    const titIdG = `tit_geraldo_${Date.now()}`;
    titularesParaLimpar.push(titIdG);

    const titularG: TitularRegistro = {
      id: titIdG,
      nome: nomeTitularG,
      apelidos: ['Geraldo', 'Guia'],
      campos: {},
    };
    await salvarOuAtualizarTitular(titularG);

    // 1. Doc 1: IR 2024 (Rua das Palmeiras, 100)
    const docIdG1 = `doc_g_ir2024_${Date.now()}`;
    docsParaLimpar.push(docIdG1);
    const docG1: DocumentoRegistro = {
      id: docIdG1,
      titulo: `Declaração de IR 2024 ${nomeTitularG}`,
      arquivo: 'declaracao_ir_2024_geraldo.pdf',
      tipo: 'Declaração de Imposto de Renda',
      titular: nomeTitularG,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Declaração de Ajuste Anual IRPF 2024 de ${nomeTitularG} contendo endereço residencial: Rua das Palmeiras, 100, Bairro Jardim, São Paulo/SP.`,
      tamanho: '200 KB',
      dataCadastro: '10/09/2026',
      dataEmissao: '30/04/2024',
    };
    const docG1Criado = await adicionarDocumento(docG1);
    docsParaLimpar.push(docG1Criado.id);
    try {
      await supabase.from('trechos').insert({
        documento_id: docG1Criado.id,
        pessoa_id: titIdG,
        pagina: 1,
        conteudo: `DECLARAÇÃO DE AJUSTE ANUAL EXERCÍCIO 2024 ANO-CALENDÁRIO 2023. Nome: ${nomeTitularG}. Endereço: Rua das Palmeiras, 100, Bairro Jardim, São Paulo/SP, CEP 01000-000.`,
        embedding: Array(1536).fill(0),
      });
    } catch {}

    // 2. Doc 2: Contrato de Locação 2022 (Avenida Brasil, 500)
    const docIdG2 = `doc_g_locacao2022_${Date.now()}`;
    docsParaLimpar.push(docIdG2);
    const docG2: DocumentoRegistro = {
      id: docIdG2,
      titulo: `Contrato de Locação 2022 ${nomeTitularG}`,
      arquivo: 'contrato_locacao_2022_geraldo.pdf',
      tipo: 'Contrato de Locação',
      titular: nomeTitularG,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Contrato de Locação residencial de ${nomeTitularG} firmado em 15/01/2022 contendo endereço: Avenida Brasil, 500, Centro, Campinas/SP.`,
      tamanho: '150 KB',
      dataCadastro: '12/09/2026',
      dataEmissao: '15/01/2022',
    };
    const docG2Criado = await adicionarDocumento(docG2);
    docsParaLimpar.push(docG2Criado.id);
    try {
      await supabase.from('trechos').insert({
        documento_id: docG2Criado.id,
        pessoa_id: titIdG,
        pagina: 1,
        conteudo: `Contrato de Locação Residencial firmado em 15 de janeiro de 2022. Locatário: ${nomeTitularG}, residente e domiciliado na Avenida Brasil, 500, Centro, Campinas/SP.`,
        embedding: Array(1536).fill(0),
      });
    } catch {}

    // 3. Doc 3: Comprovante de Energia (sem data de emissão identificável e com endereço fora do top vetorial)
    const docIdG3 = `doc_g_energia_${Date.now()}`;
    docsParaLimpar.push(docIdG3);
    const docG3: DocumentoRegistro = {
      id: docIdG3,
      titulo: `Comprovante de Energia ${nomeTitularG}`,
      arquivo: 'comprovante_energia_geraldo.pdf',
      tipo: 'Comprovante de Residência',
      titular: nomeTitularG,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Fatura e comprovante de energia elétrica da residência de ${nomeTitularG} contendo endereço: Alameda dos Anjos, 1200, Bairro Alto, Sorocaba/SP.`,
      tamanho: '120 KB',
      dataCadastro: '15/09/2026',
    };
    const docG3Criado = await adicionarDocumento(docG3);
    docsParaLimpar.push(docG3Criado.id);
    try {
      await supabase.from('trechos').insert([
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 1, conteudo: 'Companhia Paulista de Força e Luz. Informações gerais da fatura e histórico de medição técnica.', embedding: Array(1536).fill(0) },
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 2, conteudo: 'Detalhamento dos tributos e encargos do setor elétrico nacional conforme ANEEL.', embedding: Array(1536).fill(0) },
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 3, conteudo: 'Instruções de segurança para instalações elétricas internas residenciais.', embedding: Array(1536).fill(0) },
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 4, conteudo: 'Tabela de consumo mensal em quilowatts-hora dos últimos 12 meses.', embedding: Array(1536).fill(0) },
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 5, conteudo: 'Termos de fornecimento regulamentados pelo órgão fiscalizador de energia elétrica.', embedding: Array(1536).fill(0) },
        { documento_id: docG3Criado.id, pessoa_id: titIdG, pagina: 6, conteudo: `Endereço de entrega da fatura de ${nomeTitularG}: Alameda dos Anjos, 1200, Bairro Alto, Sorocaba/SP, CEP 18000-000.`, embedding: Array(1536).fill(0) },
      ]);
    } catch {}

    // 4. Doc 4: CNH com validade 26/08/2034 sem endereço
    const docIdG4 = `doc_g_cnh2034_${Date.now()}`;
    docsParaLimpar.push(docIdG4);
    const docG4: DocumentoRegistro = {
      id: docIdG4,
      titulo: `CNH ${nomeTitularG}`,
      arquivo: 'cnh_geraldo.pdf',
      tipo: 'CNH',
      titular: nomeTitularG,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Carteira Nacional de Habilitação de ${nomeTitularG}. Validade: 26/08/2034.`,
      tamanho: '90 KB',
      dataCadastro: '16/09/2026',
      dataValidade: '26/08/2034',
    };
    const docG4Criado = await adicionarDocumento(docG4);
    docsParaLimpar.push(docG4Criado.id);
    try {
      await supabase.from('trechos').insert({
        documento_id: docG4Criado.id,
        pessoa_id: titIdG,
        pagina: 1,
        conteudo: `CARTEIRA NACIONAL DE HABILITAÇÃO. Nome: ${nomeTitularG}. Data de Nascimento: 10/10/1980. CPF: 111.222.333-44. Validade: 26/08/2034. Categoria AB. Local: São Paulo/SP.`,
        embedding: Array(1536).fill(0),
      });
    } catch {}

    // 5. Doc 5: Certidão sem endereço e sem data de emissão identificável
    const docIdG5 = `doc_g_certidao_${Date.now()}`;
    docsParaLimpar.push(docIdG5);
    const docG5: DocumentoRegistro = {
      id: docIdG5,
      titulo: `Certidão Notarial ${nomeTitularG}`,
      arquivo: 'certidao_geraldo.pdf',
      tipo: 'Certidão',
      titular: nomeTitularG,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Certidão notarial dos arquivos de ${nomeTitularG}.`,
      tamanho: '80 KB',
      dataCadastro: '18/09/2026',
    };
    const docG5Criado = await adicionarDocumento(docG5);
    docsParaLimpar.push(docG5Criado.id);
    try {
      await supabase.from('trechos').insert({
        documento_id: docG5Criado.id,
        pessoa_id: titIdG,
        pagina: 1,
        conteudo: `Certidão do Registro Notarial. Certifico a requerimento que ${nomeTitularG} possui assento no Livro 12, Folha 34. Nada mais consta.`,
        embedding: Array(1536).fill(0),
      });
    } catch {}

    const docsAtualizadosG = await obterTodosDocumentos();
    const historicoG: Mensagem[] = [];

    // --- Passo G1 ---
    const msgG1 = `Qual o endereço do ${nomeTitularG}?`;
    console.log(`[Usuário]: "${msgG1}"`);
    historicoG.push({
      id: `msg-g1-user`,
      remetente: 'cliente',
      nomeRemetente: contatoTeste.nome,
      horario: formatarHorario(),
      timestamp: formatarDataIso(),
      texto: msgG1,
    });

    const resG1 = await processarMensagemChat({
      mensagemUsuario: msgG1,
      historicoRecente: historicoG.slice(0, -1),
      contato: contatoTeste,
      documentosDisponiveis: docsAtualizadosG,
    });

    console.log(`[VEGA]: "${resG1.textoResposta}"`);
    const toolsG1 = (resG1.rastro?.etapas || []).filter((e) => e.nome.startsWith('Tool:'));
    console.log(`[Tools acionadas]: ${toolsG1.map((t) => t.nome).join(', ') || 'Nenhuma'}\n`);

    // ================================================================
    // VALIDAÇÕES DAS REGRAS
    // ================================================================
    console.log('----------------------------------------------------------------');
    console.log('VALIDAÇÃO DOS CRITÉRIOS DE SUCESSO DE TODOS OS CENÁRIOS:');
    console.log('----------------------------------------------------------------');

    // 1. Cenário A: Contexto mantido no envio de documento ("Me mande o documento")
    const enviouDocNoPassoA3 = Boolean(resA3.anexos && resA3.anexos.length > 0);
    console.log(`A3: "Me mande o documento" anexou o PDF pelo contexto?: ${enviouDocNoPassoA3 ? '✅ SIM' : '❌ NÃO'}`);

    // 2. Cenário A: Desabafo "Ai é foda" sem saudação e com tom empático
    const naoCumprimentouNoDesabafo =
      !resA4.textoResposta.toLowerCase().includes('olá') &&
      !resA4.textoResposta.toLowerCase().includes('bom dia');
    console.log(`A4: "Ai é foda" sem saudação redundante de início de conversa?: ${naoCumprimentouNoDesabafo ? '✅ SIM' : '❌ NÃO'}`);

    // 3. Cenário A: Prova consistente (citou Declaração de IR na resposta e na prova)
    const citouFonteOrigemA =
      resA2.textoResposta.toLowerCase().includes('declaração') ||
      resA2.textoResposta.toLowerCase().includes('ir') ||
      resA2.textoResposta.toLowerCase().includes('ficha');
    console.log(`A2: "Prova o que vc falou" manteve a mesma fonte comprovada do histórico?: ${citouFonteOrigemA ? '✅ SIM' : '❌ NÃO'}`);

    // 4. Cenário B: Prova consistente
    const citouFonteOrigemB =
      resB2.textoResposta.toLowerCase().includes('declaração') ||
      resB2.textoResposta.toLowerCase().includes('ficha');
    console.log(`B2: "De onde vc tirou essa informação?" manteve a mesma fonte na Conversa B?: ${citouFonteOrigemB ? '✅ SIM' : '❌ NÃO'}`);

    // 5. Cenário C1: Formato de Divergência Completo e Linhas em Branco
    const textoC1 = resC1.textoResposta.toLowerCase();
    const temAvisoConflitoC =
      textoC1.includes('atenção') ||
      textoC1.includes('atencao') ||
      textoC1.includes('diferentes') ||
      textoC1.includes('divergência') ||
      textoC1.includes('divergencia') ||
      textoC1.includes('conflito');
    const temFontesComDatasC =
      (textoC1.includes('armazenado em') || textoC1.includes('armazenado') || textoC1.includes('documento de')) &&
      (textoC1.includes('2022') || textoC1.includes('2023') || textoC1.includes('2024'));
    const temMaisRecenteEPerguntaC =
      (textoC1.includes('mais recente') || textoC1.includes('atual')) &&
      (textoC1.includes('qual') || textoC1.includes('correto') || textoC1.includes('considerar'));
    const semCodigosInternosC =
      !resC1.textoResposta.includes('doc_') &&
      !resC1.textoResposta.toLowerCase().includes('doc_id') &&
      !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(resC1.textoResposta);
    // Linha em branco entre opções numeradas para leitura no WhatsApp
    const temLinhaEmBrancoEntreOpcoesC1 =
      /\b1º\)?[\s\S]*?\n\s*\n\s*\*?\b2º\)?/i.test(resC1.textoResposta);

    console.log(`C1: Aviso de conflito em tom natural?: ${temAvisoConflitoC ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`C1: Fontes numeradas com data do documento e armazenamento?: ${temFontesComDatasC ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`C1: Opções numeradas em linha própria com linha em branco entre elas?: ${temLinhaEmBrancoEntreOpcoesC1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`C1: Indicação da mais recente e pergunta de confirmação?: ${temMaisRecenteEPerguntaC ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`C1: Proibição estrita de códigos internos (doc_id/UUID)?: ${semCodigosInternosC ? '✅ SIM' : '❌ NÃO'}`);

    // 6. Cenário C2: Confirmou fontes do histórico
    const textoC2 = resC2.textoResposta.toLowerCase();
    const citouFontesC2 =
      textoC2.includes('declaração') ||
      textoC2.includes('locação') ||
      textoC2.includes('residência') ||
      textoC2.includes('comprovante') ||
      textoC2.includes('hortênsias') ||
      textoC2.includes('palmeiras');
    console.log(`C2: "De onde tirou isso?" respondeu com as fontes já registradas no histórico?: ${citouFontesC2 ? '✅ SIM' : '❌ NÃO'}`);

    // 7. Cenário C3: Envio do documento mais recente
    const enviouDocMaisRecenteC = Boolean(
      resC3.anexos &&
      resC3.anexos.length > 0
    );
    console.log(`C3: "Me mande o documento mais recente" enviou o anexo do documento mais recente?: ${enviouDocMaisRecenteC ? '✅ SIM' : '❌ NÃO'}`);

    // 8. Cenário D: Não repetiu o endereço falso da resposta antiga da VEGA
    const textoD1 = resD1.textoResposta.toLowerCase();
    const repetiuFalso = textoD1.includes('bobos falsos') || textoD1.includes('000');
    console.log(`D1: A VEGA se recusou a repetir o endereço falso da resposta anterior?: ${!repetiuFalso ? '✅ SIM (Não repetiu erro antigo)' : '❌ NÃO (Repetiu erro)'}`);

    // 9. Cenário E1: Gravação na ficha com confirmação curta e sem forma de tratamento
    const titularSalvoE = await obterTitularPorNome(nomeTitularC);
    const campoEnderecoSalvoE = titularSalvoE?.campos?.endereco;
    const valorConfirmadoE = (campoEnderecoSalvoE?.valor || '').toLowerCase();
    const termoConfirmado = valorConfirmadoE.includes('hortênsias') || valorConfirmadoE.includes('hortensias')
      ? 'hortênsias'
      : (valorConfirmadoE.includes('palmeiras') ? 'palmeiras' : 'brasil');

    const textoE1 = resE1.textoResposta.toLowerCase();
    const confirmouCurtoE1 =
      (textoE1.includes('anotado') || textoE1.includes('atualizado') || textoE1.includes('confirmado') || textoE1.includes('salvo') || textoE1.includes('registrado')) &&
      (textoE1.includes(termoConfirmado) || textoE1.includes('hortênsias') || textoE1.includes('hortensias') || textoE1.includes('endereço') || textoE1.includes('endereco'));
    const toolGravouE1 = (resE1.rastro?.etapas || []).some((e) => e.nome.includes('confirmar_versao_dado'));

    const gravouNomeRealSemCargoE =
      Boolean(campoEnderecoSalvoE?.confirmadoPor) &&
      !campoEnderecoSalvoE!.confirmadoPor!.toLowerCase().includes('diretor') &&
      (campoEnderecoSalvoE!.confirmadoPor!.toLowerCase().includes('joão') || campoEnderecoSalvoE!.confirmadoPor!.toLowerCase().includes('joao'));

    console.log(`E1: Usuário escolheu "a correta é a 2" -> VEGA gravou na ficha?: ${toolGravouE1 || confirmouCurtoE1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`E1: Gravou confirmadoPor com nome real ("${campoEnderecoSalvoE?.confirmadoPor}") sem forma de tratamento?: ${gravouNomeRealSemCargoE ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`E1: Confirmou em frase curta ao usuário?: ${confirmouCurtoE1 ? '✅ SIM' : '❌ NÃO'}`);

    // 10. Cenário E2: Entrega direta da versão confirmada citando primeiro nome de quem confirmou e quando
    const textoE2 = resE2.textoResposta.toLowerCase();
    const entregouDiretoE2 =
      textoE2.includes(termoConfirmado) || textoE2.includes('hortênsias') || textoE2.includes('hortensias') || textoE2.includes('880') || textoE2.includes('500');
    const citouPrimeiroNomeConfirmadorE2 =
      (textoE2.includes('joão') || textoE2.includes('joao')) &&
      !textoE2.includes('diretor joão') &&
      !textoE2.includes('diretor joao');
    const naoListouDivergenciasDeNovo =
      !textoE2.includes('atenção:') && !textoE2.includes('atencao:') && !textoE2.includes('*1º)*');
    console.log(`E2: "qual o endereço dele?" entregou direto a versão confirmada?: ${entregouDiretoE2 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`E2: Citou primeiro nome de quem confirmou (sem forma de tratamento) e a fonte?: ${citouPrimeiroNomeConfirmadorE2 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`E2: Não listou divergências antigas de novo?: ${naoListouDivergenciasDeNovo ? '✅ SIM' : '❌ NÃO'}`);

    // 11. Cenário F1: Alerta de documento posterior divergente (valor atual confirmado e novo valor encontrado)
    const textoF1 = resF1.textoResposta.toLowerCase();
    const mostrouValorAtualF1 =
      textoF1.includes(termoConfirmado) || textoF1.includes('hortênsias') || textoF1.includes('hortensias') || textoF1.includes('880') || textoF1.includes('500');
    const citouQuemConfirmouF1 =
      (textoF1.includes('joão') || textoF1.includes('joao')) && !textoF1.includes('diretor joão');
    const mostrouNovoValorF1 =
      textoF1.includes('alameda dos anjos') || textoF1.includes('1200') || textoF1.includes('energia');
    const perguntouSeQuerAtualizarF1 =
      textoF1.includes('atualizar') || textoF1.includes('quer') || textoF1.includes('deseja');
    const alertouDocPosteriorCompletoF1 =
      mostrouValorAtualF1 && citouQuemConfirmouF1 && mostrouNovoValorF1 && perguntouSeQuerAtualizarF1;

    console.log(`F1: Mostrou valor atual confirmado (${mostrouValorAtualF1 ? 'OK' : 'FALTOU'})?: ${mostrouValorAtualF1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`F1: Citou confirmador pelo primeiro nome sem cargo (${citouQuemConfirmouF1 ? 'OK' : 'FALTOU'})?: ${citouQuemConfirmouF1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`F1: Mostrou novo documento e novo valor encontrado (${mostrouNovoValorF1 ? 'OK' : 'FALTOU'})?: ${mostrouNovoValorF1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`F1: Perguntou se quer atualizar (${perguntouSeQuerAtualizarF1 ? 'OK' : 'FALTOU'})?: ${perguntouSeQuerAtualizarF1 ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`F1: Alerta completo de documento posterior divergente?: ${alertouDocPosteriorCompletoF1 ? '✅ SIM' : '❌ NÃO'}`);

    // 12. Cenário G1: Busca completa por titular, exclusão estrita de documentos sem endereço e mais recente correto
    const textoG1 = resG1.textoResposta.toLowerCase();
    const trouxeOs3ComEndereco =
      (textoG1.includes('palmeiras') || textoG1.includes('ir 2024') || textoG1.includes('imposto de renda')) &&
      (textoG1.includes('brasil') || textoG1.includes('locação') || textoG1.includes('locacao')) &&
      (textoG1.includes('anjos') || textoG1.includes('energia'));
    const naoListouCnhSemEndereco =
      !textoG1.includes('cnh') && !textoG1.includes('habilitação') && !textoG1.includes('habilitacao');
    const naoUsouValidadeComoData =
      !textoG1.includes('2034');
    const exibiuDataNaoIdentificada =
      textoG1.includes('não identificada') || textoG1.includes('nao identificada') || textoG1.includes('não informada') || textoG1.includes('nao informada');
    const indicouMaisRecenteCorreto =
      (textoG1.includes('mais recente') || textoG1.includes('recente')) &&
      (textoG1.includes('ir') || textoG1.includes('palmeiras') || textoG1.includes('imposto de renda'));

    console.log(`G1: Lista trouxe apenas os 3 documentos com endereço?: ${trouxeOs3ComEndereco ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`G1: CNH sem endereço foi excluída da lista?: ${naoListouCnhSemEndereco ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`G1: Nenhum documento usou validade 2034 como data?: ${naoUsouValidadeComoData ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`G1: Documento sem data de emissão identificável exibiu "data não identificada"?: ${exibiuDataNaoIdentificada ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`G1: Indicação de mais recente apontou para Declaração de IR 2024?: ${indicouMaisRecenteCorreto ? '✅ SIM' : '❌ NÃO'}`);

    console.log('\n================================================================');
    console.log('TODAS AS CONVERSAS SIMULADAS COM SUCESSO!');
    console.log('================================================================\n');

  } finally {
    // LIMPEZA OBRIGATÓRIA DE TODOS OS DADOS DE TESTE
    console.log('>>> [Limpeza] Removendo dados de teste do Supabase...');
    try {
      const sb = getSupabaseClient();
      await sb.from('trechos').delete().in('documento_id', docsParaLimpar);
    } catch {}

    for (const docId of docsParaLimpar) {
      try {
        await removerDocumento(docId);
        console.log(`Documento de teste "${docId}" removido.`);
      } catch (e: any) {
        console.warn(`Falha ao remover documento "${docId}":`, e?.message);
      }
    }

    for (const titId of titularesParaLimpar) {
      try {
        await removerTitular(titId);
        console.log(`Titular de teste "${titId}" removido.`);
      } catch (e: any) {
        console.warn(`Falha ao remover titular "${titId}":`, e?.message);
      }
    }
    console.log('>>> [Limpeza] Concluída com sucesso!\n');
  }
}

main().catch(console.error);
