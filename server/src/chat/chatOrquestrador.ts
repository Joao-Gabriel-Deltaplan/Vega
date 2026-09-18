import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { gerarEmbedding } from '../ai/openaiProvider.js';
import {
  obterTitularPorNome,
  obterTodosTitulares,
  obterTodosDocumentos,
  obterTodosConhecimentos,
  salvarOuAtualizarTitular,
} from '../storage.js';
import { buscarDocumentos, isConfirmacaoSimples } from '../busca/motor.js';
import { buscarConhecimento } from '../busca/motorConhecimento.js';
import {
  Contato,
  DocumentoRegistro,
  Anexo,
  Mensagem,
  CampoTitularId,
  ItemConhecimento,
  RastroRegistro,
  EtapaRastro,
  DocumentoRastro,
  AnexoRastro,
  CorrecaoPendenteFicha,
} from '../types.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { criarAnexoParaDocumento } from '../pdfService.js';
import { mascararDadosSensiveis, mascararDocumento, truncarTrecho } from '../utils/segurancaUtils.js';

import {
  calcularDiasRestantes,
  determinarStatusVencimento,
  atualizarValidadeDocumento,
  silenciarAlertasDocumento,
  parseDataBr,
} from '../vencimentos/alertaVencimentoService.js';

export type IntencaoChat =
  | 'saudacao_ou_vago'
  | 'pedir_arquivo'
  | 'dado_pessoal'
  | 'pergunta_conteudo'
  | 'corrigir_dado'
  | 'consultar_vencimentos'
  | 'silenciar_alerta'
  | 'fora_de_escopo';

export interface ClassificacaoChatResponse {
  intencao: IntencaoChat;
  pessoa?: string;
  origemPessoa?: 'mensagem_atual' | 'contexto';
  campos?: string[];
  documento_citado?: string;
  pergunta_completa: string;
  termo_busca: string;
  pergunta_reescrita: string;
  campo?: string;
  campo_corrigir?: string;
  valor_novo?: string;
  tempoMs: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
}

export interface TrechoEncontrado {
  id: string;
  documento_id: string;
  titulo_documento: string;
  pessoa_id: string | null;
  corporativo: boolean;
  pagina: number;
  conteudo: string;
  similaridade: number;
}

export interface ResultadoTextoIA {
  texto: string;
  tempoMs: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
}

export interface ResultadoChatOrquestrador {
  textoResposta: string;
  anexos?: Anexo[];
  opcoes?: { id: string; titulo: string }[];
  origem: 'motor' | 'ia';
  intencaoDetectada: IntencaoChat;
  perguntaReescrita: string;
  buscaUsada?: string;
  similaridade?: string;
  trechosUsados?: TrechoEncontrado[];
  documentoOferecidoId?: string;
  correcaoPendente?: CorrecaoPendenteFicha;
  rastro?: RastroRegistro;
}

/**
 * Localiza o documento físico de origem no cofre para um campo de titular,
 * garantindo que apenas documentos existentes no cofre sejam retornados.
 */
function resolverDocumentoOrigem(
  origemId: string | undefined,
  origemNome: string | undefined,
  todosDocs: DocumentoRegistro[],
  campoId?: string,
  titularNome?: string
): DocumentoRegistro | undefined {
  if (origemId) {
    const d = todosDocs.find((doc) => doc.id === origemId);
    if (d) return d;
  }

  if (origemNome) {
    const nomeNorm = normalizarParaBusca(origemNome);
    // Match exato por título ou arquivo
    const dExato = todosDocs.find((doc) => {
      const docTitNorm = normalizarParaBusca(doc.titulo);
      const docArqNorm = normalizarParaBusca(doc.arquivo);
      return docTitNorm === nomeNorm || docArqNorm === nomeNorm;
    });
    if (dExato) return dExato;

    // Match parcial seguro (apenas se nomeNorm tiver 4+ caracteres)
    if (nomeNorm.length >= 4) {
      const d = todosDocs.find((doc) => {
        const docTitNorm = normalizarParaBusca(doc.titulo);
        const docArqNorm = normalizarParaBusca(doc.arquivo);
        return docTitNorm.includes(nomeNorm) || docArqNorm.includes(nomeNorm);
      });
      if (d) return d;
    }
  }

  if (campoId) {
    if (['cnh', 'validadeCnh', 'categoriaCnh'].includes(campoId)) {
      return todosDocs.find((doc) => {
        const titNorm = normalizarParaBusca(doc.titulo);
        const arqNorm = normalizarParaBusca(doc.arquivo);
        const tipoNorm = normalizarParaBusca(doc.tipo || '');
        const ehCnh = titNorm.includes('cnh') || arqNorm.includes('cnh') || tipoNorm.includes('cnh');
        const ehDoTitular = titularNome
          ? titNorm.includes(normalizarParaBusca(titularNome)) || doc.titular?.toLowerCase().includes('thomaz')
          : true;
        return ehCnh && ehDoTitular;
      });
    }

    if (['estadoCivil'].includes(campoId)) {
      return todosDocs.find((doc) => {
        const titNorm = normalizarParaBusca(doc.titulo);
        const arqNorm = normalizarParaBusca(doc.arquivo);
        return titNorm.includes('casamento') || titNorm.includes('certidao') || arqNorm.includes('casamento');
      });
    }

    if (['rg', 'cpf', 'filiacao', 'dataNascimento'].includes(campoId)) {
      const cnh = todosDocs.find((doc) => {
        const titNorm = normalizarParaBusca(doc.titulo);
        const arqNorm = normalizarParaBusca(doc.arquivo);
        return titNorm.includes('cnh') || arqNorm.includes('cnh');
      });
      if (cnh) return cnh;
    }
  }

  return undefined;
}

/**
 * Aplica o mascaramento único padronizado para valores de campos individuais (RG e CPF)
 * Sempre no mesmo formato do rastro: CPF ***.***.***-08 e RG **.***.***-9
 */
function mascararValorCampo(campoId: string, valor: string): string {
  return mascararDocumento(campoId, valor);
}

/**
 * Verifica se documentos pessoais (CPF/RG) devem ser exibidos completos nas respostas aos usuários
 * Controlado pela variável de ambiente MOSTRAR_DOCUMENTOS_COMPLETOS=true
 */
export function deveMostrarDocumentosCompletos(): boolean {
  const val = process.env.MOSTRAR_DOCUMENTOS_COMPLETOS?.trim().toLowerCase();
  return val === 'true' || val === '1' || val === 'sim';
}

/**
 * Formata o valor de um campo para a resposta exibida ao usuário (painel/WhatsApp).
 * Se MOSTRAR_DOCUMENTOS_COMPLETOS=true, CPF e RG aparecem completos.
 * Caso contrário, aparecem com o mascaramento padrão.
 */
