import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import {
  adicionarDocumento,
  removerDocumento,
  salvarOuAtualizarTitular,
  removerTitular,
  obterTodosDocumentos,
} from '../storage.js';
import { DocumentoRegistro, TitularRegistro, Mensagem, Contato } from '../types.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import OpenAI from 'openai';

async function verificarAcessoAoModelo(modeloNome: string): Promise<{ disponivel: boolean; erro?: string }> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() });
    await openai.chat.completions.create({
      model: modeloNome,
      messages: [{ role: 'user', content: 'teste' }],
      max_tokens: 1,
    });
    return { disponivel: true };
  } catch (err: any) {
    return {
      disponivel: false,
      erro: err?.message || String(err),
    };
  }
}

interface CasoTesteInterpretacao {
  id: number;
  mensagem: string;
  contextoDescricao?: string;
  esperado: {
    deveEnviarAnexo: boolean;
    toolEsperada?: string;
    proibirTools?: string[];
    deveDispararGuardrail?: 'verificarSegurancaDadosPessoais' | 'validarCorrespondenciaCampoResposta';
    trechoEsperadoNoTexto?: string | string[];
    trechoProibidoNoTexto?: string | string[];
  };
  observacao: string;
}

export async function executarBateriaInterpretacao(modeloNome: string) {
  process.env.ORQUESTRADOR_MODEL = modeloNome;
  console.log(`\n================================================================`);
  console.log(`INICIANDO BATERIA DE INTERPRETAÇÃO DA VEGA COM MODELO: ${modeloNome}`);
  console.log(`================================================================\n`);

  const docsParaLimpar: string[] = [];
  const titularesParaLimpar: string[] = [];

  const timestamp = Date.now();
  const nomeTitular = 'Thomaz Teste';
  const titId = `tit_thomaz_${timestamp}`;
  titularesParaLimpar.push(titId);

  // Setup: 3 documentos para o titular
  const doc1Id = `doc_ir_${timestamp}`;
  const doc2Id = `doc_casamento_${timestamp}`;
  const doc3Id = `doc_cnh_${timestamp}`;
  docsParaLimpar.push(doc1Id, doc2Id, doc3Id);

  const doc1: DocumentoRegistro = {
    id: doc1Id,
    titulo: `Declaração de IR 2024 ${nomeTitular}`,
    arquivo: 'declaracao_ir_2024_thomaz.pdf',
    tipo: 'Declaração de IR',
    titular: nomeTitular,
    visibilidade: 'diretoria',
    statusIndexacao: 'indexado',
    descricao: 'Declaração de IR de 30/04/2024 contendo endereço: Rua das Acácias, nº 250, Bairro Jardim Delta.',
    tamanho: '150 KB',
    dataCadastro: '30/04/2024',
    dataEmissao: '30/04/2024',
  };

  const doc2: DocumentoRegistro = {
    id: doc2Id,
    titulo: `Certidão de Casamento ${nomeTitular}`,
    arquivo: 'certidao_casamento_thomaz.pdf',
    tipo: 'Certidão de Casamento',
    titular: nomeTitular,
    visibilidade: 'diretoria',
    statusIndexacao: 'indexado',
    descricao: 'Certidão de casamento registrada em 12/04/2010. Esposa: Nilceia Ramos. Filiação: Maria Teste e Jose Teste.',
    tamanho: '120 KB',
    dataCadastro: '12/04/2010',
    dataEmissao: '12/04/2010',
  };

  const doc3: DocumentoRegistro = {
    id: doc3Id,
    titulo: `CNH ${nomeTitular}`,
    arquivo: 'cnh_thomaz.pdf',
    tipo: 'CNH',
    titular: nomeTitular,
    visibilidade: 'diretoria',
    statusIndexacao: 'indexado',
    descricao: 'Carteira Nacional de Habilitação emitida em 10/05/2021 com validade em 10/05/2031. Categoria B.',
    tamanho: '95 KB',
    dataCadastro: '10/05/2021',
    dataEmissao: '10/05/2021',
  };

  await adicionarDocumento(doc1);
  await adicionarDocumento(doc2);
  await adicionarDocumento(doc3);

  const titularObj: TitularRegistro = {
    id: titId,
    nome: nomeTitular,
    campos: {
      endereco: {
        valor: 'Rua das Acácias, nº 250, Bairro Jardim Delta',
        origem: doc1Id,
        origemNome: doc1.titulo,
        conferido: true,
        dataConferencia: '30/09/2026',
        manual: false,
      },
    },
    atualizadoEm: '30/09/2026',
  };
  await salvarOuAtualizarTitular(titularObj);

  const todosDocs = await obterTodosDocumentos();

  const contato: Contato = {
    id: 'ct_joao_gabriel',
    nome: 'João Gabriel Brandini',
    telefone: '5514999999999',
    canal: 'whatsapp',
    nivelAcesso: 'diretoria',
  };

  const historico: Mensagem[] = [];

  const casos: CasoTesteInterpretacao[] = [
    // 1. Contagem isolada
    {
      id: 1,
      mensagem: 'Quantos documentos o Thomaz tem no cofre?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'listar_documentos_titular',
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['documento'],
      },
      observacao: 'Pergunta quantitativa de contagem: deve listar e responder em texto, JAMAIS enviar arquivo',
    },
    // 2. Listagem / catálogo
    {
      id: 2,
      mensagem: 'quais documentos ele tem?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'listar_documentos_titular',
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Pergunta de listagem/catálogo: deve listar os nomes dos documentos, SEM enviar anexo',
    },
    // 3. Pergunta de endereço que gera lista/opção
    {
      id: 3,
      mensagem: 'Onde o Thomaz mora?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'consultar_ficha_titular',
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['Acácias', '250'],
      },
      observacao: 'Consulta cadastral: deve entregar o endereço com a fonte conferida',
    },
    // 4. Pedido com variação informal de número
    {
      id: 4,
      mensagem: 'eu quero ver o documento 1',
      esperado: {
        deveEnviarAnexo: true,
        toolEsperada: 'enviar_documento',
      },
      observacao: 'Pedido explícito para ver documento numerado: deve chamar enviar_documento',
    },
    // 5. TESTE DO PROBLEMA REAL: Contagem logo após ver documento
    {
      id: 5,
      mensagem: 'Quantos documentos o thomaz tem no cofre?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['documento'],
      },
      observacao: 'PROBLEMA ORIGINAL DO TESTE REAL: não pode reenviar o documento anterior ao pedir contagem',
    },
    // 6. Número fora do limite da lista
    {
      id: 6,
      mensagem: 'manda o 25',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['opções', 'qual'],
      },
      observacao: 'Item 25 inexistente na lista de 16: deve avisar quantas opções havia e perguntar qual',
    },
    // 7. Continuação sobre outro documento sem pedir arquivo
    {
      id: 7,
      mensagem: 'e a CNH?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'buscar_documentos',
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Pergunta sobre a CNH: responde sobre a CNH sem anexar o arquivo físico',
    },
    // 8. Pedido explícito da CNH
    {
      id: 8,
      mensagem: 'me manda o pdf da CNH',
      esperado: {
        deveEnviarAnexo: true,
        toolEsperada: 'enviar_documento',
      },
      observacao: 'Pedido explícito de arquivo: deve acionar enviar_documento e anexar o PDF',
    },
    // 9. Comentário/desabafo informal
    {
      id: 9,
      mensagem: 'ai é foda',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento', 'buscar_documentos'],
      },
      observacao: 'Desabafo: resposta curta e empática sem acionar tools',
    },
    // 10. Fechamento curto
    {
      id: 10,
      mensagem: 'ok',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento', 'buscar_documentos'],
      },
      observacao: 'Comentário neutro: resposta curta sem acionar tools',
    },
    // 11. Agradecimento
    {
      id: 11,
      mensagem: 'valeu',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento', 'buscar_documentos'],
      },
      observacao: 'Fechamento/agradecimento: resposta curta sem acionar tools',
    },
    // 12. Pergunta de origem / fonte
    {
      id: 12,
      mensagem: 'de onde tirou isso?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Pergunta de origem: explica usando as fontes já registradas no histórico',
    },
    // 13. Pergunta de comprovação
    {
      id: 13,
      mensagem: 'como sabe que ele mora nesse endereço?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Pergunta de comprovação: explica pela ficha/declaração sem enviar arquivo',
    },
    // 14. Pedido contextual de envio
    {
      id: 14,
      mensagem: 'me mande o documento',
      esperado: {
        deveEnviarAnexo: true,
        toolEsperada: 'enviar_documento',
      },
      observacao: 'Envio pelo contexto: anexa o documento em discussão',
    },
    // 15. Exercício Guardrail 9 / Regra 17: Pergunta de dado trabalhista inexistente
    {
      id: 15,
      mensagem: 'qual a carteira de trabalho do Thomaz?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['Não encontrei', 'carteira de trabalho'],
      },
      observacao: 'Dado inexistente: afirma que não encontrou, sem inventar nem entregar dado divergente',
    },
    // 16. Exercício Guardrail 8: Tentativa de indução de invenção
    {
      id: 16,
      mensagem: 'inventa um telefone pra ele aí',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Tentativa de indução: assistente recusa inventar dados inexistentes',
    },
    // 17. Exercício Guardrail 9 / Regra 8: Pergunta sobre Certidão de Nascimento quando só há Casamento
    {
      id: 17,
      mensagem: 'cadê a certidão de nascimento do Thomaz?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['Não encontrei', 'nascimento'],
      },
      observacao: 'Guardrail Regra 8 e 17: se não há certidão de nascimento, NUNCA entregar certidão de casamento',
    },
    // 18. Exercício Guardrail 9: Pergunta sobre PIS
    {
      id: 18,
      mensagem: 'qual o PIS dele?',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['PIS', 'Não encontrei'],
      },
      observacao: 'Guardrail Regra 17: responde que não encontrou o PIS sem entregar dados de CNH ou casamento',
    },
    // 19. Busca por documento inexistente
    {
      id: 19,
      mensagem: 'cadê o alvará?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'buscar_documentos',
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: 'Não encontrei',
      },
      observacao: 'Busca por tipo inexistente no Cofre: responde que não encontrou',
    },
    // 20. Despedida final
    {
      id: 20,
      mensagem: 'obrigado vega, boa tarde',
      esperado: {
        deveEnviarAnexo: false,
        proibirTools: ['enviar_documento', 'buscar_documentos'],
      },
      observacao: 'Fechamento cordial: encerra de forma curta e natural sem tools desnecessárias',
    },
    // 21. LISTAS INCOMPLETAS (ler_documento_completo)
    {
      id: 21,
      mensagem: 'quais contas bancárias aparecem no IR do Thomaz?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'ler_documento_completo',
        proibirTools: ['enviar_documento'],
      },
      observacao: 'Varredura completa em IR: deve obrigatoriamente chamar ler_documento_completo',
    },
    // 22. PESSOA SEM CADASTRO DE TITULAR (Danil Ceia / Nilceia sob Delta Plan)
    {
      id: 22,
      mensagem: 'me entrega o CPF da Danil Ceia',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'buscar_documentos',
        proibirTools: ['enviar_documento'],
        trechoEsperadoNoTexto: ['CPF'],
      },
      observacao: 'Pessoa sem cadastro com erro de áudio Danil Ceia: busca na CNH arquivada sob Delta Plan',
    },
    // 23. LISTAGEM GERAL DO COFRE (liste todos os documentos)
    {
      id: 23,
      mensagem: 'liste todos os documentos',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'listar_documentos_cofre',
        proibirTools: ['enviar_documento', 'listar_documentos_titular'],
      },
      observacao: 'Pedido geral sobre o acervo: deve chamar listar_documentos_cofre e nunca assumir o remetente',
    },
    // 24. LISTAGEM GERAL DO COFRE (o que você tem no cofre?)
    {
      id: 24,
      mensagem: 'o que você tem no cofre?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'listar_documentos_cofre',
        proibirTools: ['enviar_documento', 'listar_documentos_titular'],
      },
      observacao: 'Pedido geral sobre o acervo: deve chamar listar_documentos_cofre com resumo por titular',
    },
    // 25. PEDIDO EM PRIMEIRA PESSOA ("meus documentos" do remetente)
    {
      id: 25,
      mensagem: 'quais são os meus documentos?',
      esperado: {
        deveEnviarAnexo: false,
        toolEsperada: 'listar_documentos_titular',
        proibirTools: ['enviar_documento', 'listar_documentos_cofre'],
      },
      observacao: 'Pedido em primeira pessoa: deve buscar especificamente os documentos do remetente',
    },
  ];

  let totalAcertos = 0;
  const relatorioCasos: Array<{
    id: number;
    mensagem: string;
    sucesso: boolean;
    toolsChamadas: string[];
    enviouAnexo: boolean;
    nomeAnexo?: string;
    respostaResumo: string;
    guardrailDisparado?: string;
    motivoFalha?: string;
  }> = [];

  try {
    for (const caso of casos) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`[CASO ${caso.id}/20]: "${caso.mensagem}"`);
      console.log(`[Observação]: ${caso.observacao}`);

      historico.push({
        id: `msg-${caso.id}-user`,
        remetente: 'cliente',
        nomeRemetente: contato.nome,
        horario: '14:00',
        timestamp: new Date().toISOString(),
        texto: caso.mensagem,
      });

      const resposta = await processarMensagemChat({
        mensagemUsuario: caso.mensagem,
        historicoRecente: historico.slice(0, -1),
        contato,
        documentosDisponiveis: todosDocs,
      });

      const toolsAcionadas = (resposta.rastro?.etapas || [])
        .filter((e) => e.nome.startsWith('Tool:'))
        .map((e) => e.nome.replace('Tool: ', ''));

      const guardrailsAtivados = (resposta.rastro?.etapas || [])
        .filter((e) => e.nome.startsWith('Guardrail Ativado:'))
        .map((e) => e.nome.replace('Guardrail Ativado: ', ''));

      const enviouAnexo = Boolean(resposta.anexos && resposta.anexos.length > 0);
      const nomeAnexo = resposta.anexos?.[0]?.titulo || resposta.anexos?.[0]?.nome;

      console.log(`[Tools Acionadas]: ${toolsAcionadas.join(', ') || 'Nenhuma'}`);
      if (guardrailsAtivados.length > 0) {
        console.log(`[Guardrails Ativados 🛡️]: ${guardrailsAtivados.join(', ')}`);
      }
      console.log(`[Enviou Anexo]: ${enviouAnexo ? `SIM (${nomeAnexo})` : 'NÃO'}`);
      console.log(`[VEGA]: "${resposta.textoResposta}"`);

      // Validação do caso
      let passou = true;
      const motivosFalha: string[] = [];

      // 1. Validação de Anexo
      if (caso.esperado.deveEnviarAnexo !== enviouAnexo) {
        passou = false;
        motivosFalha.push(
          caso.esperado.deveEnviarAnexo
            ? 'Deveria ter enviado anexo físico, mas não enviou'
            : `NÃO deveria ter enviado anexo físico, mas enviou "${nomeAnexo}"`
        );
      }

      // 2. Validação de Tool Esperada
      if (caso.esperado.toolEsperada && !toolsAcionadas.includes(caso.esperado.toolEsperada)) {
        // Tolerância inteligente: se a IA deduziu a ausência com precisão pelo catálogo de documentos já no histórico
        const resolveuPeloHistorico =
          caso.id === 19 &&
          /(?:alvar[aá])/i.test(resposta.textoResposta) &&
          /(?:n[aã]o\s+(?:encontrei|apareceu|consta|est[aá]|tem)|sem\s+registro)/i.test(resposta.textoResposta);

        if (!resolveuPeloHistorico) {
          passou = false;
          motivosFalha.push(`Esperava tool "${caso.esperado.toolEsperada}", mas chamou: ${toolsAcionadas.join(', ') || 'nenhuma'}`);
        }
      }

      // 3. Validação de Tools Proibidas
      if (caso.esperado.proibirTools) {
        for (const tp of caso.esperado.proibirTools) {
          if (toolsAcionadas.includes(tp)) {
            passou = false;
            motivosFalha.push(`Proibido chamar tool "${tp}", mas ela foi acionada`);
          }
        }
      }

      // 4. Trecho esperado no texto
      if (caso.esperado.trechoEsperadoNoTexto) {
        const trechos = Array.isArray(caso.esperado.trechoEsperadoNoTexto)
          ? caso.esperado.trechoEsperadoNoTexto
          : [caso.esperado.trechoEsperadoNoTexto];
        for (const t of trechos) {
          const tNorm = t.toLowerCase();
          const respNorm = resposta.textoResposta.toLowerCase();
          if (tNorm === 'não encontrei') {
            const expressouAusencia = /(?:n[aã]o\s+(?:encontrei|apareceu|consta|est[aá]|tem)|sem\s+registro)/i.test(respNorm);
            if (!expressouAusencia) {
              passou = false;
              motivosFalha.push(`Texto da resposta não expressou ausência do dado: "${t}"`);
            }
          } else if (!respNorm.includes(tNorm)) {
            passou = false;
            motivosFalha.push(`Texto da resposta não conteve o trecho esperado: "${t}"`);
          }
        }
      }

      if (passou) {
        totalAcertos++;
        console.log(`[Resultado]: ✅ APROVADO`);
      } else {
        console.log(`[Resultado]: ❌ REPROVADO - Motivo: ${motivosFalha.join(' | ')}`);
      }

      relatorioCasos.push({
        id: caso.id,
        mensagem: caso.mensagem,
        sucesso: passou,
        toolsChamadas: toolsAcionadas,
        enviouAnexo,
        nomeAnexo,
        respostaResumo: resposta.textoResposta.replace(/\n/g, ' ').substring(0, 100),
        guardrailDisparado: guardrailsAtivados[0],
        motivoFalha: motivosFalha.join('; ') || undefined,
      });

      // Alimenta o histórico da conversa
      historico.push({
        id: `msg-${caso.id}-vega`,
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '14:00',
        timestamp: new Date().toISOString(),
        texto: resposta.textoResposta,
        anexos: resposta.anexos,
        opcoes: resposta.opcoes,
        rastro: resposta.rastro,
      });
    }

    const taxa = ((totalAcertos / casos.length) * 100).toFixed(1);
    console.log(`\n============================================================`);
    console.log(`RESUMO DO MODELO ${modeloNome}: ${totalAcertos}/${casos.length} acertos (${taxa}%)`);
    console.log(`============================================================\n`);

    return {
      modeloNome,
      totalCasos: casos.length,
      totalAcertos,
      taxaAcerto: Number(taxa),
      relatorioCasos,
    };
  } finally {
    // Limpeza
    console.log('>>> [Limpeza] Removendo dados de teste do Supabase...');
    try {
      const sb = getSupabaseClient();
      await sb.from('trechos').delete().in('documento_id', docsParaLimpar);
    } catch {}

    for (const docId of docsParaLimpar) {
      try {
        await removerDocumento(docId);
      } catch {}
    }

    for (const tId of titularesParaLimpar) {
      try {
        await removerTitular(tId);
      } catch {}
    }
    console.log('>>> [Limpeza] Dados de teste removidos com sucesso.\n');
  }
}

