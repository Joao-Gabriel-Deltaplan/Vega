import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  processarMensagemChat,
  classificarEReescreverMensagem,
  sanitizarPedidoArquivo,
  extrairDocumentoRecenteDoHistorico,
} from '../chat/chatOrquestrador.js';
import {
  validarTipoDocumentoReconhecivel,
  obterDocumentosFaltantes,
} from '../documentosFaltantesService.js';
import { Contato, DocumentoRegistro, Mensagem } from '../types.js';
import { obterTodosDocumentos } from '../storage.js';

async function executarTestes() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: CONTEXTO DE CONVERSA, CLASSIFICAÇÃO IA E FALTANTES');
  console.log('================================================================\n');

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

  // -------------------------------------------------------------
  // TESTE 1: Validação de tipos reconhecíveis e sanitização de cortesia
  // -------------------------------------------------------------
  console.log('\n--- 1. Validação de Tipos Documentais e Sanitização de Comandos ---');

  const san1 = sanitizarPedidoArquivo('perfeito, agora me envie o pdf');
  asserir(san1.apenasComandoEnvio && san1.termoLimpo === '', 'sanitizarPedidoArquivo("perfeito, agora me envie o pdf") é comando de envio genérico');

  const san2 = sanitizarPedidoArquivo('show, agora solta esse arquivo aí');
  asserir(san2.apenasComandoEnvio && san2.termoLimpo === '', 'sanitizarPedidoArquivo("show, agora solta esse arquivo aí") é comando de envio genérico');

  const san3 = sanitizarPedidoArquivo('solta esse arquivo aí');
  asserir(san3.apenasComandoEnvio && san3.termoLimpo === '', 'sanitizarPedidoArquivo("solta esse arquivo aí") é comando de envio genérico');

  const san4 = sanitizarPedidoArquivo('me manda a certidão de casamento');
  asserir(!san4.apenasComandoEnvio && san4.termoLimpo.includes('certidao casamento'), 'sanitizarPedidoArquivo preserva documento citado quando existente');

  asserir(!validarTipoDocumentoReconhecivel('Perfeito, Agora Me Envie O Pdf'), 'validarTipoDocumentoReconhecivel rejeita "Perfeito, Agora Me Envie O Pdf"');
  asserir(!validarTipoDocumentoReconhecivel('Show, Agora Solta Esse Arquivo Aí'), 'validarTipoDocumentoReconhecivel rejeita "Show, Agora Solta Esse Arquivo Aí"');
  asserir(!validarTipoDocumentoReconhecivel('documento'), 'validarTipoDocumentoReconhecivel rejeita termo vago "documento"');
  asserir(validarTipoDocumentoReconhecivel('Apólice de Seguro'), 'validarTipoDocumentoReconhecivel aceita "Apólice de Seguro"');
  asserir(validarTipoDocumentoReconhecivel('Alvará'), 'validarTipoDocumentoReconhecivel aceita "Alvará"');
  asserir(validarTipoDocumentoReconhecivel('Certidão de Nascimento'), 'validarTipoDocumentoReconhecivel aceita "Certidão de Nascimento"');

  // -------------------------------------------------------------
  // TESTE 2: Classificação por IA com gpt-5.4-mini
  // -------------------------------------------------------------
  console.log('\n--- 2. Classificação de Intenções por IA (gpt-5.4-mini) ---');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente');
  }
  const openai = new OpenAI({ apiKey });

  // 2A: "show, agora solta esse arquivo aí"
  const classif1 = await classificarEReescreverMensagem('show, agora solta esse arquivo aí', [], openai);
  console.log('   IA "show, agora solta esse arquivo aí" -> intencao:', classif1.intencao, '| doc_citado:', `"${classif1.documento_citado}"`, '| termo_busca:', `"${classif1.termo_busca}"`);
  asserir(
    classif1.intencao === 'pedir_arquivo' && (!classif1.documento_citado || classif1.documento_citado.trim() === ''),
    'IA classifica "show, agora solta esse arquivo aí" como pedir_arquivo com documento_citado vazio'
  );

  // 2B: "perfeito, agora me envie o pdf"
  const classif2 = await classificarEReescreverMensagem('perfeito, agora me envie o pdf', [], openai);
  console.log('   IA "perfeito, agora me envie o pdf" -> intencao:', classif2.intencao, '| doc_citado:', `"${classif2.documento_citado}"`, '| termo_busca:', `"${classif2.termo_busca}"`);
  asserir(
    classif2.intencao === 'pedir_arquivo' && (!classif2.documento_citado || classif2.documento_citado.trim() === ''),
    'IA classifica "perfeito, agora me envie o pdf" como pedir_arquivo com documento_citado vazio'
  );

  // -------------------------------------------------------------
  // OBTENDO DOCUMENTOS DO SUPABASE PARA OS TESTES INTEGRADOS
  // -------------------------------------------------------------
  const todosDocs = await obterTodosDocumentos();
  console.log(`\nDocumentos disponíveis no Cofre: ${todosDocs.length}`);
  const docApolice = todosDocs.find(
    (d) =>
      d.arquivo.toLowerCase().includes('nivus') ||
      d.titulo.toLowerCase().includes('nivus') ||
      d.titulo.toLowerCase().includes('apólice') ||
      d.titulo.toLowerCase().includes('apolice')
  );

  if (!docApolice) {
    console.warn('⚠️ Documento da Apólice Nivus não encontrado no banco. Usando primeiro documento disponível para o teste.');
  }
  const docAlvo = docApolice || todosDocs[0];
  console.log(`Documento alvo para o teste de contexto: "${docAlvo.titulo}" (${docAlvo.arquivo})\n`);

  const contatoTeste: Contato = {
    id: 'contato-teste-contexto',
    nome: 'Usuario Teste',
    telefone: '5514999999999',
    avatarCor: '#25D366',
    nivelAcesso: 'diretoria',
    ficha: {} as any,
  };

  // Contagem inicial de faltantes no Supabase
  const faltantesIniciais = await obterDocumentosFaltantes();
  const countFaltantesInicio = faltantesIniciais.length;

  // -------------------------------------------------------------
  // TESTE 3: "show, agora solta esse arquivo aí" APÓS DISCUSSÃO DO DOCUMENTO
  // -------------------------------------------------------------
  console.log('--- 3. Teste de Fluxo: "show, agora solta esse arquivo aí" com Contexto ---');

  // Monta histórico simulado com pergunta sobre vigência/parcela e resposta da VEGA
  const historicoComApolice: Mensagem[] = [
    {
      id: 'msg-1',
      remetente: 'cliente',
      nomeRemetente: 'Usuario Teste',
      horario: '14:30',
      timestamp: new Date(Date.now() - 60000).toISOString(),
      texto: 'Qual é o tempo de vigência da apólice do Nivus?',
      origem: 'motor',
    },
    {
      id: 'msg-2',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '14:31',
      timestamp: new Date(Date.now() - 30000).toISOString(),
      texto: `De acordo com a ${docAlvo.titulo}, a vigência da apólice do seguro do Nivus é de 13/05/2024 até 13/05/2025.`,
      origem: 'motor',
      rastro: {
        mensagemId: 'msg-2',
        usuarioNome: 'Usuario Teste',
        usuarioId: 'contato-teste-contexto',
        mensagemOriginal: 'Qual é o tempo de vigência da apólice do Nivus?',
        perguntaReescrita: 'Tempo de vigência da apólice de seguro do Nivus',
        intencaoDetectada: 'pergunta_conteudo',
        tipoBusca: 'vetorial',
        documentosEncontrados: [
          {
            id: docAlvo.id,
            titulo: docAlvo.titulo,
            similaridade: 92,
            usadoNaResposta: true,
          },
        ],
        documentoUsado: docAlvo.titulo,
        enviouAnexo: false,
        respostaFinal: `De acordo com a ${docAlvo.titulo}, a vigência da apólice...`,
        modeloUsado: 'gpt-5.4-mini',
        tokensTotal: 150,
        tokensPrompt: 100,
        tokensCompletion: 50,
        custoEstimadoUsd: 0.0001,
        tempoTotalMs: 800,
        etapas: [],
      },
    },
  ];

  const resComando1 = await processarMensagemChat({
    mensagemUsuario: 'show, agora solta esse arquivo aí',
    historicoRecente: historicoComApolice,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log('   Resposta:', resComando1.textoResposta);
  console.log('   Anexos:', resComando1.anexos?.map((a) => a.nome));

  asserir(
    Boolean(resComando1.anexos && resComando1.anexos.length > 0 && resComando1.anexos[0].nome === docAlvo.arquivo),
    `"show, agora solta esse arquivo aí" enviou com sucesso o anexo "${docAlvo.arquivo}" do contexto`
  );
  asserir(
    Boolean(resComando1.textoResposta.includes(docAlvo.titulo) || resComando1.textoResposta.includes('Aqui está o documento solicitado')),
    'Resposta confirma a entrega do documento solicitado do contexto'
  );

  // -------------------------------------------------------------
  // TESTE 4: "Perfeito, agora me envie o pdf" APÓS DISCUSSÃO DO DOCUMENTO
  // -------------------------------------------------------------
  console.log('\n--- 4. Teste de Fluxo: "Perfeito, agora me envie o pdf" com Contexto ---');

  const resComando2 = await processarMensagemChat({
    mensagemUsuario: 'Perfeito, agora me envie o pdf',
    historicoRecente: historicoComApolice,
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log('   Resposta:', resComando2.textoResposta);
  console.log('   Anexos:', resComando2.anexos?.map((a) => a.nome));

  asserir(
    Boolean(resComando2.anexos && resComando2.anexos.length > 0 && resComando2.anexos[0].nome === docAlvo.arquivo),
    `"Perfeito, agora me envie o pdf" enviou com sucesso o anexo "${docAlvo.arquivo}" do contexto`
  );

  // -------------------------------------------------------------
  // TESTE 5: "me envia o pdf" SEM CONTEXTO PRÉVIO
  // -------------------------------------------------------------
  console.log('\n--- 5. Teste de Fluxo: "me envia o pdf" sem Contexto Prévio ---');

  const resSemContexto = await processarMensagemChat({
    mensagemUsuario: 'me envia o pdf',
    historicoRecente: [], // Sem mensagens anteriores
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log('   Resposta:', resSemContexto.textoResposta);
  asserir(
    resSemContexto.textoResposta.includes('Qual documento você gostaria que eu envie?') && (!resSemContexto.anexos || resSemContexto.anexos.length === 0),
    'Sem contexto, VEGA pergunta educadamente qual documento deseja e NÃO envia anexo aleatório'
  );

  // -------------------------------------------------------------
  // TESTE 6: Verificação de Integridade da tabela `documentos_faltantes`
  // -------------------------------------------------------------
  console.log('\n--- 6. Verificação de Integridade no Supabase (documentos_faltantes) ---');

  const todosFaltantesFim = await obterDocumentosFaltantes();
  const countFaltantesFim = todosFaltantesFim.length;

  asserir(
    countFaltantesInicio === countFaltantesFim,
    `Nenhum documento faltante espúrio foi registrado (Início: ${countFaltantesInicio}, Fim: ${countFaltantesFim})`
  );

  const temInvalido = todosFaltantesFim.some(
    (f) =>
      f.tipoDocumento.toLowerCase().includes('perfeito') ||
      f.tipoDocumento.toLowerCase().includes('show') ||
      f.tipoDocumento.toLowerCase().includes('solta') ||
      f.tipoDocumento.toLowerCase().includes('envie o pdf')
  );
  asserir(!temInvalido, 'Nenhuma frase de cortesia ou comando existe na tabela documentos_faltantes do Supabase');

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO FINAL: ${totalPassou}/${totalTestes} TESTES APROVADOS (${Math.round((totalPassou / totalTestes) * 100)}%)`);
  console.log('================================================================');

  if (totalPassou === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('❌ Erro inesperado ao executar testes:', err);
  process.exit(1);
});
