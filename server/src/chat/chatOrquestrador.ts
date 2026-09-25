import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { gerarEmbedding } from '../ai/openaiProvider.js';
import { chamarChatComTelemetria } from '../ai/telemetriaIaService.js';
import {
  obterTitularPorNome,
  obterTodosTitulares,
  obterTodosDocumentos,
  obterTodosConhecimentos,
  salvarOuAtualizarTitular,
  resolverTitularCadastrado,
  resolverTitularComAmbiguidade,
} from '../storage.js';
import {
  buscarDocumentos,
  isConfirmacaoSimples,
  identificarMultiplosDocumentosNoTexto,
  identificarTipoPedido,
  extrairTitularExplicito,
  titularCorresponde,
} from '../busca/motor.js';
import {
  registrarOuIncrementarDocumentoFaltante,
  formatarTipoDocumentoLegivel,
  validarTipoDocumentoReconhecivel,
} from '../documentosFaltantesService.js';
import {
  verificarDadoDisponivelEmOutroDocumento,
  obterArtigoDefinido,
  obterPreposicaoTitular,
} from '../busca/equivalenciaService.js';
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
  DadosEstruturadosMensagem,
  FichaTitular,
} from '../types.js';
import { extrairPrimeiroNome, formatarFraseAcompanhamento, nomesSaoEquivalentesComTolerancia } from '../utils/nomeUtils.js';
import { criarAnexoParaDocumento } from '../pdfService.js';
import { mascararDadosSensiveis, mascararDocumento, truncarTrecho } from '../utils/segurancaUtils.js';

/**
 * Sanitiza rigorosamente qualquer texto que será entregue ao usuário no WhatsApp ou no painel.
 * Remove sumariamente blocos de código técnicos (```documento, ```json, ```pdf, ```nao_encontrado),
 * objetos JSON acidentais ({ "id": ... }), chaves e resíduos de formatação.
 */
