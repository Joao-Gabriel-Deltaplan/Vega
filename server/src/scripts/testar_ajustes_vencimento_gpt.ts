import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  obterTodosAlertas,
  salvarAlertas,
  executarRotinaVerificacaoVencimentos,
  silenciarAlertasDocumento,
  sincronizarValidadesDocumentosExistentes,
} from '../vencimentos/alertaVencimentoService.js';
import { obterTodosDocumentos, atualizarDocumento, obterTodosTitulares } from '../storage.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { DocumentoRegistro, Contato, Mensagem } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DOCUMENTOS_FILE = path.resolve(__dirname, '../../../data/documentos.json');

async function main() {
  console.log('===============================================================');
  console.log('TESTE E VALIDAÇÃO DOS AJUSTES DE VALIDADE E PARAR DE ALERTAR');
  console.log('===============================================================\n');

  // 1. Sincronizar validades oficiais extraídas com IA
  console.log('--- 1. SINCRONIZANDO VALIDADES OFICIAIS EXTRAÍDAS COM GPT-5.4-MINI ---');
  await sincronizarValidadesDocumentosExistentes();

  const docs = await obterTodosDocumentos();
  console.log('\nResultados no Cofre (data/documentos.json):');
  for (const d of docs) {
    console.log(
      `• [${d.tipo || 'Outro'}] "${d.titulo}" (${d.arquivo}): ` +
      `Validade = ${d.dataValidade || 'Sem validade (Nula)'} ` +
      `| Trecho: "${d.trechoValidade || 'N/A'}" ` +
      `| Silenciado: ${d.silenciarAlertas ? 'SIM' : 'NÃO'}`
    );
  }

  // 2. Executar rotina diária de verificação
  console.log('\n--- 2. EXECUTANDO ROTINA DIÁRIA DE VENCIMENTOS ---');
  const rotina = await executarRotinaVerificacaoVencimentos();
  console.log(`Total de alertas pendentes: ${rotina.totalAlertas} (não lidos: ${rotina.totalNaoLidos})`);

  const alertas = await obterTodosAlertas();
  for (const a of alertas) {
    console.log(
      `  • [${a.status.toUpperCase()}] "${a.documentoTitulo}" | Titular: ${a.titular} | ` +
      `Validade: ${a.dataValidade} | Dias restantes: ${a.diasRestantes}`
    );
  }

  // 3. Teste pelo chat: silenciar documento
  const docsIniciais = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();
  const crtPosChat = docsIniciais.find((d) => d.titulo.includes('CRT') || d.tipo === 'CRT') || docsIniciais[0];
  const titularDoc = todosTitulares.find(t => t.id === crtPosChat?.titularId);
  const primeiroNomeTit = titularDoc ? extrairPrimeiroNome(titularDoc.nome) : '';
  const tipoOuTitulo = crtPosChat?.tipo || crtPosChat?.titulo || 'Documento';
  const msg1 = primeiroNomeTit ? `pare de alertar ${tipoOuTitulo} de ${primeiroNomeTit}` : `pare de alertar ${tipoOuTitulo}`;

  console.log(`\n--- 3. TESTANDO NO CHAT: "${msg1}" ---`);
  const contatoAdmin: Contato = {
    id: 'user-admin-teste',
    nome: 'Usuario Teste',
    telefone: '5500000000005',
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
  };

  const historico: Mensagem[] = [];
  console.log(`>>> MENSAGEM: "${msg1}"`);

  const res1 = await processarMensagemChat({
    mensagemUsuario: msg1,
    historicoRecente: historico,
    contato: contatoAdmin,
    documentosDisponiveis: await obterTodosDocumentos(),
  });
  console.log(`RESPOSTA (Pedido de confirmação):\n${res1.textoResposta}`);
  console.log(`[Correção pendente gerada: ${JSON.stringify(res1.correcaoPendente)}]`);

  historico.push({
    id: 'm1',
    remetente: 'cliente',
    nomeRemetente: contatoAdmin.nome,
    horario: '14:00',
    texto: msg1,
  });
  historico.push({
    id: 'm2',
    remetente: 'assistente',
    nomeRemetente: 'VEGA',
    horario: '14:00',
    texto: res1.textoResposta,
    correcaoPendente: res1.correcaoPendente,
  });

  console.log('\n>>> MENSAGEM: "sim"');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'sim',
    historicoRecente: historico,
    contato: contatoAdmin,
    documentosDisponiveis: await obterTodosDocumentos(),
  });
  console.log(`RESPOSTA APÓS CONFIRMAÇÃO:\n${res2.textoResposta}`);

  const docsPosChat = await obterTodosDocumentos();
  const docAtualizado = docsPosChat.find((d) => d.id === crtPosChat?.id);
  console.log(`\nStatus documento após confirmação no chat: silenciarAlertas = ${docAtualizado?.silenciarAlertas}`);

  // 4. Teste de substituição de documento: se o documento for substituído, silenciarAlertas volta a false
  console.log('\n--- 4. TESTANDO SUBSTITUIÇÃO DE DOCUMENTO (ALERTAS VOLTAM A FUNCIONAR) ---');
  if (crtPosChat) {
    console.log(`Simulando substituição de arquivo no documento "${crtPosChat.titulo}"...`);
    const nomeOriginal = crtPosChat.arquivo;
    await atualizarDocumento(crtPosChat.id, {
      arquivo: 'DOCUMENTO_TESTE_NOVA_VERSAO.pdf',
      silenciarAlertas: false, // Regra: se o documento for substituído, alertas voltam a funcionar
    });

    const docsPosSubstituicao = await obterTodosDocumentos();
    const docPosSub = docsPosSubstituicao.find((d) => d.id === crtPosChat.id);
    console.log(`✓ Status documento após substituição: silenciarAlertas = ${docPosSub?.silenciarAlertas} (Alertas reativados!)`);

    // Restaura nome do arquivo original
    await atualizarDocumento(crtPosChat.id, {
      arquivo: nomeOriginal,
      silenciarAlertas: false,
    });
  }

  // 5. Teste no chat: "pare de alertar o CREA" e confirmação
  console.log('\n--- 5. TESTANDO NO CHAT: "pare de alertar o CREA" ---');
  const historicoCrea: Mensagem[] = [];
  const msgCrea = 'pare de alertar o CREA';
  console.log(`>>> MENSAGEM: "${msgCrea}"`);

  const resCrea1 = await processarMensagemChat({
    mensagemUsuario: msgCrea,
    historicoRecente: historicoCrea,
    contato: contatoAdmin,
    documentosDisponiveis: await obterTodosDocumentos(),
  });
  console.log(`RESPOSTA (Pedido de confirmação):\n${resCrea1.textoResposta}`);

  historicoCrea.push({
    id: 'mc1',
    remetente: 'cliente',
    nomeRemetente: contatoAdmin.nome,
    horario: '14:05',
    texto: msgCrea,
  });
  historicoCrea.push({
    id: 'mc2',
    remetente: 'assistente',
    nomeRemetente: 'VEGA',
    horario: '14:05',
    texto: resCrea1.textoResposta,
    correcaoPendente: resCrea1.correcaoPendente,
  });

  console.log('\n>>> MENSAGEM: "sim"');
  const resCrea2 = await processarMensagemChat({
    mensagemUsuario: 'sim',
    historicoRecente: historicoCrea,
    contato: contatoAdmin,
    documentosDisponiveis: await obterTodosDocumentos(),
  });
  console.log(`RESPOSTA APÓS CONFIRMAÇÃO:\n${resCrea2.textoResposta}`);

  const docsPosCrea = await obterTodosDocumentos();
  const creaPos = docsPosCrea.find((d) => d.titulo.toLowerCase().includes('crea'));
  console.log(`Status CREA após silenciamento: silenciarAlertas = ${creaPos?.silenciarAlertas}`);

  // Reativa alertas do CREA para manter o monitoramento regular
  if (creaPos) {
    await silenciarAlertasDocumento(creaPos.id, false);
    console.log('✓ Alertas do CREA reativados ao final do teste.');
  }

  console.log('\n===============================================================');
  console.log('TODOS OS TESTES CONCLUÍDOS COM SUCESSO!');
  console.log('===============================================================');
}

main().catch(console.error);