function formatarValorParaUsuario(campoId: string, valor: string): string {
  if (!valor) return valor;
  const c = campoId.toLowerCase();

  if (deveMostrarDocumentosCompletos()) {
    if (c === 'cpf') {
      const limpo = valor.replace(/\D/g, '');
      if (limpo.length === 11) {
        return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9, 11)}`;
      }
      return valor;
    }
    if (c === 'rg') {
      return valor;
    }
    return valor;
  }

  // Se a configuração for false, aplica o mascaramento parcial
  return mascararValorCampo(campoId, valor);
}

/**
 * Calcula o custo estimado em dólares americanos para as chamadas da OpenAI
 */
function calcularCustoEstimado(modelo: string, tokensPrompt: number, tokensCompletion: number): number {
  if (modelo.includes('mini') || modelo.includes('gpt-5.4-mini') || modelo.includes('gpt-4o-mini')) {
    // ~$0.15 por 1M tokens de entrada, ~$0.60 por 1M tokens de saída
    const custoPrompt = (tokensPrompt * 0.15) / 1_000_000;
    const custoCompletion = (tokensCompletion * 0.6) / 1_000_000;
    return Number((custoPrompt + custoCompletion).toFixed(6));
  }
  // Modelos standard
  const custoPrompt = (tokensPrompt * 2.5) / 1_000_000;
  const custoCompletion = (tokensCompletion * 10.0) / 1_000_000;
  return Number((custoPrompt + custoCompletion).toFixed(6));
}

/**
 * Formata ou resume o conteúdo de um item de conhecimento citando o título
 */
async function formatarOuResumirConhecimento(
  titulo: string,
  conteudo: string,
  openai: OpenAI
): Promise<ResultadoTextoIA> {
  const inicio = Date.now();
  if (conteudo.length <= 350) {
    return {
      texto: `De acordo com a instrução *${titulo}*:\n${conteudo}`,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';
  try {
    const res = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        {
          role: 'system',
          content:
            'Você é a assistente VEGA da construtora Delta Plan. Apresente o conteúdo da instrução corporativa de forma resumida, clara e profissional em português do Brasil, citando o título no início. Use obrigatoriamente a formatação do WhatsApp: *negrito* com um asterisco, _itálico_, sem títulos (#), sem tabelas e sem links em markdown. Negrito só quando ajudar a leitura.',
        },
        {
          role: 'user',
          content: `Título: "${titulo}"\nConteúdo:\n${conteudo}`,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 300,
    });
    const resposta = res.choices[0]?.message?.content?.trim() || `De acordo com *${titulo}*:\n${conteudo}`;
    const textoLimpo = resposta.replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+/gm, '');

    return {
      texto: textoLimpo,
      tempoMs: Date.now() - inicio,
      tokensPrompt: res.usage?.prompt_tokens || 0,
      tokensCompletion: res.usage?.completion_tokens || 0,
      tokensTotal: res.usage?.total_tokens || 0,
    };
  } catch {
    return {
      texto: `De acordo com *${titulo}*:\n${conteudo}`,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }
}

/**
 * Normaliza uma string apenas para operações de busca e comparação
 * (remove acentos, converte para minúsculas, remove pontuações)
 * sem alterar a mensagem original do usuário.
 */
export function normalizarParaBusca(texto: string): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»\\\[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca por nome nos títulos e dados da aba Conhecimento
 */
export async function buscarConhecimentoPorNome(
  termo: string,
  conhecimentos: ItemConhecimento[]
): Promise<{ item: ItemConhecimento; score: number } | null> {
  if (!termo || !conhecimentos || conhecimentos.length === 0) return null;

  const termoNorm = normalizarParaBusca(termo);
  if (!termoNorm) return null;

  // 1. Correspondência exata do título
  for (const c of conhecimentos) {
    const titNorm = normalizarParaBusca(c.titulo);
    if (titNorm === termoNorm) {
      return { item: c, score: 100 };
    }
  }

  // 2. Se o texto contém o título inteiro do conhecimento (ex: "o que tem em testes jg" ou "testes jg")
  for (const c of conhecimentos) {
    const titNorm = normalizarParaBusca(c.titulo);
    if (titNorm.length >= 3 && termoNorm.includes(titNorm)) {
      return { item: c, score: 95 };
    }
  }

  // 3. Se o título contém o termo de busca (ex: "proposta comercial" dentro de "Regra de Negócio: Proposta Comercial...")
  for (const c of conhecimentos) {
    const titNorm = normalizarParaBusca(c.titulo);
    if (termoNorm.length >= 4 && titNorm.includes(termoNorm)) {
      return { item: c, score: 90 };
    }
  }

  // 4. Fallback com o motorConhecimento (siglas como LGPD, similaridade de Levenshtein, etc.)
  const resultadoMotor = await buscarConhecimento(termo, conhecimentos);
  if (resultadoMotor.status === 'unico' && resultadoMotor.instrucao && resultadoMotor.score >= 70) {
    return { item: resultadoMotor.instrucao, score: resultadoMotor.score };
  }

  return null;
}

/**
 * Extrai o último titular mencionado no histórico de mensagens (do mais recente para o mais antigo)
 */
function extrairUltimoTitularDoHistorico(historicoRecente: Mensagem[]): string | undefined {
  if (!historicoRecente || historicoRecente.length === 0) return undefined;
  for (let i = historicoRecente.length - 1; i >= 0; i--) {
    const msg = historicoRecente[i];
    if (msg.rastro?.pessoa) {
      return msg.rastro.pessoa;
    }
    const textoNorm = normalizarParaBusca(msg.texto || '');
    if (textoNorm.includes('thomaz') || textoNorm.includes('tomas')) {
      return 'Thomaz';
    }
  }
  return undefined;
}

/**
 * 1. CLASSIFICAÇÃO E REESCRITA COM UMA ÚNICA CHAMADA AO gpt-5.4-mini (JSON, temp 0.1)
 * Otimizado: envia apenas os títulos necessários e as últimas 4 mensagens (Meta: < 1.500 tokens).
 */
export async function classificarEReescreverMensagem(
  mensagemUsuario: string,
  historicoRecente: Mensagem[],
  openai: OpenAI
): Promise<ClassificacaoChatResponse> {
  const inicio = Date.now();
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  const [titulares, conhecimentos, docs] = await Promise.all([
    obterTodosTitulares(),
    obterTodosConhecimentos(),
    obterTodosDocumentos(),
  ]);
  const nomesTitularesConhecidos = titulares.map((t) => t.nome).join(', ');
  const titulosConhecimento = conhecimentos.map((c) => `"${c.titulo}"`).join(', ');
  const titulosDocs = docs.map((d) => `"${d.titulo}"`).join(', ');

  const systemPrompt = `Você é o classificador de intenções da VEGA, assistente corporativa da Delta Plan.
Titulares cadastrados: ${nomesTitularesConhecidos || 'Nenhum titular cadastrado'}.
Base de Conhecimento: ${titulosConhecimento || '"Escritório Deltaplan", "testes jg", "Regra de Negócio: Proposta Comercial e Orçamentos"'}.
Documentos no cofre: ${titulosDocs || '"CNH Thomaz", "Crea", "CRT", "Certidão de Casamento", "Cartão Vacinas"'}.

Retorne ESTRITAMENTE um objeto JSON com a seguinte estrutura:
{
  "intencao": "saudacao_ou_vago" | "pedir_arquivo" | "dado_pessoal" | "pergunta_conteudo" | "corrigir_dado" | "consultar_vencimentos" | "silenciar_alerta" | "fora_de_escopo",
  "pessoa": "nome do titular (ex: Thomaz) ou vazio",
  "campos": ["lista de campos cadastrais solicitados ou vazio (valores padronizados: endereco, estadoCivil, rg, profissao, cpf, filiacao, dataNascimento, cnh, validadeCnh, categoriaCnh, orgaoEmissor)"],
  "campo_corrigir": "nome do campo a ser corrigido (ex: profissao, cpf, rg, etc.) ou vazio",
  "valor_novo": "novo valor correto informado pelo usuário ou vazio",
  "documento_citado": "nome do documento físico citado explicitamente ou vazio",
  "pergunta_completa": "versão clara e completa da pergunta sem perder nenhuma informação",
  "termo_busca": "versão curta para busca por nome de arquivo ou tópico"
}

REGRAS RÍGIDAS DE INTENÇÃO E ESCOPO:
1. "saudacao_ou_vago": Apenas saudações puras ("oi", "olá", "bom dia") ou pedidos vagos ("me ajuda"). NUNCA use para perguntas com assunto ou listas.
2. "pedir_arquivo": Pedido exclusivo de envio de arquivo físico/PDF ("me manda a CNH", "envia o PDF do CREA", "baixa o arquivo", "qual é a CNH do Thomaz"). NUNCA classifique como pedir_arquivo se a mensagem pedir dados cadastrais ou campos!
3. "dado_pessoal": Perguntas sobre dados cadastrais de titulares (RG, CPF, endereço, estado civil, profissão, mãe, pai, filiação, data de nascimento, validade da CNH etc.).
   - Se a mensagem citar campos cadastrais de uma pessoa física titular, a intenção É SEMPRE "dado_pessoal". Preencha a lista "campos" com todos os campos pedidos!
4. "pergunta_conteudo": Perguntas sobre normas, regras, políticas corporativas ou tópicos da base de conhecimento ("o que tem em testes jg", "qual o endereço do escritório").
5. "corrigir_dado": Quando o usuário afirmar que uma informação cadastral de titular está errada, incorreta ou precisar ser corrigida (ex.: "a profissão do Thomaz está errada, é Técnico em Eletrotécnica", "está errado, é Técnico em Eletrotécnica", "o CPF dele está errado", "a profissão não é essa").
   - Identifique a "pessoa" (da mensagem atual ou do contexto das últimas mensagens).
   - Identifique o "campo_corrigir" (se a mensagem não citar diretamente o nome do campo, verifique qual campo a VEGA respondeu na mensagem anterior!).
   - Extraia o "valor_novo" caso o usuário tenha informado o valor correto. Se ele apenas disse que está errado sem informar o valor, deixe "valor_novo": "".
6. "consultar_vencimentos": Perguntas sobre prazos de validade ou vencimento de documentos do cofre ("tem algum documento vencendo?", "o que vence este mês?", "quais documentos estão vencidos?", "documentos a vencer", "validade dos documentos").
7. "silenciar_alerta": Quando o usuário solicitar para parar de alertar sobre o vencimento de um documento (ex: "pare de alertar o CRT do Thomaz", "não alerte mais o CRT", "desative os alertas do CRT", "parar de alertar documento X"). Preencha "documento_citado" (ex: "CRT") e "pessoa" se citada.
8. "fora_de_escopo": Assuntos alheios à construtora Delta Plan.

REGRAS CRÍTICAS DE SUJEITO E CONTEXTO:
- SE A MENSAGEM ATUAL CITA UM SUJEITO (pessoa ou empresa), ele SEMPRE SUBSTITUI o sujeito das mensagens anteriores! O contexto anterior DEVE SER IGNORADO nesse caso!
- RECONHECIMENTO DA EMPRESA: Os termos "Delta", "Deltaplan", "Delta Plan", "empresa", "escritório", "construtora" referem-se à própria Delta Plan Construtora. Nesses casos, a intenção É SEMPRE "pergunta_conteudo" (busca no Conhecimento e documentos corporativos), NUNCA "dado_pessoal" de um titular, e "pessoa" DEVE SER VAZIA ("")!
- O CONTEXTO SÓ DEVE SER USADO quando a mensagem atual NÃO tem sujeito nenhum (ex.: perguntas com pronomes como "ele", "dele", ou elípticas como "e a validade?", "e o CPF dele?", "e o RG dele?", "e o endereço dele?"). Nesses casos, herde o titular mencionado anteriormente no histórico.

EXEMPLOS OBRIGATÓRIOS:
- "pare de alertar o CRT do Thomaz" -> {"intencao": "silenciar_alerta", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CRT", "pergunta_completa": "Desativar alertas de vencimento do documento CRT do Thomaz", "termo_busca": "CRT"}
- "não alerte mais sobre o CRT" -> {"intencao": "silenciar_alerta", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CRT", "pergunta_completa": "Desativar alertas de vencimento do documento CRT", "termo_busca": "CRT"}
- "qual o CPF do Thomaz?" -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o CPF do Thomaz?", "termo_busca": "Thomaz"}
- "endereço delta" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o endereço da Delta Plan?", "termo_busca": "Escritorio Deltaplan"}
- "endereço deltaplan" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o endereço do escritório da Deltaplan?", "termo_busca": "Escritorio Deltaplan"}
- "e o endereço dele?" (após falar do Thomaz) -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["endereco"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o endereço do Thomaz?", "termo_busca": "Thomaz"}
- "e o RG dele?" (após falar do Thomaz) -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["rg"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o RG do Thomaz?", "termo_busca": "Thomaz"}
- "me envie esses documentos do thomaz, Endereço, estado civil, RG, profissão." -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["endereco", "estadoCivil", "rg", "profissao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Quais são o endereço, estado civil, RG e profissão do Thomaz?", "termo_busca": "Thomaz"}
- "tem algum documento vencendo?" -> {"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Consultar documentos com vencimento próximo no cofre", "termo_busca": ""}
- "o que vence este mês?" -> {"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Consultar documentos que vencem este mês", "termo_busca": ""}
- "quais documentos estão vencidos?" -> {"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Consultar documentos vencidos no cofre", "termo_busca": ""}
- "a validade da CNH do Thomaz é 10/05/2030" -> {"intencao": "corrigir_dado", "pessoa": "Thomaz", "campo_corrigir": "validadeCnh", "valor_novo": "10/05/2030", "campos": ["validadeCnh"], "documento_citado": "", "pergunta_completa": "Corrigir validade da CNH do Thomaz para 10/05/2030", "termo_busca": ""}
- "a validade da CNH do Thomaz está errada, é 10/05/2030" -> {"intencao": "corrigir_dado", "pessoa": "Thomaz", "campo_corrigir": "validadeCnh", "valor_novo": "10/05/2030", "campos": ["validadeCnh"], "documento_citado": "", "pergunta_completa": "Corrigir validade da CNH do Thomaz para 10/05/2030", "termo_busca": ""}
- "a profissão do Thomaz está errada, é Técnico em Eletrotécnica" -> {"intencao": "corrigir_dado", "pessoa": "Thomaz", "campo_corrigir": "profissao", "valor_novo": "Técnico em Eletrotécnica", "campos": ["profissao"], "documento_citado": "", "pergunta_completa": "Corrigir profissão do Thomaz para Técnico em Eletrotécnica", "termo_busca": ""}
- "está errado, é Técnico em Eletrotécnica" (após VEGA responder profissão) -> {"intencao": "corrigir_dado", "pessoa": "Thomaz", "campo_corrigir": "profissao", "valor_novo": "Técnico em Eletrotécnica", "campos": ["profissao"], "documento_citado": "", "pergunta_completa": "Corrigir profissão do Thomaz para Técnico em Eletrotécnica", "termo_busca": ""}
- "está errado" (após VEGA responder profissão) -> {"intencao": "corrigir_dado", "pessoa": "Thomaz", "campo_corrigir": "profissao", "valor_novo": "", "campos": ["profissao"], "documento_citado": "", "pergunta_completa": "Informar que o dado do Thomaz está errado", "termo_busca": ""}
- "quem é a mãe do Thomaz" -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["filiacao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Quem é a mãe do Thomaz?", "termo_busca": "filiacao Thomaz"}
- "qual é a CNH do Thomaz" -> {"intencao": "pedir_arquivo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH Thomaz", "pergunta_completa": "Enviar documento CNH Thomaz", "termo_busca": "CNH Thomaz"}
- "o que tem em testes jg" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o conteúdo do documento ou instrução testes jg?", "termo_busca": "testes jg"}
- "sim" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Confirmar envio do documento oferecido", "termo_busca": ""}`;

  // Limita o histórico recente estritamente às últimas 4 mensagens e extrai apenas remetente e texto (sem rastros pesados)
  const ultimas4Msgs = (historicoRecente || [])
    .slice(-4)
    .map((m) => `${m.remetente === 'cliente' ? 'Usuário' : 'VEGA'}: ${m.texto || ''}`)
    .filter((linha) => linha.trim().length > 0)
    .join('\n');

  const userPromptContent = ultimas4Msgs
    ? `Histórico recente da conversa (últimas 4 mensagens):\n${ultimas4Msgs}\n\nMensagem atual do usuário: "${mensagemUsuario}"`
    : `Mensagem atual do usuário: "${mensagemUsuario}"`;

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPromptContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: 300,
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    const tempoMs = Date.now() - inicio;

    const msgNorm = normalizarParaBusca(mensagemUsuario);

    // Mapeamento e detecção de segurança para campos cadastrais
    const padroesCampos: { campo: string; regex: RegExp }[] = [
      { campo: 'endereco', regex: /\b(endere[cç]o|mora|resid[eê]ncia)\b/i },
      { campo: 'estadoCivil', regex: /\b(estado\s*civil|casad[oa]|solteir[oa]|divorciad[oa])\b/i },
      { campo: 'rg', regex: /\b(rg|identidade)\b/i },
      { campo: 'profissao', regex: /\b(profiss[aã]o|cargo|ocupa[cç][aã]o)\b/i },
      { campo: 'cpf', regex: /\b(cpf)\b/i },
      { campo: 'filiacao', regex: /\b(m[aã]e|pai|pais|filia[cç][aã]o)\b/i },
      { campo: 'dataNascimento', regex: /\b(nascimento|data\s*de\s*nascimento|idade)\b/i },
      { campo: 'validadeCnh', regex: /\b(validade(\s*da\s*cnh)?|vencimento)\b/i },
      { campo: 'categoriaCnh', regex: /\b(categoria(\s*da\s*cnh)?)\b/i },
      { campo: 'cnh', regex: /\b(n[uú]mero\s*da\s*cnh|numero\s*da\s*cnh)\b/i },
    ];

    const camposDetectadosRegex: string[] = [];
    for (const p of padroesCampos) {
      if (p.regex.test(msgNorm)) {
        camposDetectadosRegex.push(p.campo);
      }
    }

    // Detecção expressa de sujeitos na mensagem atual
    const REGEX_EMPRESA = /\b(delta|deltaplan|delta\s*plan|empresa|escrit[oó]rio|escritorio|construtora)\b/i;
    const citaEmpresaNaMensagem = REGEX_EMPRESA.test(msgNorm);
    const citaThomazNaMensagem = /\b(thomaz|tomas)\b/i.test(msgNorm);

    // Detecção de intenção de correção de dado cadastral
    const REGEX_CORRECAO = /\b(est[aá]\s*errad[oa]|t[aá]\s*errad[oa]|n[aã]o\s*[eé]|incorret[oa]|corrija|corrigir|alterar|mudar\s*para|o\s*certo\s*[eé]|o\s*correto\s*[eé])\b/i;
    const ehMensagemCorrecao =
      REGEX_CORRECAO.test(msgNorm) ||
      parsed.intencao === 'corrigir_dado' ||
      (/\bvalidade\b/i.test(msgNorm) && /\b\d{2}\/\d{2}\/\d{4}\b/.test(msgNorm));

    // Detecção de consulta de vencimentos de documentos
    const REGEX_CONSULTA_VENCIMENTO = /\b(tem\s*algum\s*documento\s*vencendo|o\s*que\s*vence|quais\s*documentos?\s*est[aã]o\s*vencidos?|documentos?\s*vencidos?|documentos?\s*a\s*vencer|vencimento\s*de\s*documentos?|validade\s*dos?\s*documentos?)\b/i;
    const ehConsultaVencimento = REGEX_CONSULTA_VENCIMENTO.test(msgNorm) || parsed.intencao === 'consultar_vencimentos';

    // Detecção de parar de alertar / silenciar alertas ("pare de alertar o CRT do Thomaz")
    const REGEX_SILENCIAR = /\b(pare\s*de\s*alerta(r)?|n[aã]o\s*alerte(\s*mais)?|desative(\s*os)?\s*alerta(s)?|desativar\s*alerta(s)?|silenciar\s*alerta(s)?|parar\s*de\s*alerta(r)?)\b/i;
    const ehSilenciarAlerta = REGEX_SILENCIAR.test(msgNorm) || parsed.intencao === 'silenciar_alerta';

    let origemPessoa: 'mensagem_atual' | 'contexto' | undefined = undefined;

    if (ehSilenciarAlerta) {
      parsed.intencao = 'silenciar_alerta';
      if (!parsed.pessoa && citaThomazNaMensagem) {
        parsed.pessoa = 'Thomaz';
      }
      if (!parsed.documento_citado) {
        if (/\bcrt\b/i.test(msgNorm)) parsed.documento_citado = 'CRT';
        else if (/\bcrea\b/i.test(msgNorm)) parsed.documento_citado = 'CREA';
        else if (/\bcnh\b/i.test(msgNorm)) parsed.documento_citado = 'CNH';
      }
    } else if (ehConsultaVencimento && !ehMensagemCorrecao) {
      parsed.intencao = 'consultar_vencimentos';
      parsed.pessoa = '';
      parsed.campos = [];
      origemPessoa = undefined;
    } else if (citaEmpresaNaMensagem) {
      // Regra 1 e 2: Se a mensagem atual cita a empresa, ela SEMPRE substitui o sujeito anterior.
      // Intenção é pergunta_conteudo e pessoa é nula.
      parsed.pessoa = '';
      parsed.intencao = 'pergunta_conteudo';
      parsed.campos = [];
      origemPessoa = undefined;
      if (/\b(endere[cç]o|mora|resid[eê]ncia|localiza|onde\s*fica)\b/i.test(msgNorm)) {
        parsed.termo_busca = 'Escritório Deltaplan';
        parsed.pergunta_completa = 'Qual é o endereço do escritório da Deltaplan?';
      }
    } else if (citaThomazNaMensagem) {
      // Citou expressamente o titular na mensagem atual
      parsed.pessoa = 'Thomaz';
      origemPessoa = 'mensagem_atual';
    } else {
      // Mensagem atual NÃO cita nem a empresa nem pessoa explicitamente
      // Contexto só deve ser usado quando a mensagem não tem sujeito nenhum
      const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
      if (titularDoHistorico) {
        const temPronomeOuCampo = /\b(ele|dele|dela|ela)\b/i.test(msgNorm) || camposDetectadosRegex.length > 0 || ehMensagemCorrecao;
        if (parsed.pessoa || temPronomeOuCampo) {
          parsed.pessoa = titularDoHistorico;
          origemPessoa = 'contexto';
        }
      } else if (parsed.pessoa) {
        origemPessoa = 'contexto';
      }
    }

    if (ehMensagemCorrecao) {
      parsed.intencao = 'corrigir_dado';
      if (!parsed.campo_corrigir) {
        if (camposDetectadosRegex.length > 0) {
          parsed.campo_corrigir = camposDetectadosRegex[0];
        } else {
          // Tenta identificar o campo da última mensagem do assistente
          const ultimaMsgAss = [...(historicoRecente || [])].reverse().find((m) => m.remetente === 'assistente');
          const textoAssNorm = normalizarParaBusca(ultimaMsgAss?.texto || '');
          for (const p of padroesCampos) {
            if (p.regex.test(textoAssNorm)) {
              parsed.campo_corrigir = p.campo;
              break;
            }
          }
        }
      }

      // Se valor_novo ainda estiver vazio, tenta extrair por regex na mensagem atual
      if (!parsed.valor_novo) {
        const matchData = mensagemUsuario.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
        if (matchData) {
          parsed.valor_novo = matchData[1];
        } else {
          const matchValor = mensagemUsuario.match(/(?:é|e|para|sendo|correto é|certo é|na verdade é)\s+([^.,\n]+)/i);
          if (matchValor) {
            parsed.valor_novo = matchValor[1].trim();
          }
        }
      }
    }

    // REGRA DE PROTEÇÃO 1: Se a mensagem citar campos cadastrais e NÃO for sobre a empresa nem correção nem vencimento geral
    if (!citaEmpresaNaMensagem && !ehMensagemCorrecao && !ehConsultaVencimento && camposDetectadosRegex.length > 0) {
      parsed.intencao = 'dado_pessoal';
      const camposSet = new Set([...(parsed.campos || []), ...camposDetectadosRegex]);
      parsed.campos = Array.from(camposSet);
      if (!parsed.pessoa) {
        const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
        if (titularDoHistorico) {
          parsed.pessoa = titularDoHistorico;
          origemPessoa = 'contexto';
        }
      }
    }

    // REGRA DE PROTEÇÃO 2: Pedido explícito de arquivo sem campos cadastrais
    const regexDocSemCampo = /\b(cnh|crea|crt|certidao|cartao\s*vacinas?)\b/i;
    const regexCampoEspecifico = /\b(numero|validade|vencimento|categoria|vence|venc|data|emissao|expedicao|orgao|endereco|estado\s*civil|rg|profissao|cpf|mae|pai|filiacao|alerta|alertar|silenciar|desativar)\b/i;

    if (
      !ehSilenciarAlerta &&
      !ehConsultaVencimento &&
      parsed.intencao !== 'silenciar_alerta' &&
      regexDocSemCampo.test(msgNorm) &&
      !regexCampoEspecifico.test(msgNorm) &&
      (!parsed.campos || parsed.campos.length === 0)
    ) {
      parsed.intencao = 'pedir_arquivo';
      const docMatch = msgNorm.match(regexDocSemCampo);
      const nomeDoc = docMatch ? docMatch[0].toUpperCase() : 'CNH';
      if (msgNorm.includes('thomaz') || (parsed.pessoa && parsed.pessoa.toLowerCase().includes('thomaz'))) {
        parsed.termo_busca = `${nomeDoc} Thomaz`.trim();
        parsed.documento_citado = `${nomeDoc} Thomaz`;
      }
    }

    // REGRA DE PROTEÇÃO 3: Verificação de saudação vs pergunta de conteúdo
    const padroesConteudo = [
      /\bo que (tem|diz|consta|ha|ha) em\b/i,
      /\bo que (diz|fala|tem)\b/i,
      /\bme fal[ae] sobre\b/i,
      /\bqual(is)? a(s)? regra(s)?\b/i,
      /\bqual(is)? a(s)? politica(s)?\b/i,
      /\bqual(is)? o(s)? endereco(s)?\b/i,
      /\bonde fica\b/i,
    ];
    const temPadraoConteudo = padroesConteudo.some((p) => p.test(msgNorm));
    const temTituloConhecimento = conhecimentos.some((c) =>
      msgNorm.includes(normalizarParaBusca(c.titulo))
    );
    const temTituloDoc = docs.some((d) =>
      msgNorm.includes(normalizarParaBusca(d.titulo))
    );

    if (parsed.intencao === 'saudacao_ou_vago' && (temPadraoConteudo || temTituloConhecimento || temTituloDoc)) {
      parsed.intencao = 'pergunta_conteudo';
    }

    const perguntaCompleta = parsed.pergunta_completa || mensagemUsuario;
    const termoBusca = parsed.termo_busca || parsed.documento_citado || perguntaCompleta;

    return {
      intencao: parsed.intencao || 'pergunta_conteudo',
      pessoa: parsed.pessoa || undefined,
      origemPessoa: parsed.pessoa ? (origemPessoa || (citaThomazNaMensagem ? 'mensagem_atual' : 'contexto')) : undefined,
      campos: parsed.campos && parsed.campos.length > 0 ? parsed.campos : undefined,
      campo_corrigir: parsed.campo_corrigir || undefined,
      valor_novo: parsed.valor_novo || undefined,
      documento_citado: parsed.documento_citado || undefined,
      pergunta_completa: perguntaCompleta,
      termo_busca: termoBusca,
      pergunta_reescrita: perguntaCompleta,
      tempoMs,
      tokensPrompt: response.usage?.prompt_tokens || 0,
      tokensCompletion: response.usage?.completion_tokens || 0,
      tokensTotal: response.usage?.total_tokens || 0,
    };
  } catch (err) {
    console.error('[VEGA Chat] Erro na classificação com IA:', err);
    return {
      intencao: 'pergunta_conteudo',
      pergunta_completa: mensagemUsuario,
      termo_busca: mensagemUsuario,
      pergunta_reescrita: mensagemUsuario,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }
}

/**
 * 2. BUSCA VETORIAL NO SUPABASE (5 trechos com match_threshold 0.3)
 */
export async function executarBuscaVetorial(
  perguntaReescrita: string,
  pessoaId: string | null = null,
  matchCount: number = 5
): Promise<TrechoEncontrado[]> {
  const supabase = getSupabaseClient();
  const embeddingPergunta = await gerarEmbedding(perguntaReescrita);

  const { data, error } = await supabase.rpc('buscar_trechos', {
    query_embedding: embeddingPergunta,
    p_pessoa_id: pessoaId,
    match_threshold: 0.3,
    match_count: matchCount,
  });

  if (error) {
    console.error('[VEGA Chat] Erro na busca vetorial no Supabase:', error.message);
    return [];
  }

  return (data || []) as TrechoEncontrado[];
}

/**
 * 3. GERAÇÃO DA RESPOSTA FINAL BASEADA ESTRITAMENTE NOS TRECHOS ENCONTRADOS
 */
export async function responderComTrechos(
  pergunta: string,
  trechos: TrechoEncontrado[],
  openai: OpenAI
): Promise<ResultadoTextoIA> {
  const inicio = Date.now();
  if (trechos.length === 0) {
    return {
      texto: 'Não encontrei nos documentos.',
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  const contextoTrechos = trechos
    .map(
      (t, idx) =>
        `[Trecho ${idx + 1} | Documento: ${t.titulo_documento} | Página: ${t.pagina} | Similaridade: ${(t.similaridade * 100).toFixed(1)}%]\n${t.conteudo}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `Você é a assistente corporativa VEGA da Delta Plan.
Sua tarefa é responder à pergunta do usuário usando ESTRITAMENTE as informações presentes nos trechos fornecidos abaixo.

REGRAS OBRIGATÓRIAS:
1. Se a informação NÃO estiver contida nem mencionada nos trechos, responda exatamente: "Não encontrei nos documentos."
2. Nunca invente ou use conhecimento externo que não esteja nos trechos.
3. Sempre cite o documento de origem da resposta (ex: "De acordo com a *Política de Agendamento*...", ou "...conforme *Certidão de Casamento*", ou "De acordo com o documento *testes jg*...").
4. Considere que variações de nomes de titulares nos documentos (ex: Thomaz / Thomaz Lustri Fabre) referem-se à mesma pessoa.
5. Respostas curtas, diretas e profissionais em português do Brasil.
6. Se o trecho contiver um termo, anotação ou frase curta da base de conhecimento (ex: regras ou limites), use essa informação para responder o que consta no documento respectivo.
7. FORMATAÇÃO OBRIGATÓRIA (PADRÃO WHATSAPP): Use exclusivamente a formatação do WhatsApp:
   - *negrito* com apenas um asterisco (NUNCA use ** com dois asteriscos).
   - _itálico_ com underline.
   - NUNCA use títulos markdown (#, ##, ###).
   - NUNCA use tabelas (|).
   - NUNCA use links em markdown ([texto](url)).
   - Negrito só quando ajudar a leitura (nomes de documentos, valores, datas ou prazos-chave).`;

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Trechos recuperados dos documentos:\n${contextoTrechos}\n\nPergunta do usuário: "${pergunta}"`,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 500,
    });

    const respostaTexto = response.choices[0]?.message?.content?.trim() || 'Não encontrei nos documentos.';
    const textoLimpo = respostaTexto.replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+/gm, '');

    return {
      texto: textoLimpo,
      tempoMs: Date.now() - inicio,
      tokensPrompt: response.usage?.prompt_tokens || 0,
      tokensCompletion: response.usage?.completion_tokens || 0,
      tokensTotal: response.usage?.total_tokens || 0,
    };
  } catch (err) {
    console.error('[VEGA Chat] Erro na resposta com trechos:', err);
    return {
      texto: 'Não encontrei nos documentos.',
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }
}

/**
 * 4. ORQUESTRADOR PRINCIPAL DO CHAT COM RASTRO DE RACIOCÍNIO
 */
export async function processarMensagemChat(dados: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  contato: Contato;
  documentosDisponiveis: DocumentoRegistro[];
  documentoIdDireto?: string;
}): Promise<ResultadoChatOrquestrador> {
  const inicioTotal = Date.now();
  const { mensagemUsuario, historicoRecente, contato, documentosDisponiveis, documentoIdDireto } = dados;
  const primeiroNome = extrairPrimeiroNome(contato.nome);
  const vocativo = primeiroNome ? `, ${primeiroNome}` : '';

  // CASO ESPECIAL: Clique direto em opção ou documento sugerido
  if (documentoIdDireto) {
    if (documentoIdDireto.startsWith('k-')) {
      const todosK = await obterTodosConhecimentos();
      const itemK = todosK.find((k) => k.id === documentoIdDireto);
      const textoK = itemK
        ? `Sobre ${itemK.titulo}${vocativo}:\n${itemK.conteudo}`
        : 'Instrução não localizada na base de conhecimento.';
      const rastro = {
        mensagemId: '',
        usuarioNome: contato.nome,
        usuarioId: contato.id,
        mensagemOriginal: mensagemUsuario || `Acessar instrução ${documentoIdDireto}`,
        perguntaReescrita: itemK?.titulo || documentoIdDireto,
        intencaoDetectada: 'pergunta_conteudo' as IntencaoChat,
        tipoBusca: 'nome_conhecimento',
        documentosEncontrados: itemK
          ? [{ id: itemK.id, titulo: itemK.titulo, similaridade: 100, usadoNaResposta: true, trecho: truncarTrecho(itemK.conteudo, 300) }]
          : [],
        documentoUsado: itemK?.titulo,
        enviouAnexo: false,
        respostaFinal: mascararDadosSensiveis(textoK),
        modeloUsado: 'Motor Interno',
        tokensTotal: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        custoEstimadoUsd: 0,
        tempoTotalMs: Date.now() - inicioTotal,
        etapas: [
          {
            ordem: 1,
            nome: 'Acesso Direto à Instrução',
            descricao: `Item de conhecimento "${itemK?.titulo || documentoIdDireto}" acessado diretamente por seleção na interface.`,
            tempoMs: Date.now() - inicioTotal,
          },
        ],
      };
      return {
        textoResposta: textoK,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: itemK?.titulo || documentoIdDireto,
        rastro,
      };
    } else {
      const doc = documentosDisponiveis.find((d) => d.id === documentoIdDireto);
      if (doc) {
        const textoDoc = `Aqui está o documento solicitado: ${doc.titulo}.`;
        const anexo = await criarAnexoParaDocumento(doc);
        const rastro = {
          mensagemId: '',
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          mensagemOriginal: mensagemUsuario || `Acessar documento ${doc.titulo}`,
          perguntaReescrita: doc.titulo,
          intencaoDetectada: 'pedir_arquivo' as IntencaoChat,
          tipoBusca: 'nome_cofre',
          documentosEncontrados: [{ id: doc.id, titulo: doc.titulo, tipo: doc.tipo, similaridade: 100, usadoNaResposta: true }],
          documentoUsado: doc.titulo,
          enviouAnexo: true,
          anexosDetalhes: [{ nome: anexo.nome, titulo: anexo.titulo, tamanho: anexo.tamanho, tipo: anexo.tipo }],
          respostaFinal: mascararDadosSensiveis(textoDoc),
          modeloUsado: 'Motor Interno',
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: Date.now() - inicioTotal,
          etapas: [
            {
              ordem: 1,
              nome: 'Acesso Direto a Documento Físico',
              descricao: `Documento "${doc.titulo}" entregue diretamente por seleção de opção na interface.`,
              tempoMs: Date.now() - inicioTotal,
            },
          ],
        };
        return {
          textoResposta: textoDoc,
          anexos: [anexo],
          origem: 'motor',
          intencaoDetectada: 'pedir_arquivo',
          perguntaReescrita: doc.titulo,
          rastro,
        };
      }
    }
  }

  // 1. CASO DE CONFIRMAÇÃO DE CORREÇÃO PENDENTE DE DADO CADASTRAL ("sim", "pode alterar", "confirmo")
  const ultimaMsgAssistente = [...historicoRecente].reverse().find((m) => m.remetente === 'assistente');
  const correcaoPendente = ultimaMsgAssistente?.correcaoPendente;

  if (correcaoPendente && isConfirmacaoSimples(mensagemUsuario)) {
    // Verifica permissão configurada para alterar dados
    const autorizadosConfig = process.env.USUARIOS_AUTORIZADOS_CORRECAO?.trim();
    let autorizado = true;
    if (autorizadosConfig) {
      const lista = autorizadosConfig.split(',').map((s) => s.trim().toLowerCase());
      autorizado =
        lista.includes(contato.id.toLowerCase()) ||
        lista.includes(contato.nome.toLowerCase()) ||
        lista.includes(contato.telefone.toLowerCase()) ||
        contato.nivelAcesso === 'diretoria';
    }

    if (!autorizado) {
      const textoNegado = 'Você não possui autorização para alterar dados da ficha cadastral.';
      return {
        textoResposta: textoNegado,
        origem: 'motor',
        intencaoDetectada: 'corrigir_dado',
        perguntaReescrita: 'Alteração cadastral não autorizada',
        rastro: {
          mensagemId: '',
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          mensagemOriginal: mensagemUsuario,
          perguntaReescrita: 'Alteração cadastral não autorizada',
          intencaoDetectada: 'corrigir_dado',
          tipoBusca: 'ficha',
          documentosEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoNegado,
          modeloUsado: 'Motor Interno',
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: Date.now() - inicioTotal,
          etapas: [
            {
              ordem: 1,
              nome: 'Verificação de Permissão',
              descricao: `Usuário ${contato.nome} não possui autorização em USUARIOS_AUTORIZADOS_CORRECAO para alterar dados cadastrais.`,
              tempoMs: Date.now() - inicioTotal,
            },
          ],
        },
      };
    }

    // Caso especial: Confirmação de silenciamento de alerta de vencimento
    if (correcaoPendente.campoId === ('silenciar_alerta' as any) && correcaoPendente.documentoId) {
      await silenciarAlertasDocumento(correcaoPendente.documentoId, true);
      const textoSucesso = `Os alertas de vencimento do documento *${correcaoPendente.documentoTitulo || 'solicitado'}* foram desativados. Se o documento for substituído futuramente, os alertas voltarão a funcionar.`;
      const rastroSilenciar: RastroRegistro = {
        mensagemId: '',
        usuarioNome: contato.nome,
        usuarioId: contato.id,
        mensagemOriginal: mensagemUsuario,
        perguntaReescrita: `Confirmar desativação de alertas: ${correcaoPendente.documentoTitulo}`,
        perguntaCompleta: `Desativar alertas de vencimento do documento ${correcaoPendente.documentoTitulo}`,
        termoBusca: correcaoPendente.documentoTitulo || '',
        intencaoDetectada: 'silenciar_alerta' as IntencaoChat,
        tipoBusca: 'nome_cofre',
        documentosEncontrados: [],
        documentoUsado: correcaoPendente.documentoTitulo || 'Documento do Cofre',
        enviouAnexo: false,
        respostaFinal: textoSucesso,
        modeloUsado: 'Motor Interno',
        tokensTotal: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        custoEstimadoUsd: 0,
        tempoTotalMs: Date.now() - inicioTotal,
        etapas: [
          {
            ordem: 1,
            nome: 'Desativação de Alertas Confirmada',
            descricao: `Alertas do documento "${correcaoPendente.documentoTitulo}" silenciados com sucesso pelo usuário ${contato.nome}.`,
            tempoMs: Date.now() - inicioTotal,
          },
        ],
      };

      return {
        textoResposta: textoSucesso,
        origem: 'motor',
        intencaoDetectada: 'silenciar_alerta',
        perguntaReescrita: `Desativar alertas: ${correcaoPendente.documentoTitulo}`,
        rastro: rastroSilenciar,
      };
    }

    // Aplica e salva a correção na ficha em data/titulares.json
    const titular = await obterTitularPorNome(correcaoPendente.titularNome);
    if (titular && correcaoPendente.campoId !== 'silenciar_alerta') {
      const campoKey = correcaoPendente.campoId as CampoTitularId;
      const dataHojeStr = new Date().toLocaleDateString('pt-BR');
      titular.campos[campoKey] = {
        valor: correcaoPendente.valorNovo,
        origem: 'corrigido pelo chat',
        origemNome: 'corrigido pelo chat',
        origemVisibilidade: 'diretoria',
        conferido: true,
        dataConferencia: dataHojeStr,
        manual: true,
        historicoCorrecao: {
          valorAnterior: correcaoPendente.valorAnterior,
          valorNovo: correcaoPendente.valorNovo,
          corrigidoPor: contato.nome,
          dataHora: new Date().toISOString(),
        },
      };
      await salvarOuAtualizarTitular(titular);

      // Se a correção for de validade da CNH, atualiza também o documento no cofre e zera alertas
      if (campoKey === 'validadeCnh') {
        const todosDocs = await obterTodosDocumentos();
        const docCnh = todosDocs.find(
          (d) =>
            (d.titular?.toLowerCase().includes(correcaoPendente.titularNome.toLowerCase()) ||
              correcaoPendente.titularNome.toLowerCase().includes(d.titular?.toLowerCase() || '')) &&
            (d.tipo?.toLowerCase().includes('cnh') || d.titulo.toLowerCase().includes('cnh'))
        );
        if (docCnh) {
          await atualizarValidadeDocumento(
            docCnh.id,
            correcaoPendente.valorNovo,
            'corrigido pelo chat',
            contato.nome
          );
        }
      }
    }

    const textoConfirmacao = `A *${correcaoPendente.campoLabel}* do *${correcaoPendente.titularNome}* foi alterada com sucesso para *${correcaoPendente.valorNovo}*.`;

    const rastro: RastroRegistro = {
      mensagemId: '',
      usuarioNome: contato.nome,
      usuarioId: contato.id,
      mensagemOriginal: mensagemUsuario,
      perguntaReescrita: `Confirmar correção: ${correcaoPendente.campoLabel} -> ${correcaoPendente.valorNovo}`,
      perguntaCompleta: `Alterar ${correcaoPendente.campoLabel} de ${correcaoPendente.titularNome} de ${correcaoPendente.valorAnterior} para ${correcaoPendente.valorNovo}`,
      termoBusca: correcaoPendente.titularNome,
      pessoa: correcaoPendente.titularNome,
      intencaoDetectada: 'corrigir_dado' as IntencaoChat,
      tipoBusca: 'ficha',
      documentosEncontrados: [],
      documentoUsado: 'Ficha Cadastral (corrigido pelo chat)',
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modeloUsado: 'Motor Interno',
      tokensTotal: 0,
      tokensPrompt: 0,
      tokensCompletion: 0,
      custoEstimadoUsd: 0,
      tempoTotalMs: Date.now() - inicioTotal,
      detalhesCorrecao: {
        campo: correcaoPendente.campoLabel,
        valorAnterior: correcaoPendente.valorAnterior,
        valorNovo: correcaoPendente.valorNovo,
        titular: correcaoPendente.titularNome,
        corrigidoPor: contato.nome,
        dataHora: new Date().toLocaleDateString('pt-BR'),
      },
      etapas: [
        {
          ordem: 1,
          nome: 'Confirmação e Gravação na Ficha',
          descricao: `Usuário confirmou com "${mensagemUsuario}". Campo "${correcaoPendente.campoLabel}" de ${correcaoPendente.titularNome} alterado de "${correcaoPendente.valorAnterior}" para "${correcaoPendente.valorNovo}" com origem "corrigido pelo chat".`,
          tempoMs: Date.now() - inicioTotal,
          detalhes: {
            campo: correcaoPendente.campoLabel,
            valorAnterior: correcaoPendente.valorAnterior,
            valorNovo: correcaoPendente.valorNovo,
            origem: 'corrigido pelo chat',
            manual: true,
          },
        },
      ],
    };

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'corrigir_dado',
      perguntaReescrita: `Confirmar correção: ${correcaoPendente.campoLabel} -> ${correcaoPendente.valorNovo}`,
      rastro,
    };
  }

  // 2. CASO DE CONFIRMAÇÃO DE OFERTA DE DOCUMENTO ANTERIOR ("sim", "pode mandar", "manda", "quero")
  const docOferecidoIdsStr = ultimaMsgAssistente?.documentoOferecidoId;

  if (docOferecidoIdsStr && isConfirmacaoSimples(mensagemUsuario)) {
    const ids = docOferecidoIdsStr.split(',').map((s) => s.trim()).filter(Boolean);
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    const docsParaEnviar = todosDocs.filter((d) => ids.includes(d.id));

    if (docsParaEnviar.length > 0) {
      const anexos: Anexo[] = [];
      for (const d of docsParaEnviar) {
        anexos.push(await criarAnexoParaDocumento(d));
      }

      const titulos = docsParaEnviar.map((d) => d.titulo).join(', ');
      const textoResposta = docsParaEnviar.length === 1
        ? `Aqui está o documento solicitado: ${titulos}.`
        : `Aqui estão os documentos solicitados: ${titulos}.`;

      const docsRastro: DocumentoRastro[] = docsParaEnviar.map((d) => ({
        id: d.id,
        titulo: d.titulo,
        tipo: d.tipo,
        similaridade: 100,
        usadoNaResposta: true,
      }));

      const rastro: RastroRegistro = {
        mensagemId: '',
        usuarioNome: contato.nome,
        usuarioId: contato.id,
        mensagemOriginal: mensagemUsuario,
        perguntaReescrita: `Confirmar envio: ${titulos}`,
        perguntaCompleta: `Enviar documento(s) ${titulos}`,
        termoBusca: titulos,
        documentoCitado: titulos,
        intencaoDetectada: 'pedir_arquivo' as IntencaoChat,
        tipoBusca: 'nome_cofre',
        documentosEncontrados: docsRastro,
        documentoUsado: titulos,
        enviouAnexo: true,
        anexosDetalhes: anexos.map((a) => ({
          nome: a.nome,
          titulo: a.titulo,
          tamanho: a.tamanho,
          tipo: a.tipo,
        })),
        respostaFinal: mascararDadosSensiveis(textoResposta),
        modeloUsado: 'Motor Interno',
        tokensTotal: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        custoEstimadoUsd: 0,
        tempoTotalMs: Date.now() - inicioTotal,
        etapas: [
          {
            ordem: 1,
            nome: 'Confirmação de Envio de Documento Ofertado',
            descricao: `Usuário confirmou o recebimento com "${mensagemUsuario}". Documento(s) "${titulos}" preparado(s) e anexado(s) para entrega direta.`,
            tempoMs: Date.now() - inicioTotal,
            detalhes: {
              confirmacao: mensagemUsuario,
              documentosEnviados: titulos,
              documentoIds: ids,
            },
          },
        ],
      };

      return {
        textoResposta,
        anexos,
        origem: 'motor',
        intencaoDetectada: 'pedir_arquivo',
        perguntaReescrita: titulos,
        buscaUsada: 'Confirmação de Envio de Documento Ofertado',
        similaridade: '100% (Confirmação afirmativa)',
        rastro,
      };
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente no .env');
  }
  const openai = new OpenAI({ apiKey });

  const etapas: EtapaRastro[] = [];
  let tokensPromptTotal = 0;
  let tokensCompletionTotal = 0;
  let tokensGeraisTotal = 0;
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';
  let modeloUsado = chatModel;

  // ============================================================================
  // ETAPA 1: Classificação e Reescrita Contextual
  // ============================================================================
  const classificacao = await classificarEReescreverMensagem(mensagemUsuario, historicoRecente, openai);
  const { intencao, pergunta_reescrita, pessoa, campo, tempoMs: tempoClassif } = classificacao;

  tokensPromptTotal += classificacao.tokensPrompt;
  tokensCompletionTotal += classificacao.tokensCompletion;
  tokensGeraisTotal += classificacao.tokensTotal;

  const pessoaDescricao = classificacao.pessoa
    ? `${classificacao.pessoa} (${classificacao.origemPessoa === 'mensagem_atual' ? 'da mensagem atual' : 'do contexto'})`
    : undefined;

  etapas.push({
    ordem: 1,
    nome: 'Classificação e Reescrita Contextual',
    descricao: `Mensagem analisada com ${classificacao.tokensTotal} tokens (${tempoClassif} ms). Intenção: "${intencao}". Pergunta completa: "${classificacao.pergunta_completa}". Termo de busca: "${classificacao.termo_busca}".${pessoaDescricao ? ` Sujeito: ${pessoaDescricao}.` : ''}`,
    tempoMs: tempoClassif,
    detalhes: {
      intencao,
      perguntaOriginal: mensagemUsuario,
      perguntaCompleta: classificacao.pergunta_completa,
      termoBusca: classificacao.termo_busca,
      perguntaReescrita: classificacao.pergunta_completa,
      pessoa: classificacao.pessoa,
      origemPessoa: classificacao.origemPessoa,
      pessoaDescricao,
      campos: classificacao.campos,
      documentoCitado: classificacao.documento_citado,
      tokensPrompt: classificacao.tokensPrompt,
      tokensCompletion: classificacao.tokensCompletion,
    },
  });

  // Função auxiliar para construir o rastro completo de cada caso
  const criarRastroFinal = (params: {
    tipoBusca: string;
    docsEncontrados: DocumentoRastro[];
    docUsado?: string;
    enviouAnexo: boolean;
    anexos?: Anexo[];
    respostaFinal: string;
    modelo: string;
  }): RastroRegistro => {
    const tempoTotalMs = Date.now() - inicioTotal;
    // Se houve consumo de tokens de IA (classificação, resumo ou resposta com trechos), exibe o modelo gpt-5.4-mini
    const modeloRastro = tokensGeraisTotal > 0 ? chatModel : (params.modelo || 'Motor Interno');
    const custoEstimadoUsd = calcularCustoEstimado(modeloRastro, tokensPromptTotal, tokensCompletionTotal);

    return {
      mensagemId: '', // Preenchido no index.ts com o id da mensagem criada
      usuarioNome: contato.nome,
      usuarioId: contato.id,
      mensagemOriginal: mensagemUsuario,
      perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
      perguntaCompleta: classificacao.pergunta_completa,
      termoBusca: classificacao.termo_busca,
      pessoa: classificacao.pessoa,
      origemPessoa: classificacao.origemPessoa,
      campos: classificacao.campos,
      documentoCitado: classificacao.documento_citado,
      intencaoDetectada: intencao,
      tipoBusca: params.tipoBusca,
      documentosEncontrados: params.docsEncontrados,
      documentoUsado: params.docUsado,
      enviouAnexo: params.enviouAnexo,
      anexosDetalhes: params.anexos?.map((a) => ({
        nome: a.nome,
        titulo: a.titulo,
        tamanho: a.tamanho,
        tipo: a.tipo,
      })),
      respostaFinal: mascararDadosSensiveis(params.respostaFinal),
      modeloUsado: modeloRastro,
      tokensTotal: tokensGeraisTotal,
      tokensPrompt: tokensPromptTotal,
      tokensCompletion: tokensCompletionTotal,
      custoEstimadoUsd,
      tempoTotalMs,
      etapas,
    };
  };

  // ============================================================================
  // CASO 1: SAUDAÇÃO OU PEDIDO VAGO
  // ============================================================================
  if (intencao === 'saudacao_ou_vago') {
    const buscaUsada = 'Nenhuma (Saudação pura / Sem assunto)';
    const similaridade = 'N/A';
    modeloUsado = 'Motor Interno';

    etapas.push({
      ordem: 2,
      nome: 'Resposta Direta de Boas-Vindas',
      descricao: 'Como não houve assunto corporativo específico, a VEGA enviou saudação e apresentação das suas capacidades.',
      tempoMs: 1,
      detalhes: { tipo: 'saudacao_apresentacao' },
    });

    const textoResposta = `Olá${vocativo}! Sou a VEGA, assistente corporativa da Delta Plan. Como posso te ajudar? Posso localizar documentos no cofre, consultar dados cadastrais de titulares ou responder dúvidas sobre políticas e normas internas.`;

    const rastro = criarRastroFinal({
      tipoBusca: 'nenhuma',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: modeloUsado,
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: intencao,
      perguntaReescrita: pergunta_reescrita,
      buscaUsada,
      similaridade,
      rastro,
    };
  }

  // ============================================================================
  // CASO 2: PEDIR ARQUIVO (Cofre -> Aba Conhecimento -> Rede de Segurança Vetorial)
  // ============================================================================
  if (intencao === 'pedir_arquivo') {
    const inicioBuscaDoc = Date.now();
    const termoBuscaArquivo = classificacao.termo_busca || classificacao.documento_citado || pergunta_reescrita || mensagemUsuario;
    // 1. Busca por nome no Cofre (documentos físicos / PDFs)
    const buscaDoc = await buscarDocumentos(termoBuscaArquivo, contato);
    const tempoBuscaDoc = Date.now() - inicioBuscaDoc;

    if (buscaDoc.status === 'unico') {
      const doc = buscaDoc.resultados[0];
      const anexo = await criarAnexoParaDocumento(doc);
      modeloUsado = 'Motor Interno';

      etapas.push({
        ordem: 2,
        nome: 'Localização de Arquivo Físico no Cofre',
        descricao: `Documento "${doc.titulo}" (${doc.arquivo}) localizado com 100% de correspondência por nome em ${tempoBuscaDoc} ms.`,
        tempoMs: tempoBuscaDoc,
        detalhes: {
          documentoId: doc.id,
          titulo: doc.titulo,
          arquivo: doc.arquivo,
          tamanho: doc.tamanho,
        },
      });

      etapas.push({
        ordem: 3,
        nome: 'Geração e Anexo do Arquivo PDF',
        descricao: `Arquivo PDF "${doc.arquivo}" preparado para entrega direta ao usuário.`,
        tempoMs: 2,
        detalhes: { anexo: doc.arquivo },
      });

      const docsRastro: DocumentoRastro[] = [
        {
          id: doc.id,
          titulo: doc.titulo,
          tipo: doc.tipo,
          similaridade: 100,
          usadoNaResposta: true,
        },
      ];

      const textoResposta = `Aqui está o documento solicitado: ${doc.titulo}.`;

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: docsRastro,
        docUsado: doc.titulo,
        enviouAnexo: true,
        anexos: [anexo],
        respostaFinal: textoResposta,
        modelo: modeloUsado,
      });

      return {
        textoResposta,
        anexos: [anexo],
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por nome no Cofre (Arquivo Físico)',
        similaridade: '100% (Correspondência por nome)',
        rastro,
      };
    }

    if (buscaDoc.status === 'ambiguo') {
      modeloUsado = 'Motor Interno';
      const docsRastro: DocumentoRastro[] = buscaDoc.resultados.map((d) => ({
        id: d.id,
        titulo: d.titulo,
        tipo: d.tipo,
        similaridade: 80,
        usadoNaResposta: false,
      }));

      etapas.push({
        ordem: 2,
        nome: 'Resolução de Ambiguidade de Documentos',
        descricao: `Encontrados ${buscaDoc.resultados.length} documentos possíveis. Oferecidas opções de escolha ao usuário.`,
        tempoMs: tempoBuscaDoc,
        detalhes: { resultados: buscaDoc.resultados.map((d) => d.titulo) },
      });

      const textoResposta = `Encontrei mais de um documento relacionado${vocativo}. Qual deles você gostaria de acessar?`;

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: docsRastro,
        enviouAnexo: false,
        respostaFinal: textoResposta,
        modelo: modeloUsado,
      });

      return {
        textoResposta,
        opcoes: buscaDoc.resultados.map((d: DocumentoRegistro) => ({ id: d.id, titulo: d.titulo })),
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por nome no Cofre (Ambiguidade)',
        similaridade: 'Múltiplos resultados',
        rastro,
      };
    }

    // 2. BUSCA POR NOME NA ABA CONHECIMENTO
    const inicioBuscaK = Date.now();
    const todosConhecimentos = await obterTodosConhecimentos();
    const matchConhecimento =
      (await buscarConhecimentoPorNome(classificacao.termo_busca, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(pergunta_reescrita, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(mensagemUsuario, todosConhecimentos));
    const tempoBuscaK = Date.now() - inicioBuscaK;

    if (matchConhecimento) {
      const { item, score } = matchConhecimento;
      const resK = await formatarOuResumirConhecimento(item.titulo, item.conteudo, openai);
      tokensPromptTotal += resK.tokensPrompt;
      tokensCompletionTotal += resK.tokensCompletion;
      tokensGeraisTotal += resK.tokensTotal;
      if (resK.tokensTotal > 0) modeloUsado = chatModel;

      etapas.push({
        ordem: 2,
        nome: 'Busca por Tópico na Base de Conhecimento',
        descricao: `Item de conhecimento "${item.titulo}" identificado com ${score}% de correspondência em ${tempoBuscaK} ms.`,
        tempoMs: tempoBuscaK,
        detalhes: { item: item.titulo, score },
      });

      etapas.push({
        ordem: 3,
        nome: 'Apresentação do Conteúdo Corporativo',
        descricao: `Conteúdo da norma/instrução formatado e apresentado ao usuário em ${resK.tempoMs} ms.`,
        tempoMs: resK.tempoMs,
        detalhes: { tokens: resK.tokensTotal },
      });

      const docsRastro: DocumentoRastro[] = [
        {
          id: item.id,
          titulo: item.titulo,
          similaridade: score,
          trecho: truncarTrecho(item.conteudo, 300),
          usadoNaResposta: true,
        },
      ];

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: docsRastro,
        docUsado: item.titulo,
        enviouAnexo: false,
        respostaFinal: resK.texto,
        modelo: modeloUsado,
      });

      return {
        textoResposta: resK.texto,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por nome na Aba Conhecimento',
        similaridade: `${score}% (Correspondência no título "${item.titulo}")`,
        rastro,
      };
    }

    // 3. REDE DE SEGURANÇA: Busca vetorial no Supabase
    const inicioVetorial = Date.now();
    const perguntaVetorial = classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario;
    const trechosSeguranca = await executarBuscaVetorial(perguntaVetorial, null, 5);
    const tempoVetorial = Date.now() - inicioVetorial;

    if (trechosSeguranca.length > 0) {
      const topSim = trechosSeguranca[0].similaridade;
      const resTrechos = await responderComTrechos(perguntaVetorial, trechosSeguranca, openai);
      tokensPromptTotal += resTrechos.tokensPrompt;
      tokensCompletionTotal += resTrechos.tokensCompletion;
      tokensGeraisTotal += resTrechos.tokensTotal;
      modeloUsado = chatModel;

      etapas.push({
        ordem: 2,
        nome: 'Rede de Segurança Vetorial no Supabase',
        descricao: `Busca semântica recuperou ${trechosSeguranca.length} trecho(s) com similaridade máxima de ${(topSim * 100).toFixed(1)}% em ${tempoVetorial} ms.`,
        tempoMs: tempoVetorial,
        detalhes: { topSimilaridade: topSim, quantidadeTrechos: trechosSeguranca.length },
      });

      etapas.push({
        ordem: 3,
        nome: 'Síntese da Resposta com IA',
        descricao: `Resposta gerada pelo modelo ${chatModel} com base estrita nos trechos oficiais em ${resTrechos.tempoMs} ms.`,
        tempoMs: resTrechos.tempoMs,
        detalhes: { tokens: resTrechos.tokensTotal },
      });

      const docsRastro: DocumentoRastro[] = trechosSeguranca.map((t, idx) => ({
        id: t.documento_id,
        titulo: t.titulo_documento,
        pagina: t.pagina,
        similaridade: Number((t.similaridade * 100).toFixed(1)),
        trecho: truncarTrecho(t.conteudo, 300),
        usadoNaResposta: idx === 0 || t.similaridade >= 0.5,
      }));

      const rastro = criarRastroFinal({
        tipoBusca: 'vetorial',
        docsEncontrados: docsRastro,
        docUsado: trechosSeguranca[0]?.titulo_documento,
        enviouAnexo: false,
        respostaFinal: resTrechos.texto,
        modelo: modeloUsado,
      });

      return {
        textoResposta: resTrechos.texto,
        origem: 'ia',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca vetorial no Supabase (Rede de Segurança)',
        similaridade: `${(topSim * 100).toFixed(1)}%`,
        trechosUsados: trechosSeguranca,
        rastro,
      };
    }

    // Ambas falharam
    modeloUsado = 'Motor Interno';
    etapas.push({
      ordem: 2,
      nome: 'Varredura no Cofre e Base Vetorial',
      descricao: 'Nenhum arquivo físico ou trecho correspondente foi encontrado.',
      tempoMs: tempoBuscaDoc + tempoBuscaK + tempoVetorial,
    });

    const textoResposta = `Não consegui identificar esse documento nem informações sobre ele no cofre${vocativo}.`;

    const rastro = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: modeloUsado,
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: intencao,
      perguntaReescrita: pergunta_reescrita,
      buscaUsada: 'Busca por nome e vetorial (ambas falharam)',
      similaridade: '0%',
      rastro,
    };
  }

  // ============================================================================
  // CASO 2.5: CORREÇÃO DE DADO CADASTRAL (intencao === 'corrigir_dado')
  // ============================================================================
  if (intencao === 'corrigir_dado') {
    const inicioCorrecao = Date.now();
    const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
    const nomePessoa = classificacao.pessoa || pessoa || titularDoHistorico || 'Thomaz';
    const titular = await obterTitularPorNome(nomePessoa);
    const primeiroNomeTitular = titular ? (extrairPrimeiroNome(titular.nome) || titular.nome) : nomePessoa;

    // Mapeamento de termos para campos e labels amigáveis
    const MAPA_CAMPOS_LABELS: Record<string, { id: CampoTitularId; label: string }> = {
      profissao: { id: 'profissao', label: 'profissão' },
      cargo: { id: 'profissao', label: 'profissão' },
      ocupacao: { id: 'profissao', label: 'profissão' },
      cpf: { id: 'cpf', label: 'CPF' },
      rg: { id: 'rg', label: 'RG' },
      identidade: { id: 'rg', label: 'RG' },
      endereco: { id: 'endereco', label: 'endereço' },
      estadocivil: { id: 'estadoCivil', label: 'estado civil' },
      civil: { id: 'estadoCivil', label: 'estado civil' },
      datanascimento: { id: 'dataNascimento', label: 'data de nascimento' },
      nascimento: { id: 'dataNascimento', label: 'data de nascimento' },
      filiacao: { id: 'filiacao', label: 'filiação' },
      mae: { id: 'filiacao', label: 'mãe' },
      pai: { id: 'filiacao', label: 'pai' },
      cnh: { id: 'cnh', label: 'número da CNH' },
      categoriacnh: { id: 'categoriaCnh', label: 'categoria da CNH' },
      validadecnh: { id: 'validadeCnh', label: 'validade da CNH' },
      orgaoemissor: { id: 'orgaoEmissor', label: 'órgão emissor' },
    };

    let campoId: CampoTitularId = 'profissao';
    let labelCampo = 'profissão';

    const campoDesejado = (classificacao.campo_corrigir || (classificacao.campos && classificacao.campos[0]) || '')
      .toLowerCase()
      .replace(/[\s_-]/g, '');

    if (campoDesejado && MAPA_CAMPOS_LABELS[campoDesejado]) {
      campoId = MAPA_CAMPOS_LABELS[campoDesejado].id;
      labelCampo = MAPA_CAMPOS_LABELS[campoDesejado].label;
    } else {
      // Tenta inferir da mensagem atual
      const msgNorm = normalizarParaBusca(mensagemUsuario);
      let achouNaMsg = false;
      for (const [k, v] of Object.entries(MAPA_CAMPOS_LABELS)) {
        if (msgNorm.includes(k)) {
          campoId = v.id;
          labelCampo = v.label;
          achouNaMsg = true;
          break;
        }
      }
      if (!achouNaMsg) {
        // Tenta inferir da última mensagem do assistente
        const ultimaMsgAss = [...(historicoRecente || [])].reverse().find((m) => m.remetente === 'assistente');
        const textoAssNorm = normalizarParaBusca(ultimaMsgAss?.texto || '');
        for (const [k, v] of Object.entries(MAPA_CAMPOS_LABELS)) {
          if (textoAssNorm.includes(k)) {
            campoId = v.id;
            labelCampo = v.label;
            break;
          }
        }
      }
    }

    // Identifica o novo valor informado pelo usuário
    let valorNovo = (classificacao.valor_novo || '').trim();
    if (!valorNovo) {
      // Regex de fallback para extrair valor após "é", "para", "sendo", etc.
      const mVal = mensagemUsuario.match(/(?:é|e|para|sendo|correto é|certo é|na verdade é)\s+([^.,\n]+)/i);
      if (mVal && mVal[1].trim()) {
        valorNovo = mVal[1].trim();
      }
    }

    // Se o usuário disser que está errado sem informar o valor certo, perguntar qual é o correto
    if (!valorNovo) {
      const textoPerguntaValor = `Qual é o valor correto para a *${labelCampo}* do *${primeiroNomeTitular}*?`;
      const rastro = criarRastroFinal({
        tipoBusca: 'ficha',
        docsEncontrados: [],
        docUsado: 'Ficha Cadastral',
        enviouAnexo: false,
        respostaFinal: textoPerguntaValor,
        modelo: 'Motor Interno',
      });
      rastro.etapas.push({
        ordem: 2,
        nome: 'Solicitação do Valor Correto',
        descricao: `Usuário informou que o dado está errado sem fornecer o novo valor. Solicitado o valor correto para ${labelCampo}.`,
        tempoMs: Date.now() - inicioCorrecao,
      });

      return {
        textoResposta: textoPerguntaValor,
        origem: 'motor',
        intencaoDetectada: 'corrigir_dado',
        perguntaReescrita: `Corrigir ${labelCampo} de ${primeiroNomeTitular}`,
        rastro,
      };
    }

    // Usuário informou o valor certo -> Formulamos a mensagem de confirmação antes de salvar
    const valorAnterior = titular?.campos[campoId]?.valor || 'não cadastrado';
    const textoConfirmacao = `Vou alterar a *${labelCampo}* do *${primeiroNomeTitular}* de *${valorAnterior}* para *${valorNovo}*. Confirma?`;

    const rastro = criarRastroFinal({
      tipoBusca: 'ficha',
      docsEncontrados: [],
      docUsado: 'Ficha Cadastral',
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modelo: 'Motor Interno',
    });
    rastro.detalhesCorrecao = {
      campo: labelCampo,
      valorAnterior,
      valorNovo,
      titular: primeiroNomeTitular,
      corrigidoPor: contato.nome,
    };
    rastro.etapas.push({
      ordem: 2,
      nome: 'Proposta de Correção Cadastral',
      descricao: `Proposta de alteração no campo "${labelCampo}" de ${primeiroNomeTitular} de "${valorAnterior}" para "${valorNovo}". Aguardando confirmação afirmativa.`,
      tempoMs: Date.now() - inicioCorrecao,
      detalhes: {
        campo: labelCampo,
        valorAnterior,
        valorNovo,
        titular: primeiroNomeTitular,
      },
    });

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'corrigir_dado',
      perguntaReescrita: `Alterar ${labelCampo} do ${primeiroNomeTitular} para ${valorNovo}`,
      correcaoPendente: {
        titularId: titular?.id || `tit_${nomePessoa.toLowerCase()}`,
        titularNome: primeiroNomeTitular,
        campoId,
        campoLabel: labelCampo,
        valorAnterior,
        valorNovo,
      },
      rastro,
    };
  }

  // ============================================================================
  // CASO 2.6: CONSULTA DE VENCIMENTO DE DOCUMENTOS (intencao === 'consultar_vencimentos')
  // ============================================================================
  if (intencao === 'consultar_vencimentos') {
    const inicioVenc = Date.now();
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    const agora = new Date();

    // Filtra documentos que possuem data de validade cadastrada
    const docsComValidade = todosDocs
      .filter((d) => d.dataValidade && d.dataValidade.trim())
      .map((d) => {
        const diasRestantes = calcularDiasRestantes(d.dataValidade!, agora) ?? 9999;
        const status = determinarStatusVencimento(diasRestantes);
        return { doc: d, diasRestantes, status };
      })
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    const msgNorm = normalizarParaBusca(mensagemUsuario);
    const querApenasVencidos = /\b(vencid[oa]s?|ja\s*venceu|ja\s*venceram)\b/i.test(msgNorm);
    const querEsteMes = /\b(este\s*m[eê]s|neste\s*m[eê]s|mes\s*atual)\b/i.test(msgNorm);
    const querVencendoGeral = /\b(vencendo|a\s*vencer|proximos?)\b/i.test(msgNorm);

    let docsFiltrados = [...docsComValidade];

    if (querApenasVencidos) {
      docsFiltrados = docsComValidade.filter((item) => item.status === 'vencido');
    } else if (querEsteMes) {
      docsFiltrados = docsComValidade.filter((item) => {
        const d = parseDataBr(item.doc.dataValidade!);
        if (!d) return false;
        return (
          (d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear()) ||
          (item.diasRestantes >= 0 && item.diasRestantes <= 30)
        );
      });
    } else if (querVencendoGeral) {
      docsFiltrados = docsComValidade.filter((item) => item.diasRestantes <= 60);
    }

    let textoResposta = '';

    if (docsFiltrados.length === 0) {
      if (querApenasVencidos) {
        textoResposta = 'Não encontrei nenhum documento vencido no momento. Todos os documentos com data de validade estão regulares!';
      } else if (querEsteMes) {
        textoResposta = 'Não há documentos vencendo este mês no Cofre. Todos estão regulares!';
      } else {
        textoResposta = 'Não encontrei documentos com vencimento próximo no momento. Todos os documentos monitorados estão em dia!';
      }
    } else {
      const linhas: string[] = [];
      if (querApenasVencidos) {
        linhas.push('Estes são os documentos vencidos no Cofre:\n');
      } else if (querEsteMes) {
        linhas.push('Estes são os documentos que vencem este mês:\n');
      } else {
        linhas.push('Aqui estão os documentos com controle de vencimento:\n');
      }

      for (const item of docsFiltrados) {
        const { doc, diasRestantes, status } = item;
        const titularNome = doc.titular || 'Delta Plan';
        let situacaoStr = '';
        if (status === 'vencido') {
          const diasPositivos = Math.abs(diasRestantes);
          situacaoStr = diasPositivos === 1 ? 'venceu ontem' : `vencido há ${diasPositivos} dias`;
        } else if (status === 'vence_hoje') {
          situacaoStr = 'vence hoje!';
        } else if (diasRestantes <= 30) {
          situacaoStr = `vence em ${diasRestantes} dias`;
        } else if (diasRestantes <= 60) {
          situacaoStr = `vence em ${diasRestantes} dias`;
        } else {
          situacaoStr = 'em dia';
        }

        linhas.push(`• *${doc.titulo}* (${titularNome}) — Validade: *${doc.dataValidade}* (${situacaoStr})`);
      }

      linhas.push('\nQuer que eu envie algum desses documentos?');
      textoResposta = linhas.join('\n');
    }

    const docsRastro: DocumentoRastro[] = docsFiltrados.map((item) => ({
      id: item.doc.id,
      titulo: item.doc.titulo,
      tipo: item.doc.tipo,
      similaridade: 100,
      usadoNaResposta: true,
      trecho: `Validade: ${item.doc.dataValidade} | Dias restantes: ${item.diasRestantes} | Status: ${item.status}`,
    }));

    etapas.push({
      ordem: 2,
      nome: 'Consulta de Vencimento de Documentos',
      descricao: `Localizados ${docsFiltrados.length} documento(s) com base nos critérios de validade em ${Date.now() - inicioVenc} ms.`,
      tempoMs: Date.now() - inicioVenc,
      detalhes: {
        totalMonitorados: docsComValidade.length,
        totalFiltrados: docsFiltrados.length,
        criterio: querApenasVencidos ? 'vencidos' : querEsteMes ? 'este_mes' : 'geral',
      },
    });

    const rastro = criarRastroFinal({
      tipoBusca: 'vencimentos',
      docsEncontrados: docsRastro,
      docUsado: docsFiltrados.length > 0 ? docsFiltrados.map((d) => d.doc.titulo).join(', ') : undefined,
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: 'consultar_vencimentos',
      perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
      buscaUsada: 'Controle de Validade de Documentos do Cofre',
      similaridade: '100% (Consulta de Vencimentos)',
      rastro,
    };
  }

  // ============================================================================
  // CASO 2.7: SILENCIAR ALERTAS DE VENCIMENTO (intencao === 'silenciar_alerta')
  // ============================================================================
  if (intencao === 'silenciar_alerta') {
    const inicioSilenciar = Date.now();
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    const msgNorm = normalizarParaBusca(mensagemUsuario);

    const docCitado = (classificacao.documento_citado || '').toLowerCase().trim();
    const pessoaCitada = (classificacao.pessoa || '').toLowerCase().trim();

    let docEncontrado = todosDocs.find((d) => {
      const tit = d.titulo.toLowerCase();
      const arq = d.arquivo.toLowerCase();
      const titular = (d.titular || '').toLowerCase();

      const matchPessoa = !pessoaCitada || titular.includes(pessoaCitada) || pessoaCitada.includes(titular);
      const matchDoc =
        (docCitado && (tit.includes(docCitado) || arq.includes(docCitado))) ||
        (msgNorm.includes('crt') && (tit.includes('crt') || arq.includes('crt'))) ||
        (msgNorm.includes('crea') && (tit.includes('crea') || arq.includes('crea'))) ||
        (msgNorm.includes('cnh') && (tit.includes('cnh') || arq.includes('cnh')));

      return matchDoc && matchPessoa;
    });

    if (!docEncontrado) {
      docEncontrado = todosDocs.find((d) => {
        const tit = d.titulo.toLowerCase();
        return (
          (msgNorm.includes('crt') && tit.includes('crt')) ||
          (msgNorm.includes('crea') && tit.includes('crea')) ||
          (msgNorm.includes('cnh') && tit.includes('cnh'))
        );
      });
    }

    if (!docEncontrado) {
      const textoNaoEncontrado = `Não encontrei no Cofre o documento mencionado para desativar alertas${vocativo}. Pode confirmar o nome do documento?`;
      return {
        textoResposta: textoNaoEncontrado,
        origem: 'motor',
        intencaoDetectada: 'silenciar_alerta',
        perguntaReescrita: 'Desativar alertas de documento',
        rastro: criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoNaoEncontrado,
          modelo: 'Motor Interno',
        }),
      };
    }

    const titularStr = docEncontrado.titular ? ` do *${docEncontrado.titular}*` : '';
    const textoConfirmacao = `Vou desativar os alertas de vencimento do documento *${docEncontrado.titulo}*${titularStr}. Confirma?`;

    etapas.push({
      ordem: 1,
      nome: 'Identificação de Documento para Silenciar Alertas',
      descricao: `Documento "${docEncontrado.titulo}" localizado para silenciar alertas. Aguardando confirmação do usuário.`,
      tempoMs: Date.now() - inicioSilenciar,
    });

    const rastro = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: [
        {
          id: docEncontrado.id,
          titulo: docEncontrado.titulo,
          tipo: docEncontrado.tipo,
          similaridade: 100,
          usadoNaResposta: true,
        },
      ],
      docUsado: docEncontrado.titulo,
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'silenciar_alerta',
      perguntaReescrita: `Desativar alertas do documento ${docEncontrado.titulo}`,
      correcaoPendente: {
        titularId: docEncontrado.titular || '',
        titularNome: docEncontrado.titular || 'Delta Plan',
        campoId: 'silenciar_alerta' as any,
        campoLabel: 'alertas de vencimento',
        valorAnterior: 'ativo',
        valorNovo: 'desativado',
        documentoId: docEncontrado.id,
        documentoTitulo: docEncontrado.titulo,
      },
      rastro,
    };
  }

  // ============================================================================
  // CASO 3: DADO PESSOAL (Ficha primeiro -> se não existir, cai no vetor da pessoa)
  // ============================================================================
  if (intencao === 'dado_pessoal') {
    const inicioFicha = Date.now();
    const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
    const nomePessoa = classificacao.pessoa || pessoa || titularDoHistorico || 'Thomaz';
    const titular = await obterTitularPorNome(nomePessoa);
    const primeiroNomeTitular = titular ? (extrairPrimeiroNome(titular.nome) || titular.nome) : nomePessoa;
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();

    // 1. Identifica a lista de campos solicitados
    let camposIdentificados: string[] = classificacao.campos && classificacao.campos.length > 0
      ? [...classificacao.campos]
      : [];

    if (camposIdentificados.length === 0) {
      const msgNorm = normalizarParaBusca(mensagemUsuario);
      const padroesCampos: { campo: string; regex: RegExp }[] = [
        { campo: 'endereco', regex: /\b(endere[cç]o|mora|resid[eê]ncia)\b/i },
        { campo: 'estadoCivil', regex: /\b(estado\s*civil|casad[oa]|solteir[oa]|divorciad[oa])\b/i },
        { campo: 'rg', regex: /\b(rg|identidade)\b/i },
        { campo: 'profissao', regex: /\b(profiss[aã]o|cargo|ocupa[cç][aã]o)\b/i },
        { campo: 'cpf', regex: /\b(cpf)\b/i },
        { campo: 'filiacao', regex: /\b(m[aã]e|pai|pais|filia[cç][aã]o)\b/i },
        { campo: 'dataNascimento', regex: /\b(nascimento|data\s*de\s*nascimento|idade)\b/i },
        { campo: 'validadeCnh', regex: /\b(validade(\s*da\s*cnh)?|vencimento)\b/i },
        { campo: 'categoriaCnh', regex: /\b(categoria(\s*da\s*cnh)?)\b/i },
        { campo: 'cnh', regex: /\b(n[uú]mero\s*da\s*cnh|numero\s*da\s*cnh|cnh)\b/i },
        { campo: 'orgaoEmissor', regex: /\b(orgao\s*emissor|[oó]rg[aã]o)\b/i },
      ];
      for (const p of padroesCampos) {
        if (p.regex.test(msgNorm)) {
          camposIdentificados.push(p.campo);
        }
      }
    }

    if (camposIdentificados.length === 0 && campo) {
      camposIdentificados.push(campo);
    }
    if (camposIdentificados.length === 0) {
      camposIdentificados.push('filiacao');
    }

    // Remove eventuais duplicidades mantendo a ordem
    camposIdentificados = Array.from(new Set(camposIdentificados));

    interface InfoCampoProcessado {
      campoId: CampoTitularId;
      label: string;
      valorFormatado: string;
      valorMascaradoRastro: string;
      origemNome: string;
      docOrigem?: DocumentoRegistro;
      conferido: boolean;
      encontrado: boolean;
    }

    const camposProcessados: InfoCampoProcessado[] = [];

    for (const cNome of camposIdentificados) {
      const cNorm = cNome.toLowerCase().replace(/[\s_-]/g, '');
      let campoId: CampoTitularId = 'filiacao';
      let label = 'Filiação';

      if (cNorm.includes('endereco')) {
        campoId = 'endereco';
        label = 'Endereço';
      } else if (cNorm.includes('estadocivil') || cNorm.includes('civil') || cNorm.includes('casado')) {
        campoId = 'estadoCivil';
        label = 'Estado civil';
      } else if (cNorm === 'rg' || cNorm.includes('identidade')) {
        campoId = 'rg';
        label = 'RG';
      } else if (cNorm.includes('profiss') || cNorm.includes('cargo') || cNorm.includes('ocupac')) {
        campoId = 'profissao';
        label = 'Profissão';
      } else if (cNorm === 'cpf') {
        campoId = 'cpf';
        label = 'CPF';
      } else if (cNorm.includes('mae') || cNorm.includes('mãe')) {
        campoId = 'filiacao';
        label = 'Mãe';
      } else if (cNorm.includes('pai')) {
        campoId = 'filiacao';
        label = 'Pai';
      } else if (cNorm.includes('filiac')) {
        campoId = 'filiacao';
        const msgL = mensagemUsuario.toLowerCase();
        if (/\b(m[aã]e)\b/i.test(msgL) && !/\b(pai)\b/i.test(msgL)) {
          label = 'Mãe';
        } else if (/\b(pai)\b/i.test(msgL) && !/\b(m[aã]e)\b/i.test(msgL)) {
          label = 'Pai';
        } else {
          label = 'Filiação';
        }
      } else if (cNorm.includes('nasc')) {
        campoId = 'dataNascimento';
        label = 'Data de nascimento';
      } else if (cNorm.includes('validade') || cNorm.includes('venc')) {
        campoId = 'validadeCnh';
        label = 'Validade da CNH';
      } else if (cNorm.includes('categoria')) {
        campoId = 'categoriaCnh';
        label = 'Categoria da CNH';
      } else if (cNorm.includes('cnh') || cNorm.includes('habilitac')) {
        campoId = 'cnh';
        label = 'Número da CNH';
      } else if (cNorm.includes('orgao')) {
        campoId = 'orgaoEmissor';
        label = 'Órgão emissor';
      }

      // Consulta o campo na ficha do titular
      if (titular && titular.campos[campoId]) {
        const reg = titular.campos[campoId]!;
        let valorBruto = reg.valor;

        if (campoId === 'filiacao') {
          if (label === 'Mãe') {
            const mMae = reg.valor.match(/Mãe:\s*([^|]+)/i);
            if (mMae) valorBruto = mMae[1].trim();
          } else if (label === 'Pai') {
            const mPai = reg.valor.match(/Pai:\s*([^|]+)/i);
            if (mPai) valorBruto = mPai[1].trim();
          }
        }

        // Valor para exibição na resposta do usuário (completo se MOSTRAR_DOCUMENTOS_COMPLETOS=true)
        let valorParaUsuario = formatarValorParaUsuario(campoId, valorBruto);
        // Valor mascarado para o rastro de auditoria (Ver raciocínio)
        let valorParaRastro = mascararValorCampo(campoId, valorBruto);

        const docOrigem = resolverDocumentoOrigem(
          reg.origem,
          reg.origemNome,
          todosDocs,
          campoId,
          titular.nome
        );

        camposProcessados.push({
          campoId,
          label,
          valorFormatado: valorParaUsuario,
          valorMascaradoRastro: valorParaRastro,
          origemNome: reg.origemNome || reg.origem || 'Ficha Cadastral',
          docOrigem,
          conferido: Boolean(reg.conferido),
          encontrado: true,
        });
      } else {
        // Não encontrou na ficha cadastral
        camposProcessados.push({
          campoId,
          label,
          valorFormatado: 'não encontrei nos documentos.',
          valorMascaradoRastro: 'não encontrei nos documentos.',
          origemNome: 'Não encontrado',
          docOrigem: undefined,
          conferido: false,
          encontrado: false,
        });
      }
    }

    const tempoFicha = Date.now() - inicioFicha;
    modeloUsado = 'Motor Interno';

    // Determina se deve responder em formato de lista (múltiplos campos ou mensagem em lista)
    const ehListaMultipla =
      camposProcessados.length > 1 ||
      mensagemUsuario.includes(',') ||
      mensagemUsuario.includes(';') ||
      /\b(documentos|esses|estes|dados|campos)\b/i.test(mensagemUsuario);

    let textoResposta = '';
    if (ehListaMultipla) {
      const linhas = camposProcessados.map((cp) => {
        if (!cp.encontrado) {
          return `*${cp.label}:* não encontrei nos documentos.`;
        }
        return `*${cp.label}:* ${cp.valorFormatado}`;
      });
      textoResposta = linhas.join('\n');
    } else {
      const cp = camposProcessados[0];
      const ehFeminino = ['Validade da CNH', 'Categoria da CNH', 'Data de nascimento', 'Filiação', 'Profissão'].includes(cp.label);
      const artigo = ehFeminino ? 'a' : 'o';

      if (cp.encontrado) {
        if (cp.label === 'Mãe') {
          textoResposta = `A mãe do ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'Pai') {
          textoResposta = `O pai do ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'CPF') {
          textoResposta = `O CPF do ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'RG') {
          textoResposta = `O RG do ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else {
          const artCap = ehFeminino ? 'A' : 'O';
          textoResposta = `${artCap} ${cp.label.toLowerCase()} do ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        }
      } else {
        textoResposta = `Não encontrei ${artigo} ${cp.label.toLowerCase()} do ${primeiroNomeTitular} nos documentos.`;
      }
    }

    // Coleta os documentos físicos únicos que realmente existem no cofre e são origem de algum campo respondido
    const docsFisicosParaOferta: DocumentoRegistro[] = [];
    for (const cp of camposProcessados) {
      if (
        cp.encontrado &&
        cp.docOrigem &&
        todosDocs.some((d) => d.id === cp.docOrigem!.id) &&
        !docsFisicosParaOferta.some((d) => d.id === cp.docOrigem!.id)
      ) {
        docsFisicosParaOferta.push(cp.docOrigem);
      }
    }

    let documentoOferecidoId: string | undefined = undefined;
    if (docsFisicosParaOferta.length === 1) {
      const docUnico = docsFisicosParaOferta[0];
      textoResposta += `\n\nQuer que eu envie o documento de onde tirei essa informação (${docUnico.titulo})?`;
      documentoOferecidoId = docUnico.id;
    } else if (docsFisicosParaOferta.length > 1) {
      const titulos = docsFisicosParaOferta.map((d) => d.titulo).join(', ');
      textoResposta += `\n\nQuer que eu envie os documentos de onde tirei essas informações (${titulos})?`;
      documentoOferecidoId = docsFisicosParaOferta.map((d) => d.id).join(',');
    }

    // Registra rastro com listagem detalhada de cada campo e de onde veio (valores mascarados para segurança)
    etapas.push({
      ordem: 2,
      nome: 'Consulta à Ficha Cadastral Estruturada',
      descricao: `Consulta aos dados de ${primeiroNomeTitular}. Campos consultados: ${camposProcessados
        .map((c) => `${c.label} (${c.encontrado ? c.origemNome : 'não encontrado'})`)
        .join(', ')}.`,
      tempoMs: tempoFicha,
      detalhes: {
        pessoa: titular?.nome || nomePessoa,
        origemPessoa: classificacao.origemPessoa,
        camposConsultados: camposProcessados.map((c) => ({
          campo: c.label,
          valor: c.valorMascaradoRastro,
          origem: c.origemNome,
          documentoOrigem: c.docOrigem?.titulo,
          conferido: c.conferido,
          encontrado: c.encontrado,
        })),
      },
    });

    const docsRastro: DocumentoRastro[] = docsFisicosParaOferta.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      tipo: d.tipo,
      similaridade: 100,
      usadoNaResposta: true,
    }));

    // A origem mostrada no rastro e resumo deve ser exatamente a registrada nos campos da ficha
    const origensFichaEncontradas = Array.from(
      new Set(camposProcessados.filter((c) => c.encontrado).map((c) => c.origemNome))
    );
    const docUsadoRastro = origensFichaEncontradas.length > 0 ? origensFichaEncontradas.join(', ') : 'Ficha Cadastral';

    const rastro = criarRastroFinal({
      tipoBusca: 'ficha_cadastral',
      docsEncontrados: docsRastro,
      docUsado: docUsadoRastro,
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: modeloUsado,
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: intencao,
      perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
      buscaUsada: 'Ficha Cadastral Estruturada',
      similaridade: '100% (Campo cadastral)',
      documentoOferecidoId,
      rastro,
    };
  }

  // ============================================================================
  // CASO 4: PERGUNTA DE CONTEÚDO (Busca vetorial 5 trechos + Busca por nome se houver match em título)
  // ============================================================================
  if (intencao === 'pergunta_conteudo') {
    let pessoaIdAlvo: string | null = null;
    if (/\bthomaz\b/i.test(pergunta_reescrita) || /\bthomaz\b/i.test(mensagemUsuario)) {
      pessoaIdAlvo = 'tit_thomaz';
    }

    // 1. Busca por nome no Conhecimento caso a mensagem seja o título direto/termo exato
    const inicioBuscaK = Date.now();
    const todosConhecimentos = await obterTodosConhecimentos();
    const termoBuscaK = classificacao.termo_busca || classificacao.pergunta_completa || mensagemUsuario;
    const termoNorm = normalizarParaBusca(termoBuscaK);
    const msgNorm = normalizarParaBusca(mensagemUsuario);
    const matchExatoTitulo = todosConhecimentos.find((c) => {
      const titNorm = normalizarParaBusca(c.titulo);
      return titNorm === termoNorm || titNorm === msgNorm;
    });
    const tempoBuscaK = Date.now() - inicioBuscaK;

    if (matchExatoTitulo) {
      const resK = await formatarOuResumirConhecimento(matchExatoTitulo.titulo, matchExatoTitulo.conteudo, openai);
      tokensPromptTotal += resK.tokensPrompt;
      tokensCompletionTotal += resK.tokensCompletion;
      tokensGeraisTotal += resK.tokensTotal;
      if (resK.tokensTotal > 0) modeloUsado = chatModel;
      else modeloUsado = 'Motor Interno';

      etapas.push({
        ordem: 2,
        nome: 'Localização de Instrução por Título Exato',
        descricao: `Encontrada instrução corporativa "${matchExatoTitulo.titulo}" na Base de Conhecimento em ${tempoBuscaK} ms.`,
        tempoMs: tempoBuscaK,
        detalhes: { titulo: matchExatoTitulo.titulo },
      });

      etapas.push({
        ordem: 3,
        nome: 'Apresentação do Conteúdo Corporativo',
        descricao: `Conteúdo da norma apresentado em ${resK.tempoMs} ms.`,
        tempoMs: resK.tempoMs,
        detalhes: { tokens: resK.tokensTotal },
      });

      const docsRastro: DocumentoRastro[] = [
        {
          id: matchExatoTitulo.id,
          titulo: matchExatoTitulo.titulo,
          similaridade: 100,
          trecho: truncarTrecho(matchExatoTitulo.conteudo, 300),
          usadoNaResposta: true,
        },
      ];

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: docsRastro,
        docUsado: matchExatoTitulo.titulo,
        enviouAnexo: false,
        respostaFinal: resK.texto,
        modelo: modeloUsado,
      });

      return {
        textoResposta: resK.texto,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
        buscaUsada: 'Busca por nome na Aba Conhecimento',
        similaridade: `100% (Título: "${matchExatoTitulo.titulo}")`,
        rastro,
      };
    }

    // 2. Busca Vetorial no Supabase (5 trechos com match_threshold 0.3)
    const inicioVetorial = Date.now();
    const perguntaVetorial = classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario;
    const trechosConteudo = await executarBuscaVetorial(perguntaVetorial, pessoaIdAlvo, 5);
    const tempoVetorial = Date.now() - inicioVetorial;

    if (trechosConteudo.length > 0) {
      const topSim = trechosConteudo[0].similaridade;
      const resTrechos = await responderComTrechos(perguntaVetorial, trechosConteudo, openai);
      tokensPromptTotal += resTrechos.tokensPrompt;
      tokensCompletionTotal += resTrechos.tokensCompletion;
      tokensGeraisTotal += resTrechos.tokensTotal;
      modeloUsado = chatModel;

      etapas.push({
        ordem: 2,
        nome: 'Busca Semântica Vetorial no Supabase',
        descricao: `Encontrados ${trechosConteudo.length} trecho(s) com similaridade de ${(topSim * 100).toFixed(1)}% no documento "${trechosConteudo[0].titulo_documento}" em ${tempoVetorial} ms.`,
        tempoMs: tempoVetorial,
        detalhes: {
          quantidadeTrechos: trechosConteudo.length,
          topSimilaridade: topSim,
          topDocumento: trechosConteudo[0].titulo_documento,
        },
      });

      etapas.push({
        ordem: 3,
        nome: 'Síntese da Resposta com IA',
        descricao: `Resposta sintetizada pelo modelo ${chatModel} em ${resTrechos.tempoMs} ms baseando-se estritamente nos trechos oficiais.`,
        tempoMs: resTrechos.tempoMs,
        detalhes: { tokens: resTrechos.tokensTotal },
      });

      const docsRastro: DocumentoRastro[] = trechosConteudo.map((t, idx) => ({
        id: t.documento_id,
        titulo: t.titulo_documento,
        pagina: t.pagina,
        similaridade: Number((t.similaridade * 100).toFixed(1)),
        trecho: truncarTrecho(t.conteudo, 300),
        usadoNaResposta: idx === 0 || t.similaridade >= 0.5,
      }));

      const rastro = criarRastroFinal({
        tipoBusca: 'vetorial',
        docsEncontrados: docsRastro,
        docUsado: trechosConteudo[0]?.titulo_documento,
        enviouAnexo: false,
        respostaFinal: resTrechos.texto,
        modelo: modeloUsado,
      });

      return {
        textoResposta: resTrechos.texto,
        origem: 'ia',
        intencaoDetectada: intencao,
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
        buscaUsada: 'Busca vetorial no Supabase',
        similaridade: `${(topSim * 100).toFixed(1)}%`,
        trechosUsados: trechosConteudo,
        rastro,
      };
    }

    // 3. Fallback: busca por nome no conhecimento
    const inicioFallback = Date.now();
    const matchConhecimentoFallback =
      (await buscarConhecimentoPorNome(classificacao.termo_busca, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(pergunta_reescrita, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(mensagemUsuario, todosConhecimentos));
    const tempoFallback = Date.now() - inicioFallback;

    if (matchConhecimentoFallback) {
      const { item, score } = matchConhecimentoFallback;
      const resK = await formatarOuResumirConhecimento(item.titulo, item.conteudo, openai);
      tokensPromptTotal += resK.tokensPrompt;
      tokensCompletionTotal += resK.tokensCompletion;
      tokensGeraisTotal += resK.tokensTotal;
      if (resK.tokensTotal > 0) modeloUsado = chatModel;
      else modeloUsado = 'Motor Interno';

      etapas.push({
        ordem: 2,
        nome: 'Busca por Tópico na Base de Conhecimento (Fallback)',
        descricao: `Encontrada instrução "${item.titulo}" com ${score}% de relevância em ${tempoFallback} ms.`,
        tempoMs: tempoFallback,
        detalhes: { item: item.titulo, score },
      });

      etapas.push({
        ordem: 3,
        nome: 'Apresentação do Conteúdo Corporativo',
        descricao: `Conteúdo formatado e entregue em ${resK.tempoMs} ms.`,
        tempoMs: resK.tempoMs,
        detalhes: { tokens: resK.tokensTotal },
      });

      const docsRastro: DocumentoRastro[] = [
        {
          id: item.id,
          titulo: item.titulo,
          similaridade: score,
          trecho: truncarTrecho(item.conteudo, 300),
          usadoNaResposta: true,
        },
      ];

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: docsRastro,
        docUsado: item.titulo,
        enviouAnexo: false,
        respostaFinal: resK.texto,
        modelo: modeloUsado,
      });

      return {
        textoResposta: resK.texto,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por nome na Aba Conhecimento (Fallback)',
        similaridade: `${score}%`,
        rastro,
      };
    }

    modeloUsado = 'Motor Interno';
    etapas.push({
      ordem: 2,
      nome: 'Varredura Vetorial e Textual no Supabase',
      descricao: 'Nenhum trecho com similaridade suficiente (threshold >= 0.3) foi localizado nos documentos indexados.',
      tempoMs: tempoVetorial + tempoFallback,
    });

    const textoResposta = 'Não encontrei nos documentos.';

    const rastro = criarRastroFinal({
      tipoBusca: 'vetorial',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: modeloUsado,
    });

    return {
      textoResposta,
      origem: 'ia',
      intencaoDetectada: intencao,
      perguntaReescrita: pergunta_reescrita,
      buscaUsada: 'Busca vetorial no Supabase',
      similaridade: '0%',
      rastro,
    };
  }

  // ============================================================================
  // CASO 5: FORA DE ESCOPO
  // ============================================================================
  modeloUsado = 'Motor Interno';
  etapas.push({
    ordem: 2,
    nome: 'Identificação de Escopo',
    descricao: 'A mensagem foi classificada como fora do escopo corporativo da Delta Plan e de documentos dos titulares.',
    tempoMs: 1,
  });

  const textoResposta = `Esse assunto está fora do meu escopo de atuação${vocativo}. Como assistente da Delta Plan, posso te ajudar com busca de documentos oficiais, dados de titulares ou normas e procedimentos internos da construtora.`;

  const rastro = criarRastroFinal({
    tipoBusca: 'nenhuma',
    docsEncontrados: [],
    enviouAnexo: false,
    respostaFinal: textoResposta,
    modelo: modeloUsado,
  });

  return {
    textoResposta,
    origem: 'motor',
    intencaoDetectada: intencao,
    perguntaReescrita: pergunta_reescrita,
    buscaUsada: 'Nenhuma (Fora de escopo)',
    similaridade: 'N/A',
    rastro,
  };
}