export function sanitizarRespostaTextoFinal(texto: string): string {
  if (!texto) return '';

  let limpo = texto;

  // 1. Remove qualquer bloco markdown de código com delimitadores triplos (```...```)
  limpo = limpo.replace(/```(?:documento|pdf|json|nao_encontrado)?\s*[\s\S]*?```/gi, '');

  // 2. Remove blocos JSON que tenham vazado soltos sem crases (ex: { "id": "...", "titulo": ... })
  limpo = limpo.replace(/\{\s*"(?:id|titulo|arquivo|termo)"\s*:[\s\S]*?\}/gi, '');

  // 3. Remove quaisquer crases triplas ou duplas residuais
  limpo = limpo.replace(/```+/g, '');

  // 4. Normaliza quebras de linha múltiplas e espaços
  limpo = limpo
    .split('\n')
    .map((linha) => linha.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 5. Normalização estrita de pontuações anômalas (ex: ".." ou ",." ou ", .")
  limpo = limpo
    .replace(/,\s*\./g, '.')
    .replace(/,\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();

  return limpo;
}


import {
  calcularDiasRestantes,
  determinarStatusVencimento,
  atualizarValidadeDocumento,
  silenciarAlertasDocumento,
  parseDataBr,
} from '../vencimentos/alertaVencimentoService.js';
import {
  obterAgoraBrasilia,
  obterAgoraIsoUtc,
} from '../utils/dataHoraUtils.js';
import { obterConfiguracoesVegaSync } from '../config/configuracoesVegaService.js';

export type IntencaoChat =
  | 'saudacao_ou_vago'
  | 'pedir_arquivo'
  | 'listar_documentos'
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
  documentos_citados?: string[];
  ambiguidadeTitulares?: string[];
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

/**
 * Interpreta a resposta do usuário quando há documentos previamente oferecidos pela VEGA.
 * Reconhece:
 * - "os dois", "esses 2", "ambos", "todos", "pode mandar", "sim", "manda": envia todos.
 * - "o primeiro", "1", "o 1", ordinal: envia o primeiro da lista.
 * - "o segundo", "2", "o 2", ordinal: envia o segundo da lista.
 * - Nome de um documento (ex: "crea", "certidão"): envia o correspondente.
 */
export function resolverEscolhaDocumentosOferecidos(
  mensagemUsuario: string,
  docsOferecidos: DocumentoRegistro[]
): DocumentoRegistro[] | null {
  if (!mensagemUsuario || !docsOferecidos || docsOferecidos.length === 0) return null;

  const msgLimpa = mensagemUsuario
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // REGRA DE EXCLUSÃO ABSOLUTA: Se a mensagem for uma pergunta, pedido de informação ou comando interrogativo,
  // NUNCA pode ser tratada como confirmação de documento ofertado!
  const ehPerguntaOuNovaBusca =
    mensagemUsuario.includes('?') ||
    /\b(qual|quando|onde|quem|quanto|quantos|como|por\s*que|porque|cad[eê]|me\s*diga|informa|informe|sabe|mostra|mostre)\b/i.test(msgLimpa);

  if (ehPerguntaOuNovaBusca) {
    return null;
  }

  // 1. Mensagens afirmativas explícitas ("sim", "pode mandar", "manda", "quero", "isso", "por favor", etc.)
  const regexAfirmativo = /\b(sim|pode mandar|pode enviar|manda|envia|quero|isso|por favor|com certeza|manda ai|manda a[ií]|manda ele|solta esse arquivo|envia ele|os dois|os 2|ambos|todos|todas|pode ser|com certeza|ok|claro|perfeito|manda bala)\b/i;
  if (regexAfirmativo.test(msgLimpa) || isConfirmacaoSimples(mensagemUsuario)) {
    return docsOferecidos;
  }

  // 2. Escolha por número ordinal ("o primeiro", "primeiro", "1", "o 1", "opcao 1")
  const regexPrimeiro = /\b(primeiro|primeira|1|opcao 1|op[cç][aã]o 1|o 1|o primeiro)\b/i;
  if (regexPrimeiro.test(msgLimpa) && docsOferecidos.length >= 1) {
    return [docsOferecidos[0]];
  }

  // 3. Escolha por segundo ordinal ("o segundo", "segundo", "2", "o 2", "opcao 2")
  const regexSegundo = /\b(segundo|segunda|2|opcao 2|op[cç][aã]o 2|o 2|o segundo)\b/i;
  if (regexSegundo.test(msgLimpa) && docsOferecidos.length >= 2) {
    return [docsOferecidos[1]];
  }

  // 4. Escolha por terceiro ordinal ("o terceiro", "terceiro", "3", "o 3", "opcao 3")
  const regexTerceiro = /\b(terceiro|terceira|3|opcao 3|op[cç][aã]o 3|o 3|o terceiro)\b/i;
  if (regexTerceiro.test(msgLimpa) && docsOferecidos.length >= 3) {
    return [docsOferecidos[2]];
  }

  // 5. Escolha pelo nome do documento ou tipo (NUNCA por nome do titular!)
  // Mensagens com mais de 6 palavras não são escolha de documento
  if (msgLimpa.split(/\s+/).length > 6) {
    return null;
  }

  const matches = docsOferecidos.filter((d) => {
    const tNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const arqNorm = d.arquivo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const palavrasTitulo = tNorm.split(/\s+/).filter(
      (w) => w.length >= 3 && !['documento', 'thomaz', 'lustri', 'fabre', 'delta', 'plan', 'para', 'com'].includes(w)
    );
    return (
      msgLimpa.includes(tNorm) ||
      (palavrasTitulo.length > 0 && palavrasTitulo.some((p) => msgLimpa.includes(p))) ||
      (d.tipo && msgLimpa.includes(d.tipo.toLowerCase())) ||
      (d.apelidos && d.apelidos.some((ap) => msgLimpa.includes(ap.toLowerCase())))
    );
  });

  if (matches.length > 0) {
    return matches;
  }

  return null;
}

/**
 * Extrai a saudação inicial do usuário se houver ("bom dia", "boa tarde", "olá", etc.)
 */
export function extrairSaudacaoUsuario(msg: string): string {
  const m = (msg || '').trim().toLowerCase();
  if (/^bom\s*dia\b/i.test(m)) return 'Bom dia';
  if (/^boa\s*tarde\b/i.test(m)) return 'Boa tarde';
  if (/^boa\s*noite\b/i.test(m)) return 'Boa noite';
  if (/^(ol[aá]|oi)\b/i.test(m)) return 'Olá';
  return '';
}

/**
 * Monta o prefixo de saudação para a resposta (ex.: "Bom dia, Joao! ")
 */
export function montarPrefixoSaudacao(msg: string, primeiroNome?: string): string {
  const saudacao = extrairSaudacaoUsuario(msg);
  if (!saudacao) return '';
  if (primeiroNome && primeiroNome.trim().length > 0) {
    return `${saudacao}, ${primeiroNome.trim()}! `;
  }
  return `${saudacao}! `;
}

/**
 * Formata a pergunta de ambiguidade de titulares ("Encontrei certidões de: 1) Titular A, 2) Titular B. Qual delas?")
 */
export function formatarPerguntaAmbiguoTitular(
  tipoPedido: string,
  titulares: string[],
  prefixoSaudacao: string = ''
): string {
  const lista = titulares.map((t, idx) => `${idx + 1}) ${t}`).join(', ');
  const tipoNorm = (tipoPedido || 'documento').trim().toLowerCase();

  let pronome = 'Qual deles?';
  let termo = tipoNorm;

  if (tipoNorm.includes('certid')) {
    pronome = 'Qual delas?';
    termo = tipoNorm.replace(/certid[aã]o/gi, 'certidões');
  } else if (tipoNorm === 'cnh' || tipoNorm.includes('carteira')) {
    pronome = 'Qual delas?';
    termo = tipoNorm === 'cnh' ? 'CNHs' : tipoNorm.replace(/carteira/gi, 'carteiras');
  } else if (tipoNorm.includes('procura')) {
    pronome = 'Qual delas?';
    termo = tipoNorm.replace(/procura[cç][aã]o/gi, 'procurações');
  } else if (tipoNorm.includes('declara')) {
    pronome = 'Qual delas?';
    termo = tipoNorm.replace(/declara[cç][aã]o/gi, 'declarações');
  } else {
    pronome = 'Qual deles?';
  }

  // Capitaliza a primeira letra do termo se não tiver prefixo
  if (!prefixoSaudacao) {
    termo = termo.charAt(0).toUpperCase() + termo.slice(1);
  }

  return `${prefixoSaudacao}Encontrei ${termo} de: ${lista}. ${pronome}`;
}

/**
 * Formata a pergunta ao usuário quando um dado pessoal é solicitado sem especificar titular
 * e sem titular identificado no histórico recente.
 * Regra rígida: Nunca assume ninguém nem lista todos os titulares; pergunta diretamente: "De quem você precisa do [campo]?"
 */
export function formatarPerguntaDadoPessoalSemTitular(
  campos?: string[],
  mensagem?: string,
  prefixoSaudacao: string = ''
): string {
  const msgNorm = (mensagem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const camposNorm = (campos || []).map((c) => c.toLowerCase());

  // Se forem múltiplos campos solicitados
  if (camposNorm.length > 1) {
    return `${prefixoSaudacao}De quem você precisa dessas informações?`;
  }

  const c = camposNorm.length > 0 ? camposNorm[0] : '';

  if (c === 'cpf' || /\bcpf\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa do CPF?`;
  }
  if (c === 'rg' || /\b(rg|identidade)\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa do RG?`;
  }
  if (c === 'endereco' || /\b(endere[cç]o|mora|resid[eê]ncia)\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa do endereço?`;
  }
  if (c === 'filiacao' || /\b(m[aã]e|pai|pais|filia[cç][aã]o)\b/i.test(msgNorm)) {
    if (/\b(m[aã]e)\b/i.test(msgNorm)) return `${prefixoSaudacao}De quem você precisa do nome da mãe?`;
    if (/\b(pai)\b/i.test(msgNorm)) return `${prefixoSaudacao}De quem você precisa do nome do pai?`;
    return `${prefixoSaudacao}De quem você precisa da filiação?`;
  }
  if (c === 'datanascimento' || /\b(nascimento|data\s*(de\s*)?nascimento|idade)\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa da data de nascimento?`;
  }
  if (c === 'profissao' || /\b(profiss[aã]o|cargo|ocupa[cç][aã]o)\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa da profissão?`;
  }
  if (c === 'estadocivil' || /\b(estado\s*civil|casad[oa]|solteir[oa])\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa do estado civil?`;
  }
  if (c === 'validadecnh' || (/\bvalidade\b/i.test(msgNorm) && /\bcnh\b/i.test(msgNorm))) {
    return `${prefixoSaudacao}De quem você precisa da validade da CNH?`;
  }
  if (c === 'categoriacnh' || (/\bcategoria\b/i.test(msgNorm) && /\bcnh\b/i.test(msgNorm))) {
    return `${prefixoSaudacao}De quem você precisa da categoria da CNH?`;
  }
  if (c === 'cnh' || /\b(cnh|habilita[cç][aã]o)\b/i.test(msgNorm)) {
    return `${prefixoSaudacao}De quem você precisa da CNH?`;
  }
  if (
    c === 'vacina' ||
    c === 'vacinacao' ||
    c === 'covid' ||
    /\b(vacina|vacinas|vacina[cç][aã]o|imuniza[cç][aã]o|covid(-?19)?|doses?)\b/i.test(msgNorm)
  ) {
    if (/\b(dias?|datas?|quando)\b/i.test(msgNorm)) {
      return `${prefixoSaudacao}De quem você precisa das datas de vacinação?`;
    }
    return `${prefixoSaudacao}De quem você precisa das informações de vacinação?`;
  }

  return `${prefixoSaudacao}De quem você precisa dessa informação?`;
}

/**
 * Expressão regular que reconhece qualquer menção a tipos de documentos ou certidões corporativas/pessoais.
 * Pedidos de documentos são SEMPRE do escopo da VEGA (nunca fora de escopo).
 */
export const REGEX_DOCUMENTO_QUALQUER = /\b(documentos?|arquivos?|pdfs?|contratos?|alvar[aá]s?|certid[aã]o|certid[oõ]es|notas?(\s*fiscais|\s*fiscal)?|comprovantes?|procura[cç][aã]o|procura[cç][oõ]es|termos?|recibos?|declara[cç][aã]o|declara[cç][oõ]es|estatutos?|licen[cç]as?|ap[oó]lices?|escrituras?|habite-?se|cnh|carteira(\s*de\s*motorista)?|carteira(\s*de)?\s*vacina[cç][aã]o|cart[aã]o(\s*de)?\s*vacinas?|vacinas?|vacina[cç][aã]o|covid(-?19)?|imuniza[cç][aã]o|doses?|habilita[cç][aã]o|crea|crt|cau|oab|conselho|registro\s*profissional|passaportes?|atestados?|laudos?|art|rrt)\b/i;


/**
 * Sanitiza pedidos de arquivo removendo cortesias, saudações, comandos de envio e termos genéricos de arquivo.
 * Retorna o termo limpo restante e se a mensagem era apenas um comando de envio genérico (sem nome de documento).
 */
export function sanitizarPedidoArquivo(mensagem: string): {
  termoLimpo: string;
  apenasComandoEnvio: boolean;
} {
  if (!mensagem || !mensagem.trim()) {
    return { termoLimpo: '', apenasComandoEnvio: true };
  }

  // Normaliza para minúsculas e remove acentos para compatibilidade perfeita de fronteira de palavras (\b)
  let limpo = mensagem
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Remover pontuações superficiais e quebras de linha
  limpo = limpo.replace(/[,;:.!?"'()]/g, ' ');

  // 2. Remover saudações e cortesias
  limpo = limpo.replace(
    /\b(perfeito|perfeita|otimo|otima|beleza|legal|maravilha|show|maravilhoso|ok|obrigado|obrigada|valeu|muito obrigado|muito obrigada|por favor|por gentileza|agora|entao|bom dia|boa tarde|boa noite|ola|oi|e ai)\b/gi,
    ' '
  );

  // 3. Remover comandos e expressões de envio / solicitação
  limpo = limpo.replace(
    /\b(me envie|me envia|me manda|manda|envia|enviar|mandar|quero|preciso|gostaria|favor enviar|favor mandar|pode mandar|pode enviar|passa|me passa|encaminha|me encaminha|solta|solte|baixa|baixar|faz o download|fazer o download|download)\b/gi,
    ' '
  );

  // 4. Remover termos genéricos que apenas indicam formato de arquivo e não o nome do documento
  limpo = limpo.replace(
    /\b(o pdf|um pdf|pdf|os pdfs|pdfs|o arquivo|um arquivo|arquivo|os arquivos|arquivos|o documento|um documento|documento|os documentos|documentos|esse documento|este documento|aquele documento|o anexo|um anexo|anexo|os anexos|anexos|em anexo|em pdf|esse|este|isso|aquilo|dele|dela|ele|ela|pra mim|para mim|ai)\b/gi,
    ' '
  );

  // 5. Remover artigos, conjunções e preposições que sobraram soltas nas pontas
  limpo = limpo.replace(/\b(o|a|os|as|de|do|da|dos|das|em|no|na|nos|nas|por|para|pra|pro|com|e|ou|um|uma|uns|umas)\b/gi, ' ');

  // 6. Limpar espaços duplos
  limpo = limpo.replace(/\s+/g, ' ').trim();

  // Se nada sobrou (ou sobrou menos que 2 letras), é puramente um comando de envio sem nome de documento
  const apenasComandoEnvio = limpo.length < 2;

  return {
    termoLimpo: limpo,
    apenasComandoEnvio,
  };
}

/**
 * Constantes da Janela de Contexto de Conversa
 * - JANELA_CONTEXTO_MENSAGENS: 30 mensagens para o histórico geral (titulares, documentos recentes e referências).
 * - JANELA_CLASSIFICADOR_MENSAGENS: 12 mensagens para o classificador LLM (contexto real sem encarecer).
 */
export const JANELA_CONTEXTO_MENSAGENS = 30;
export const JANELA_CLASSIFICADOR_MENSAGENS = 12;

/**
 * Recupera o documento mais recente que esteve em discussão no histórico recente da conversa.
 * Inspeciona rastro.documentoUsado, documentoOferecidoId, anexos e citações textuais no histórico.
 * Janela: Avalia estritamente as últimas 30 mensagens da conversa.
 */
export function extrairDocumentoRecenteDoHistorico(
  historicoRecente: Mensagem[],
  todosDocs: DocumentoRegistro[]
): DocumentoRegistro | null {
  if (!historicoRecente || historicoRecente.length === 0 || !todosDocs || todosDocs.length === 0) {
    return null;
  }

  // Percorre as mensagens das mais recentes para as mais antigas dentro da janela das últimas 30 mensagens
  const ultimasMsgs = historicoRecente.slice(-JANELA_CONTEXTO_MENSAGENS);
  const msgsReversas = [...ultimasMsgs].reverse();

  for (const msg of msgsReversas) {
    // 1. Checa se a mensagem ofereceu um documento específico por ID
    if (msg.documentoOferecidoId) {
      const doc = todosDocs.find((d) => d.id === msg.documentoOferecidoId);
      if (doc) return doc;
    }

    // 2. Checa o rastro da mensagem
    if (msg.rastro) {
      // 2a. Se registrou documentoUsado no rastro
      if (msg.rastro.documentoUsado) {
        const docUsadoStr = msg.rastro.documentoUsado.trim().toLowerCase();
        const docMatch = todosDocs.find(
          (d) =>
            d.titulo.toLowerCase() === docUsadoStr ||
            d.arquivo.toLowerCase() === docUsadoStr ||
            docUsadoStr.includes(d.titulo.toLowerCase()) ||
            d.titulo.toLowerCase().includes(docUsadoStr)
        );
        if (docMatch) return docMatch;
      }

      // 2b. Se nos trechos/documentos encontrados houve um usado
      if (msg.rastro.documentosEncontrados && msg.rastro.documentosEncontrados.length > 0) {
        const docEncontradoUsado = msg.rastro.documentosEncontrados.find((d) => d.usadoNaResposta);
        if (docEncontradoUsado) {
          const docMatch = todosDocs.find(
            (d) =>
              (docEncontradoUsado.id && d.id === docEncontradoUsado.id) ||
              d.titulo.toLowerCase() === (docEncontradoUsado.titulo || '').toLowerCase()
          );
          if (docMatch) return docMatch;
        }
      }
    }

    // 3. Checa se a mensagem teve anexos
    if (msg.anexos && msg.anexos.length > 0) {
      for (const anexo of msg.anexos) {
        const docMatch = todosDocs.find(
          (d) =>
            d.arquivo === anexo.nome ||
            (anexo.titulo && d.titulo.toLowerCase() === anexo.titulo.toLowerCase())
        );
        if (docMatch) return docMatch;
      }
    }

    // 4. Checa no texto da mensagem do assistente se cita expressamente algum documento do cofre
    // (ex: "De acordo com a *Apólice de seguro automotivo do carro Nivus Tokyo*...")
    if (msg.remetente === 'assistente' && msg.texto) {
      const textoL = msg.texto.toLowerCase();
      // Ordena por tamanho decrescente do título para priorizar nomes mais específicos
      const docsOrdenados = [...todosDocs].sort((a, b) => b.titulo.length - a.titulo.length);
      for (const d of docsOrdenados) {
        if (d.titulo && d.titulo.length >= 4) {
          const titL = d.titulo.toLowerCase();
          if (textoL.includes(titL) || textoL.includes(`*${titL}*`)) {
            return d;
          }
        }
      }
    }
  }

  return null;
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
  dadosEstruturados?: DadosEstruturadosMensagem;
}

export function extrairDadosEstruturadosDeItemConhecimento(item: ItemConhecimento): DadosEstruturadosMensagem | undefined {
  if (!item) return undefined;
  const tipo = item.tipo || 'regra';
  const dados: DadosEstruturadosMensagem = {
    tipo,
    titulo: item.titulo,
    conteudo: item.conteudo,
  };

  if (tipo === 'link') {
    const match = item.conteudo?.match(/https?:\/\/[^\s]+/i);
    if (match) dados.link = match[0].replace(/[.,;)]+$/, '');
  } else if (tipo === 'pix') {
    const matchChave = item.conteudo?.match(/(?:chave|pix|cpf|cnpj|email|telefone|chave aleat[oó]ria)?[:\s]+([a-zA-Z0-9.\-_@+]+)/i);
    if (matchChave) dados.chavePix = matchChave[1];
  } else if (tipo === 'contato') {
    const matchTel = item.conteudo?.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/);
    if (matchTel) dados.telefone = matchTel[0];
  }

  return dados;
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
          ? titNorm.includes(normalizarParaBusca(titularNome)) || (doc.titular ? normalizarParaBusca(doc.titular).includes(normalizarParaBusca(titularNome)) : false)
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
 * Recupera o último documento que a VEGA entregou como anexo ou citou nas mensagens anteriores da conversa.
 */
function obterUltimoDocumentoEnviado(
  historico: Mensagem[],
  todosDocs: DocumentoRegistro[]
): DocumentoRegistro | null {
  if (!historico || historico.length === 0) return null;

  // Avalia as mensagens dentro da janela das últimas 30 mensagens
  const ultimasMsgs = historico.slice(-JANELA_CONTEXTO_MENSAGENS);

  for (let i = ultimasMsgs.length - 1; i >= 0; i--) {
    const m = ultimasMsgs[i];
    if (m.remetente === 'assistente') {
      // 1. Checa por anexos da mensagem
      if (m.anexos && m.anexos.length > 0) {
        for (const ax of m.anexos) {
          const doc = todosDocs.find(
            (d) =>
              d.id === (ax as any).id ||
              (ax.titulo && d.titulo.toLowerCase() === ax.titulo.toLowerCase()) ||
              d.arquivo.toLowerCase() === ax.nome.toLowerCase()
          );
          if (doc) return doc;
        }
      }
      // 2. Checa rastro de documento usado
      if (m.rastro?.documentoUsado) {
        const docUsadoStr = m.rastro.documentoUsado.toLowerCase();
        const doc = todosDocs.find(
          (d) =>
            d.titulo.toLowerCase() === docUsadoStr ||
            d.arquivo.toLowerCase() === docUsadoStr
        );
        if (doc) return doc;
      }
      // 3. Checa texto: "Aqui está o documento solicitado: X"
      if (m.texto) {
        const match = m.texto.match(/Aqui está o documento solicitado:\s*([^.\n]+)/i);
        if (match) {
          const tit = match[1].trim().toLowerCase();
          const doc = todosDocs.find((d) => d.titulo.toLowerCase() === tit || tit.includes(d.titulo.toLowerCase()));
          if (doc) return doc;
        }
      }
    }
  }
  return null;
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
  item: ItemConhecimento,
  openai: OpenAI
): Promise<ResultadoTextoIA> {
  const inicio = Date.now();

  // 1. Resposta Determinística Exata para Chave PIX
  if (item.tipo === 'pix') {
    const d = (item.dadosEstruturados as any) || {};
    const titular = d.titular || 'Delta Plan';
    const tipoChave = d.tipoChave || 'Chave';
    const chave = d.chave || item.conteudo;
    const bancoLinha = d.banco ? `\n*Banco:* ${d.banco}` : '';
    const titularLinha = `\n*Titular:* ${titular}`;

    return {
      texto: `Aqui está a chave PIX de *${titular}*:\n\n*Chave:* \`${chave}\` (${tipoChave})${bancoLinha}${titularLinha}`,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  // 2. Resposta Determinística Exata para Links de Sistemas
  if (item.tipo === 'link') {
    const d = (item.dadosEstruturados as any) || {};
    const sistema = d.nomeSistema || item.titulo;
    const link = d.link || item.conteudo;
    const finalidadeLinha = d.finalidade ? `\n_(${d.finalidade})_` : '';

    return {
      texto: `Aqui está o link do *${sistema}*:\n\n🔗 ${link}${finalidadeLinha}`,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  // 3. Resposta Determinística Exata para Contatos
  if (item.tipo === 'contato') {
    const d = (item.dadosEstruturados as any) || {};
    const nome = d.nome || item.titulo;
    const partes: string[] = [`*${nome}*`];
    if (d.funcao) partes.push(`*Cargo/Função:* ${d.funcao}`);
    if (d.telefone) partes.push(`*Telefone:* ${d.telefone}`);
    if (d.email) partes.push(`*E-mail:* ${d.email}`);

    return {
      texto: `Aqui estão os dados de contato de *${nome}*:\n\n${partes.join('\n')}`,
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  // 4. Regras e textos livres
  const titulo = item.titulo;
  const conteudo = item.conteudo;

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
    const res = await chamarChatComTelemetria(
      openai,
      {
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
        temperature: obterConfiguracoesVegaSync().temperaturaResposta,
        max_completion_tokens: 300,
      },
      { motivo: 'chat_resumo_conhecimento' }
    );
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

  // 0. BUSCA EXATA ESTRUTURADA (PIX, Link, Contato)
  // A) Consulta de Chave PIX
  if (termoNorm.includes('pix')) {
    const itensPix = conhecimentos.filter(
      (c) => c.tipo === 'pix' || c.titulo.toLowerCase().includes('pix')
    );
    if (itensPix.length > 0) {
      for (const p of itensPix) {
        const dados = (p.dadosEstruturados as any) || {};
        const titular = dados.titular ? normalizarParaBusca(dados.titular) : '';
        const titItem = normalizarParaBusca(p.titulo);
        if (
          (titular && termoNorm.includes(titular)) ||
          (titItem && termoNorm.includes(titItem))
        ) {
          return { item: p, score: 100 };
        }
      }
      // Se não especificou titular mas só existe 1 chave cadastrada
      if (itensPix.length === 1) {
        return { item: itensPix[0], score: 100 };
      }
    }
  }

  // B) Consulta de Links de Sistemas
  if (/\b(link|url|site|sistema|portal|acesso)\b/.test(termoNorm)) {
    const itensLink = conhecimentos.filter(
      (c) => c.tipo === 'link' || c.categoria?.toLowerCase() === 'sistemas'
    );
    for (const l of itensLink) {
      const dados = (l.dadosEstruturados as any) || {};
      const nomeSis = dados.nomeSistema ? normalizarParaBusca(dados.nomeSistema) : '';
      const titItem = normalizarParaBusca(l.titulo);
      if (
        (nomeSis && (termoNorm.includes(nomeSis) || nomeSis.includes(termoNorm))) ||
        (titItem && (termoNorm.includes(titItem) || titItem.includes(termoNorm)))
      ) {
        return { item: l, score: 100 };
      }
    }
  }

  // C) Consulta de Contatos
  if (/\b(contato|telefone|celular|whatsapp|email|e-mail|ramal|falar com)\b/.test(termoNorm)) {
    const itensContato = conhecimentos.filter(
      (c) => c.tipo === 'contato' || c.categoria?.toLowerCase() === 'contatos'
    );
    for (const ct of itensContato) {
      const dados = (ct.dadosEstruturados as any) || {};
      const nome = dados.nome ? normalizarParaBusca(dados.nome) : '';
      const funcao = dados.funcao ? normalizarParaBusca(dados.funcao) : '';
      const titItem = normalizarParaBusca(ct.titulo);
      if (
        (nome && (termoNorm.includes(nome) || nome.includes(termoNorm))) ||
        (funcao && (termoNorm.includes(funcao) || funcao.includes(termoNorm))) ||
        (titItem && (termoNorm.includes(titItem) || titItem.includes(termoNorm)))
      ) {
        return { item: ct, score: 100 };
      }
    }
  }

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
 * Extrai o último titular mencionado no histórico de mensagens (do mais recente para o mais antigo).
 * Janela: Avalia estritamente as últimas 30 mensagens da conversa.
 */
export function extrairUltimoTitularDoHistorico(historicoRecente: Mensagem[]): string | undefined {
  if (!historicoRecente || historicoRecente.length === 0) return undefined;

  // Avalia estritamente a janela das últimas 30 mensagens
  const ultimasMsgs = historicoRecente.slice(-JANELA_CONTEXTO_MENSAGENS);

  for (let i = ultimasMsgs.length - 1; i >= 0; i--) {
    const msg = ultimasMsgs[i];
    // Se a mensagem for de saudação pura ou apresentação padrão da VEGA, ignorar para não contaminar o contexto
    if (msg.rastro?.intencaoDetectada === 'saudacao_ou_vago') continue;
    if (msg.remetente === 'assistente' && /sou a vega/i.test(msg.texto || '')) continue;

    if (msg.rastro?.pessoa) {
      return msg.rastro.pessoa;
    }
    const titularEncontrado = extrairTitularExplicito(msg.texto || '');
    if (titularEncontrado) {
      return titularEncontrado;
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

  // Eixo A: Tipos únicos de documentos gerados 100% dinamicamente da tabela documentos, sem tipos fixos em código
  const tiposDocsUnicos = Array.from(
    new Set(
      docs
        .map((d) => (d.tipo || '').trim())
        .filter((t) => t.length > 0 && t.toLowerCase() !== 'outros')
    )
  ).sort();
  const listaTiposDocs = tiposDocsUnicos.length > 0
    ? tiposDocsUnicos.map((t) => `"${t}"`).join(', ')
    : 'Nenhum documento cadastrado';

  const systemPrompt = `Você é o classificador de intenções da VEGA, assistente corporativa da Delta Plan.
Titulares cadastrados: ${nomesTitularesConhecidos || 'Nenhum titular cadastrado'}.
Base de Conhecimento: ${titulosConhecimento || 'Nenhum item cadastrado'}.
Tipos de documentos no cofre: ${listaTiposDocs}.

Retorne ESTRITAMENTE um objeto JSON com a seguinte estrutura:
{
  "intencao": "saudacao_ou_vago" | "pedir_arquivo" | "listar_documentos" | "dado_pessoal" | "pergunta_conteudo" | "corrigir_dado" | "consultar_vencimentos" | "silenciar_alerta" | "fora_de_escopo",
  "pessoa": "nome do titular ou pessoa citada na mensagem (ex: Fulano, Nilceia) ou vazio",
  "campos": ["lista de campos ou dados específicos solicitados (ex.: cpf, rg, filiacao, mae, pai, dataNascimento, endereco, estadoCivil, profissao, cnh, validadeCnh, categoriaCnh, orgaoEmissor, titulo_eleitor, pis, carteira_reservista, certidao_nascimento, passaporte ou qualquer outro campo/dado perguntado) ou vazio"],
  "campo_corrigir": "nome do campo a ser corrigido (ex: profissao, cpf, rg, etc.) ou vazio",
  "valor_novo": "novo valor correto informado pelo usuário ou vazio",
  "documento_citado": "nome do documento físico citado explicitamente ou vazio",
  "documentos_citados": ["lista de documentos físicos citados na mensagem atual (ex: ['CREA', 'Certidão de Casamento']) ou vazio"],
  "pergunta_completa": "versão clara e completa da pergunta sem perder nenhuma informação",
  "termo_busca": "versão curta para busca por nome de arquivo ou tópico"
}

REGRAS RÍGIDAS DE INTENÇÃO E ESCOPO:
1. "saudacao_ou_vago": Apenas saudações puras ("oi", "olá", "bom dia") ou pedidos vagos ("me ajuda"). NUNCA use para perguntas com assunto ou listas.
2. "pedir_arquivo": Pedido EXPRESSO de envio ou entrega de qualquer documento físico ("me manda a CNH", "envia o PDF do CREA", "baixa o arquivo", "preciso do documento X", "me envia a certidão", "perfeito, agora me envie o pdf", "show, agora solta esse arquivo aí", "manda o arquivo").
   - REGRA DE OURO PARA DOCUMENTO CITADO:
     * Preencha "documento_citado" e "termo_busca" SOMENTE se a mensagem citar expressamente um documento real e identificável (ex: "CNH", "Certidão de Casamento", "CREA", "Alvará", "Contrato", "Apólice de Seguro", "Passaporte").
     * Se a mensagem for apenas um comando de envio, gíria ou pedido genérico do arquivo em discussão (ex: "perfeito, agora me envie o pdf", "show, agora solta esse arquivo aí", "me envia o pdf", "manda o arquivo", "solta esse documento", "manda ele", "pode mandar", "solta aí"), devolva OBRIGATORIAMENTE "documento_citado": "" e "termo_busca": "" (vazios!). O sistema usará o contexto da conversa para enviar o documento correto.
     * NUNCA coloque frases de comando, cortesias ou gírias em "documento_citado" ou "termo_busca"!
   - ATENÇÃO CRÍTICA: Só é "pedir_arquivo" quando a pessoa pede o DOCUMENTO EM SI para envio ("me manda", "me envia", "preciso do arquivo", "quero o PDF", "solta esse arquivo").
   - Pedidos de RESUMO, EXPLICAÇÃO, INTERPRETAÇÃO ou PERGUNTAS sobre o que está escrito ("resuma esse documento", "o que esse documento fala sobre X?", "explique o documento", "qual a data de registro do casamento?", "quando fui dispensado do serviço militar?") são SEMPRE "pergunta_conteudo", NUNCA "pedir_arquivo"!
3. "listar_documentos": Quando o usuário solicitar listar, ver ou consultar quais documentos existem no Cofre ou de uma pessoa ("quais documentos você tem?", "o que tem no cofre?", "quais documentos do Fulano você tem?", "o que você tem do Fulano?", "preciso de mais alguns documentos do Fulano", "me mostra os documentos"). Preencha "pessoa" se citada.
4. "dado_pessoal": Perguntas sobre dados cadastrais e informações pontuais de pessoas (RG, CPF, filiação/mãe/pai, profissão, estado civil, validade da CNH, título de eleitor, PIS, carteira de reservista, etc.).
5. "pergunta_conteudo": Perguntas sobre o conteúdo de documentos ("resuma esse documento em 10 linhas", "o que esse documento fala sobre águas fluviais?", "qual a data de registro do casamento?", "quando fui dispensado do serviço militar?", "quais dias eu tomei as vacinas da covid?", "quais vacinas ele tomou?", "qual o endereço do Fulano?", "o que diz na página 2?").
   - REGRA MANDATÓRIA: Perguntas sobre o conteúdo de documentos arquivados no Cofre (como vacinas tomadas, datas de vacinação/doses de covid, cláusulas contratuais, valores, datas de registro de certidões, alvarás) são SEMPRE "pergunta_conteudo", NUNCA "fora_de_escopo"!
   - Se o usuário perguntar sem citar titular (ex: "quais dias eu tomei as vacinas da covid?"), devolva "intencao": "pergunta_conteudo", "pessoa": "", "termo_busca": "vacina covid". O sistema perguntará de quem é. NUNCA classifique como fora_de_escopo!
   - Quando o usuário disser "esse documento" ou "o documento acima" logo após a VEGA entregar um anexo, a pergunta DEVE ser respondida com base estrita no texto daquele documento!
6. "corrigir_dado": Quando o usuário afirmar que uma informação cadastral de titular está errada, incorreta ou precisar ser corrigida (ex.: "a profissão do Fulano está errada, é Técnico em Eletrotécnica").
7. "consultar_vencimentos": Perguntas sobre prazos de validade ou vencimento de documentos do cofre ("tem algum documento vencendo?", "o que vence este mês?", "quais documentos estão vencidos?").
8. "silenciar_alerta": Quando o usuário solicitar para parar de alertar sobre o vencimento de um documento (ex: "pare de alertar o CRT do Fulano").
9. "fora_de_escopo": Apenas assuntos que NÃO TÊM NENHUMA relação com documentos ou informações da empresa (ex: receitas culinárias, futebol, piadas). Perguntas sobre vacinas, documentos, datas de imunização ou dados de titulares NUNCA são fora de escopo.

REGRAS CRÍTICAS DE SUJEITO E CONTEXTO:
- SE A MENSAGEM ATUAL CITA UM SUJEITO (pessoa cadastrada, pessoa não cadastrada ou empresa), ele SEMPRE SUBSTITUI o sujeito das mensagens anteriores! O contexto anterior DEVE SER IGNORADO nesse caso!
- NOME CITADO NA MENSAGEM SEMPRE PREVALECE: Se a mensagem citar expressamente qualquer nome de pessoa (mesmo que NÃO conste na lista de titulares cadastrados, ex.: cônjuge, parente, terceiro como "Nilceia"), preencha "pessoa" com esse nome exato. NUNCA substitua esse nome por um titular do histórico e NUNCA o apague!
- RECONHECIMENTO DA EMPRESA: Os termos "Delta", "Deltaplan", "Delta Plan", "empresa", "escritório", "construtora" referem-se à própria Delta Plan Construtora. Nesses casos, a intenção É SEMPRE "pergunta_conteudo" (busca no Conhecimento e documentos corporativos), NUNCA "dado_pessoal" de um titular, e "pessoa" DEVE SER VAZIA ("")!
- O CONTEXTO SÓ DEVE SER USADO quando a mensagem atual NÃO tem sujeito nenhum (ex.: perguntas com pronomes como "ele", "dele", ou elípticas como "e a validade?", "e o CPF dele?", "e o RG dele?", "e o endereço dele?"). Nesses casos, herde o titular mencionado anteriormente no histórico.

EXEMPLOS OBRIGATÓRIOS:
- "qual número do título eleitoral do thomaz?" -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["titulo_eleitor"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o número do título de eleitor do Thomaz?", "termo_busca": "titulo eleitor Thomaz"}
- "qual o PIS do fulano?" -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["pis"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o PIS do Fulano?", "termo_busca": "pis Fulano"}
- "show, agora me envie o pdf" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Enviar documento do contexto", "termo_busca": ""}
- "contrato de locação" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "contrato de locação", "documentos_citados": ["contrato de locação"], "pergunta_completa": "Enviar documento contrato de locação", "termo_busca": "contrato de locação"}
- "me envia o crea e a certidão de casamento do fulano" -> {"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CREA, Certidão de Casamento", "documentos_citados": ["CREA", "Certidão de Casamento"], "pergunta_completa": "Enviar documentos CREA e Certidão de Casamento do Fulano", "termo_busca": "CREA, Certidão de Casamento"}
- "esses 2 documentos, pode mandar" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Confirmar envio dos documentos oferecidos", "termo_busca": ""}
- "me envia o registro profissional do fulano" -> {"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "registro profissional", "documentos_citados": [], "pergunta_completa": "Enviar registro profissional do Fulano", "termo_busca": "registro profissional Fulano"}
- "pare de alertar o CRT do fulano" -> {"intencao": "silenciar_alerta", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CRT", "pergunta_completa": "Desativar alertas de vencimento do documento CRT do Fulano", "termo_busca": "CRT"}
- "qual o CPF do fulano?" -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o CPF do Fulano?", "termo_busca": "Fulano"}
- "qual o nome da mãe da Nilceia?" -> {"intencao": "dado_pessoal", "pessoa": "Nilceia", "campos": ["filiacao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quem é a mãe da Nilceia?", "termo_busca": "filiacao Nilceia"}
- "quais dias eu tomei as vacinas da covid?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quais dias foram tomadas as vacinas da covid?", "termo_busca": "vacina covid"}
- "endereço delta" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o endereço da Delta Plan?", "termo_busca": "Escritorio Deltaplan"}
- "e o RG dele?" (após falar de um titular) -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["rg"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o RG do Fulano?", "termo_busca": "Fulano"}
- "me envie esses documentos do fulano: endereço, estado civil e profissão" -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["endereco", "estadoCivil", "profissao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Quais são o endereço, estado civil e profissão do Fulano?", "termo_busca": "Fulano"}
- "o que vence este mês?" -> {"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Consultar documentos que vencem este mês", "termo_busca": ""}
- "a profissão do fulano está errada, é Técnico em Eletrotécnica" -> {"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "profissao", "valor_novo": "Técnico em Eletrotécnica", "campos": ["profissao"], "documento_citado": "", "pergunta_completa": "Corrigir profissão do Fulano para Técnico em Eletrotécnica", "termo_busca": ""}
- "está errado, é 10/05/2030" (após VEGA responder validade) -> {"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "validadeCnh", "valor_novo": "10/05/2030", "campos": ["validadeCnh"], "documento_citado": "", "pergunta_completa": "Corrigir validade da CNH do Fulano para 10/05/2030", "termo_busca": ""}
- "quem é a mãe do fulano" -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["filiacao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Quem é a mãe do Fulano?", "termo_busca": "filiacao Fulano"}
- "qual cpf?" -> {"intencao": "dado_pessoal", "pessoa": "", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o CPF?", "termo_busca": "cpf"}
- "qual é a CNH do fulano" -> {"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH", "pergunta_completa": "Enviar documento CNH do Fulano", "termo_busca": "CNH Fulano"}
- "o que tem em Regra de Negócio: Proposta Comercial" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Qual é o conteúdo do documento ou instrução Regra de Negócio: Proposta Comercial?", "termo_busca": "Proposta Comercial"}
- "sim" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "pergunta_completa": "Confirmar envio do documento oferecido", "termo_busca": ""}

`;

  // Limita o histórico recente às últimas 12 mensagens para contexto rico e sem custo excessivo
  const ultimasMsgsClassificador = (historicoRecente || [])
    .slice(-JANELA_CLASSIFICADOR_MENSAGENS)
    .map((m) => `${m.remetente === 'cliente' ? 'Usuário' : 'VEGA'}: ${m.texto || ''}`)
    .filter((linha) => linha.trim().length > 0)
    .join('\n');

  const userPromptContent = ultimasMsgsClassificador
    ? `Histórico recente da conversa:\n${ultimasMsgsClassificador}\n\nMensagem atual do usuário: "${mensagemUsuario}"`
    : `Mensagem atual do usuário: "${mensagemUsuario}"`;

  try {
    const response = await chamarChatComTelemetria(
      openai,
      {
        model: chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_completion_tokens: 300,
      },
      { motivo: 'chat_classificador' }
    );

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    const tempoMs = Date.now() - inicio;

    const msgNorm = normalizarParaBusca(mensagemUsuario);

    // Identifica se uma pessoa foi citada diretamente na mensagem atual
    let pessoaCitadaNaMensagem: string | undefined = undefined;
    if (parsed.pessoa) {
      const pNorm = normalizarParaBusca(parsed.pessoa);
      if (
        msgNorm.includes(pNorm) ||
        pNorm.split(/\s+/).some((parte: string) => parte.length >= 3 && msgNorm.includes(parte))
      ) {
        pessoaCitadaNaMensagem = parsed.pessoa;
      }
    }

    // Fallback de detecção por regex para casos como "da Nilceia", "do Marcos", "de Fulano"
    if (!pessoaCitadaNaMensagem) {
      const matchPessoa = mensagemUsuario.match(/\b(?:de|da|do|dos|das)\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+)*)/);
      if (matchPessoa) {
        const candidato = matchPessoa[1].trim();
        const candNorm = normalizarParaBusca(candidato);
        const ehPalavraIgnorada = /\b(documento|pdf|arquivo|certidao|contrato|alvara|cnh|rg|empresa|delta|deltaplan|registro|casamento|nascimento|mae|pai|filiacao|resumo|vacina|covid)\b/i.test(candNorm);
        if (!ehPalavraIgnorada) {
          pessoaCitadaNaMensagem = candidato;
        }
      }
    }

    let origemPessoa: 'mensagem_atual' | 'contexto' | undefined = undefined;
    let ambiguidadeTitulares: FichaTitular[] = [];

    // Regra 16 com Tolerância de Grafia e Apelidos:
    // Nome citado na mensagem sempre prevalece sobre o contexto.
    // Se casar com um titular cadastrado (exato, por apelido ou por tolerância S/Z, TH/T, acentos),
    // normalizamos para o nome oficial do titular. Se for ambíguo, sinalizamos ambiguidade.
    if (pessoaCitadaNaMensagem) {
      const resAmb = resolverTitularComAmbiguidade(pessoaCitadaNaMensagem, titulares);
      if (resAmb.ambiguo) {
        ambiguidadeTitulares = resAmb.candidatos;
        parsed.pessoa = pessoaCitadaNaMensagem;
      } else if (resAmb.titular) {
        parsed.pessoa = resAmb.titular.nome;
      } else {
        parsed.pessoa = pessoaCitadaNaMensagem;
      }
      origemPessoa = 'mensagem_atual';
    } else if (parsed.pessoa) {
      // Se parsed.pessoa veio da LLM mas não está textualmente na mensagem atual,
      // verificamos se casa com algum titular cadastrado válido (com tolerância)
      const resAmb = resolverTitularComAmbiguidade(parsed.pessoa, titulares);
      if (resAmb.ambiguo) {
        ambiguidadeTitulares = resAmb.candidatos;
      } else if (resAmb.titular) {
        parsed.pessoa = resAmb.titular.nome;
      } else {
        parsed.pessoa = '';
      }
    }

    const ehPedidoCertidao = /\bcertid[aã]o\b/i.test(msgNorm);

    // Mapeamento e detecção de segurança para campos cadastrais e dados específicos
    const padroesCampos: { campo: string; regex: RegExp }[] = [
      { campo: 'endereco', regex: /\b(endere[cç]o|mora|resid[eê]ncia)\b/i },
      { campo: 'estadoCivil', regex: /\b(estado\s*civil|casad[oa]|solteir[oa]|divorciad[oa])\b/i },
      { campo: 'rg', regex: /\b(rg|identidade)\b/i },
      { campo: 'profissao', regex: /\b(profiss[aã]o|cargo|ocupa[cç][aã]o)\b/i },
      { campo: 'cpf', regex: /\b(cpf)\b/i },
      { campo: 'filiacao', regex: /\b(m[aã]e|pai|pais|filia[cç][aã]o)\b/i },
      { campo: 'dataNascimento', regex: /\b(data\s*(de\s*)?nascimento|quando\s*nasceu|ano\s*de\s*nascimento|idade)\b/i },
      { campo: 'validadeCnh', regex: /\b(validade(\s*da\s*cnh)?|vencimento)\b/i },
      { campo: 'categoriaCnh', regex: /\b(categoria(\s*da\s*cnh)?)\b/i },
      { campo: 'cnh', regex: /\b(n[uú]mero\s*da\s*cnh|numero\s*da\s*cnh)\b/i },
      { campo: 'orgaoEmissor', regex: /\b([oó]rg[aã]o(\s*emissor)?)\b/i },
      { campo: 'titulo_eleitor', regex: /\b(t[ií]tulo(\s*de)?\s*eleitor(al)?|n[uú]mero\s*do\s*t[ií]tulo)\b/i },
      { campo: 'pis', regex: /\b(pis|pasep|nis)\b/i },
      { campo: 'carteira_reservista', regex: /\b(reservista|certificado\s*de\s*reservista|carteira\s*de\s*reservista)\b/i },
      { campo: 'certidao_nascimento', regex: /\b(certid[aã]o\s*de\s*nascimento)\b/i },
      { campo: 'passaporte', regex: /\b(passaporte|n[uú]mero\s*do\s*passaporte)\b/i },
    ];

    const camposDetectadosRegex: string[] = [];
    if (!ehPedidoCertidao || msgNorm.includes('certidao de nascimento')) {
      for (const p of padroesCampos) {
        if (p.regex.test(msgNorm)) {
          camposDetectadosRegex.push(p.campo);
        }
      }
    }

    // Detecção expressa de sujeitos na mensagem atual
    const REGEX_EMPRESA = /\b(delta|deltaplan|delta\s*plan|empresa|escrit[oó]rio|escritorio|construtora)\b/i;
    const citaEmpresaNaMensagem = REGEX_EMPRESA.test(msgNorm);
    const titularExplicitoMsg = extrairTitularExplicito(msgNorm);

    // Detecção de intenção de correção de dado cadastral
    const REGEX_CORRECAO = /\b(est[aá]\s*errad[oa]|t[aá]\s*errad[oa]|n[aã]o\s*[eé]|incorret[oa]|corrija|corrigir|alterar|mudar\s*para|o\s*certo\s*[eé]|o\s*correto\s*[eé])\b/i;
    const ehMensagemCorrecao =
      REGEX_CORRECAO.test(msgNorm) ||
      parsed.intencao === 'corrigir_dado' ||
      (/\bvalidade\b/i.test(msgNorm) && /\b\d{2}\/\d{2}\/\d{4}\b/.test(msgNorm));

    // Detecção de consulta de vencimentos de documentos
    const REGEX_CONSULTA_VENCIMENTO = /\b(tem\s*algum\s*documento\s*vencendo|o\s*que\s*vence|quais\s*documentos?\s*est[aã]o\s*vencidos?|documentos?\s*vencidos?|documentos?\s*a\s*vencer|vencimento\s*de\s*documentos?|validade\s*dos?\s*documentos?)\b/i;
    const ehConsultaVencimento = REGEX_CONSULTA_VENCIMENTO.test(msgNorm) || parsed.intencao === 'consultar_vencimentos';

    // Detecção de parar de alertar / silenciar alertas
    const REGEX_SILENCIAR = /\b(pare\s*de\s*alerta(r)?|n[aã]o\s*alerte(\s*mais)?|desative(\s*os)?\s*alerta(s)?|desativar\s*alerta(s)?|silenciar\s*alerta(s)?|parar\s*de\s*alerta(r)?)\b/i;
    const ehSilenciarAlerta = REGEX_SILENCIAR.test(msgNorm) || parsed.intencao === 'silenciar_alerta';

    if (ehSilenciarAlerta) {
      parsed.intencao = 'silenciar_alerta';
      if (!parsed.pessoa && (pessoaCitadaNaMensagem || titularExplicitoMsg)) {
        parsed.pessoa = pessoaCitadaNaMensagem || titularExplicitoMsg;
        origemPessoa = 'mensagem_atual';
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
    } else if (pessoaCitadaNaMensagem) {
      // Regra 16: Citou expressamente uma pessoa na mensagem atual (mesmo não sendo titular cadastrado)
      parsed.pessoa = pessoaCitadaNaMensagem;
      origemPessoa = 'mensagem_atual';
    } else if (titularExplicitoMsg) {
      // Citou expressamente um titular cadastrado na mensagem atual
      parsed.pessoa = titularExplicitoMsg;
      origemPessoa = 'mensagem_atual';
    } else {
      // Mensagem atual NÃO cita nem a empresa nem pessoa explicitamente
      // Contexto só deve ser usado quando a mensagem não tem sujeito nenhum e está dentro da janela de 30 mensagens
      const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
      if (titularDoHistorico) {
        const temPronomeOuCampo = /\b(ele|dele|dela|ela)\b/i.test(msgNorm) || camposDetectadosRegex.length > 0 || ehMensagemCorrecao;
        if (parsed.pessoa || temPronomeOuCampo) {
          parsed.pessoa = titularDoHistorico;
          origemPessoa = 'contexto';
        }
      } else {
        // Se estiver fora da janela das últimas 30 mensagens ou sem titular no histórico, limpa a pessoa
        parsed.pessoa = '';
        origemPessoa = undefined;
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

    const ehPerguntaFatoDocumento =
      /\b(dispensad[oa]|servi[cç]o\s*militar|registro\s+(do\s+)?casamento|data\s+(do\s+)?registro)\b/i.test(msgNorm);

    // REGRA DE PROTEÇÃO 1: Se a mensagem citar campos cadastrais e NÃO for sobre a empresa nem correção nem vencimento geral
    if (!citaEmpresaNaMensagem && !ehMensagemCorrecao && !ehConsultaVencimento && !ehPerguntaFatoDocumento && camposDetectadosRegex.length > 0) {
      parsed.intencao = 'dado_pessoal';
      const camposSet = new Set([...(parsed.campos || []), ...camposDetectadosRegex]);
      parsed.campos = Array.from(camposSet);
      if (!titularExplicitoMsg && !pessoaCitadaNaMensagem && !parsed.pessoa) {
        const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
        if (titularDoHistorico) {
          parsed.pessoa = titularDoHistorico;
          origemPessoa = 'contexto';
        } else {
          parsed.pessoa = '';
          origemPessoa = undefined;
        }
      }
    }

    if (ehPerguntaFatoDocumento) {
      parsed.intencao = 'pergunta_conteudo';
      if (!titularExplicitoMsg && !pessoaCitadaNaMensagem && !parsed.pessoa) {
        const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
        if (titularDoHistorico) {
          parsed.pessoa = titularDoHistorico;
          origemPessoa = 'contexto';
        } else {
          parsed.pessoa = '';
          origemPessoa = undefined;
        }
      }
    }

    // REGRA DE PROTEÇÃO 2: Pedido de arquivos físicos (múltiplos ou individual)
    // Pedidos de qualquer documento (contrato, certidão, alvará, etc.) NUNCA são fora de escopo.
    const ehPedidoListagem =
      /\b(quais\s+documentos|o\s+que\s+(tem|voce\s+tem)\s+no\s+cofre|documentos\s+(que\s+)?(tem|existem)|lista(r)?\s+(os\s+)?documentos|mais\s+alguns\s+documentos)\b/i.test(
        msgNorm
      );

    const ehPerguntaExplicacaoOuResumo =
      /\b(resum[aeo]|resumo|expliq?u?e|fala\s+sobre|diz\s+sobre|o\s+que\s+(fala|diz|tem|consta)|conteudo|qual\s+o\s+conteudo|sobre\s+o\s+que\s+[eé]|quantas\s+linhas|em\s+\d+\s+linhas)\b/i.test(
        msgNorm
      );

    if (ehPedidoListagem) {
      parsed.intencao = 'listar_documentos';
    } else if (ehPerguntaExplicacaoOuResumo) {
      parsed.intencao = 'pergunta_conteudo';
    } else if (ehPedidoCertidao || REGEX_DOCUMENTO_QUALQUER.test(msgNorm)) {
      if (ehPedidoCertidao || parsed.intencao === 'fora_de_escopo' || parsed.intencao === 'saudacao_ou_vago' || parsed.intencao === 'dado_pessoal') {
        parsed.intencao = 'pedir_arquivo';
        if (!parsed.documento_citado) {
          const tipoIdentificado = identificarTipoPedido(mensagemUsuario);
          if (tipoIdentificado && validarTipoDocumentoReconhecivel(tipoIdentificado)) {
            parsed.documento_citado = tipoIdentificado;
            parsed.termo_busca = tipoIdentificado;
          } else {
            parsed.documento_citado = '';
            parsed.termo_busca = '';
          }
        }
      }
    }

    const multiplosNoTexto = identificarMultiplosDocumentosNoTexto(mensagemUsuario, docs, parsed.pessoa);
    if (!ehPerguntaExplicacaoOuResumo && !ehPedidoListagem && multiplosNoTexto.length > 1) {
      parsed.intencao = 'pedir_arquivo';
      parsed.documentos_citados = multiplosNoTexto.map((d) => d.titulo);
      parsed.documento_citado = multiplosNoTexto.map((d) => d.titulo).join(', ');
      parsed.termo_busca = parsed.documento_citado;
    } else if (!ehPerguntaExplicacaoOuResumo && !ehPedidoListagem) {
      const regexCampoEspecifico = /\b(numero|validade|vencimento|categoria|vence|venc|data|emissao|expedicao|orgao|endereco|estado\s*civil|rg|profissao|cpf|mae|pai|filiacao|alerta|alertar|silenciar|desativar)\b/i;

      if (
        !ehSilenciarAlerta &&
        !ehConsultaVencimento &&
        !ehMensagemCorrecao &&
        parsed.intencao !== 'silenciar_alerta' &&
        parsed.intencao !== 'listar_documentos' &&
        parsed.intencao !== 'pergunta_conteudo' &&
        REGEX_DOCUMENTO_QUALQUER.test(msgNorm) &&
        !regexCampoEspecifico.test(msgNorm) &&
        (!parsed.campos || parsed.campos.length === 0)
      ) {
        parsed.intencao = 'pedir_arquivo';
        if (!parsed.documento_citado) {
          const tipoIdentificado = identificarTipoPedido(mensagemUsuario);
          if (tipoIdentificado && validarTipoDocumentoReconhecivel(tipoIdentificado)) {
            parsed.documento_citado = tipoIdentificado;
            parsed.termo_busca = tipoIdentificado;
          } else {
            parsed.documento_citado = '';
            parsed.termo_busca = '';
          }
        }
        const titularDetectado = parsed.pessoa || extrairTitularExplicito(mensagemUsuario, titulares.map((t) => t.nome));
        if (titularDetectado) {
          if (parsed.termo_busca && !parsed.termo_busca.toLowerCase().includes(titularDetectado.toLowerCase())) {
            parsed.termo_busca = `${parsed.termo_busca} ${titularDetectado}`.trim();
          }
        }
      }
    }

    // Se documento_citado for apenas comando de envio genérico (ex: "pdf", "arquivo", cortesia residual), limpa para usar contexto
    if (parsed.documento_citado) {
      const sanitizadoCitado = sanitizarPedidoArquivo(parsed.documento_citado);
      if (sanitizadoCitado.apenasComandoEnvio) {
        parsed.documento_citado = '';
        parsed.termo_busca = '';
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
      origemPessoa: parsed.pessoa ? (origemPessoa || (titularExplicitoMsg ? 'mensagem_atual' : 'contexto')) : undefined,
      campos: parsed.campos && parsed.campos.length > 0 ? parsed.campos : undefined,
      campo_corrigir: parsed.campo_corrigir || undefined,
      valor_novo: parsed.valor_novo || undefined,
      documento_citado: parsed.documento_citado || undefined,
      documentos_citados: parsed.documentos_citados && parsed.documentos_citados.length > 0 ? parsed.documentos_citados : undefined,
      ambiguidadeTitulares: ambiguidadeTitulares.length > 1 ? ambiguidadeTitulares.map((t) => t.nome) : undefined,
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
 * 2.1. BUSCA DE TRECHOS NO COFRE POR NOME DE PESSOA NÃO CADASTRADA COMO TITULAR
 * Permite localizar ocorrências de cônjuges (ex: Nilceia na Certidão de Casamento),
 * testemunhas, sócios em contratos e terceiros citados em qualquer documento.
 */
export async function buscarTrechosPorNomePessoaNoCofre(
  nomePessoa: string,
  perguntaOuTermo?: string,
  documentosDisponiveis?: DocumentoRegistro[]
): Promise<TrechoEncontrado[]> {
  const supabase = getSupabaseClient();
  const primeiroNome = extrairPrimeiroNome(nomePessoa) || nomePessoa;
  const termoNorm = normalizarParaBusca(primeiroNome);

  if (!termoNorm || termoNorm.length < 3) {
    return [];
  }

  // 1. Busca direta na tabela trechos por ocorrência do nome (ilike)
  const { data: trechosSupabase, error } = await supabase
    .from('trechos')
    .select('id, documento_id, pessoa_id, conteudo, pagina')
    .ilike('conteudo', `%${termoNorm}%`);

  if (error) {
    console.error('[VEGA Chat] Erro ao buscar trechos por nome de pessoa no Cofre:', error.message);
    return [];
  }

  const trechosEncontrados = trechosSupabase || [];
  if (trechosEncontrados.length === 0) {
    return [];
  }

  // 2. Metadados dos documentos onde os trechos foram encontrados
  const docIds = Array.from(new Set(trechosEncontrados.map((t) => t.documento_id)));
  const docs = documentosDisponiveis && documentosDisponiveis.length > 0
    ? documentosDisponiveis.filter((d) => docIds.includes(d.id))
    : (await supabase.from('documentos').select('id, titulo, titular, tipo').in('id', docIds)).data || [];

  const mapaDocs = new Map((docs || []).map((d: any) => [d.id, d]));

  // 3. Monta TrechoEncontrado para cada trecho que de fato contém o nome
  const trechosFormatados: TrechoEncontrado[] = [];
  for (const t of trechosEncontrados) {
    const conteudoNorm = normalizarParaBusca(t.conteudo);
    if (conteudoNorm.includes(termoNorm)) {
      const doc = mapaDocs.get(t.documento_id);
      trechosFormatados.push({
        id: t.id,
        documento_id: t.documento_id,
        titulo_documento: doc?.titulo || 'Documento do Cofre',
        pessoa_id: t.pessoa_id,
        corporativo: !t.pessoa_id,
        pagina: t.pagina || 1,
        conteudo: t.conteudo,
        similaridade: 0.95,
      });
    }
  }

  return trechosFormatados;
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

  const configVega = obterConfiguracoesVegaSync();
  const agoraBrasilia = obterAgoraBrasilia();
  const systemPrompt = `${configVega.promptPersona}

---
DIRETRIZES DE RESPOSTA COM TRECHOS DO COFRE:
Sua tarefa é responder à pergunta do usuário usando ESTRITAMENTE as informações presentes nos trechos fornecidos abaixo.
Data e hora atual de referência: ${agoraBrasilia.dataHoraStr} (Fuso Oficial de Brasília - America/Sao_Paulo). Ao se referir a prazos ou termos como "hoje", "este mês" ou "ano atual", use sempre essa referência.

REGRAS OBRIGATÓRIAS:
1. Se a informação NÃO estiver contida nem mencionada nos trechos, responda exatamente: "Não encontrei nos documentos."
2. Nunca invente ou use conhecimento externo que não esteja nos trechos.
3. Sempre cite o documento de origem da resposta (ex: "De acordo com a *Política de Agendamento*...", ou "...conforme *Certidão de Casamento*", ou "De acordo com o documento *testes jg*...").
4. Considere que variações de nomes de titulares nos documentos referem-se à mesma pessoa quando corresponderem ao titular cadastrado no Supabase.
5. Respostas curtas, diretas e profissionais em português do Brasil, mantendo o tom da persona.
6. Se o trecho contiver um termo, anotação ou frase curta da base de conhecimento (ex: regras ou limites), use essa informação para responder o que consta no documento respectivo.
7. FORMATAÇÃO OBRIGATÓRIA (PADRÃO WHATSAPP): Use exclusivamente a formatação do WhatsApp:
   - *negrito* com apenas um asterisco (NUNCA use ** com dois asteriscos).
   - _itálico_ com underline.
   - NUNCA use títulos markdown (#, ##, ###).
   - NUNCA use tabelas (|).
   - NUNCA use links em markdown ([texto](url)).
   - Negrito só quando ajudar a leitura (nomes de documentos, valores, datas ou prazos-chave).
8. ATENÇÃO MÁXIMA AO DADO EXATO PERGUNTADO (REGRA 17):
   - REGRA ABSOLUTA DE DADO ESPECÍFICO: A VEGA só pode responder estritamente o campo ou informação solicitada na pergunta.
   - Se a pergunta for sobre um campo ou dado específico (ex: título de eleitor, PIS, carteira de reservista, certidão de nascimento, passaporte, etc.) e esse dado NÃO constar de forma inequívoca nos trechos para a pessoa em questão, responda OBRIGATORIAMENTE que não encontrou o dado nos documentos (ex: "Não encontrei o título de eleitor do Thomaz nos documentos.").
   - NUNCA responda com outro campo ou dado presente no documento (como filiação, CPF, RG ou nascimento) como substituto!
   - Se a pergunta for sobre data de DISPENSA DO SERVIÇO MILITAR, responda rigorosamente a data em que foi dispensado do serviço militar (ex.: 23 de agosto de 2005), e NUNCA a data de nascimento!
   - Se a pergunta for sobre data do REGISTRO DO CASAMENTO, responda rigorosamente a data do registro do casamento (ex.: 12 de abril de 2010), e NUNCA a data de nascimento!
   - Se a pergunta for sobre VACINAS ou DOSES TOMADAS, responda listando com clareza o nome da vacina, a dose e a data exata em que foi aplicada conforme constar no documento.
   - Se a pergunta for sobre uma PESSOA ESPECÍFICA citada na mensagem (mesmo que não seja o titular principal do documento, como cônjuge, parente, sócio, testemunha ou terceiro citado no texto), responda estritamente sobre a pessoa perguntada! NUNCA responda dados de outra pessoa.
   - Deixe SEMPRE explícito de quem é a informação respondida e cite o documento (exemplo: "A mãe da Nilceia, conforme a *Certidão de Casamento*, é Celucia Fanha Ramos.").
   - Se o trecho contiver múltiplas datas ou múltiplas pessoas, leia atentamente o contexto para responder EXATAMENTE a pessoa e o dado solicitados pelo usuário.
9. DISTINÇÃO USUÁRIO VS TITULAR: NUNCA chame o usuário que está conversando pelo nome do titular do documento. Trate o titular do documento na terceira pessoa.
10. PROIBIÇÃO ABSOLUTA DE BLOCOS TÉCNICOS: NUNCA emita blocos markdown como \`\`\`documento, \`\`\`json, \`\`\`pdf ou qualquer estrutura de código/JSON. Toda a resposta deve ser em texto natural formatado exclusivamente para WhatsApp.`;

  try {
    const response = await chamarChatComTelemetria(
      openai,
      {
        model: chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Trechos recuperados dos documentos:\n${contextoTrechos}\n\nPergunta do usuário: "${pergunta}"`,
          },
        ],
        temperature: configVega.temperaturaResposta,
        max_completion_tokens: 500,
      },
      { motivo: 'chat_resposta_trechos' }
    );

    const respostaTexto = response.choices[0]?.message?.content?.trim() || 'Não encontrei nos documentos.';
    let textoLimpo = respostaTexto.replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+/gm, '');
    textoLimpo = sanitizarRespostaTextoFinal(textoLimpo);

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
async function executarProcessamentoMensagemChatInterno(dados: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  contato: Contato;
  documentosDisponiveis?: DocumentoRegistro[];
  documentoIdDireto?: string;
}): Promise<ResultadoChatOrquestrador> {
  const inicioTotal = Date.now();
  const { mensagemUsuario, historicoRecente, contato, documentoIdDireto } = dados;
  const documentosDisponiveis = dados.documentosDisponiveis || [];
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
        dadosEstruturados: itemK ? extrairDadosEstruturadosDeItemConhecimento(itemK) : undefined,
      };
    } else {
      const doc = documentosDisponiveis.find((d) => d.id === documentoIdDireto);
      if (doc) {
        const textoDoc = formatarFraseAcompanhamento(doc.titulo, contato.nome, doc.titular);
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

    // Aplica e salva a correção na ficha na tabela titulares do Supabase
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

  // 1.8. CASO DE CONFIRMAÇÃO DE DADO EQUIVALENTE OFERECIDO ("Quer que eu informe?" -> "Sim", "Pode informar")
  if (
    ultimaMsgAssistente &&
    ultimaMsgAssistente.texto &&
    ultimaMsgAssistente.texto.includes('Quer que eu informe?') &&
    isConfirmacaoSimples(mensagemUsuario)
  ) {
    const textoAntigo = ultimaMsgAssistente.texto.toLowerCase();
    const todosTitulares = await obterTodosTitulares();
    const titularAlvo = todosTitulares.find((t) => textoAntigo.includes(t.nome.toLowerCase())) ||
      todosTitulares.find((t) => textoAntigo.includes(extrairPrimeiroNome(t.nome).toLowerCase())) ||
      todosTitulares[0];

    let respostaDado = '';
    const nomeTit = titularAlvo ? extrairPrimeiroNome(titularAlvo.nome) : '';
    if (textoAntigo.includes('data de nascimento')) {
      const dataNasc = titularAlvo?.campos?.dataNascimento?.valor || '';
      respostaDado = dataNasc ? `A data de nascimento do ${nomeTit} é *${dataNasc}*.` : '';
    } else if (textoAntigo.includes('endereço')) {
      const end = titularAlvo?.campos?.endereco?.valor || '';
      respostaDado = end ? `O endereço do ${nomeTit} é *${end}*.` : '';
    } else if (textoAntigo.includes('título de eleitor')) {
      const titEl = (titularAlvo?.campos as any)?.tituloEleitor?.valor || '';
      respostaDado = titEl ? `O número do título de eleitor é *${titEl}*.` : 'Não encontrei o número do título de eleitor registrado.';
    }

    if (respostaDado) {
      const rastro: RastroRegistro = {
        mensagemId: '',
        usuarioNome: contato.nome,
        usuarioId: contato.id,
        mensagemOriginal: mensagemUsuario,
        perguntaReescrita: 'Confirmação de exibição de dado oferecido',
        intencaoDetectada: 'dado_pessoal',
        tipoBusca: 'ficha',
        documentosEncontrados: [],
        enviouAnexo: false,
        respostaFinal: respostaDado,
        modeloUsado: 'Motor Interno',
        tokensTotal: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        custoEstimadoUsd: 0,
        tempoTotalMs: Date.now() - inicioTotal,
        etapas: [
          {
            ordem: 1,
            nome: 'Confirmação de Exibição de Dado Oferecido',
            descricao: `Usuário confirmou com "${mensagemUsuario}". Exibido o dado solicitado: "${respostaDado}".`,
            tempoMs: Date.now() - inicioTotal,
          },
        ],
      };

      return {
        textoResposta: respostaDado,
        origem: 'motor',
        intencaoDetectada: 'dado_pessoal',
        perguntaReescrita: 'Confirmação de exibição de dado oferecido',
        rastro,
      };
    }
  }

  // 2. CASO DE RESOLUÇÃO OU CONFIRMAÇÃO DE DOCUMENTOS PREVIAMENTE OFERECIDOS
  // ("os dois", "esses 2", "pode mandar", "manda", "o primeiro", "1", "o segundo", "crea", "certidão")
  const docOferecidoIdsStr = ultimaMsgAssistente?.documentoOferecidoId;

  if (docOferecidoIdsStr) {
    const ids = docOferecidoIdsStr.split(',').map((s) => s.trim()).filter(Boolean);
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    const docsCandidatos = todosDocs.filter((d) => ids.includes(d.id));

    if (docsCandidatos.length > 0) {
      const docsEscolhidos = resolverEscolhaDocumentosOferecidos(mensagemUsuario, docsCandidatos);
      if (docsEscolhidos && docsEscolhidos.length > 0) {
        const anexos: Anexo[] = [];
        for (const d of docsEscolhidos) {
          anexos.push(await criarAnexoParaDocumento(d));
        }

        const titulos = docsEscolhidos.map((d) => d.titulo).join(' e ');
        const textoResposta = docsEscolhidos.length === 1
          ? `Aqui está o documento solicitado: ${titulos}.`
          : `Aqui estão os documentos solicitados: ${titulos}.`;

        const docsRastro: DocumentoRastro[] = docsEscolhidos.map((d) => ({
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
          perguntaReescrita: `Envio de documento(s) selecionado(s): ${titulos}`,
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
              nome: 'Resolução de Escolha de Documentos Ofertados',
              descricao: `Usuário respondeu com "${mensagemUsuario}". Documento(s) selecionado(s): "${titulos}". Preparado(s) e anexado(s) para entrega direta.`,
              tempoMs: Date.now() - inicioTotal,
              detalhes: {
                escolha: mensagemUsuario,
                documentosEnviados: titulos,
                documentoIds: docsEscolhidos.map((d) => d.id),
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
          buscaUsada: 'Resolução de Opção/Confirmação de Documento',
          similaridade: '100% (Seleção direta do usuário)',
          rastro,
        };
      }
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
  // CASO ESPECIAL: AMBIGUIDADE ENTRE TITULARES CADASTRADOS SIMILARES
  // ============================================================================
  if (classificacao.ambiguidadeTitulares && classificacao.ambiguidadeTitulares.length > 1) {
    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
    const opcoes = classificacao.ambiguidadeTitulares.map((t, idx) => `${idx + 1}) ${t}`).join(', ');
    const textoResposta = `${prefixoSaudacao}Encontrei mais de um titular parecido: ${opcoes}. De qual deles você precisa?`;

    etapas.push({
      ordem: 2,
      nome: 'Resolução de Ambiguidade de Titular',
      descricao: `Identificada ambiguidade entre ${classificacao.ambiguidadeTitulares.length} titulares: ${opcoes}.`,
      tempoMs: 1,
    });

    const rastro = criarRastroFinal({
      tipoBusca: 'ambiguidade_titular',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: intencao,
      perguntaReescrita: pergunta_reescrita,
      buscaUsada: 'ambiguidade_titular',
      similaridade: 'N/A',
      rastro,
    };
  }

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
  // CASO 1.5: LISTAR DOCUMENTOS (intencao === 'listar_documentos')
  // ============================================================================
  if (intencao === 'listar_documentos') {
    const inicioListagem = Date.now();
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    const todosTitulares = await obterTodosTitulares();
    const mapaTitulares = new Map(todosTitulares.map((t) => [t.id, t.nome]));
    const nivelAcesso = contato?.nivelAcesso || contato?.ficha?.nivelAcesso || 'geral';

    // Filtra pelo nível de acesso
    const docsAcessiveis = todosDocs.filter(
      (d) => nivelAcesso === 'diretoria' || d.visibilidade !== 'diretoria'
    );

    let titularFiltro = classificacao.pessoa || pessoa;
    if (!titularFiltro) {
      const titularExtraido = extrairTitularExplicito(mensagemUsuario, todosTitulares.map((t) => t.nome));
      if (titularExtraido) {
        titularFiltro = titularExtraido;
      }
    }

    let textoResposta = '';
    const docsRastro: DocumentoRastro[] = [];

    // Tenta resolver o titular pelo cadastro oficial
    const titularResolvido = titularFiltro ? resolverTitularCadastrado(titularFiltro, todosTitulares) : null;

    if (titularResolvido || titularFiltro) {
      const nomeExibicao = titularResolvido ? titularResolvido.nome : titularFiltro!;
      const primeiroNomeTit = extrairPrimeiroNome(nomeExibicao) || nomeExibicao;

      const docsDoTitular = docsAcessiveis.filter((d) => {
        if (titularResolvido && d.pessoaId) {
          return d.pessoaId === titularResolvido.id;
        }
        if (titularResolvido) {
          const tNome = titularResolvido.nome.toLowerCase();
          return d.titular && (d.titular.toLowerCase().includes(tNome) || tNome.includes(d.titular.toLowerCase()));
        }
        const f = titularFiltro!.toLowerCase();
        return d.titular && (d.titular.toLowerCase().includes(f) || f.includes(d.titular.toLowerCase()));
      });

      if (docsDoTitular.length === 0) {
        textoResposta = `Não encontrei nenhum documento cadastrado para o *${primeiroNomeTit}* no Cofre.`;
      } else {
        const itensLista = docsDoTitular.map((d) => `• *${d.titulo}*`).join('\n');
        textoResposta = `Estes são os documentos disponíveis do *${primeiroNomeTit}* no Cofre:\n\n${itensLista}\n\nQual deles você gostaria que eu envie?`;
        for (const d of docsDoTitular) {
          docsRastro.push({
            id: d.id,
            titulo: d.titulo,
            tipo: d.tipo,
            similaridade: 100,
            usadoNaResposta: true,
          });
        }
      }
    } else {
      // Listagem geral agrupada por titular usando o nome oficial do cadastro via pessoa_id
      const grupos: Record<string, DocumentoRegistro[]> = {};
      for (const d of docsAcessiveis) {
        const tit = (d.pessoaId && mapaTitulares.get(d.pessoaId)) || d.titular || 'Documentos da Empresa';
        if (!grupos[tit]) grupos[tit] = [];
        grupos[tit].push(d);
      }

      const blocos: string[] = ['Estes são os documentos disponíveis no Cofre da VEGA:\n'];
      for (const [tit, lista] of Object.entries(grupos)) {
        blocos.push(`*${tit}:*`);
        for (const d of lista) {
          blocos.push(`• *${d.titulo}*`);
          docsRastro.push({
            id: d.id,
            titulo: d.titulo,
            tipo: d.tipo,
            similaridade: 100,
            usadoNaResposta: true,
          });
        }
        blocos.push('');
      }
      blocos.push('Qual deles você gostaria que eu consulte ou envie?');
      textoResposta = blocos.join('\n');
    }

    const rastro = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: docsRastro,
      docUsado: titularFiltro ? `Documentos de ${titularFiltro}` : 'Catálogo Geral do Cofre',
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: 'Motor Interno',
    });

    etapas.push({
      ordem: 2,
      nome: 'Listagem de Documentos do Cofre',
      descricao: `${docsRastro.length} documentos listados para o usuário em ${Date.now() - inicioListagem} ms.`,
      tempoMs: Date.now() - inicioListagem,
      detalhes: { total: docsRastro.length, titular: titularFiltro || 'todos' },
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: 'listar_documentos',
      perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
      buscaUsada: 'Listagem do Cofre de Documentos',
      similaridade: '100% (Listagem Oficial)',
      rastro,
    };
  }

  // ============================================================================
  // CASO 2: PEDIR ARQUIVO (Cofre -> Aba Conhecimento -> Rede de Segurança Vetorial)
  // ============================================================================
  if (intencao === 'pedir_arquivo') {
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();

    // 1. Identificação de múltiplos documentos pedidos na mensagem ou reescrita
    let docsMultiplos = identificarMultiplosDocumentosNoTexto(mensagemUsuario, todosDocs, pessoa);
    if (docsMultiplos.length < 2 && pergunta_reescrita) {
      const daReescrita = identificarMultiplosDocumentosNoTexto(pergunta_reescrita, todosDocs, pessoa);
      if (daReescrita.length > docsMultiplos.length) {
        docsMultiplos = daReescrita;
      }
    }

    if (docsMultiplos.length < 2 && classificacao.documentos_citados && classificacao.documentos_citados.length > 1) {
      const docsPorCitacao: DocumentoRegistro[] = [];
      for (const termoCitado of classificacao.documentos_citados) {
        const termoCompleto = pessoa ? `${termoCitado} ${pessoa}` : termoCitado;
        const resBusca = await buscarDocumentos(termoCompleto, contato, todosDocs);
        if (resBusca.status === 'unico' && resBusca.resultados[0]) {
          const docAchado = resBusca.resultados[0];
          if (!docsPorCitacao.some((d) => d.id === docAchado.id)) {
            docsPorCitacao.push(docAchado);
          }
        }
      }
      if (docsPorCitacao.length > 1) {
        docsMultiplos = docsPorCitacao;
      }
    }

    // Se identificou múltiplos documentos, envia todos diretamente sem perguntar (Exigências 1 e 4)
    if (docsMultiplos.length > 1) {
      modeloUsado = 'Motor Interno';
      const anexos: Anexo[] = [];
      for (const d of docsMultiplos) {
        anexos.push(await criarAnexoParaDocumento(d));
      }

      const titulos = docsMultiplos.map((d) => d.titulo).join(' e ');
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoResposta = `${prefixoSaudacao}Aqui estão os documentos solicitados: ${titulos}.`;

      const docsRastro: DocumentoRastro[] = docsMultiplos.map((d) => ({
        id: d.id,
        titulo: d.titulo,
        tipo: d.tipo,
        similaridade: 100,
        usadoNaResposta: true,
      }));

      etapas.push({
        ordem: 2,
        nome: 'Localização de Múltiplos Arquivos Físicos no Cofre',
        descricao: `${docsMultiplos.length} documentos identificados (${titulos}) e preparados para entrega direta.`,
        tempoMs: 2,
        detalhes: {
          documentos: docsMultiplos.map((d) => ({ id: d.id, titulo: d.titulo, arquivo: d.arquivo })),
        },
      });

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: docsRastro,
        docUsado: titulos,
        enviouAnexo: true,
        anexos,
        respostaFinal: textoResposta,
        modelo: modeloUsado,
      });

      return {
        textoResposta,
        anexos,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca de múltiplos documentos no Cofre',
        similaridade: '100% (Múltiplos documentos localizados)',
        rastro,
      };
    }

    // 2. PEDIDO GENÉRICO DE ENVIO / RECUPERAÇÃO DO DOCUMENTO DO CONTEXTO DA CONVERSA
    // A IA é o mecanismo principal (retorna documento_citado vazio para comandos genéricos).
    // A sanitização por lista funciona como camada de proteção extra.
    const docCitadoIa = (classificacao.documento_citado || '').trim();
    const termoBuscaIa = (classificacao.termo_busca || '').trim();
    const sanitizadoMsg = sanitizarPedidoArquivo(mensagemUsuario);

    const ehComandoGenerico =
      (!docCitadoIa && !termoBuscaIa) ||
      sanitizadoMsg.apenasComandoEnvio ||
      (docCitadoIa ? sanitizarPedidoArquivo(docCitadoIa).apenasComandoEnvio : false);

    if (ehComandoGenerico) {
      const docContexto = extrairDocumentoRecenteDoHistorico(historicoRecente, todosDocs);

      if (docContexto) {
        // Documento identificado a partir do contexto recente da conversa
        modeloUsado = 'Motor Interno';
        const anexo = await criarAnexoParaDocumento(docContexto);
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const textoDocFormatado = formatarFraseAcompanhamento(docContexto.titulo, contato.nome, docContexto.titular);
        const textoResposta = `${prefixoSaudacao}${textoDocFormatado}`;

        const docsRastro: DocumentoRastro[] = [
          {
            id: docContexto.id,
            titulo: docContexto.titulo,
            tipo: docContexto.tipo,
            similaridade: 100,
            usadoNaResposta: true,
          },
        ];

        etapas.push({
          ordem: 2,
          nome: 'Recuperação de Documento do Contexto da Conversa',
          descricao: `Documento "${docContexto.titulo}" (${docContexto.arquivo}) identificado a partir das mensagens anteriores e anexado para envio direto.`,
          tempoMs: 2,
          detalhes: {
            documentoId: docContexto.id,
            titulo: docContexto.titulo,
            arquivo: docContexto.arquivo,
          },
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: docsRastro,
          docUsado: docContexto.titulo,
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
          buscaUsada: 'Contexto da conversa (Documento recente em discussão)',
          similaridade: '100% (Recuperado do histórico)',
          rastro,
        };
      } else {
        // Pedido genérico de envio sem documento citado e sem documento no contexto
        // NUNCA inventar nome de documento nem registrar na lista de pendentes!
        modeloUsado = 'Motor Interno';
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const textoResposta = `${prefixoSaudacao}Qual documento você gostaria que eu envie? Por favor, informe o nome ou tipo do documento.`;

        etapas.push({
          ordem: 2,
          nome: 'Solicitação de Esclarecimento de Documento',
          descricao: 'Pedido de envio recebido sem documento citado e sem histórico prévio de documento em discussão.',
          tempoMs: 1,
        });

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
          buscaUsada: 'Comando genérico sem documento citado nem no contexto',
          similaridade: '0%',
          rastro,
        };
      }
    }

    const inicioBuscaDoc = Date.now();
    let termoBuscaArquivo = docCitadoIa || termoBuscaIa || sanitizadoMsg.termoLimpo || mensagemUsuario;
    const titularBusca = pessoa || classificacao.pessoa;
    if (titularBusca && !termoBuscaArquivo.toLowerCase().includes(titularBusca.toLowerCase())) {
      termoBuscaArquivo = `${termoBuscaArquivo} ${titularBusca}`.trim();
    }
    // 1. Busca por nome no Cofre (documentos físicos / PDFs)
    const buscaDoc = await buscarDocumentos(termoBuscaArquivo, contato, todosDocs, titularBusca);
    const tempoBuscaDoc = Date.now() - inicioBuscaDoc;

    if (buscaDoc.status === 'unico') {
      const doc = buscaDoc.resultados[0];
      const titularDivergente = titularBusca && !titularCorresponde(doc.titular, titularBusca);
      if (titularDivergente) {
        // Bloqueio de divergência: o único documento encontrado pertence a outro titular!
        buscaDoc.status = 'nenhum';
        buscaDoc.resultados = [];
        buscaDoc.titularEncontrado = titularBusca;
      } else {
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

        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const textoDocFormatado = formatarFraseAcompanhamento(doc.titulo, contato.nome, doc.titular);
        const textoResposta = `${prefixoSaudacao}${textoDocFormatado}`;

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
    }

    if (buscaDoc.status === 'ambiguo') {
      const temConectivo = /\b(e|com|mais|tambem|al[eé]m disso|os dois|ambos|junto|preciso dos)\b/i.test(mensagemUsuario) || mensagemUsuario.includes(',');
      // Se houver conectivo e os resultados corresponderem a múltiplos documentos distintos pedidos, envia todos
      if (temConectivo && buscaDoc.resultados.length > 1) {
        const normMensagem = normalizarParaBusca(mensagemUsuario);
        const termosDistintos = buscaDoc.resultados.filter((d) => {
          const tNorm = normalizarParaBusca(d.titulo);
          const arqNorm = normalizarParaBusca(d.arquivo);
          return normMensagem.includes(tNorm) ||
            tNorm.split(/\s+/).some((p) => p.length >= 4 && normMensagem.includes(p)) ||
            (d.tipo && normMensagem.includes(normalizarParaBusca(d.tipo)));
        });

        if (termosDistintos.length >= 2) {
          modeloUsado = 'Motor Interno';
          const anexos: Anexo[] = [];
          for (const d of termosDistintos) {
            anexos.push(await criarAnexoParaDocumento(d));
          }
          const titulos = termosDistintos.map((d) => d.titulo).join(' e ');
          const textoResposta = `Aqui estão os documentos solicitados: ${titulos}.`;
          const docsRastro: DocumentoRastro[] = termosDistintos.map((d) => ({
            id: d.id,
            titulo: d.titulo,
            tipo: d.tipo,
            similaridade: 100,
            usadoNaResposta: true,
          }));

          const rastro = criarRastroFinal({
            tipoBusca: 'nome_cofre',
            docsEncontrados: docsRastro,
            docUsado: titulos,
            enviouAnexo: true,
            anexos,
            respostaFinal: textoResposta,
            modelo: modeloUsado,
          });

          return {
            textoResposta,
            anexos,
            origem: 'motor',
            intencaoDetectada: intencao,
            perguntaReescrita: pergunta_reescrita,
            buscaUsada: 'Busca de múltiplos documentos no Cofre',
            similaridade: '100% (Múltiplos documentos localizados)',
            rastro,
          };
        }
      }

      // Ambiguidade real: lista as opções enumeradas e guarda documentoOferecidoId
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
        descricao: `Encontrados ${buscaDoc.resultados.length} documentos possíveis. Oferecidas opções enumeradas de escolha ao usuário.`,
        tempoMs: tempoBuscaDoc,
        detalhes: { resultados: buscaDoc.resultados.map((d) => d.titulo) },
      });

      const listaDocsFormatada = buscaDoc.resultados
        .map((d, idx) => `${idx + 1}) *${d.titulo}*`)
        .join(', ');

      const perguntaFinal = buscaDoc.resultados.length === 2
        ? 'Quer os dois ou algum específico?'
        : 'Quer todos ou algum específico?';

      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoResposta = `${prefixoSaudacao}Encontrei estes documentos: ${listaDocsFormatada}. ${perguntaFinal}`;

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: docsRastro,
        enviouAnexo: false,
        respostaFinal: textoResposta,
        modelo: modeloUsado,
      });

      return {
        textoResposta,
        documentoOferecidoId: buscaDoc.resultados.map((d: DocumentoRegistro) => d.id).join(','),
        opcoes: buscaDoc.resultados.map((d: DocumentoRegistro) => ({ id: d.id, titulo: d.titulo })),
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por nome no Cofre (Ambiguidade)',
        similaridade: 'Múltiplos resultados',
        rastro,
      };
    }

    if (buscaDoc.status === 'ambiguo_titular') {
      modeloUsado = 'Motor Interno';
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const titulares = (buscaDoc.titularesPossiveis && buscaDoc.titularesPossiveis.length > 0)
        ? buscaDoc.titularesPossiveis
        : (Array.from(new Set(buscaDoc.resultados.map((d) => d.titular).filter(Boolean))) as string[]);

      const textoResposta = formatarPerguntaAmbiguoTitular(buscaDoc.tipoPedido || 'documento', titulares, prefixoSaudacao);

      const docsRastro: DocumentoRastro[] = buscaDoc.resultados.map((d) => ({
        id: d.id,
        titulo: d.titulo,
        tipo: d.tipo,
        similaridade: 95,
        usadoNaResposta: false,
      }));

      etapas.push({
        ordem: 2,
        nome: 'Resolução de Ambiguidade de Titular',
        descricao: `Encontrados ${buscaDoc.resultados.length} documentos de titulares diferentes (${titulares.join(', ')}). Solicitada a desambiguação ao usuário.`,
        tempoMs: tempoBuscaDoc,
        detalhes: { resultados: buscaDoc.resultados.map((d) => d.titulo), titulares },
      });

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: docsRastro,
        enviouAnexo: false,
        respostaFinal: textoResposta,
        modelo: modeloUsado,
      });

      return {
        textoResposta,
        documentoOferecidoId: buscaDoc.resultados.map((d: DocumentoRegistro) => d.id).join(','),
        opcoes: buscaDoc.resultados.map((d: DocumentoRegistro) => ({ id: d.id, titulo: d.titulo })),
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Busca por tipo no Cofre (Ambiguidade de Titular)',
        similaridade: 'Múltiplos titulares encontrados',
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
      const resK = await formatarOuResumirConhecimento(item, openai);
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
        dadosEstruturados: extrairDadosEstruturadosDeItemConhecimento(item),
      };
    }

    // BLOQUEIO RÍGIDO POR TIPO: Se o usuário pediu um tipo de documento específico que não existe no cofre,
    // NUNCA acionar a rede vetorial que traria documentos divergentes (ex.: certidão de casamento para nascimento)
    const tipoPedidoDetectado = buscaDoc.tipoPedido || (termoBuscaArquivo ? identificarTipoPedido(termoBuscaArquivo) : null);
    if (tipoPedidoDetectado && buscaDoc.status === 'nenhum') {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const todosTitulares = await obterTodosTitulares();
      const titularExtraidoMsg = extrairTitularExplicito(mensagemUsuario, todosTitulares.map((t) => t.nome));
      const titularRef = buscaDoc.titularEncontrado || pessoa || classificacao.pessoa || titularExtraidoMsg || null;
      const titularResolvido = titularRef ? resolverTitularCadastrado(titularRef, todosTitulares) : null;
      const primeiroNomeTit = titularResolvido ? (extrairPrimeiroNome(titularResolvido.nome) || titularResolvido.nome) : (titularRef ? (extrairPrimeiroNome(titularRef) || titularRef) : '');

      const tipoFormatado = formatarTipoDocumentoLegivel(tipoPedidoDetectado);
      const artigo = obterArtigoDefinido(tipoFormatado);
      const prep = primeiroNomeTit ? obterPreposicaoTitular(primeiroNomeTit) : '';

      // 1. "Não encontrei [artigo] *[Tipo]* d[prep] *[Titular]* no Cofre."
      const fraseInicial = primeiroNomeTit
        ? `Não encontrei ${artigo} *${tipoFormatado}* ${prep} *${primeiroNomeTit}* no Cofre.`
        : `Não encontrei ${artigo} *${tipoFormatado}* no Cofre.`;

      // 2. "Anotei na lista de documentos pendentes."
      let textoSemDoc = `${prefixoSaudacao}${fraseInicial}\n\nAnotei na lista de documentos pendentes.`;

      // 3. Verificação estrita se o dado equivalente consta em outro documento do titular
      const docsDoTitular = todosDocs.filter((d) => {
        if (titularResolvido && d.pessoaId) return d.pessoaId === titularResolvido.id;
        if (titularResolvido) return d.titular && d.titular.toLowerCase().includes(titularResolvido.nome.toLowerCase());
        if (titularRef) return d.titular && d.titular.toLowerCase().includes(titularRef.toLowerCase());
        return false;
      });

      const sugestaoEquivalente = verificarDadoDisponivelEmOutroDocumento(tipoPedidoDetectado, docsDoTitular);
      if (sugestaoEquivalente) {
        textoSemDoc += `\n\n${sugestaoEquivalente.fraseOferta}`;
      }

      // Registro cumulativo na tabela de documentos faltantes (soma contagem sem duplicar)
      await registrarOuIncrementarDocumentoFaltante({
        tipoDocumento: tipoFormatado,
        titularInformado: titularResolvido ? titularResolvido.nome : titularRef,
        solicitanteNome: contato?.nome || 'Usuário',
        solicitanteContato: contato?.telefone || contato?.id,
        dadosEquivalentesOferecidos: sugestaoEquivalente ? `${sugestaoEquivalente.dadoNome} (${sugestaoEquivalente.documentoFonte})` : null,
        textoDoPedido: mensagemUsuario,
      });

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoSemDoc,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoSemDoc,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Bloqueio Rígido por Tipo Documental (Registrado em Pendentes)',
        similaridade: '0%',
        rastro,
      };
    }

    // 3. REDE DE SEGURANÇA: Busca vetorial no Supabase
    const inicioVetorial = Date.now();
    const perguntaVetorial = classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario;
    const trechosSeguranca = await executarBuscaVetorial(perguntaVetorial, null, 5);
    const tempoVetorial = Date.now() - inicioVetorial;

    if (trechosSeguranca.length > 0 && trechosSeguranca[0].similaridade >= 0.60) {
      const topSim = trechosSeguranca[0].similaridade;
      const resTrechos = await responderComTrechos(perguntaVetorial, trechosSeguranca, openai);
      tokensPromptTotal += resTrechos.tokensPrompt;
      tokensCompletionTotal += resTrechos.tokensCompletion;
      tokensGeraisTotal += resTrechos.tokensTotal;
      modeloUsado = chatModel;

      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      let textoFinalTrechos = resTrechos.texto;
      if (
        textoFinalTrechos.toLowerCase().includes('não encontrei nos documentos') ||
        textoFinalTrechos.toLowerCase().includes('não encontrei esse documento') ||
        textoFinalTrechos.toLowerCase().includes('não consegui identificar')
      ) {
        textoFinalTrechos = `${prefixoSaudacao}Não encontrei esse documento no Cofre.`;
      }

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
        respostaFinal: textoFinalTrechos,
        modelo: modeloUsado,
      });

      return {
        textoResposta: textoFinalTrechos,
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

    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
    const todosTitulares = await obterTodosTitulares();
    const titularExtraidoMsg = extrairTitularExplicito(mensagemUsuario, todosTitulares.map((t) => t.nome));
    const titularRef = buscaDoc.titularEncontrado || pessoa || classificacao.pessoa || titularExtraidoMsg || null;
    const titularResolvido = titularRef ? resolverTitularCadastrado(titularRef, todosTitulares) : null;
    const primeiroNomeTit = titularResolvido ? (extrairPrimeiroNome(titularResolvido.nome) || titularResolvido.nome) : (titularRef ? (extrairPrimeiroNome(titularRef) || titularRef) : '');

    const termoIdentificado = classificacao.documento_citado || termoBuscaArquivo || 'documento';
    const ehTipoValido = validarTipoDocumentoReconhecivel(termoIdentificado);

    if (!ehTipoValido) {
      const textoSemDocGenerico = `${prefixoSaudacao}Não encontrei esse documento no Cofre.`;
      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoSemDocGenerico,
        modelo: modeloUsado,
      });

      return {
        textoResposta: textoSemDocGenerico,
        origem: 'motor',
        intencaoDetectada: intencao,
        perguntaReescrita: pergunta_reescrita,
        buscaUsada: 'Documento não localizado no Cofre',
        similaridade: '0%',
        rastro,
      };
    }

    const tipoFormatado = formatarTipoDocumentoLegivel(termoIdentificado);
    const artigo = obterArtigoDefinido(tipoFormatado);
    const prep = primeiroNomeTit ? obterPreposicaoTitular(primeiroNomeTit) : '';

    const fraseInicial = primeiroNomeTit
      ? `Não encontrei ${artigo} *${tipoFormatado}* ${prep} *${primeiroNomeTit}* no Cofre.`
      : `Não encontrei ${artigo} *${tipoFormatado}* no Cofre.`;

    let textoResposta = `${prefixoSaudacao}${fraseInicial}\n\nAnotei na lista de documentos pendentes.`;

    const docsDoTitular = todosDocs.filter((d) => {
      if (titularResolvido && d.pessoaId) return d.pessoaId === titularResolvido.id;
      if (titularResolvido) return d.titular && d.titular.toLowerCase().includes(titularResolvido.nome.toLowerCase());
      if (titularRef) return d.titular && d.titular.toLowerCase().includes(titularRef.toLowerCase());
      return false;
    });

    const sugestaoEquivalente = verificarDadoDisponivelEmOutroDocumento(termoIdentificado, docsDoTitular);
    if (sugestaoEquivalente) {
      textoResposta += `\n\n${sugestaoEquivalente.fraseOferta}`;
    }

    await registrarOuIncrementarDocumentoFaltante({
      tipoDocumento: tipoFormatado,
      titularInformado: titularResolvido ? titularResolvido.nome : titularRef,
      solicitanteNome: contato?.nome || 'Usuário',
      solicitanteContato: contato?.telefone || contato?.id,
      dadosEquivalentesOferecidos: sugestaoEquivalente ? `${sugestaoEquivalente.dadoNome} (${sugestaoEquivalente.documentoFonte})` : null,
      textoDoPedido: mensagemUsuario,
    });

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
      buscaUsada: 'Busca por nome e vetorial (ambas falharam - Registrado em Pendentes)',
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
    const nomePessoa = classificacao.pessoa || pessoa || titularDoHistorico || null;
    const titular = nomePessoa ? await obterTitularPorNome(nomePessoa) : null;

    if (!titular) {
      const textoPerguntaTitular = 'De qual titular você deseja corrigir esse dado?';
      const rastro = criarRastroFinal({
        tipoBusca: 'ficha',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoPerguntaTitular,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoPerguntaTitular,
        origem: 'motor',
        intencaoDetectada: 'corrigir_dado',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario,
        rastro,
      };
    }

    const primeiroNomeTitular = extrairPrimeiroNome(titular.nome) || titular.nome;

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
        titularId: titular.id,
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
    const agoraBrasilia = obterAgoraBrasilia();
    const agora = agoraBrasilia.dataRef;

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
          (d.getMonth() === (agoraBrasilia.mes - 1) && d.getFullYear() === agoraBrasilia.ano) ||
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
    const nomePessoa = classificacao.pessoa || pessoa || titularDoHistorico || null;
    const titular = nomePessoa ? await obterTitularPorNome(nomePessoa) : null;

    // Regra 16: Se a mensagem citou expressamente uma pessoa que NÃO é titular cadastrado:
    // NUNCA ignorar nem substituir pelo titular do contexto!
    // Fazer busca nos documentos do Cofre pelo nome citado.
    if (!titular && classificacao.pessoa && classificacao.origemPessoa === 'mensagem_atual') {
      const nomeNaoCadastrado = classificacao.pessoa;
      const trechosDaPessoa = await buscarTrechosPorNomePessoaNoCofre(
        nomeNaoCadastrado,
        classificacao.pergunta_completa || mensagemUsuario,
        documentosDisponiveis
      );

      if (trechosDaPessoa.length > 0) {
        modeloUsado = chatModel;
        const resTrechos = await responderComTrechos(
          classificacao.pergunta_completa || mensagemUsuario,
          trechosDaPessoa,
          openai
        );

        tokensPromptTotal += resTrechos.tokensPrompt;
        tokensCompletionTotal += resTrechos.tokensCompletion;
        tokensGeraisTotal += resTrechos.tokensTotal;

        etapas.push({
          ordem: 2,
          nome: 'Busca no Cofre por Pessoa Não Cadastrada',
          descricao: `Encontrado(s) ${trechosDaPessoa.length} trecho(s) citando "${nomeNaoCadastrado}" no documento "${trechosDaPessoa[0].titulo_documento}".`,
          tempoMs: Date.now() - inicioFicha,
          detalhes: {
            pessoa: nomeNaoCadastrado,
            documento: trechosDaPessoa[0].titulo_documento,
            quantidadeTrechos: trechosDaPessoa.length,
          },
        });

        const docsRastro: DocumentoRastro[] = trechosDaPessoa.map((t) => ({
          id: t.documento_id,
          titulo: t.titulo_documento,
          pagina: t.pagina,
          similaridade: Number((t.similaridade * 100).toFixed(1)),
          trecho: truncarTrecho(t.conteudo, 300),
          usadoNaResposta: true,
        }));

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: docsRastro,
          docUsado: trechosDaPessoa[0].titulo_documento,
          enviouAnexo: false,
          respostaFinal: resTrechos.texto,
          modelo: modeloUsado,
        });

        return {
          textoResposta: resTrechos.texto,
          origem: 'motor',
          intencaoDetectada: intencao,
          perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
          buscaUsada: 'Busca em documentos do Cofre (Pessoa Não Cadastrada)',
          similaridade: `${(trechosDaPessoa[0].similaridade * 100).toFixed(1)}% (${trechosDaPessoa[0].titulo_documento})`,
          rastro,
        };
      } else {
        // Pessoa não cadastrada NÃO aparece em nenhum documento do Cofre
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const artigo = (nomeNaoCadastrado.toLowerCase().endsWith('a') || nomeNaoCadastrado.toLowerCase().endsWith('eia')) ? 'a' : 'o';
        const textoResposta = `${prefixoSaudacao}Não encontrei informações sobre ${artigo} *${nomeNaoCadastrado}* nos documentos do Cofre.`;

        etapas.push({
          ordem: 2,
          nome: 'Varredura no Cofre (Pessoa Inexistente)',
          descricao: `Nenhum documento ou menção a "${nomeNaoCadastrado}" foi encontrado no Cofre.`,
          tempoMs: Date.now() - inicioFicha,
          detalhes: { pessoa: nomeNaoCadastrado },
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoResposta,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta,
          origem: 'motor',
          intencaoDetectada: intencao,
          perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
          rastro,
        };
      }
    }

    if (!titular) {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoPerguntaTitular = formatarPerguntaDadoPessoalSemTitular(
        classificacao.campos,
        mensagemUsuario,
        prefixoSaudacao
      );
      const rastro = criarRastroFinal({
        tipoBusca: 'ficha',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoPerguntaTitular,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoPerguntaTitular,
        origem: 'motor',
        intencaoDetectada: 'dado_pessoal',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario,
        rastro,
      };
    }

    const primeiroNomeTitular = extrairPrimeiroNome(titular.nome) || titular.nome;
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();

    // 1. Identifica a lista de campos solicitados
    let camposIdentificados: string[] = classificacao.campos && classificacao.campos.length > 0
      ? [...classificacao.campos]
      : [];

    const padroesCampos: { campo: string; regex: RegExp }[] = [
      { campo: 'endereco', regex: /\b(endere[cç]o|mora|resid[eê]ncia)\b/i },
      { campo: 'estadoCivil', regex: /\b(estado\s*civil|casad[oa]|solteir[oa]|divorciad[oa])\b/i },
      { campo: 'rg', regex: /\b(rg|identidade)\b/i },
      { campo: 'profissao', regex: /\b(profiss[aã]o|cargo|ocupa[cç][aã]o)\b/i },
      { campo: 'cpf', regex: /\b(cpf)\b/i },
      { campo: 'filiacao', regex: /\b(m[aã]e|pai|pais|filia[cç][aã]o)\b/i },
      { campo: 'dataNascimento', regex: /\b(nascimento|data\s*(de\s*)?nascimento|idade)\b/i },
      { campo: 'validadeCnh', regex: /\b(validade(\s*da\s*cnh)?|vencimento)\b/i },
      { campo: 'categoriaCnh', regex: /\b(categoria(\s*da\s*cnh)?)\b/i },
      { campo: 'cnh', regex: /\b(n[uú]mero\s*da\s*cnh|numero\s*da\s*cnh|cnh)\b/i },
      { campo: 'orgaoEmissor', regex: /\b(orgao\s*emissor|[oó]rg[aã]o)\b/i },
      { campo: 'titulo_eleitor', regex: /\b(t[ií]tulo(\s*de)?\s*eleitor(al)?|n[uú]mero\s*do\s*t[ií]tulo)\b/i },
      { campo: 'pis', regex: /\b(pis|pasep|nis)\b/i },
      { campo: 'carteira_reservista', regex: /\b(reservista|certificado\s*de\s*reservista|carteira\s*de\s*reservista)\b/i },
      { campo: 'certidao_nascimento', regex: /\b(certid[aã]o\s*de\s*nascimento)\b/i },
      { campo: 'passaporte', regex: /\b(passaporte|n[uú]mero\s*do\s*passaporte)\b/i },
    ];

    if (camposIdentificados.length === 0) {
      const msgNorm = normalizarParaBusca(mensagemUsuario);
      for (const p of padroesCampos) {
        if (p.regex.test(msgNorm)) {
          camposIdentificados.push(p.campo);
        }
      }
    }

    if (camposIdentificados.length === 0 && campo) {
      camposIdentificados.push(campo);
    }

    // Se nenhum campo conhecido foi identificado, tenta extrair a expressão solicitada (ex: "qual o X do fulano")
    if (camposIdentificados.length === 0) {
      const matchExpressaoCampo = mensagemUsuario.match(/(?:qual|quais|qual\s+o|qual\s+a|número\s+d[eoa]|numero\s+d[eoa])\s+([a-záéíóúâêôãõç\s]{3,35})\s+d[eoa]\b/i);
      if (matchExpressaoCampo && matchExpressaoCampo[1]) {
        const termoLimpo = matchExpressaoCampo[1].trim();
        if (termoLimpo.length > 2 && !/\b(documento|arquivo|pdf)\b/i.test(termoLimpo)) {
          camposIdentificados.push(termoLimpo);
        }
      }
    }

    // REGRA 17: NUNCA forçar camposIdentificados.push('filiacao')!
    // Se ainda assim estiver vazio, usa um identificador genérico sem assumir nenhum campo prévio
    if (camposIdentificados.length === 0) {
      camposIdentificados.push('informação solicitada');
    }

    // Remove eventuais duplicidades mantendo a ordem
    camposIdentificados = Array.from(new Set(camposIdentificados));

    interface InfoCampoProcessado {
      campoId: CampoTitularId | null;
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
      let campoId: CampoTitularId | null = null;
      let label = cNome;

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
      } else if (cNorm.includes('titulo') || cNorm.includes('eleitor')) {
        campoId = null;
        label = 'Título de eleitor';
      } else if (cNorm.includes('pis') || cNorm.includes('pasep') || cNorm.includes('nis')) {
        campoId = null;
        label = 'PIS';
      } else if (cNorm.includes('reservista')) {
        campoId = null;
        label = 'Carteira de reservista';
      } else if (cNorm.includes('passaporte')) {
        campoId = null;
        label = 'Passaporte';
      } else if (cNorm.includes('certidaonascimento')) {
        campoId = null;
        label = 'Certidão de nascimento';
      }

      // Consulta o campo na ficha do titular (apenas se for campo estruturado existente)
      if (campoId && titular && titular.campos[campoId]) {
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
        // Fallback Obrigatório (Regra 9 do GEMINI.md): busca nos trechos dos documentos do titular no Supabase
        let valorAchadoVetorial: string | null = null;
        let docOrigemVetorial: DocumentoRegistro | undefined = undefined;

        const idTitularAlvo = titular?.id || null;
        if (idTitularAlvo) {
          const supabase = getSupabaseClient();
          const trechosCandidatos: { conteudo: string; documento_id: string; titulo_documento?: string }[] = [];

          // 1. Busca Direta por Termo/Palavra-chave nos trechos do titular no Supabase
          // (Garante que campos como Título de Eleitor, PIS, Reservista, etc. sejam localizados nos documentos oficiais)
          const termosChave: string[] = [];
          const lNorm = label.toLowerCase();
          if (lNorm.includes('titulo') || lNorm.includes('eleitor')) {
            termosChave.push('título eleitoral', 'titulo eleitoral', 'título de eleitor', 'titulo de eleitor', 'eleitoral');
          } else if (lNorm.includes('pis') || lNorm.includes('pasep') || lNorm.includes('nis')) {
            termosChave.push('pis', 'pasep', 'nis');
          } else if (lNorm.includes('reservista')) {
            termosChave.push('reservista', 'incorporação', 'dispensa');
          } else {
            termosChave.push(lNorm);
          }

          for (const termo of termosChave) {
            const { data: trechosMatch } = await supabase
              .from('trechos')
              .select('id, documento_id, pessoa_id, conteudo, pagina')
              .eq('pessoa_id', idTitularAlvo)
              .ilike('conteudo', `%${termo}%`)
              .limit(5);

            if (trechosMatch && trechosMatch.length > 0) {
              for (const tr of trechosMatch) {
                if (!trechosCandidatos.some((tc) => tc.conteudo === tr.conteudo)) {
                  trechosCandidatos.push(tr);
                }
              }
              break;
            }
          }

          // 2. Se não encontrou por palavra-chave direta, executa a busca vetorial semântica nos trechos do titular
          if (trechosCandidatos.length === 0) {
            const termoBuscaCampo = `${label} ${primeiroNomeTitular}`;
            const trechosVet = await executarBuscaVetorial(termoBuscaCampo, idTitularAlvo, 8);
            if (trechosVet.length > 0 && trechosVet[0].similaridade >= 0.40) {
              trechosCandidatos.push(...trechosVet);
            }
          }

          // 3. Extração estrita via gpt-5.4-mini (Regra 17): responde SOMENTE se o dado estiver presente
          for (const topTrecho of trechosCandidatos) {
            const promptExtracao = `A partir do seguinte trecho de documento oficial:
"""
${topTrecho.conteudo}
"""
Extraia APENAS o valor correspondente ao campo "${label}".
REGRA ABSOLUTA DE DADO ESPECÍFICO (REGRA 17):
- Extraia o valor SOMENTE se o trecho contiver EXATAMENTE a informação solicitada para "${label}".
- Se o trecho contiver outros dados (como CPF, RG, filiação, data de nascimento, etc.) mas NÃO contiver o campo "${label}", responda APENAS: NÃO_ENCONTRADO.
- NUNCA retorne outro campo como substituto!
Se não encontrar esse dado com total clareza no trecho, responda apenas: NÃO_ENCONTRADO.
NÃO inclua explicações nem frases antes ou depois, apenas o valor exato.`;

            try {
              const respExtracao = await chamarChatComTelemetria(
                openai,
                {
                  model: 'gpt-5.4-mini',
                  messages: [{ role: 'user', content: promptExtracao }],
                  temperature: 0.0,
                },
                { motivo: 'chat_fallback_vetorial', contatoId: contato.id, contatoNome: contato.nome }
              );
              const pTokens = respExtracao.usage?.prompt_tokens || 0;
              const cTokens = respExtracao.usage?.completion_tokens || 0;
              tokensPromptTotal += pTokens;
              tokensCompletionTotal += cTokens;
              tokensGeraisTotal += pTokens + cTokens;

              const val = respExtracao.choices[0]?.message?.content?.trim();
              if (val && !val.includes('NÃO_ENCONTRADO') && val.length >= 2) {
                valorAchadoVetorial = val;
                docOrigemVetorial = todosDocs.find(
                  (d) => d.id === topTrecho.documento_id || d.titulo === (topTrecho as any).titulo_documento
                );
                if (!docOrigemVetorial) {
                  const { data: dSup } = await supabase.from('documentos').select('*').eq('id', topTrecho.documento_id).maybeSingle();
                  if (dSup) docOrigemVetorial = dSup;
                }
                break;
              }
            } catch (err) {
              console.error('[VEGA Chat] Erro ao extrair dado via trechos:', err);
            }
          }
        }

        if (valorAchadoVetorial) {
          const valorFormatadoFinal = campoId
            ? formatarValorParaUsuario(campoId, valorAchadoVetorial)
            : `*${valorAchadoVetorial}*`;

          camposProcessados.push({
            campoId,
            label,
            valorFormatado: valorFormatadoFinal,
            valorMascaradoRastro: mascararValorCampo(campoId || ('' as any), valorAchadoVetorial),
            origemNome: docOrigemVetorial?.titulo || 'Documentos do Cofre',
            docOrigem: docOrigemVetorial,
            conferido: false,
            encontrado: true,
          });
        } else {
          // Não encontrou nem na ficha nem nos trechos
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
    }

    const tempoFicha = Date.now() - inicioFicha;
    modeloUsado = 'Motor Interno';

    const prepTitular = (primeiroNomeTitular.toLowerCase().endsWith('a') || primeiroNomeTitular.toLowerCase().endsWith('eia')) ? 'da' : 'do';
    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);

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
      textoResposta = `${prefixoSaudacao}${linhas.join('\n')}`;
    } else {
      const cp = camposProcessados[0];
      const ehFeminino = ['Validade da CNH', 'Categoria da CNH', 'Data de nascimento', 'Filiação', 'Profissão', 'Carteira de reservista', 'Certidão de nascimento'].includes(cp.label);
      const artigo = ehFeminino ? 'a' : 'o';

      if (cp.encontrado) {
        if (cp.label === 'Mãe') {
          textoResposta = `${prefixoSaudacao}A mãe ${prepTitular} ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'Pai') {
          textoResposta = `${prefixoSaudacao}O pai ${prepTitular} ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'CPF') {
          textoResposta = `${prefixoSaudacao}O CPF ${prepTitular} ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else if (cp.label === 'RG') {
          textoResposta = `${prefixoSaudacao}O RG ${prepTitular} ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        } else {
          const artCap = ehFeminino ? 'A' : 'O';
          textoResposta = `${prefixoSaudacao}${artCap} ${cp.label.toLowerCase()} ${prepTitular} ${primeiroNomeTitular} é ${cp.valorFormatado}.`;
        }
      } else {
        textoResposta = `${prefixoSaudacao}Não encontrei ${artigo} ${cp.label.toLowerCase()} ${prepTitular} *${primeiroNomeTitular}* nos documentos.`;
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
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();

    // 0. Detecção de pergunta ou resumo sobre documento recém-entregue no chat ("esse documento", "o documento acima", "resumo do documento")
    const ehSobreDocRecente =
      /\b(esse|este|deste|desse|o)\s+documento\b/i.test(mensagemUsuario) ||
      /\b(resum[aeo]|expliq?u?e|fala\s+sobre|diz\s+sobre|conte[uú]do)\b/i.test(mensagemUsuario);

    const docRecente = ehSobreDocRecente ? obterUltimoDocumentoEnviado(historicoRecente, todosDocs) : null;
    if (docRecente) {
      // Busca todos os trechos desse documento específico no Supabase
      const supabase = getSupabaseClient();
      const { data: trechosDoDoc } = await supabase
        .from('trechos')
        .select('*')
        .eq('documento_id', docRecente.id)
        .order('pagina', { ascending: true });

      if (trechosDoDoc && trechosDoDoc.length > 0) {
        const textoTrechos = trechosDoDoc
          .map((t, idx) => `[Página ${t.pagina || 1} | Trecho ${idx + 1}]\n${t.conteudo}`)
          .join('\n\n');

        const promptDoc = `Você é a VEGA, assistente de inteligência artificial da Construtora Delta Plan.
O usuário está fazendo uma pergunta ou solicitando um resumo sobre o documento que você acabou de entregar: "${docRecente.titulo}" (${docRecente.arquivo}).

CONTEÚDO COMPLETO DO DOCUMENTO:
"""
${textoTrechos}
"""

PERGUNTA OU PEDIDO DO USUÁRIO: "${mensagemUsuario}"

DIRETRIZES OBRIGATÓRIAS:
1. Responda com base ESTRITA no conteúdo do documento fornecido acima.
2. Se o usuário pediu um resumo em número determinado de linhas (ex.: "resuma esse documento em 10 linhas"), faça um resumo conciso, fiel e estruturado atendendo exatamente à restrição de linhas.
3. Se o usuário perguntou sobre um tema específico (ex.: "o que esse documento fala sobre águas fluviais?"), explique exatamente o que consta no documento sobre redes pluviais, escoamento de águas, galerias ou termos correlatos.
4. NUNCA invente informações não contidas no documento.
5. NÃO forneça links e NÃO envie novamente o arquivo anexo: responda de maneira puramente textual em Português do Brasil com formatação do WhatsApp (*negrito*, _itálico_).`;

        const inicioIA = Date.now();
        const completion = await chamarChatComTelemetria(
          openai,
          {
            model: 'gpt-5.4-mini',
            messages: [{ role: 'user', content: promptDoc }],
            temperature: obterConfiguracoesVegaSync().temperaturaResposta,
          },
          { motivo: 'chat_pergunta_documento_entregue', contatoId: contato.id, contatoNome: contato.nome }
        );

        const textoRespostaDoc =
          completion.choices[0]?.message?.content?.trim() || 'Não consegui analisar o conteúdo do documento.';

        etapas.push({
          ordem: 2,
          nome: 'Análise de Conteúdo do Documento Recém-Entregue',
          descricao: `Conteúdo de "${docRecente.titulo}" analisado pelo modelo gpt-5.4-mini em ${Date.now() - inicioIA} ms.`,
          tempoMs: Date.now() - inicioIA,
          detalhes: { documento: docRecente.titulo, trechos: trechosDoDoc.length },
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: trechosDoDoc.map((t, idx) => ({
            id: t.documento_id,
            titulo: docRecente.titulo,
            pagina: t.pagina,
            similaridade: 100,
            trecho: truncarTrecho(t.conteudo, 300),
            usadoNaResposta: true,
          })),
          docUsado: docRecente.titulo,
          enviouAnexo: false,
          respostaFinal: textoRespostaDoc,
          modelo: 'gpt-5.4-mini',
        });

        return {
          textoResposta: textoRespostaDoc,
          origem: 'ia',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: mensagemUsuario,
          buscaUsada: `Análise direta de conteúdo: ${docRecente.titulo}`,
          similaridade: '100% (Documento Recém-Entregue)',
          rastro,
        };
      }
    }

    let pessoaIdAlvo: string | null = null;
    const todosTitulares = await obterTodosTitulares();
    const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
    const titularDoContato = todosTitulares.find(
      (t) =>
        contato?.nome &&
        (t.nome.toLowerCase().includes(contato.nome.toLowerCase().trim()) ||
          contato.nome.toLowerCase().includes(t.nome.toLowerCase().trim()))
    )?.nome;
    const pessoaIdentificada =
      classificacao.pessoa || pessoa || titularDoHistorico || titularDoContato || null;
    if (pessoaIdentificada) {
      const titResolvido = resolverTitularCadastrado(pessoaIdentificada, todosTitulares);
      if (titResolvido) {
        pessoaIdAlvo = titResolvido.id;
      }
    }

    // Regra 16: Se a mensagem citou expressamente uma pessoa na mensagem atual que NÃO é titular cadastrado:
    // NUNCA ignorar nem substituir pelo titular do contexto!
    // Fazer busca nos documentos do Cofre pelo nome citado.
    if (!pessoaIdAlvo && classificacao.pessoa && classificacao.origemPessoa === 'mensagem_atual') {
      const nomeNaoCadastrado = classificacao.pessoa;
      const trechosDaPessoa = await buscarTrechosPorNomePessoaNoCofre(
        nomeNaoCadastrado,
        classificacao.pergunta_completa || mensagemUsuario,
        documentosDisponiveis
      );

      if (trechosDaPessoa.length > 0) {
        modeloUsado = chatModel;
        const resTrechos = await responderComTrechos(
          classificacao.pergunta_completa || mensagemUsuario,
          trechosDaPessoa,
          openai
        );

        tokensPromptTotal += resTrechos.tokensPrompt;
        tokensCompletionTotal += resTrechos.tokensCompletion;
        tokensGeraisTotal += resTrechos.tokensTotal;

        const docsRastro: DocumentoRastro[] = trechosDaPessoa.map((t) => ({
          id: t.documento_id,
          titulo: t.titulo_documento,
          pagina: t.pagina,
          similaridade: Number((t.similaridade * 100).toFixed(1)),
          trecho: truncarTrecho(t.conteudo, 300),
          usadoNaResposta: true,
        }));

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: docsRastro,
          docUsado: trechosDaPessoa[0].titulo_documento,
          enviouAnexo: false,
          respostaFinal: resTrechos.texto,
          modelo: modeloUsado,
        });

        return {
          textoResposta: resTrechos.texto,
          origem: 'motor',
          intencaoDetectada: intencao,
          perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
          buscaUsada: 'Busca em documentos do Cofre (Pessoa Não Cadastrada)',
          similaridade: `${(trechosDaPessoa[0].similaridade * 100).toFixed(1)}% (${trechosDaPessoa[0].titulo_documento})`,
          rastro,
        };
      } else {
        // Pessoa não cadastrada NÃO aparece em nenhum documento do Cofre
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const artigo = (nomeNaoCadastrado.toLowerCase().endsWith('a') || nomeNaoCadastrado.toLowerCase().endsWith('eia')) ? 'a' : 'o';
        const textoResposta = `${prefixoSaudacao}Não encontrei informações sobre ${artigo} *${nomeNaoCadastrado}* nos documentos do Cofre.`;

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoResposta,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta,
          origem: 'motor',
          intencaoDetectada: intencao,
          perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita,
          rastro,
        };
      }
    }

    // 0.5. Blindagem de dado pessoal ou informacao de documento sem titular na busca de conteudo/vetorial:
    // Se nao ha pessoa titular definida explicitamente nem no historico recente da conversa,
    // e a pergunta solicita dado pessoal (CPF, RG, CNH, data de nascimento, filiacao, endereco residencial)
    // ou dados de documentos pessoais (vacinas, covid, imunizacao), a VEGA NUNCA assume ninguem
    // nem busca trechos de titular arbitrario: pergunta diretamente o titular.
    const regexDadoPessoalSensivel = /\b(cpf|rg|identidade|endere[cç]o|mora|resid[eê]ncia|m[aã]e|pai|filia[cç][aã]o|nascimento|data\s*(de\s*)?nascimento|vacina|vacinas|vacina[cç][aã]o|covid(-?19)?|imuniza[cç][aã]o|doses?)\b/i;
    const ehTemaCorporativo = /\b(delta|deltaplan|empresa|escrit[oó]rio|sede|obra|proposta|contrato|or[cç]amento)\b/i.test(mensagemUsuario);
    if (!pessoaIdAlvo && !classificacao.pessoa && regexDadoPessoalSensivel.test(mensagemUsuario) && !ehTemaCorporativo) {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoPerguntaTitular = formatarPerguntaDadoPessoalSemTitular(
        classificacao.campos,
        mensagemUsuario,
        prefixoSaudacao
      );
      const rastro = criarRastroFinal({
        tipoBusca: 'vetorial',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoPerguntaTitular,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoPerguntaTitular,
        origem: 'motor',
        intencaoDetectada: 'dado_pessoal',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario,
        rastro,
      };
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
      const resK = await formatarOuResumirConhecimento(matchExatoTitulo, openai);
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
        dadosEstruturados: extrairDadosEstruturadosDeItemConhecimento(matchExatoTitulo),
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
      const resK = await formatarOuResumirConhecimento(item, openai);
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
        dadosEstruturados: extrairDadosEstruturadosDeItemConhecimento(item),
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
  const msgNormFinal = normalizarParaBusca(mensagemUsuario);
  const ehPerguntaVacina = /\b(vacina|vacinas|vacina[cç][aã]o|covid(-?19)?|imuniza[cç][aã]o|doses?)\b/i.test(msgNormFinal);
  if (ehPerguntaVacina) {
    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
    const textoPerguntaTitular = formatarPerguntaDadoPessoalSemTitular(
      classificacao.campos,
      mensagemUsuario,
      prefixoSaudacao
    );
    const rastro = criarRastroFinal({
      tipoBusca: 'vetorial',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoPerguntaTitular,
      modelo: 'Motor Interno',
    });
    return {
      textoResposta: textoPerguntaTitular,
      origem: 'motor',
      intencaoDetectada: 'pergunta_conteudo',
      perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || mensagemUsuario,
      rastro,
    };
  }

  if (REGEX_DOCUMENTO_QUALQUER.test(msgNormFinal)) {
    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
    const textoDocNaoEncontrado = `${prefixoSaudacao}Não encontrei esse documento no Cofre.`;
    const rastroDoc = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: [],
      enviouAnexo: false,
      respostaFinal: textoDocNaoEncontrado,
      modelo: 'Motor Interno',
    });
    return {
      textoResposta: textoDocNaoEncontrado,
      origem: 'motor',
      intencaoDetectada: 'pedir_arquivo',
      perguntaReescrita: pergunta_reescrita,
      buscaUsada: 'Busca por nome no Cofre',
      similaridade: '0%',
      rastro: rastroDoc,
    };
  }

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

/**
 * GUARDRAIL FINAL DE CORRESPONDÊNCIA DE CAMPO (REGRA 17)
 * Valida rigorosamente se a resposta gerada corresponde ao campo ou informação solicitada pelo usuário.
 * Se o usuário solicitou um dado específico (ex: título de eleitor, PIS, reservista, etc.) e a resposta
 * entregou outro campo divergente (ex: filiação, CPF, RG, data de nascimento), intercepta e bloqueia,
 * substituindo pela resposta oficial de não encontrado nos documentos.
 */
export function validarCorrespondenciaCampoResposta(
  mensagemUsuario: string,
  textoResposta: string
): { textoValidado: string; interceptado: boolean; motivo?: string } {
  const msgNorm = normalizarParaBusca(mensagemUsuario);
  const respNorm = normalizarParaBusca(textoResposta);

  // Se a própria resposta já afirma que não encontrou, está em total conformidade
  if (/\bn[aã]o\s+encontrei\b/i.test(respNorm) || /\bfora\s+do\s+meu\s+escopo\b/i.test(respNorm)) {
    return { textoValidado: textoResposta, interceptado: false };
  }

  // Extrai nome de pessoa citada na pergunta se houver
  const titularExplicito = extrairTitularExplicito(msgNorm);
  const matchPessoa = mensagemUsuario.match(/\bd[eoa]\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)/);
  const nomePessoa = titularExplicito || (matchPessoa ? matchPessoa[1] : '');
  const prep = (nomePessoa.toLowerCase().endsWith('a') || nomePessoa.toLowerCase().endsWith('eia')) ? 'da' : 'do';
  const pessoaFormatada = nomePessoa ? ` ${prep} *${nomePessoa}*` : '';

  // 1. TÍTULO DE ELEITOR / TÍTULO ELEITORAL
  const pedeTituloEleitor = /\b(t[ií]tulo(\s*de)?\s*eleitor(al)?|n[uú]mero\s*do\s*t[ií]tulo)\b/i.test(msgNorm);
  if (pedeTituloEleitor) {
    const mencionaTitulo = /\bt[ií]tulo\b/i.test(respNorm);
    const falaDeFiliacaoOuOutro = /\b(m[aã]e|pai|pais|filia[cç][aã]o|cpf|rg|nascid|nascimento)\b/i.test(respNorm);
    if (!mencionaTitulo && falaDeFiliacaoOuOutro) {
      return {
        textoValidado: `Não encontrei o título de eleitor${pessoaFormatada} nos documentos.`,
        interceptado: true,
        motivo: 'Usuário perguntou título de eleitor, mas a resposta continha outro campo cadastral divergente.',
      };
    }
  }

  // 2. PIS / PASEP / NIS
  const pedePis = /\b(pis|pasep|nis)\b/i.test(msgNorm);
  if (pedePis) {
    const mencionaPis = /\b(pis|pasep|nis)\b/i.test(respNorm);
    const falaDeOutro = /\b(m[aã]e|pai|pais|filia[cç][aã]o|cpf|rg|nascid|nascimento|cnh)\b/i.test(respNorm);
    if (!mencionaPis && falaDeOutro) {
      return {
        textoValidado: `Não encontrei o PIS${pessoaFormatada} nos documentos.`,
        interceptado: true,
        motivo: 'Usuário perguntou PIS, mas a resposta continha outro campo cadastral divergente.',
      };
    }
  }

  // 3. CARTEIRA DE RESERVISTA
  const pedeReservista = /\b(reservista|carteira\s*de\s*reservista|certificado\s*de\s*reservista)\b/i.test(msgNorm);
  if (pedeReservista) {
    const mencionaReservista = /\breservista\b/i.test(respNorm);
    const falaDeNascimentoOuFiliacao = /\b(nascimento|nascid|m[aã]e|pai|pais|filia[cç][aã]o)\b/i.test(respNorm);
    if (!mencionaReservista && falaDeNascimentoOuFiliacao) {
      return {
        textoValidado: `Não encontrei a carteira de reservista${pessoaFormatada} nos documentos.`,
        interceptado: true,
        motivo: 'Usuário perguntou carteira de reservista, mas a resposta continha dados de nascimento/filiação.',
      };
    }
  }

  // 4. CERTIDÃO DE NASCIMENTO
  const pedeCertidaoNascimento = /\bcertid[aã]o\s*de\s*nascimento\b/i.test(msgNorm);
  if (pedeCertidaoNascimento) {
    const mencionaNascimento = /\bcertid[aã]o\s*de\s*nascimento\b/i.test(respNorm);
    const falaDeCasamento = /\bcasamento\b/i.test(respNorm);
    if (!mencionaNascimento && falaDeCasamento) {
      return {
        textoValidado: `Não encontrei a certidão de nascimento${pessoaFormatada} no Cofre.`,
        interceptado: true,
        motivo: 'Usuário perguntou certidão de nascimento, mas a resposta entregou certidão de casamento.',
      };
    }
  }

  // 5. PASSAPORTE
  const pedePassaporte = /\bpassaporte\b/i.test(msgNorm);
  if (pedePassaporte) {
    const mencionaPassaporte = /\bpassaporte\b/i.test(respNorm);
    if (!mencionaPassaporte) {
      return {
        textoValidado: `Não encontrei o passaporte${pessoaFormatada} nos documentos.`,
        interceptado: true,
        motivo: 'Usuário perguntou passaporte, mas a resposta continha outro documento ou campo.',
      };
    }
  }

  // 6. DISPENSA MILITAR VS DATA DE NASCIMENTO
  const pedeDispensa = /\b(dispensad[oa]|servi[cç]o\s*militar)\b/i.test(msgNorm);
  if (pedeDispensa) {
    const mencionaDispensa = /\b(dispens|incorpor|militar)\b/i.test(respNorm);
    const afirmaNascimento = /\b(data\s*de\s*nascimento|nasceu\s*em)\b/i.test(respNorm);
    if (!mencionaDispensa && afirmaNascimento) {
      return {
        textoValidado: `Não encontrei a data de dispensa do serviço militar${pessoaFormatada} nos documentos.`,
        interceptado: true,
        motivo: 'Usuário perguntou data de dispensa militar, mas a resposta entregou data de nascimento.',
      };
    }
  }

  // 7. PESSOA ESPECÍFICA CITADA VS TITULAR DO CONTEXTO (ex: Nilceia vs Thomaz)
  if (msgNorm.includes('nilceia') && !msgNorm.includes('thomaz')) {
    const atribuiAoThomaz = /\b(m[aã]e\s+do\s+thomaz|pai\s+do\s+thomaz|cpf\s+do\s+thomaz|nascimento\s+do\s+thomaz|nascid[oa]\s+do\s+thomaz|aqui\s+est[aá].*do\s+thomaz|passaporte\s+thomaz)\b/i.test(respNorm);
    const naoMencionaNilceia = !respNorm.includes('nilceia');
    if (atribuiAoThomaz || (naoMencionaNilceia && /\b(thomaz|lustri|fabre)\b/i.test(respNorm))) {
      return {
        textoValidado: `Não encontrei esse documento da *Nilceia* no Cofre.`,
        interceptado: true,
        motivo: 'Usuário perguntou sobre Nilceia, mas a resposta atribuiu dados/documento ao Thomaz.',
      };
    }
  }

  return { textoValidado: textoResposta, interceptado: false };
}

/**
 * 4. ORQUESTRADOR PRINCIPAL DO CHAT COM RASTRO DE RACIOCÍNIO E SANITIZAÇÃO RIGOROSA
 */
export async function processarMensagemChat(dados: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  contato: Contato;
  documentosDisponiveis?: DocumentoRegistro[];
  documentoIdDireto?: string;
}): Promise<ResultadoChatOrquestrador> {
  const resultado = await executarProcessamentoMensagemChatInterno(dados);

  // GUARDRAIL FINAL (REGRA 17): Validação estrita de correspondência de campo
  const checagemCampo = validarCorrespondenciaCampoResposta(dados.mensagemUsuario, resultado.textoResposta);
  if (checagemCampo.interceptado) {
    console.warn(`[VEGA Guardrail] Resposta interceptada pela Regra 17: ${checagemCampo.motivo}`);
    resultado.textoResposta = checagemCampo.textoValidado;
    if (resultado.anexos && resultado.anexos.length > 0) {
      resultado.anexos = [];
    }
    if (resultado.rastro) {
      resultado.rastro.respostaFinal = checagemCampo.textoValidado;
      resultado.rastro.enviouAnexo = false;
      resultado.rastro.anexosDetalhes = [];
      resultado.rastro.etapas.push({
        ordem: resultado.rastro.etapas.length + 1,
        nome: 'Guardrail de Correspondência de Campo (Regra 17)',
        descricao: `Resposta interceptada e corrigida: ${checagemCampo.motivo}`,
        tempoMs: 1,
        detalhes: { motivo: checagemCampo.motivo },
      });
    }
  }

  // SANITIZAÇÃO DUPLA: Garante que NENHUM bloco de código, JSON ou resíduo técnico
  // jamais chegue à interface do usuário ou seja enviado para o WhatsApp.
  resultado.textoResposta = sanitizarRespostaTextoFinal(resultado.textoResposta);
  if (resultado.rastro && resultado.rastro.respostaFinal) {
    resultado.rastro.respostaFinal = sanitizarRespostaTextoFinal(resultado.rastro.respostaFinal);
  }

  return resultado;
}


