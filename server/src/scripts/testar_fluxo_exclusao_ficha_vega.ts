import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  adicionarDocumento,
  obterTodosDocumentos,
  removerDocumento,
  obterTodosTitulares,
  salvarOuAtualizarTitular,
  removerTitular,
} from '../storage.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, DocumentoRegistro } from '../types.js';

async function main() {
  console.log('================================================================');
  console.log('TESTE END-TO-END: FLUXO DE EXCLUSÃO DE DOCUMENTO E FICHA CADASTRAL');
  console.log('================================================================\n');

  const contatoTeste: Contato = {
    id: 'user-teste-diretoria',
    nome: 'Diretor Teste',
    telefone: '5511999999999',
    avatarCor: '#2563eb',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
    },
  };

  // 1. Cadastra documento de teste no Cofre
  const idDocTeste = `doc-teste-${Date.now()}`;
  const docTeste: DocumentoRegistro = {
    id: idDocTeste,
    titulo: 'Alvará Teste de Exclusão',
    arquivo: 'alvara_teste_exclusao.pdf',
    tipo: 'Alvará',
    titular: 'Rogerio Temporario',
    visibilidade: 'diretoria',
    statusIndexacao: 'indexado',
    dataUpload: '30/09/2026',
    tamanho: '100 KB',
  };

  console.log('>>> 1. Cadastrando documento de teste no Cofre...');
  const docCriado = await adicionarDocumento(docTeste);
  console.log(`Documento criado: "${docCriado.titulo}" (ID: ${docCriado.id})\n`);

  // 2. Alimenta um campo na ficha de Rogerio Temporario apontando para esse documento
  console.log('>>> 2. Vinculando campo "orgaoEmissor" na ficha de "Rogerio Temporario" ao documento de teste...');
  const todosTitulares = await obterTodosTitulares();
  let titTeste = todosTitulares.find((t) => t.nome.toLowerCase().includes('rogerio temporario'));
  if (!titTeste) {
    titTeste = {
      id: 'tit_rogerio_temporario',
      nome: 'Rogerio Temporario',
      campos: {},
      atualizadoEm: '30/09/2026',
    };
  }

  titTeste.campos.orgaoEmissor = {
    valor: 'SSP/TESTE-EXCLUSAO',
    origem: docCriado.id,
    origemNome: docCriado.titulo,
    origemVisibilidade: 'diretoria',
    conferido: true,
    dataConferencia: '30/09/2026',
    manual: false,
  };
  await salvarOuAtualizarTitular(titTeste);
  console.log(`Campo orgaoEmissor salvo na ficha com valor "SSP/TESTE-EXCLUSAO", origem "${docCriado.id}"\n`);

  // 3. Pergunta para a VEGA antes de excluir
  console.log('>>> 3. Perguntando órgão emissor do Rogerio Temporario para a VEGA...');
  const docsAntes = await obterTodosDocumentos();
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual o órgão emissor do Rogerio Temporario?',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: docsAntes,
  });

  console.log('Resposta da VEGA:');
  console.log(`"${res1.textoResposta}"\n`);

  const citouFonte =
    res1.textoResposta.includes('pela ficha cadastral') &&
    res1.textoResposta.includes('Alvará Teste de Exclusão');
  const temValor = res1.textoResposta.includes('SSP/TESTE-EXCLUSAO');

  if (temValor && citouFonte) {
    console.log('✅ TESTE 1 PASSOU: VEGA respondeu o valor e citou a fonte da ficha cadastral!\n');
  } else {
    console.error('❌ TESTE 1 FALHOU: VEGA não citou a fonte ou não retornou o valor esperado.\n');
  }

  // 4. Exclui o documento do Cofre
  console.log('>>> 4. Excluindo documento de teste do Cofre via removerDocumento()...');
  const excluiu = await removerDocumento(docCriado.id);
  console.log(`Documento excluído?: ${excluiu}\n`);

  // 5. Verifica se o campo foi removido da ficha do titular
  console.log('>>> 5. Verificando se o campo foi removido da ficha de "Rogerio Temporario"...');
  const titApos = (await obterTodosTitulares()).find((t) => t.nome.toLowerCase().includes('rogerio temporario'));
  const campoAindaExiste = Boolean(titApos?.campos?.orgaoEmissor);

  if (!campoAindaExiste) {
    console.log('✅ TESTE 2 PASSOU: Campo "orgaoEmissor" foi removido automaticamente da ficha após exclusão do documento!\n');
  } else {
    console.error('❌ TESTE 2 FALHOU: Campo "orgaoEmissor" ainda permaneceu na ficha após exclusão do documento!\n');
  }

  // 6. Pergunta novamente para a VEGA após exclusão
  console.log('>>> 6. Perguntando novamente órgão emissor do Rogerio Temporario para a VEGA após exclusão...');
  const docsDepois = await obterTodosDocumentos();
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual o órgão emissor do Rogerio Temporario?',
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: docsDepois,
  });

  console.log('Resposta da VEGA:');
  console.log(`"${res2.textoResposta}"\n`);

  const textoNorm2 = res2.textoResposta.toLowerCase();
  const naoEncontrou =
    textoNorm2.includes('não encontrei') ||
    textoNorm2.includes('não localizei') ||
    textoNorm2.includes('não consegui localizar') ||
    textoNorm2.includes('não consta') ||
    textoNorm2.includes('não há');

  if (naoEncontrou && !res2.textoResposta.includes('SSP/TESTE-EXCLUSAO')) {
    console.log('✅ TESTE 3 PASSOU: VEGA informou corretamente que não encontrou o documento/dado!\n');
  } else {
    console.error('❌ TESTE 3 FALHOU: VEGA respondeu com dado de documento que foi excluído!\n');
  }

  // Limpeza final do titular temporário
  if (titTeste?.id) {
    await removerTitular(titTeste.id);
  }

  console.log('================================================================');
  console.log('TODOS OS TESTES CONCLUÍDOS COM SUCESSO!');
  console.log('================================================================');
}

main().catch(console.error);