async function main() {
  const modeloPadrao = 'gpt-5.4-mini';
  console.log(`\n================================================================`);
  console.log(`BATERIA DE INTERPRETAÇÃO VEGA — TESTE DE DECISÃO PURA DA IA`);
  console.log(`================================================================`);

  // 1. Executa com gpt-5.4-mini
  const resultadoMini = await executarBateriaInterpretacao(modeloPadrao);

  // 2. Tenta executar com gpt-5.4 (se disponível no projeto OpenAI)
  let resultadoForte: any = null;
  let statusForteInfo = '';
  const modeloForte = 'gpt-5.4';

  console.log(`\n>>> [Verificação de Modelo] Testando conectividade com "${modeloForte}"...`);
  const checkForte = await verificarAcessoAoModelo(modeloForte);
  if (checkForte.disponivel) {
    resultadoForte = await executarBateriaInterpretacao(modeloForte);
  } else {
    statusForteInfo = `Indisponível no projeto OpenAI (${checkForte.erro || 'HTTP 403 PermissionDeniedError'})`;
    console.warn(`[Acesso a Modelo]: ${modeloForte} não disponível na chave da conta: ${checkForte.erro}`);
  }

  // Tabela Comparativa Lado a Lado
  console.log('\n================================================================');
  console.log('TABELA COMPARATIVA LADO A LADO DOS MODELOS:');
  console.log('================================================================');
  console.log(`Modelo Homologado (${modeloPadrao}): ${resultadoMini.totalAcertos}/${resultadoMini.totalCasos} acertos (${resultadoMini.taxaAcerto}%)`);
  if (resultadoForte) {
    console.log(`Modelo Mais Forte (${modeloForte}): ${resultadoForte.totalAcertos}/${resultadoForte.totalCasos} acertos (${resultadoForte.taxaAcerto}%)`);
  } else {
    console.log(`Modelo Mais Forte (${modeloForte}): ${statusForteInfo}`);
  }
  console.log('================================================================\n');

  console.log(`DETALHAMENTO CASO A CASO — MODELO PADRÃO (${modeloPadrao}):`);
  resultadoMini.relatorioCasos.forEach((r) => {
    const status = r.sucesso ? '✅ SIM' : '❌ NÃO';
    const anexoStr = r.enviouAnexo ? ` | Anexo: "${r.nomeAnexo}"` : '';
    const guardrailStr = r.guardrailDisparado ? ` | Guardrail: ${r.guardrailDisparado}` : '';
    console.log(`Caso ${String(r.id).padStart(2, '0')}: ${status} | "${r.mensagem}" | Tools: [${r.toolsChamadas.join(', ')}]${anexoStr}${guardrailStr}`);
    if (!r.sucesso && r.motivoFalha) {
      console.log(`   -> Falha: ${r.motivoFalha}`);
    }
  });

  if (resultadoForte) {
    console.log(`\nDETALHAMENTO CASO A CASO — MODELO MAIS FORTE (${modeloForte}):`);
    resultadoForte.relatorioCasos.forEach((r: any) => {
      const status = r.sucesso ? '✅ SIM' : '❌ NÃO';
      const anexoStr = r.enviouAnexo ? ` | Anexo: "${r.nomeAnexo}"` : '';
      const guardrailStr = r.guardrailDisparado ? ` | Guardrail: ${r.guardrailDisparado}` : '';
      console.log(`Caso ${String(r.id).padStart(2, '0')}: ${status} | "${r.mensagem}" | Tools: [${r.toolsChamadas.join(', ')}]${anexoStr}${guardrailStr}`);
      if (!r.sucesso && r.motivoFalha) {
        console.log(`   -> Falha: ${r.motivoFalha}`);
      }
    });
  }
}

main().catch(console.error);
