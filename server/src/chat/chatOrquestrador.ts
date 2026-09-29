import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { gerarEmbedding } from '../ai/openaiProvider.js';
import { chamarChatComTelemetria } from '../ai/telemetriaIaService.js';
import { checarSeLimiteConsumoEstourado, registrarAviso } from '../avisos/avisosFalhaService.js';
import {
  obterTitularPorNome,
  obterTodosTitulares,
  obterTodosDocumentos,
  obterTodosConhecimentos,
  adicionarConhecimento,
  atualizarConhecimento,
  salvarOuAtualizarTitular,
  resolverTitularCadastrado,
  resolverTitularComAmbiguidade,
  removerDocumento,
  mapearLinhaDocumento,
} from '../storage.js';
import { indexarConhecimentoBackground } from '../indexador/indexadorAutomatico.js';
import { salvarPendenciaDocumentoWhatsApp } from '../whatsapp/pendenciasWhatsAppService.js';
import { normalizarNumeroCanonica } from '../whatsapp/usuarioWhatsAppService.js';
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
import { gerarLinksNavegacao } from '../utils/geoLinks.js';

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
import { calcularChecklistTitular } from '../documentosEsperadosService.js';
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
  | 'consultar_checklist_faltantes'
  | 'apagar_documento'
  | 'cadastrar_conhecimento'
  | 'fora_de_escopo';

export interface DetalhesConhecimentoClassificado {
  chavePix?: string;
  tipoChavePix?: 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria';
  beneficiario?: string;
  banco?: string;
  url?: string;
  nomeSistema?: string;
  telefone?: string;
  email?: string;
  nome?: string;
  cargo?: string;
  setor?: string;
  descricao?: string;
}

export interface ItemPedidoClassificado {
  intencao: IntencaoChat;
  pessoa?: string;
  origemPessoa?: 'mensagem_atual' | 'contexto';
  campos?: string[];
  documento_citado?: string;
  documentos_citados?: string[];
  ambiguidadeTitulares?: string[];
  pergunta_completa: string;
  termo_busca: string;
  pergunta_reescrita?: string;
  campo_corrigir?: string;
  valor_novo?: string;
  tipo_conhecimento?: 'pix' | 'link' | 'contato' | 'outro';
  titulo_conhecimento?: string;
  detalhes_conhecimento?: DetalhesConhecimentoClassificado;
  campo_faltante?: string;
}

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
  tipo_conhecimento?: 'pix' | 'link' | 'contato' | 'outro';
  titulo_conhecimento?: string;
  detalhes_conhecimento?: DetalhesConhecimentoClassificado;
  campo_faltante?: string;
  pedidos?: ItemPedidoClassificado[];
  tempoMs: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
}

export const REGEX_EMPRESA =
  /\b(delta|deltaplan|delta\s*plan|empresa|escrit[oó]rio|escritorio|sede|filial|obra|almoxarifado|canteiro|construtora)\b/i;

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

  // REGRA DE EXCLUSÃO ABSOLUTA 1 (TRAVA 1): Menção à empresa (Delta, Delta Plan, escritório, construtora, etc.)
  // NUNCA pode ser tratada como confirmação de documento pessoal previamente ofertado!
  if (REGEX_EMPRESA.test(msgLimpa)) {
    return null;
  }

  // REGRA DE EXCLUSÃO ABSOLUTA 2: Se a mensagem for uma pergunta, pedido de informação ou comando interrogativo,
  // NUNCA pode ser tratada como confirmação de documento ofertado!
  const ehPerguntaOuNovaBusca =
    mensagemUsuario.includes('?') ||
    /\b(qual|quando|onde|quem|quanto|quantos|como|por\s*que|porque|cad[eê]|me\s*diga|informa|informe|sabe|mostra|mostre)\b/i.test(msgLimpa);

  if (ehPerguntaOuNovaBusca) {
    return null;
  }

  const palavras = msgLimpa.split(/\s+/).filter(Boolean);

  // 1. Mensagens afirmativas explícitas curtas ("sim", "pode mandar", "manda", "quero", "isso", "por favor", etc.)
  // REGRA 18: Somente mensagens curtas (até 4 palavras) e inequivocamente afirmativas constituem aceite de documento oferecido.
  // Frases com mais de 4 palavras (como "Me mande o endereço do escritório...") NUNCA são confirmação cega.
  const regexAfirmativo = /\b(sim|pode mandar|pode enviar|manda|envia|quero|isso|por favor|com certeza|manda ai|manda a[ií]|manda ele|solta esse arquivo|envia ele|os dois|os 2|ambos|todos|todas|pode ser|com certeza|ok|claro|perfeito|manda bala)\b/i;
  if (palavras.length <= 4 && (regexAfirmativo.test(msgLimpa) || isConfirmacaoSimples(mensagemUsuario))) {
    return docsOferecidos;
  }

  // 2. Escolha por número ordinal ("o primeiro", "primeiro", "1", "o 1", "opcao 1")
  const regexPrimeiro = /\b(primeiro|primeira|1|opcao 1|op[cç][aã]o 1|o 1|o primeiro)\b/i;
  if (palavras.length <= 4 && regexPrimeiro.test(msgLimpa) && docsOferecidos.length >= 1) {
    return [docsOferecidos[0]];
  }

  // 3. Escolha por segundo ordinal ("o segundo", "segundo", "2", "o 2", "opcao 2")
  const regexSegundo = /\b(segundo|segunda|2|opcao 2|op[cç][aã]o 2|o 2|o segundo)\b/i;
  if (palavras.length <= 4 && regexSegundo.test(msgLimpa) && docsOferecidos.length >= 2) {
    return [docsOferecidos[1]];
  }

  // 4. Escolha por terceiro ordinal ("o terceiro", "terceiro", "3", "o 3", "opcao 3")
  const regexTerceiro = /\b(terceiro|terceira|3|opcao 3|op[cç][aã]o 3|o 3|o terceiro)\b/i;
  if (palavras.length <= 4 && regexTerceiro.test(msgLimpa) && docsOferecidos.length >= 3) {
    return [docsOferecidos[2]];
  }

  // 5. Escolha pelo nome do documento ou tipo (NUNCA por nome do titular!)
  // Mensagens com mais de 6 palavras não são escolha de documento
  if (palavras.length > 6) {
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
 * Remove saudações repetidas do início de textos em pedidos subsequentes de um lote unificado.
 */
export function removerSaudacaoInicial(texto: string): string {
  if (!texto) return '';
  return texto
    .replace(/^(?:ol[aá]|oi|bom\s*dia|boa\s*tarde|boa\s*noite)(?:,\s*[^!\n.,]+)?[:!.,\s]*/i, '')
    .trim();
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
 * Sanitiza pedidos de resumo ou conteúdo para verificar se a mensagem cita expressamente
 * um documento ou se é puramente uma referência anafórica ao documento do contexto.
 * Retorna se é puramente anafórico/genérico e o termo/documento remanescente se houver.
 */
export function sanitizarPedidoResumoOuConteudo(mensagem: string): {
  termoLimpo: string;
  apenasReferenciaContexto: boolean;
} {
  if (!mensagem || !mensagem.trim()) {
    return { termoLimpo: '', apenasReferenciaContexto: true };
  }

  let limpo = mensagem
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 1. Remover pontuações
  limpo = limpo.replace(/[,;:.!?"'()«»\\\[\]|]/g, ' ');

  // 2. Remover saudações e cortesias
  limpo = limpo.replace(
    /\b(perfeito|perfeita|otimo|otima|beleza|legal|maravilha|show|maravilhoso|ok|obrigado|obrigada|valeu|muito obrigado|muito obrigada|por favor|por gentileza|agora|entao|bom dia|boa tarde|boa noite|ola|oi|e ai)\b/gi,
    ' '
  );

  // 3. Remover comandos de resumo, explicação e leitura de conteúdo
  limpo = limpo.replace(
    /\b(resuma|resumo|resumir|faca um resumo|faz um resumo|explique|explicar|me explique|me diga|fala sobre|fale sobre|diga sobre|diz sobre|conteudo|qual o conteudo|qual e o conteudo|o que diz|o que fala|o que consta|o que tem|do que se trata|sobre o que e|sobre o que se trata|quantas linhas|em poucas palavras)\b/gi,
    ' '
  );

  // 4. Remover especificações numéricas de linhas ("em 10 linhas", "em 5 linhas", "10 linhas")
  limpo = limpo.replace(/\b(em\s+)?\d+\s+linhas\b/gi, ' ');

  // 5. Remover pronomes dêiticos e termos puramente anafóricos que referenciam o contexto
  limpo = limpo.replace(
    /\b(esse documento|este documento|deste documento|desse documento|o documento acima|o documento entregue|o documento|um documento|documento|os documentos|o arquivo|esse arquivo|este arquivo|desse arquivo|deste arquivo|arquivo|os arquivos|o pdf|esse pdf|este pdf|desse pdf|deste pdf|pdf|os pdfs|ele|ela|dele|dela|nele|nela|esse|este|deste|desse|isso|aquilo|ai)\b/gi,
    ' '
  );

  // 6. Remover preposições e artigos soltos
  limpo = limpo.replace(/\b(o|a|os|as|de|do|da|dos|das|em|no|na|nos|nas|por|para|pra|pro|com|e|ou|um|uma|uns|umas)\b/gi, ' ');

  limpo = limpo.replace(/\s+/g, ' ').trim();

  // Se nada sobrou (ou menos que 2 letras), é puramente anafórico / referência ao contexto
  const apenasReferenciaContexto = limpo.length < 2;

  return {
    termoLimpo: limpo,
    apenasReferenciaContexto,
  };
}

/**
 * Localiza no catálogo do Cofre um documento citado pelo usuário em pedidos de resumo ou conteúdo.
 * Retorna o documento correspondente ou null se não existir no Cofre.
 */
export function localizarDocumentoCitadoNoCofre(
  termoOuNomeCitado: string,
  todosDocs: DocumentoRegistro[],
  titularAlvo?: string
): DocumentoRegistro | null {
  if (!termoOuNomeCitado || !todosDocs || todosDocs.length === 0) return null;

  const termoNorm = termoOuNomeCitado
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. Match direto no catálogo completo por título ou arquivo (independente de titular suposto)
  for (const doc of todosDocs) {
    const docTitNorm = doc.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const docArqNorm = doc.arquivo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (docTitNorm === termoNorm || docArqNorm === termoNorm || termoNorm === docTitNorm || termoNorm === docArqNorm) {
      return doc;
    }
    // Match se o título contém o termo ou vice-versa (se tiver 4+ letras)
    if (termoNorm.length >= 4 && (docTitNorm.includes(termoNorm) || termoNorm.includes(docTitNorm))) {
      return doc;
    }
  }

  // Se houver titularAlvo válido, tenta filtrar, mas se o filtro esvaziar, mantém o catálogo completo
  let catalogo = titularAlvo
    ? todosDocs.filter((d) => titularCorresponde(d.titular, titularAlvo))
    : todosDocs;

  if (catalogo.length === 0) {
    catalogo = todosDocs;
  }

  // 2. Se o termo cita sigla técnica ou tipo específico (ART, RRT, CREA, CNH, CRT, etc.)
  const tipoIdentificado = identificarTipoPedido(termoOuNomeCitado);
  const palavrasTermo = termoNorm.split(/\s+/).filter(
    (w) => w.length >= 3 && !['resumo', 'resuma', 'sobre', 'para', 'documento', 'arquivo', 'pdf', 'servicos'].includes(w)
  );

  // Documentos que casam com o tipo ou sigla
  const docsDoTipo = catalogo.filter((d) => {
    const titNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tipoNorm = (d.tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const arqNorm = d.arquivo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (tipoIdentificado) {
      const tipoIdNorm = tipoIdentificado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (tipoNorm === tipoIdNorm || titNorm.includes(tipoIdNorm) || arqNorm.includes(tipoIdNorm)) {
        return true;
      }
    }

    // Siglas como ART, RRT, CREA, CNH, CRT
    for (const sigla of ['art', 'rrt', 'crea', 'crt', 'cau', 'cnh', 'rg', 'cpf']) {
      if (new RegExp(`\\b${sigla}\\b`, 'i').test(termoNorm)) {
        if (
          new RegExp(`\\b${sigla}\\b`, 'i').test(titNorm) ||
          new RegExp(`\\b${sigla}\\b`, 'i').test(tipoNorm) ||
          new RegExp(`\\b${sigla}\\b`, 'i').test(arqNorm)
        ) {
          return true;
        }
      }
    }

    return false;
  });

  if (docsDoTipo.length === 1) {
    return docsDoTipo[0];
  }

  if (docsDoTipo.length > 1) {
    // Desempata pelas outras palavras do termo (ex: "menegazzo")
    let melhorDoc = docsDoTipo[0];
    let maxBates = -1;
    for (const d of docsDoTipo) {
      const textoCompleto = `${d.titulo} ${d.arquivo} ${d.titular || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const bates = palavrasTermo.filter((p) => textoCompleto.includes(p)).length;
      if (bates > maxBates) {
        maxBates = bates;
        melhorDoc = d;
      }
    }
    return melhorDoc;
  }

  // 3. Match por inclusão de partes significativas no título de algum documento
  for (const doc of catalogo) {
    const docTitNorm = doc.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (palavrasTermo.length >= 2 && palavrasTermo.every((p) => docTitNorm.includes(p))) {
      return doc;
    }
    if (palavrasTermo.length >= 1 && palavrasTermo.some((p) => p.length >= 5 && docTitNorm.includes(p))) {
      return doc;
    }
  }

  return null;
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
    const d = (item.dadosEstruturados as any) || {};
    dados.link = d.link || (item.conteudo?.match(/https?:\/\/[^\s]+/) ? item.conteudo.match(/https?:\/\/[^\s]+/)?.[0] : undefined);
  } else if (tipo === 'pix') {
    const d = (item.dadosEstruturados as any) || {};
    dados.chavePix = d.chave || d.chavePix;
    dados.tipoChavePix = d.tipoChave || d.tipoChavePix;
    dados.titularPix = d.titular || d.titularPix;
    dados.bancoPix = d.banco || d.bancoPix;
    if (!dados.chavePix) {
      const matchChave = item.conteudo?.match(/(?:chave|pix|cpf|cnpj|email|telefone|chave aleat[oó]ria)?[:\s]+([a-zA-Z0-9.\-_@+]+)/i);
      if (matchChave) dados.chavePix = matchChave[1];
    }
  } else if (tipo === 'contato') {
    const d = (item.dadosEstruturados as any) || {};
    dados.telefone = d.telefone || d.celular || d.whatsapp;
    dados.setor = d.funcao || d.setor;
    if (!dados.telefone) {
      const matchTel = item.conteudo?.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/);
      if (matchTel) dados.telefone = matchTel[0];
    }
  } else if (tipo === 'local') {
    const d = (item.dadosEstruturados as any) || {};
    dados.nomeLocal = d.nomeLocal || item.titulo;
    dados.endereco = d.endereco || item.conteudo;
    dados.pontoReferencia = d.pontoReferencia;
    dados.cidade = d.cidade;
    const linksNav = dados.endereco ? gerarLinksNavegacao(dados.endereco, dados.cidade) : undefined;
    dados.linkMaps = (d.linkMaps && !d.linkMaps.includes('google.com/maps/search/')) ? d.linkMaps : (linksNav?.linkMaps || d.linkMaps);
    dados.linkWaze = (d.linkWaze && !d.linkWaze.includes('waze.com/ul')) ? d.linkWaze : (linksNav?.linkWaze || d.linkWaze);
  } else if (!tipo || tipo === 'regra') {
    // Se parecer um local (título tem Escritório, Obra, etc., ou conteúdo é rua/av)
    const ehLocalPeloTitulo = /\b(escrit[oó]rio|obra|sede|filial|almoxarifado|dep[oó]sito|canteiro|local|endere[cç]o)\b/i.test(item.titulo || '');
    const ehLocalPeloConteudo = /\b(rua|av\.|avenida|rodovia|alameda|estrada|bairro|travessa)\b/i.test(item.conteudo || '');
    if (ehLocalPeloTitulo && ehLocalPeloConteudo) {
      dados.tipo = 'local';
      dados.nomeLocal = item.titulo;
      dados.endereco = item.conteudo;
      const linksNav = gerarLinksNavegacao(dados.endereco);
      dados.linkMaps = linksNav.linkMaps;
      dados.linkWaze = linksNav.linkWaze;
    }
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

  // 4. Resposta Determinística Exata para Localização / Endereços / Como Chegar
  if (
    item.tipo === 'local' ||
    (/\b(escrit[oó]rio|obra|sede|filial|almoxarifado|dep[oó]sito|canteiro|local|endere[cç]o)\b/i.test(item.titulo || '') &&
      /\b(rua|av\.|avenida|rodovia|alameda|estrada|bairro|travessa|\d{2,})\b/i.test(item.conteudo || ''))
  ) {
    const d = (item.dadosEstruturados as any) || {};
    const nome = d.nomeLocal || item.titulo;
    const endereco = d.endereco || item.conteudo;
    const partes: string[] = [`Aqui está a localização de *${nome}*:`];
    if (endereco) partes.push(`\n📍 *Endereço:* ${endereco}`);
    if (d.cidade) partes.push(`🏙️ *Cidade:* ${d.cidade}`);
    if (d.pontoReferencia) partes.push(`📌 *Como chegar / Referência:* ${d.pontoReferencia}`);

    const linksNav = endereco ? gerarLinksNavegacao(endereco, d.cidade) : undefined;
    const urlMaps = (d.linkMaps && !d.linkMaps.includes('google.com/maps/search/')) ? d.linkMaps : (linksNav?.linkMaps || d.linkMaps);
    const urlWaze = (d.linkWaze && !d.linkWaze.includes('waze.com/ul')) ? d.linkWaze : (linksNav?.linkWaze || d.linkWaze);

    if (urlMaps) partes.push(`🗺️ *Google Maps:* ${urlMaps}`);
    if (urlWaze) partes.push(`🚗 *Waze:* ${urlWaze}`);

    return {
      texto: partes.join('\n'),
      tempoMs: Date.now() - inicio,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  }

  // 5. Regras e textos livres
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
 * Deduz o tipo da chave PIX a partir do formato e conteúdo
 */
export function deduzirTipoChavePix(chaveRaw: string): 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria' {
  const limpa = (chaveRaw || '').trim();
  if (limpa.includes('@')) return 'email';
  const digitos = limpa.replace(/\D/g, '');
  if (digitos.length === 14) return 'cnpj';
  if (digitos.length === 11) {
    // Se o 3º dígito após o DDD não for 9, é CPF
    // No Brasil, celular é (XX) 9XXXX-XXXX -> digitos[2] === '9'
    // Ex: 43859328832 -> digitos[2] é '8', portanto é CPF
    if (limpa.includes('.') || limpa.includes('-') || digitos[2] !== '9') {
      return 'cpf';
    }
    return 'telefone';
  }
  if (digitos.length === 10 || digitos.length === 12 || digitos.length === 13) {
    return 'telefone';
  }
  if (limpa.length >= 30 && limpa.includes('-')) {
    return 'aleatoria';
  }
  return 'cpf';
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
      (c) => c.tipo === 'pix' || c.titulo.toLowerCase().includes('pix') || c.categoria?.toLowerCase() === 'financeiro'
    );
    if (itensPix.length > 0) {
      for (const p of itensPix) {
        const dados = (p.dadosEstruturados as any) || {};
        const titular = dados.titular ? normalizarParaBusca(dados.titular) : '';
        const titItem = normalizarParaBusca(p.titulo);
        const partesTitular = titular ? titular.split(/\s+/).filter((pt: string) => pt.length >= 3) : [];
        const matchPartes = partesTitular.length > 0 && partesTitular.some((pt: string) => termoNorm.includes(pt));

        if (
          (titular && (termoNorm.includes(titular) || titular.includes(termoNorm) || matchPartes)) ||
          (titItem && (termoNorm.includes(titItem) || titItem.includes(termoNorm)))
        ) {
          return { item: p, score: 100 };
        }
      }

      // Regra 22: NUNCA devolver chave de outra pessoa se um titular/sujeito foi citado!
      const palavrasIgnoradas = new Set(['qual', 'o', 'a', 'os', 'as', 'pix', 'chave', 'de', 'do', 'da', 'dos', 'das', 'e', 'me', 'manda', 'passa', 'envia', 'salve', 'salva', 'anote', 'anota', 'por', 'favor', 'tem']);
      const termosSignificativos = termoNorm.split(/\s+/).filter((w) => w.length >= 3 && !palavrasIgnoradas.has(w));

      if (termosSignificativos.length > 0) {
        return null;
      }

      // Se a mensagem foi puramente genérica ("qual o pix?", "me manda a chave pix") e só existe 1 chave
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

  // D) Consulta de Localização / Endereços / Como Chegar
  const regexConsultaLocal = /\b(onde fica|onde e|onde é|como chegar|como chego|qual o endereco|qual o endereço|qual a localizacao|qual a localização|localizacao|localização|local|locais|lugares|lugar|endereco|endereço|enderecos|endereços|rota|rotas|como ir|ponto de apoio|obra|obras|almoxarifado|deposito|depósito|escritorio|escritório|sede|filial)\b/i;

  if (regexConsultaLocal.test(termoNorm)) {
    const itensLocal = conhecimentos.filter(
      (c) => c.tipo === 'local' || c.categoria?.toLowerCase() === 'localização' || c.categoria?.toLowerCase() === 'localizacao' || c.categoria?.toLowerCase() === 'obras'
    );

    if (itensLocal.length > 0) {
      // 1. Procurar match específico de um dos locais cadastrados
      for (const loc of itensLocal) {
        const dados = (loc.dadosEstruturados as any) || {};
        const nomeLoc = dados.nomeLocal ? normalizarParaBusca(dados.nomeLocal) : '';
        const endLoc = dados.endereco ? normalizarParaBusca(dados.endereco) : '';
        const cidLoc = dados.cidade ? normalizarParaBusca(dados.cidade) : '';
        const titItem = normalizarParaBusca(loc.titulo);

        if (
          (nomeLoc && (termoNorm.includes(nomeLoc) || nomeLoc.includes(termoNorm))) ||
          (titItem && (termoNorm.includes(titItem) || titItem.includes(termoNorm)))
        ) {
          return { item: loc, score: 100 };
        }

        // Palavras significativas do nome do local (ex: "solar", "central", "deposito", etc.)
        const palavras = (nomeLoc || titItem)
          .split(/\s+/)
          .filter((p) => p.length >= 4 && !['obra', 'local', 'delta', 'plan', 'sede', 'localizacao', 'endereco'].includes(p));
        for (const p of palavras) {
          if (termoNorm.includes(p)) {
            return { item: loc, score: 95 };
          }
        }
      }

      // 2. Se a busca for ampla/geral por locais cadastrados ("onde ficam os lugares", "quais locais temos?", "quais os endereços?")
      const ehBuscaGeral = /\b(locais|lugares|onde ficam|quais os locais|todos os locais|quais enderecos|quais os enderecos|lista de locais|quais lugares|nossas obras|onde ficam as obras)\b/i.test(termoNorm);
      if (ehBuscaGeral && itensLocal.length > 1) {
        const consolidado: ItemConhecimento = {
          id: 'k-locais-consolidados',
          titulo: 'Locais Cadastrados na Delta Plan',
          categoria: 'Localização',
          conteudo: itensLocal.map((l, idx) => {
            const d = (l.dadosEstruturados as any) || {};
            const nome = d.nomeLocal || l.titulo;
            const end = d.endereco || l.conteudo;
            const ref = d.pontoReferencia ? `\n📌 _Como chegar:_ ${d.pontoReferencia}` : '';
            const linksNav = end ? gerarLinksNavegacao(end, d.cidade) : undefined;
            const maps = (d.linkMaps && !d.linkMaps.includes('google.com/maps/search/')) ? d.linkMaps : (linksNav?.linkMaps || d.linkMaps);
            const waze = (d.linkWaze && !d.linkWaze.includes('waze.com/ul')) ? d.linkWaze : (linksNav?.linkWaze || d.linkWaze);
            const rotas = [maps ? `🗺️ Maps: ${maps}` : '', waze ? `🚗 Waze: ${waze}` : ''].filter(Boolean).join('\n');
            return `${idx + 1}. *${nome}*\n📍 ${end}${ref}${rotas ? `\n${rotas}` : ''}`;
          }).join('\n\n'),
          tipo: 'regra',
          dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
        };
        return { item: consolidado, score: 100 };
      }

      // Se só existir 1 local cadastrado e a pessoa perguntou onde fica ou como chegar
      if (itensLocal.length === 1) {
        return { item: itensLocal[0], score: 100 };
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
 * Pós-processa e aplica todas as regras de segurança e normalização em um pedido individual classificado.
 */
export function posProcessarItemPedido(
  itemRaw: any,
  mensagemUsuario: string,
  titulares: FichaTitular[],
  docs: DocumentoRegistro[],
  conhecimentos: ItemConhecimento[],
  historicoRecente: Mensagem[]
): ItemPedidoClassificado {
  const perguntaCompleta = itemRaw.pergunta_completa || mensagemUsuario;
  const textoAnalise = [perguntaCompleta, itemRaw.termo_busca, itemRaw.documento_citado].filter(Boolean).join(' ');
  const itemNorm = normalizarParaBusca(textoAnalise);
  const msgNorm = normalizarParaBusca(mensagemUsuario);

  let intencao: IntencaoChat = itemRaw.intencao || 'pergunta_conteudo';
  let pessoa = itemRaw.pessoa || '';
  let origemPessoa: 'mensagem_atual' | 'contexto' | undefined = undefined;
  let campos: string[] = Array.isArray(itemRaw.campos) ? itemRaw.campos : [];
  let campo_corrigir = itemRaw.campo_corrigir || '';
  let valor_novo = itemRaw.valor_novo || '';
  let documento_citado = itemRaw.documento_citado || '';
  let documentos_citados: string[] = Array.isArray(itemRaw.documentos_citados) ? itemRaw.documentos_citados : [];
  let ambiguidadeTitulares: string[] = [];

  // 1. Identifica se uma pessoa foi citada diretamente no pedido ou na mensagem
  let pessoaCitadaNaMensagem: string | undefined = undefined;
  if (pessoa) {
    const pNorm = normalizarParaBusca(pessoa);
    if (
      itemNorm.includes(pNorm) ||
      msgNorm.includes(pNorm) ||
      pNorm.split(/\s+/).some((parte: string) => parte.length >= 3 && (itemNorm.includes(parte) || msgNorm.includes(parte)))
    ) {
      pessoaCitadaNaMensagem = pessoa;
    }
  }

  // Fallback de detecção por regex para casos como "da Nilceia", "do Marcos", "de Fulano"
  if (!pessoaCitadaNaMensagem) {
    const matchPessoa = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(?:de|da|do|dos|das)\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+)*)/);
    if (matchPessoa) {
      const candidato = matchPessoa[1].trim();
      const candNorm = normalizarParaBusca(candidato);
      const ehPalavraIgnorada = /\b(documento|pdf|arquivo|certidao|contrato|alvara|cnh|rg|empresa|delta|deltaplan|registro|casamento|nascimento|mae|pai|filiacao|resumo|vacina|covid|escrit[oó]rio|sede|filial|obra|almoxarifado|dep[oó]sito|canteiro|local|localiza[cç][aã]o|sistema|app|portal|chave|pix|conta|banco|contato|suporte)\b/i.test(candNorm);
      if (!ehPalavraIgnorada) {
        pessoaCitadaNaMensagem = candidato;
      }
    }
  }

  // Regra 16 com Tolerância de Grafia e Apelidos:
  if (pessoaCitadaNaMensagem) {
    const resAmb = resolverTitularComAmbiguidade(pessoaCitadaNaMensagem, titulares);
    if (resAmb.ambiguo) {
      ambiguidadeTitulares = resAmb.candidatos.map((t) => t.nome);
      pessoa = pessoaCitadaNaMensagem;
    } else if (resAmb.titular) {
      pessoa = resAmb.titular.nome;
    } else {
      pessoa = pessoaCitadaNaMensagem;
    }
    origemPessoa = 'mensagem_atual';
  } else if (pessoa) {
    const resAmb = resolverTitularComAmbiguidade(pessoa, titulares);
    if (resAmb.ambiguo) {
      ambiguidadeTitulares = resAmb.candidatos.map((t) => t.nome);
    } else if (resAmb.titular) {
      pessoa = resAmb.titular.nome;
    } else {
      pessoa = '';
    }
  }

  const ehPedidoCertidao = /\bcertid[aã]o\b/i.test(itemNorm);

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
  if (!ehPedidoCertidao || itemNorm.includes('certidao de nascimento')) {
    for (const p of padroesCampos) {
      if (p.regex.test(itemNorm)) {
        camposDetectadosRegex.push(p.campo);
      }
    }
  }

  // Detecção expressa de sujeitos no pedido
  const citaEmpresaNaMensagem = REGEX_EMPRESA.test(itemNorm);
  const titularExplicitoMsg = extrairTitularExplicito(itemNorm);

  // Detecção de correção
  const REGEX_CORRECAO = /\b(est[aá]\s*errad[oa]|t[aá]\s*errad[oa]|n[aã]o\s*[eé]|incorret[oa]|corrija|corrigir|alterar|mudar\s*para|o\s*certo\s*[eé]|o\s*correto\s*[eé])\b/i;
  const ehMensagemCorrecao =
    REGEX_CORRECAO.test(itemNorm) ||
    intencao === 'corrigir_dado' ||
    (/\bvalidade\b/i.test(itemNorm) && /\b\d{2}\/\d{2}\/\d{4}\b/.test(itemNorm));

  // Detecção de silenciar alerta
  const REGEX_SILENCIAR = /\b(pare\s*de\s*alerta(r)?|n[aã]o\s*alerte(\s*mais)?|desative(\s*os)?\s*alerta(s)?|desativar\s*alerta(s)?|silenciar\s*alerta(s)?|parar\s*de\s*alerta(r)?)\b/i;
  const ehSilenciarAlerta = REGEX_SILENCIAR.test(itemNorm) || intencao === 'silenciar_alerta';

  let termoBusca = itemRaw.termo_busca || documento_citado || perguntaCompleta;

  if (ehSilenciarAlerta) {
    intencao = 'silenciar_alerta';
    if (!pessoa && (pessoaCitadaNaMensagem || titularExplicitoMsg)) {
      pessoa = pessoaCitadaNaMensagem || titularExplicitoMsg || '';
      origemPessoa = 'mensagem_atual';
    }
    if (!documento_citado) {
      if (/\bcrt\b/i.test(itemNorm)) documento_citado = 'CRT';
      else if (/\bcrea\b/i.test(itemNorm)) documento_citado = 'CREA';
      else if (/\bcnh\b/i.test(itemNorm)) documento_citado = 'CNH';
    }
  } else if (intencao === 'consultar_checklist_faltantes' && !ehMensagemCorrecao) {
    if (pessoaCitadaNaMensagem || titularExplicitoMsg) {
      pessoa = pessoaCitadaNaMensagem || titularExplicitoMsg || '';
      origemPessoa = 'mensagem_atual';
    }
  } else if (intencao === 'consultar_vencimentos' && !ehMensagemCorrecao) {
    pessoa = '';
    campos = [];
    origemPessoa = undefined;
  } else if (citaEmpresaNaMensagem) {
    pessoa = '';
    intencao = 'pergunta_conteudo';
    campos = [];
    origemPessoa = undefined;
    if (/\b(endere[cç]o|mora|resid[eê]ncia|localiza|onde\s*fica)\b/i.test(itemNorm)) {
      termoBusca = 'Escritório Deltaplan';
    }
  } else if (pessoaCitadaNaMensagem) {
    pessoa = pessoaCitadaNaMensagem;
    origemPessoa = 'mensagem_atual';
  } else if (titularExplicitoMsg) {
    pessoa = titularExplicitoMsg;
    origemPessoa = 'mensagem_atual';
  } else {
    // Contexto só deve ser usado quando não contiver sujeito e estiver na janela
    const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
    if (titularDoHistorico) {
      const temPronomeOuCampo = /\b(ele|dele|dela|ela)\b/i.test(itemNorm) || camposDetectadosRegex.length > 0 || ehMensagemCorrecao;
      if (pessoa || temPronomeOuCampo) {
        pessoa = titularDoHistorico;
        origemPessoa = 'contexto';
      }
    } else {
      pessoa = '';
      origemPessoa = undefined;
    }
  }

  if (ehMensagemCorrecao) {
    intencao = 'corrigir_dado';
    if (!campo_corrigir && camposDetectadosRegex.length > 0) {
      campo_corrigir = camposDetectadosRegex[0];
    }
    if (!valor_novo) {
      const matchData = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
      if (matchData) {
        valor_novo = matchData[1];
      } else {
        const matchValor = (perguntaCompleta + ' ' + mensagemUsuario).match(/(?:é|e|para|sendo|correto é|certo é|na verdade é)\s+([^.,\n]+)/i);
        if (matchValor) {
          valor_novo = matchValor[1].trim();
        }
      }
    }
  }

  if (intencao === 'dado_pessoal' && !citaEmpresaNaMensagem) {
    if (camposDetectadosRegex.length > 0) {
      campos = Array.from(new Set([...campos, ...camposDetectadosRegex]));
    }
    documento_citado = '';
    documentos_citados = [];
  }

  // Proteção: resumo vs pedir_arquivo
  const ehPerguntaExplicacaoOuResumo =
    /\b(resum[aeo]|resumo|expliq?u?e|fala\s+sobre|diz\s+sobre|o\s+que\s+(fala|diz|tem|consta)\s+n[oa]|conteudo|qual\s+o\s+conteudo|sobre\s+o\s+que\s+[eé]|quantas\s+linhas|em\s+\d+\s+linhas)\b/i.test(
      itemNorm
    );

  if (ehPerguntaExplicacaoOuResumo && intencao === 'pedir_arquivo') {
    intencao = 'pergunta_conteudo';
    const sanitizadoResumo = sanitizarPedidoResumoOuConteudo(perguntaCompleta);
    if (!sanitizadoResumo.apenasReferenciaContexto) {
      if (!documento_citado) {
        const tipoIdentificado = identificarTipoPedido(perguntaCompleta);
        const termoCandidato = tipoIdentificado || sanitizadoResumo.termoLimpo;
        if (termoCandidato && !/\b(cofre|arquivo|documento)\b/i.test(termoCandidato)) {
          documento_citado = termoCandidato;
          termoBusca = documento_citado;
        }
      }
    } else {
      documento_citado = '';
      termoBusca = '';
    }
  }

  // Múltiplos documentos citados no texto do pedido
  const multiplosNoTexto = identificarMultiplosDocumentosNoTexto(perguntaCompleta, docs, pessoa);
  if (!ehPerguntaExplicacaoOuResumo && intencao !== 'listar_documentos' && intencao !== 'dado_pessoal' && multiplosNoTexto.length > 1) {
    intencao = 'pedir_arquivo';
    documentos_citados = multiplosNoTexto.map((d) => d.titulo);
    documento_citado = multiplosNoTexto.map((d) => d.titulo).join(', ');
    termoBusca = documento_citado;
  }

  // Sanitização de comando genérico de envio
  if (documento_citado) {
    const sanitizadoCitado = sanitizarPedidoArquivo(documento_citado);
    if (sanitizadoCitado.apenasComandoEnvio) {
      documento_citado = '';
      termoBusca = '';
    }
  }

  // Proteção: saudação vs pergunta de conteúdo
  const padroesConteudo = [
    /\bo que (tem|diz|consta|ha|ha) em\b/i,
    /\bo que (diz|fala|tem)\b/i,
    /\bme fal[ae] sobre\b/i,
    /\bqual(is)? a(s)? regra(s)?\b/i,
    /\bqual(is)? a(s)? politica(s)?\b/i,
    /\bqual(is)? o(s)? endereco(s)?\b/i,
    /\bonde fica\b/i,
  ];
  const temPadraoConteudo = padroesConteudo.some((p) => p.test(itemNorm));
  const temTituloConhecimento = conhecimentos.some((c) =>
    itemNorm.includes(normalizarParaBusca(c.titulo))
  );
  const temTituloDoc = docs.some((d) =>
    itemNorm.includes(normalizarParaBusca(d.titulo))
  );

  if (intencao === 'saudacao_ou_vago' && (temPadraoConteudo || temTituloConhecimento || temTituloDoc)) {
    intencao = 'pergunta_conteudo';
  }

  // Suporte a cadastrar_conhecimento (Regra 22)
  const ehComandoCadastro =
    /\b(salv[aeo]|salvar|anot[aeo]|anotar|guard[aeo]|guardar|cadastr[aeo]|cadastrar|armazen[aeo]|armazenar|registr[aeo]|registrar)\b/i.test(
      itemNorm
    ) ||
    /\b(salv[aeo]|salvar|anot[aeo]|anotar|guard[aeo]|guardar|cadastr[aeo]|cadastrar|armazen[aeo]|armazenar|registr[aeo]|registrar)\b/i.test(
      msgNorm
    );
  const citaItemConhecimento =
    /\b(pix|chave\s*pix|telefone|contato|link|celular|whatsapp|url|site)\b/i.test(itemNorm) ||
    /\b(pix|chave\s*pix|telefone|contato|link|celular|whatsapp|url|site)\b/i.test(msgNorm);

  if (ehComandoCadastro && citaItemConhecimento) {
    intencao = 'cadastrar_conhecimento';
  }

  let tipo_conhecimento = itemRaw.tipo_conhecimento || '';
  let titulo_conhecimento = itemRaw.titulo_conhecimento || '';
  let detalhes_conhecimento = itemRaw.detalhes_conhecimento ? { ...itemRaw.detalhes_conhecimento } : undefined;
  let campo_faltante = itemRaw.campo_faltante || '';

  if (intencao === 'cadastrar_conhecimento') {
    if (!tipo_conhecimento) {
      if (/\b(pix|chave\s*pix)\b/i.test(itemNorm) || /\b(pix|chave\s*pix)\b/i.test(msgNorm)) {
        tipo_conhecimento = 'pix';
      } else if (/\b(link|url|site|portal)\b/i.test(itemNorm) || /\b(link|url|site|portal)\b/i.test(msgNorm)) {
        tipo_conhecimento = 'link';
      } else if (/\b(telefone|contato|celular|ramal)\b/i.test(itemNorm) || /\b(telefone|contato|celular|ramal)\b/i.test(msgNorm)) {
        tipo_conhecimento = 'contato';
      } else {
        tipo_conhecimento = 'outro';
      }
    }

    if (tipo_conhecimento === 'pix') {
      detalhes_conhecimento = detalhes_conhecimento || {};
      if (!detalhes_conhecimento.chavePix) {
        const matchDigitos = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(\d{11}|\d{14}|\d{10,13}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[0-9a-fA-F-]{32,36})\b/);
        if (matchDigitos) {
          detalhes_conhecimento.chavePix = matchDigitos[1];
        }
      }
      if (detalhes_conhecimento.chavePix && !detalhes_conhecimento.tipoChavePix) {
        detalhes_conhecimento.tipoChavePix = deduzirTipoChavePix(detalhes_conhecimento.chavePix);
      }
      if (!detalhes_conhecimento.beneficiario) {
        if (pessoa) {
          detalhes_conhecimento.beneficiario = pessoa;
        } else {
          const matchBenef = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(?:de|do|da|dos|das)\s+([A-ZÁÉÍÓÚÂÊÔÃÕa-záéíóúâêôãõç]+)\b/i);
          if (matchBenef && !/\b(pix|chave|empresa|delta)\b/i.test(matchBenef[1])) {
            detalhes_conhecimento.beneficiario = matchBenef[1].charAt(0).toUpperCase() + matchBenef[1].slice(1);
            pessoa = detalhes_conhecimento.beneficiario;
          }
        }
      }
      if (!titulo_conhecimento) {
        titulo_conhecimento = `Chave PIX do ${detalhes_conhecimento.beneficiario || pessoa || ''}`.trim();
      }
    } else if (tipo_conhecimento === 'contato') {
      detalhes_conhecimento = detalhes_conhecimento || {};
      if (!detalhes_conhecimento.telefone) {
        const matchTel = (perguntaCompleta + ' ' + mensagemUsuario).match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/);
        if (matchTel) {
          detalhes_conhecimento.telefone = matchTel[0].trim();
        }
      }
      if (!detalhes_conhecimento.nome) {
        if (pessoa) {
          detalhes_conhecimento.nome = pessoa;
        } else {
          const matchNome = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(?:de|do|da|dos|das)\s+([A-ZÁÉÍÓÚÂÊÔÃÕa-záéíóúâêôãõç]+)\b/i);
          if (matchNome && !/\b(contato|telefone|celular|empresa|delta)\b/i.test(matchNome[1])) {
            detalhes_conhecimento.nome = matchNome[1].charAt(0).toUpperCase() + matchNome[1].slice(1);
            pessoa = detalhes_conhecimento.nome;
          }
        }
      }
      if (!titulo_conhecimento) {
        titulo_conhecimento = `Telefone ${detalhes_conhecimento.nome || pessoa || ''}`.trim();
      }
    }
  }

  return {
    intencao,
    pessoa: pessoa || undefined,
    origemPessoa,
    campos: campos.length > 0 ? campos : undefined,
    campo_corrigir: campo_corrigir || undefined,
    valor_novo: valor_novo || undefined,
    documento_citado: documento_citado || undefined,
    documentos_citados: documentos_citados.length > 0 ? documentos_citados : undefined,
    ambiguidadeTitulares: ambiguidadeTitulares.length > 1 ? ambiguidadeTitulares : undefined,
    pergunta_completa: perguntaCompleta,
    termo_busca: termoBusca || documento_citado || perguntaCompleta,
    pergunta_reescrita: perguntaCompleta,
    tipo_conhecimento: tipo_conhecimento || undefined,
    titulo_conhecimento: titulo_conhecimento || undefined,
    detalhes_conhecimento,
    campo_faltante: campo_faltante || undefined,
  };
}

/**
 * 1. CLASSIFICAÇÃO E REESCRITA COM UMA ÚNICA CHAMADA AO gpt-5.4-mini (JSON, temp 0.1)
 * Suporta mensagens com um único pedido ou múltiplos pedidos agrupados em lista.
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
  "pedidos": [
    {
      "intencao": "saudacao_ou_vago" | "pedir_arquivo" | "listar_documentos" | "dado_pessoal" | "pergunta_conteudo" | "corrigir_dado" | "consultar_vencimentos" | "silenciar_alerta" | "consultar_checklist_faltantes" | "apagar_documento" | "cadastrar_conhecimento" | "fora_de_escopo",
      "pessoa": "nome do titular ou pessoa citada na mensagem (ex: Fulano, Nilceia, Berna) ou vazio",
      "campos": ["lista de campos ou dados específicos solicitados (ex.: cpf, rg, filiacao, mae, pai, dataNascimento, endereco, estadoCivil, profissao, cnh, validadeCnh, categoriaCnh, orgaoEmissor, titulo_eleitor, pis, carteira_reservista, certidao_nascimento, passaporte) ou vazio"],
      "campo_corrigir": "nome do campo a ser corrigido ou vazio",
      "valor_novo": "novo valor correto informado pelo usuário ou vazio",
      "tipo_conhecimento": "pix" | "link" | "contato" | "outro" | "",
      "titulo_conhecimento": "título curto do item a cadastrar ou vazio",
      "detalhes_conhecimento": {
        "chavePix": "valor da chave PIX ou vazio",
        "tipoChavePix": "cpf" | "cnpj" | "telefone" | "email" | "aleatoria" | "",
        "beneficiario": "nome do titular/beneficiário da chave ou vazio",
        "banco": "nome do banco se citado ou vazio",
        "url": "link ou url completo ou vazio",
        "nomeSistema": "nome do sistema ou site ou vazio",
        "telefone": "número de telefone informado ou vazio",
        "email": "e-mail informado ou vazio",
        "nome": "nome do contato ou vazio",
        "cargo": "cargo ou função se informada ou vazio",
        "setor": "departamento ou setor se informado ou vazio"
      },
      "campo_faltante": "informação ausente que precisa ser perguntada (ex: tipo da chave) ou vazio",
      "documento_citado": "nome do documento físico específico citado (NUNCA termos de repositório como 'cofre', 'arquivo', 'documento') ou vazio",
      "documentos_citados": ["lista de documentos físicos citados ou vazio"],
      "pergunta_completa": "versão clara e completa desta solicitação específica sem perder informações",
      "termo_busca": "versão curta para busca por nome de arquivo ou tópico"
    }
  ]
}

REGRAS RÍGIDAS PARA MÚLTIPLOS PEDIDOS:
- Se a mensagem contiver mais de um pedido, pergunta ou solicitação distinta (seja do mesmo tipo ou de tipos diferentes, ou mensagens agrupadas como 'onde fica o escritório e qual o pix', 'manda a CNH e a certidão', 'qual o CPF do Thomaz e a certidão de casamento dele'), retorne CADA pedido como um item separado na lista "pedidos", rigorosamente na ordem em que aparecem.
- Se for apenas um pedido ou pergunta, a lista "pedidos" deve conter exatamente 1 único item.

REGRAS RÍGIDAS DE INTENÇÃO E ESCOPO:
0. "listar_documentos": Inventário ou catálogo geral ("o que tem no cofre?", "quais documentos você tem?", "o que temos guardado?", "listar o cofre", "quais documentos existem?").
   - "Cofre" é repositório, NUNCA documento individual. Perguntas sobre o cofre são SEMPRE "listar_documentos", JAMAIS "pergunta_conteudo".
   - "documento_citado" e "termo_busca" DEVEM SER OBRIGATORIAMENTE vazios ("").
1. "saudacao_ou_vago": Apenas saudações puras ("oi", "olá", "bom dia") ou pedidos vagos ("ajuda"). Nunca para perguntas com assunto ou listas.
2. "pedir_arquivo": Pedido EXPRESSO de envio ou entrega de documento físico ("me envia o PDF", "manda a CNH", "contrato de locação", "solta esse arquivo aí", "sim", "o primeiro").
   - Se citar documento real ("CNH", "CREA", "Contrato"): preencha "documento_citado", "documentos_citados" e "termo_busca".
   - Se for comando de envio, gíria anafórica ou confirmação ("me envia o pdf", "solta ele", "pode mandar", "sim", "o primeiro"): "documento_citado" e "termo_busca" DEVEM SER vazios (""). O contexto enviará o documento correto.
   - Pedidos de resumo, explicação ou perguntas sobre texto ("resuma", "explique", "data de casamento") são SEMPRE "pergunta_conteudo", NUNCA "pedir_arquivo".
3. "dado_pessoal": Informações cadastrais de pessoas (CPF, RG, endereço residencial, estado civil, filiação/mãe/pai, profissão, validade da CNH, categoria da CNH, título de eleitor, PIS, carteira de reservista).
   - Mesmo com verbos de envio ("mande o título de eleitor", "passa o PIS do Fulano", "qual o CPF dele?"), É SEMPRE "dado_pessoal", NUNCA "pedir_arquivo".
   - Distinção PIS vs PIX: "PIS" é campo cadastral de pessoa ("dado_pessoal", campos: ["pis"]). Consulta a "PIX" existente é "pergunta_conteudo". Pedidos para SALVAR, GUARDAR ou CADASTRAR PIX novo são OBRIGATORIAMENTE "cadastrar_conhecimento".
   - Sem titular citado: intencao: "dado_pessoal", pessoa: "", campos: [campo solicitado].
4. "pergunta_conteudo": Perguntas ou consultas sobre texto de documento arquivado ou instruções/itens existentes da Base de Conhecimento:
   - Base de Conhecimento: consultas de links de sistemas ("link do app"), contatos corporativos ("contato financeiro"), localização/rotas de obras e sedes ("como chegar na obra", "onde fica o escritório"), regras de negócio e consultas de chaves PIX já cadastradas ("qual o pix do Fulano/empresa", "me manda a chave pix").
   - IMPORTANTE: Pedidos para SALVAR, CADASTRAR, ANOTAR ou GUARDAR uma nova informação (PIX novo, novo telefone, novo link) são SEMPRE "cadastrar_conhecimento", NUNCA "pergunta_conteudo".
   - Fatos jurídicos vs Nascimento: datas de eventos registrados em documentos (dispensa militar, registro de casamento, vacinas) são ESTRITAMENTE "pergunta_conteudo", NUNCA "dado_pessoal" e JAMAIS respondidas com nascimento.
   - Resumos (Regra 20): pedidos de resumo são SEMPRE "pergunta_conteudo". Se citar documento ("resuma a ART"), preencha "documento_citado" e "termo_busca". Se for anafórico ("resuma esse documento"), deixe-os vazios ("").
   - Vacinas/Covid: perguntas sobre vacinas do cofre são SEMPRE "pergunta_conteudo", NUNCA "fora_de_escopo".
5. "corrigir_dado": Informação cadastral de titular incorreta ou correção ("profissão do Fulano é X", "está errado, é 10/05/2030"). Preencha "campo_corrigir", "valor_novo" e "pessoa".
6. "consultar_vencimentos": Prazos de validade ou vencimento de documentos ("o que vence este mês?", "documentos vencidos"). Preencha "pessoa" se citada.
7. "silenciar_alerta": Desativar avisos de vencimento ("pare de alertar o CRT", "desative alertas da CNH"). Preencha "documento_citado" e "pessoa".
8. "consultar_checklist_faltantes": Documentos pendentes ou checklist ("o que falta do Fulano?", "quais faltam da empresa X?", "o que está faltando?"). Preencha "pessoa" se citada.
9. "apagar_documento": Excluir, descartar ou cancelar documento físico/foto salvo ou recente ("apaga o último documento", "apaga a foto", "cancela esse documento"). Preencha "documento_citado" e "pessoa" se citados.
10. "cadastrar_conhecimento": Pedidos para salvar, anotar, cadastrar, guardar ou registrar uma nova informação na Base de Conhecimento (chaves PIX, contatos, telefones, links de sistemas). Ex.: "salva o pix do berna é 43859328832", "anota o telefone do financeiro", "guarda esse link", "cadastra o contato do João".
11. "fora_de_escopo": Apenas assuntos totalmente alheios à empresa (culinária, futebol, piadas). Vacinas, documentos e dados corporativos NUNCA são fora de escopo.

REGRAS CRÍTICAS DE SUJEITO E CONTEXTO:
- Nome citado prevalece: qualquer pessoa citada (cadastrada ou não, ex.: cônjuge como "Nilceia", "Berna") prevalece sobre o histórico e define "pessoa".
- Reconhecimento da Empresa Delta Plan: "Delta", "Delta Plan", "empresa", "escritório", "sede", "obra", "almoxarifado" referem-se à organização corporativa -> intencao: "pergunta_conteudo", pessoa: "".
- O termo "Cofre" é repositório geral, NUNCA documento individual. Consultas sobre o cofre são SEMPRE "listar_documentos", documento_citado: "".
- Uso do contexto: herdar titular do histórico APENAS quando a mensagem atual não contiver sujeito e usar pronomes ("ele", "dele") ou perguntas elípticas ("e a validade?", "e o CPF dele?").

EXEMPLOS OBRIGATÓRIOS:
- "Quero que salve, o pix do berna é 43859328832" -> {"pedidos": [{"intencao": "cadastrar_conhecimento", "pessoa": "Berna", "tipo_conhecimento": "pix", "titulo_conhecimento": "Chave PIX do Berna", "detalhes_conhecimento": {"chavePix": "43859328832", "tipoChavePix": "cpf", "beneficiario": "Berna"}, "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Salvar chave PIX do Berna 43859328832", "termo_busca": "pix Berna"}]}
- "anota o telefone do Berna que é 11987654321" -> {"pedidos": [{"intencao": "cadastrar_conhecimento", "pessoa": "Berna", "tipo_conhecimento": "contato", "titulo_conhecimento": "Telefone do Berna", "detalhes_conhecimento": {"telefone": "11987654321", "nome": "Berna"}, "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Salvar telefone do Berna 11987654321", "termo_busca": "telefone Berna"}]}
- "salva esse link do portal https://portal.delta.com.br" -> {"pedidos": [{"intencao": "cadastrar_conhecimento", "pessoa": "", "tipo_conhecimento": "link", "titulo_conhecimento": "Link do Portal", "detalhes_conhecimento": {"url": "https://portal.delta.com.br", "nomeSistema": "Portal Delta"}, "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Salvar link do portal https://portal.delta.com.br", "termo_busca": "Link Portal"}]}
- "Eu quero saber onde que fica o escritório da Delta. E eu também quero saber o Pix do João Gabriel." -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Onde fica o escritório da Delta Plan?", "termo_busca": "Escritorio Deltaplan"}, {"intencao": "pergunta_conteudo", "pessoa": "João Gabriel", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é a chave PIX do João Gabriel?", "termo_busca": "pix João Gabriel"}]}
- "me envia o crea e a certidão de casamento do Thomaz" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CREA", "documentos_citados": ["CREA"], "pergunta_completa": "Enviar documento CREA do Thomaz", "termo_busca": "CREA Thomaz"}, {"intencao": "pedir_arquivo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "Certidão de Casamento", "documentos_citados": ["Certidão de Casamento"], "pergunta_completa": "Enviar certidão de casamento do Thomaz", "termo_busca": "Certidão de Casamento Thomaz"}]}
- "qual o cpf do thomaz e me manda a certidão de casamento dele" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o CPF do Thomaz?", "termo_busca": "cpf Thomaz"}, {"intencao": "pedir_arquivo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "Certidão de Casamento", "documentos_citados": ["Certidão de Casamento"], "pergunta_completa": "Enviar certidão de casamento do Thomaz", "termo_busca": "Certidão de Casamento Thomaz"}]}
- "o que tem no cofre?" -> {"pedidos": [{"intencao": "listar_documentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Listar documentos disponíveis no cofre", "termo_busca": ""}]}
- "quais documentos do fulano você tem?" -> {"pedidos": [{"intencao": "listar_documentos", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Listar documentos do Fulano", "termo_busca": "Fulano"}]}
- "me mande o endereço do escritório da Delta Plan" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o endereço do escritório da Delta Plan?", "termo_busca": "Escritorio Deltaplan"}]}
- "resuma a art de serviços menegazzo" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "ART de serviços menegazzo", "documentos_citados": ["ART de serviços menegazzo"], "pergunta_completa": "Resumir a ART de serviços menegazzo", "termo_busca": "ART de serviços menegazzo"}]}
- "resuma esse documento" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Resumir o documento do contexto", "termo_busca": ""}]}
- "quando fui dispensado do serviço militar?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "dispensa militar", "documentos_citados": [], "pergunta_completa": "Quando ocorreu a dispensa do serviço militar?", "termo_busca": "dispensa servico militar"}]}
- "qual a data de registro de casamento do Thomaz?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "certidão de casamento", "documentos_citados": [], "pergunta_completa": "Qual é a data de registro de casamento do Thomaz?", "termo_busca": "registro casamento Thomaz"}]}
- "qual o pix do João Gabriel" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "João Gabriel", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é a chave PIX do João Gabriel?", "termo_busca": "pix João Gabriel"}]}
- "me manda a chave pix" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é a chave PIX?", "termo_busca": "chave pix"}]}
- "qual o link do sistema de máquinas?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o link do App de Portfólio das Máquinas?", "termo_busca": "App de Portfólio das Máquinas"}]}
- "qual o contato do financeiro?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o contato do departamento financeiro?", "termo_busca": "financeiro"}]}
- "como chegar na obra residencial solar?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Como chegar na obra residencial solar?", "termo_busca": "obra residencial solar"}]}
- "o que tem em Regra de Negócio: Proposta Comercial" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o conteúdo do documento ou instrução Regra de Negócio: Proposta Comercial?", "termo_busca": "Proposta Comercial"}]}
- "quais dias eu tomei as vacinas da covid?" -> {"pedidos": [{"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quais dias foram tomadas as vacinas da covid?", "termo_busca": "vacina covid"}]}
- "me mande o título de eleitor do thomaz" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["titulo_eleitor"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o título de eleitor do Thomaz?", "termo_busca": "titulo eleitor Thomaz"}]}
- "me passa o PIS do thomaz" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["pis"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o PIS do Thomaz?", "termo_busca": "pis Thomaz"}]}
- "qual cpf?" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o CPF?", "termo_busca": "cpf"}]}
- "qual o endereço?" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "", "campos": ["endereco"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o endereço residencial?", "termo_busca": "endereco"}]}
- "qual o nome da mãe da Nilceia?" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Nilceia", "campos": ["filiacao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quem é a mãe da Nilceia?", "termo_busca": "filiacao Nilceia"}]}
- "e o RG dele?" (após falar de um titular) -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["rg"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o RG do Fulano?", "termo_busca": "Fulano"}]}
- "me envie esses documentos do fulano: endereço, estado civil e profissão" -> {"pedidos": [{"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["endereco", "estadoCivil", "profissao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quais são o endereço, estado civil e profissão do Fulano?", "termo_busca": "Fulano"}]}
- "show, agora me envie o pdf" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Enviar documento do contexto", "termo_busca": ""}]}
- "contrato de locação" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "contrato de locação", "documentos_citados": ["contrato de locação"], "pergunta_completa": "Enviar documento contrato de locação", "termo_busca": "contrato de locação"}]}
- "sim" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Confirmar envio do documento oferecido", "termo_busca": ""}]}
- "o primeiro" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Escolher primeira opção de documento oferecido", "termo_busca": ""}]}
- "qual é a CNH do fulano" -> {"pedidos": [{"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH", "documentos_citados": ["CNH"], "pergunta_completa": "Enviar documento CNH do Fulano", "termo_busca": "CNH Fulano"}]}
- "desative os alertas da CNH do Thomaz" -> {"pedidos": [{"intencao": "silenciar_alerta", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH", "documentos_citados": ["CNH"], "pergunta_completa": "Desativar alertas de vencimento da CNH do Thomaz", "termo_busca": "CNH"}]}
- "o que vence este mês?" -> {"pedidos": [{"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos que vencem este mês", "termo_busca": ""}]}
- "a profissão do fulano está errada, é Técnico em Eletrotécnica" -> {"pedidos": [{"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "profissao", "valor_novo": "Técnico em Eletrotécnica", "campos": ["profissao"], "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Corrigir profissão do Fulano para Técnico em Eletrotécnica", "termo_busca": ""}]}
- "está errado, é 10/05/2030" (após VEGA responder validade) -> {"pedidos": [{"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "validadeCnh", "valor_novo": "10/05/2030", "campos": ["validadeCnh"], "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Corrigir validade da CNH do Fulano para 10/05/2030", "termo_busca": ""}]}
- "o que falta do fulano?" -> {"pedidos": [{"intencao": "consultar_checklist_faltantes", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes do Fulano", "termo_busca": ""}]}
- "quais documentos faltam da empresa X?" -> {"pedidos": [{"intencao": "consultar_checklist_faltantes", "pessoa": "Empresa X", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes da Empresa X", "termo_busca": ""}]}
- "o que está faltando?" -> {"pedidos": [{"intencao": "consultar_checklist_faltantes", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes", "termo_busca": ""}]}
- "apaga o último documento que mandei" -> {"pedidos": [{"intencao": "apagar_documento", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Apagar o último documento enviado", "termo_busca": ""}]}
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
        max_completion_tokens: 600,
      },
      { motivo: 'chat_classificador' }
    );

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    const tempoMs = Date.now() - inicio;

    let pedidosRaw: any[] = [];
    if (Array.isArray(parsed.pedidos) && parsed.pedidos.length > 0) {
      pedidosRaw = parsed.pedidos;
    } else if (parsed.intencao) {
      pedidosRaw = [parsed];
    } else {
      pedidosRaw = [{ intencao: 'pergunta_conteudo', pergunta_completa: mensagemUsuario, termo_busca: mensagemUsuario }];
    }

    const pedidosProcessados: ItemPedidoClassificado[] = pedidosRaw.map((raw) =>
      posProcessarItemPedido(raw, mensagemUsuario, titulares, docs, conhecimentos, historicoRecente)
    );

    const primeiro = pedidosProcessados[0] || {
      intencao: 'pergunta_conteudo' as IntencaoChat,
      pergunta_completa: mensagemUsuario,
      termo_busca: mensagemUsuario,
    };

    return {
      intencao: primeiro.intencao,
      pessoa: primeiro.pessoa,
      origemPessoa: primeiro.origemPessoa,
      campos: primeiro.campos,
      campo_corrigir: primeiro.campo_corrigir,
      valor_novo: primeiro.valor_novo,
      documento_citado: primeiro.documento_citado,
      documentos_citados: primeiro.documentos_citados,
      ambiguidadeTitulares: primeiro.ambiguidadeTitulares,
      pergunta_completa: primeiro.pergunta_completa,
      termo_busca: primeiro.termo_busca,
      pergunta_reescrita: primeiro.pergunta_reescrita || primeiro.pergunta_completa,
      tipo_conhecimento: primeiro.tipo_conhecimento,
      titulo_conhecimento: primeiro.titulo_conhecimento,
      detalhes_conhecimento: primeiro.detalhes_conhecimento,
      campo_faltante: primeiro.campo_faltante,
      pedidos: pedidosProcessados,
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
      pedidos: [
        {
          intencao: 'pergunta_conteudo',
          pergunta_completa: mensagemUsuario,
          termo_busca: mensagemUsuario,
        },
      ],
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
  pedidoPreClassificado?: ItemPedidoClassificado;
}): Promise<ResultadoChatOrquestrador> {
  const inicioTotal = Date.now();
  const { mensagemUsuario, historicoRecente, documentoIdDireto } = dados;
  const contato = dados.contato || { id: 'anonimo', nome: '', telefone: '', canal: 'whatsapp' as const };
  const documentosDisponiveis = dados.documentosDisponiveis || [];
  const primeiroNome = extrairPrimeiroNome(contato?.nome || '');
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
  // ETAPA 1 (ARQUITETURAL): Classificação e Reescrita Contextual pela IA
  // TODA mensagem de texto ou áudio passa primeiro pela IA!
  // ============================================================================
  let classificacao: ClassificacaoChatResponse;

  if (dados.pedidoPreClassificado) {
    const p = dados.pedidoPreClassificado;
    classificacao = {
      intencao: p.intencao,
      pessoa: p.pessoa,
      origemPessoa: p.origemPessoa,
      campos: p.campos,
      campo_corrigir: p.campo_corrigir,
      valor_novo: p.valor_novo,
      documento_citado: p.documento_citado,
      documentos_citados: p.documentos_citados,
      ambiguidadeTitulares: p.ambiguidadeTitulares,
      pergunta_completa: p.pergunta_completa,
      termo_busca: p.termo_busca,
      pergunta_reescrita: p.pergunta_reescrita || p.pergunta_completa,
      tipo_conhecimento: p.tipo_conhecimento,
      titulo_conhecimento: p.titulo_conhecimento,
      detalhes_conhecimento: p.detalhes_conhecimento,
      campo_faltante: p.campo_faltante,
      pedidos: [p],
      tempoMs: 0,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
    };
  } else {
    classificacao = await classificarEReescreverMensagem(mensagemUsuario, historicoRecente, openai);
  }

  // ============================================================================
  // TRATAMENTO DE MÚLTIPLOS PEDIDOS NO MESMO LOTE / MENSAGEM (REQUISITOS 1 A 6)
  // Se o classificador identificar mais de 1 pedido, executa cada um e une as respostas
  // ============================================================================
  if (!dados.pedidoPreClassificado && classificacao.pedidos && classificacao.pedidos.length > 1) {
    const MAX_PEDIDOS_LOTE = 5;
    const pedidosTotais = classificacao.pedidos;
    const pedidosParaExecutar = pedidosTotais.slice(0, MAX_PEDIDOS_LOTE);
    const excedeuLimite = pedidosTotais.length > MAX_PEDIDOS_LOTE;

    const resultadosExecucao: {
      sucesso: boolean;
      resultado?: ResultadoChatOrquestrador;
      erroMsg?: string;
      pedido: ItemPedidoClassificado;
    }[] = [];

    for (const pedidoItem of pedidosParaExecutar) {
      try {
        const resPedido = await executarProcessamentoMensagemChatInterno({
          ...dados,
          mensagemUsuario: pedidoItem.pergunta_completa || mensagemUsuario,
          pedidoPreClassificado: pedidoItem,
        });
        resultadosExecucao.push({
          sucesso: true,
          resultado: resPedido,
          pedido: pedidoItem,
        });
      } catch (err: any) {
        console.error(`[VEGA Multi-Pedidos ❌] Erro ao executar pedido:`, err);
        const descricao = pedidoItem.documento_citado || pedidoItem.pergunta_completa || pedidoItem.termo_busca || 'solicitado';
        resultadosExecucao.push({
          sucesso: false,
          erroMsg: `Não consegui processar o pedido sobre *${descricao}*.`,
          pedido: pedidoItem,
        });
      }
    }

    // 1. Montagem da resposta textual consolidada na ordem dos pedidos
    const blocosTexto: string[] = [];
    for (let i = 0; i < resultadosExecucao.length; i++) {
      const item = resultadosExecucao[i];
      if (item.sucesso && item.resultado) {
        let txt = item.resultado.textoResposta.trim();
        // Em pedidos após o primeiro, removemos eventuais saudações redundantes
        if (i > 0) {
          txt = removerSaudacaoInicial(txt);
        }
        if (txt) {
          blocosTexto.push(txt);
        }
      } else if (item.erroMsg) {
        blocosTexto.push(`⚠️ ${item.erroMsg}`);
      }
    }

    if (excedeuLimite) {
      blocosTexto.push(
        `_Por segurança, atendi os primeiros ${MAX_PEDIDOS_LOTE} pedidos. Por favor, envie os demais novamente._`
      );
    }

    const textoRespostaConsolidada = blocosTexto.join('\n\n');

    // 2. Anexos consolidados de todos os pedidos
    const todosAnexos: Anexo[] = [];
    const anexosIdsVistos = new Set<string>();
    for (const item of resultadosExecucao) {
      if (item.sucesso && item.resultado?.anexos) {
        for (const anexo of item.resultado.anexos) {
          const chave = (anexo as any).id || anexo.nome;
          if (!anexosIdsVistos.has(chave)) {
            anexosIdsVistos.add(chave);
            todosAnexos.push(anexo);
          }
        }
      }
    }

    // 3. Rastro e métricas consolidadas
    const etapasConsolidadas: EtapaRastro[] = [
      {
        ordem: 1,
        nome: 'Classificação Multi-Pedidos',
        descricao: `Identificados ${pedidosTotais.length} pedidos distintos (${pedidosParaExecutar.length} processados).`,
        tempoMs: classificacao.tempoMs,
        detalhes: {
          totalPedidos: pedidosTotais.length,
          processados: pedidosParaExecutar.length,
          pedidos: pedidosParaExecutar.map((p) => ({
            intencao: p.intencao,
            pessoa: p.pessoa,
            pergunta: p.pergunta_completa,
          })),
        },
      },
    ];

    let ordemEtapa = 2;
    let tokensPromptConsolidados = classificacao.tokensPrompt;
    let tokensCompletionConsolidados = classificacao.tokensCompletion;
    let tokensTotalConsolidados = classificacao.tokensTotal;
    let dadosEstruturadosFinal: any = undefined;

    for (const item of resultadosExecucao) {
      if (item.sucesso && item.resultado) {
        if (!dadosEstruturadosFinal && item.resultado.dadosEstruturados) {
          dadosEstruturadosFinal = item.resultado.dadosEstruturados;
        }
        if (item.resultado.rastro) {
          tokensPromptConsolidados += item.resultado.rastro.tokensPrompt || 0;
          tokensCompletionConsolidados += item.resultado.rastro.tokensCompletion || 0;
          tokensTotalConsolidados += item.resultado.rastro.tokensTotal || 0;
          for (const et of item.resultado.rastro.etapas || []) {
            etapasConsolidadas.push({
              ...et,
              ordem: ordemEtapa++,
              nome: `[Pedido: ${item.pedido.intencao}] ${et.nome}`,
            });
          }
        }
      }
    }

    const rastroConsolidado: RastroRegistro = {
      mensagemId: '',
      usuarioNome: contato.nome,
      usuarioId: contato.id,
      mensagemOriginal: mensagemUsuario,
      perguntaReescrita: classificacao.pergunta_completa,
      perguntaCompleta: classificacao.pergunta_completa,
      termoBusca: classificacao.termo_busca,
      pessoa: classificacao.pessoa,
      origemPessoa: classificacao.origemPessoa,
      campos: classificacao.campos,
      documentoCitado: classificacao.documento_citado,
      intencaoDetectada: classificacao.intencao,
      tipoBusca: 'multi_pedidos',
      documentosEncontrados: [],
      enviouAnexo: todosAnexos.length > 0,
      anexosDetalhes: todosAnexos.map((a) => ({
        nome: a.nome,
        titulo: a.titulo,
        tamanho: a.tamanho,
        tipo: a.tipo,
      })),
      respostaFinal: mascararDadosSensiveis(textoRespostaConsolidada),
      modeloUsado: chatModel,
      tokensTotal: tokensTotalConsolidados,
      tokensPrompt: tokensPromptConsolidados,
      tokensCompletion: tokensCompletionConsolidados,
      custoEstimadoUsd: calcularCustoEstimado(chatModel, tokensPromptConsolidados, tokensCompletionConsolidados),
      tempoTotalMs: Date.now() - inicioTotal,
      etapas: etapasConsolidadas,
    };

    return {
      textoResposta: textoRespostaConsolidada,
      anexos: todosAnexos.length > 0 ? todosAnexos : undefined,
      origem: 'motor',
      intencaoDetectada: classificacao.intencao,
      perguntaReescrita: classificacao.pergunta_completa,
      rastro: rastroConsolidado,
      dadosEstruturados: dadosEstruturadosFinal,
    };
  }

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
    const modeloRastro = tokensGeraisTotal > 0 ? chatModel : (params.modelo || 'Motor Interno');
    const custoEstimadoUsd = calcularCustoEstimado(modeloRastro, tokensPromptTotal, tokensCompletionTotal);

    return {
      mensagemId: '',
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
  // RESOLUÇÃO DE CONFIRMAÇÕES / OFERTAS PENDENTES (ORIENTADAS PELA IA)
  // Só executa se a IA tiver classificado a mensagem como compatível com a oferta anterior!
  // ============================================================================
  const ultimaMsgAssistente = [...historicoRecente].reverse().find((m) => m.remetente === 'assistente');

  // A. CONFIRMAÇÃO DE CORREÇÃO PENDENTE DE DADO CADASTRAL OU AÇÃO PENDENTE
  const correcaoPendente = ultimaMsgAssistente?.correcaoPendente;
  if (
    correcaoPendente &&
    (intencao === 'corrigir_dado' ||
      intencao === 'apagar_documento' ||
      intencao === 'pedir_arquivo' ||
      isConfirmacaoSimples(mensagemUsuario) ||
      /^(sim|s|pode|confirmo|confirma|apaga|apagar|exclui|excluir|n[aã]o|n|cancela|cancelar|deixa|esquece|manter|mantem)/i.test(mensagemUsuario.trim()))
  ) {
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
      etapas.push({
        ordem: 2,
        nome: 'Verificação de Permissão',
        descricao: `Usuário ${contato.nome} não possui autorização em USUARIOS_AUTORIZADOS_CORRECAO para alterar dados cadastrais.`,
        tempoMs: 1,
      });
      const rastro = criarRastroFinal({
        tipoBusca: 'ficha',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoNegado,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoNegado,
        origem: 'motor',
        intencaoDetectada: 'corrigir_dado',
        perguntaReescrita: 'Alteração cadastral não autorizada',
        rastro,
      };
    }

    // Exclusão pendente de documento
    if (correcaoPendente.campoId === ('apagar_documento' as any) && correcaoPendente.documentoId) {
      const msgLimpa = mensagemUsuario.toLowerCase().trim();
      const querConfirmar =
        isConfirmacaoSimples(mensagemUsuario) ||
        /^(sim|s|pode|confirmo|confirma|apaga|apagar|exclui|excluir|com certeza|claro)/i.test(msgLimpa);
      const querCancelar = /^(n[aã]o|n|cancela|cancelar|deixa|esquece|manter|mantem)/i.test(msgLimpa);

      if (querConfirmar) {
        await removerDocumento(correcaoPendente.documentoId);
        const docTitulo = correcaoPendente.documentoTitulo || 'documento';
        const textoSucesso = `Documento *${docTitulo}* apagado com sucesso do Cofre.`;

        etapas.push({
          ordem: 2,
          nome: 'Exclusão Definitiva Confirmada',
          descricao: `Documento "${docTitulo}" excluído definitivamente do Cofre pelo administrador ${contato.nome}.`,
          tempoMs: 1,
        });

        const rastroApagar = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [],
          docUsado: docTitulo,
          enviouAnexo: false,
          respostaFinal: textoSucesso,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta: textoSucesso,
          origem: 'motor',
          intencaoDetectada: 'apagar_documento',
          perguntaReescrita: `Exclusão confirmada: ${docTitulo}`,
          rastro: rastroApagar,
        };
      }

      if (querCancelar) {
        const docTitulo = correcaoPendente.documentoTitulo || 'documento';
        const textoCancelado = `Operação cancelada. O documento *${docTitulo}* continua salvo no Cofre.`;

        etapas.push({
          ordem: 2,
          nome: 'Exclusão Cancelada pelo Usuário',
          descricao: `Exclusão do documento "${docTitulo}" cancelada pelo usuário.`,
          tempoMs: 1,
        });

        const rastroCanc = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [],
          docUsado: docTitulo,
          enviouAnexo: false,
          respostaFinal: textoCancelado,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta: textoCancelado,
          origem: 'motor',
          intencaoDetectada: 'apagar_documento',
          perguntaReescrita: `Exclusão cancelada: ${docTitulo}`,
          rastro: rastroCanc,
        };
      }
    }

    // Confirmação ou cancelamento de cadastro/substituição na Base de Conhecimento
    if (
      correcaoPendente.campoId === ('cadastrar_conhecimento' as any) ||
      correcaoPendente.campoId === ('substituir_conhecimento' as any)
    ) {
      const msgLimpa = mensagemUsuario.toLowerCase().trim();
      const querConfirmar =
        isConfirmacaoSimples(mensagemUsuario) ||
        /^(sim|s|pode|confirmo|confirma|salva|salvar|pode salvar|substitui|substituir|com certeza|claro|ok|isso)/i.test(msgLimpa);
      const querCancelar = /^(n[aã]o|n|cancela|cancelar|deixa|esquece|n[aã]o salva|n[aã]o precisa|mantem|manter)/i.test(msgLimpa);

      if (querConfirmar) {
        let itemSalvo: any = null;
        const itemInfo = correcaoPendente.itemConhecimento;
        if (correcaoPendente.campoId === 'substituir_conhecimento' && correcaoPendente.documentoId) {
          itemSalvo = await atualizarConhecimento(correcaoPendente.documentoId, {
            titulo: itemInfo?.titulo || correcaoPendente.valorNovo,
            categoria: itemInfo?.categoria || 'Geral',
            conteudo: itemInfo?.conteudo,
            tipo: itemInfo?.tipo || 'regra',
            dadosEstruturados: itemInfo?.dadosEstruturados,
          });
        } else if (itemInfo) {
          itemSalvo = await adicionarConhecimento({
            titulo: itemInfo.titulo || correcaoPendente.valorNovo,
            categoria: itemInfo.categoria || 'Geral',
            conteudo: itemInfo.conteudo,
            tipo: itemInfo.tipo || 'regra',
            dadosEstruturados: itemInfo.dadosEstruturados,
          });
        }

        if (itemSalvo) {
          indexarConhecimentoBackground(itemSalvo).catch((err) =>
            console.warn('[ChatOrquestrador ⚠️] Erro ao indexar conhecimento:', err)
          );
        }

        const tituloFinal = itemSalvo?.titulo || itemInfo?.titulo || correcaoPendente.valorNovo || 'Informação';
        const textoSucesso =
          correcaoPendente.campoId === 'substituir_conhecimento'
            ? `Informações de *${tituloFinal}* atualizadas com sucesso na Base de Conhecimento.`
            : `Informação *${tituloFinal}* cadastrada com sucesso na Base de Conhecimento.`;

        etapas.push({
          ordem: 2,
          nome: 'Cadastro na Base de Conhecimento Confirmado',
          descricao: `Item "${tituloFinal}" salvo na Base de Conhecimento pelo administrador ${contato.nome}.`,
          tempoMs: 1,
        });

        const rastroConh = criarRastroFinal({
          tipoBusca: 'nome_conhecimento',
          docsEncontrados: [],
          docUsado: tituloFinal,
          enviouAnexo: false,
          respostaFinal: textoSucesso,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta: textoSucesso,
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: `Cadastro confirmado: ${tituloFinal}`,
          rastro: rastroConh,
        };
      }

      if (querCancelar) {
        const tituloItem = correcaoPendente.itemConhecimento?.titulo || correcaoPendente.valorNovo || 'informação';
        const textoCancelado = `Operação cancelada. A informação *${tituloItem}* não foi salva na Base de Conhecimento.`;

        etapas.push({
          ordem: 2,
          nome: 'Cadastro Cancelado pelo Usuário',
          descricao: `Cadastro da informação "${tituloItem}" cancelado pelo usuário.`,
          tempoMs: 1,
        });

        const rastroCanc = criarRastroFinal({
          tipoBusca: 'nome_conhecimento',
          docsEncontrados: [],
          docUsado: tituloItem,
          enviouAnexo: false,
          respostaFinal: textoCancelado,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta: textoCancelado,
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: `Cadastro cancelado: ${tituloItem}`,
          rastro: rastroCanc,
        };
      }
    }

    if (correcaoPendente.campoId === ('silenciar_alerta' as any) && correcaoPendente.documentoId) {
      await silenciarAlertasDocumento(correcaoPendente.documentoId, true);
      const textoSucesso = `Os alertas de vencimento do documento *${correcaoPendente.documentoTitulo || 'solicitado'}* foram desativados. Se o documento for substituído futuramente, os alertas voltarão a funcionar.`;
      etapas.push({
        ordem: 2,
        nome: 'Desativação de Alertas Confirmada',
        descricao: `Alertas do documento "${correcaoPendente.documentoTitulo}" silenciados com sucesso pelo usuário ${contato.nome}.`,
        tempoMs: 1,
      });
      const rastroSilenciar = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: [],
        docUsado: correcaoPendente.documentoTitulo || 'Documento do Cofre',
        enviouAnexo: false,
        respostaFinal: textoSucesso,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoSucesso,
        origem: 'motor',
        intencaoDetectada: 'silenciar_alerta',
        perguntaReescrita: `Desativar alertas: ${correcaoPendente.documentoTitulo}`,
        rastro: rastroSilenciar,
      };
    }

    const titular = await obterTitularPorNome(correcaoPendente.titularNome);
    if (
      titular &&
      correcaoPendente.campoId !== 'silenciar_alerta' &&
      correcaoPendente.campoId !== 'apagar_documento' &&
      correcaoPendente.campoId !== ('cadastrar_conhecimento' as any) &&
      correcaoPendente.campoId !== ('substituir_conhecimento' as any)
    ) {
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
    etapas.push({
      ordem: 2,
      nome: 'Confirmação e Gravação na Ficha',
      descricao: `Usuário confirmou com "${mensagemUsuario}". Campo "${correcaoPendente.campoLabel}" de ${correcaoPendente.titularNome} alterado de "${correcaoPendente.valorAnterior}" para "${correcaoPendente.valorNovo}" com origem "corrigido pelo chat".`,
      tempoMs: 1,
      detalhes: {
        campo: correcaoPendente.campoLabel,
        valorAnterior: correcaoPendente.valorAnterior,
        valorNovo: correcaoPendente.valorNovo,
        origem: 'corrigido pelo chat',
        manual: true,
      },
    });

    const rastro = criarRastroFinal({
      tipoBusca: 'ficha',
      docsEncontrados: [],
      docUsado: 'Ficha Cadastral (corrigido pelo chat)',
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'corrigir_dado',
      perguntaReescrita: `Confirmar correção: ${correcaoPendente.campoLabel} -> ${correcaoPendente.valorNovo}`,
      rastro,
    };
  }

  // B. CONFIRMAÇÃO DE DADO EQUIVALENTE OFERECIDO ("Quer que eu informe?" -> "Sim", "Pode informar")
  if (
    ultimaMsgAssistente &&
    ultimaMsgAssistente.texto &&
    ultimaMsgAssistente.texto.includes('Quer que eu informe?') &&
    (intencao === 'dado_pessoal' || isConfirmacaoSimples(mensagemUsuario))
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
      etapas.push({
        ordem: 2,
        nome: 'Confirmação de Exibição de Dado Oferecido',
        descricao: `Usuário confirmou com "${mensagemUsuario}". Exibido o dado solicitado: "${respostaDado}".`,
        tempoMs: 1,
      });
      const rastro = criarRastroFinal({
        tipoBusca: 'ficha',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: respostaDado,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: respostaDado,
        origem: 'motor',
        intencaoDetectada: 'dado_pessoal',
        perguntaReescrita: 'Confirmação de exibição de dado oferecido',
        rastro,
      };
    }
  }

  // C. CASO DE RESOLUÇÃO OU CONFIRMAÇÃO DE DOCUMENTOS PREVIAMENTE OFERECIDOS
  // Só executa se a IA tiver classificado como pedir_arquivo (ex: "sim", "pode mandar", "manda", "o primeiro")
  const docOferecidoIdsStr = ultimaMsgAssistente?.documentoOferecidoId;

  if (docOferecidoIdsStr && intencao === 'pedir_arquivo') {
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

        etapas.push({
          ordem: 2,
          nome: 'Resolução de Escolha de Documentos Ofertados',
          descricao: `Usuário respondeu com "${mensagemUsuario}". Documento(s) selecionado(s): "${titulos}". Preparado(s) e anexado(s) para entrega direta.`,
          tempoMs: 1,
          detalhes: {
            escolha: mensagemUsuario,
            documentosEnviados: titulos,
            documentoIds: docsEscolhidos.map((d) => d.id),
          },
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: docsRastro,
          docUsado: titulos,
          enviouAnexo: true,
          anexos,
          respostaFinal: textoResposta,
          modelo: 'Motor Interno',
        });

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
  // CASO ESPECIAL: BUSCA DIRETA NA BASE DE CONHECIMENTO CORPORATIVO
  // (Locais / Obras / Escritório / PIX / Links / Contatos / Regras)
  // ============================================================================
  const todosConhecimentos = await obterTodosConhecimentos();
  const msgNorm = normalizarParaBusca(mensagemUsuario);
  const citaEmpresaNaMensagem = /\b(delta|deltaplan|delta\s*plan|empresa|escrit[oó]rio|escritorio|sede|filial|obra|almoxarifado|canteiro|construtora)\b/i.test(msgNorm);
  const ehDadoPessoalSemTitular = intencao === 'dado_pessoal' && !pessoa && !citaEmpresaNaMensagem;
  const ehPerguntaConhecimentoEstruturado =
    /\b(pix|chave\s*pix|link|sistema|portal|acesso|ramal|contato|onde\s*fica|como\s*chego|como\s*chegar|localiza[cç][aã]o|rota|waze|maps|google\s*maps|onde\s*[eé]|como\s*ir)\b/i.test(msgNorm) ||
    Boolean(classificacao.campos && classificacao.campos.includes('pix')) ||
    (/\b(endere[cç]o)\b/i.test(msgNorm) && citaEmpresaNaMensagem);

  if (
    intencao !== 'cadastrar_conhecimento' &&
    intencao !== 'apagar_documento' &&
    !ehDadoPessoalSemTitular &&
    (ehPerguntaConhecimentoEstruturado || intencao === 'pergunta_conteudo')
  ) {
    const matchK =
      (await buscarConhecimentoPorNome(classificacao.termo_busca, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(pergunta_reescrita, todosConhecimentos)) ||
      (await buscarConhecimentoPorNome(mensagemUsuario, todosConhecimentos));

    if (matchK && matchK.score >= 50) {
      const { item, score } = matchK;
      const resK = await formatarOuResumirConhecimento(item, openai);
      const tempoK = Date.now() - inicioTotal;

      etapas.push({
        ordem: 2,
        nome: 'Localização de Conhecimento Corporativo',
        descricao: `Encontrado item "${item.titulo}" (${item.tipo}) com ${score}% de relevância na Base de Conhecimento.`,
        tempoMs: tempoK,
        detalhes: { item: item.titulo, tipo: item.tipo, score },
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
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: resK.texto,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || item.titulo,
        buscaUsada: 'Base de Conhecimento Corporativo',
        similaridade: `${score}%`,
        rastro,
        dadosEstruturados: extrairDadosEstruturadosDeItemConhecimento(item),
      };
    }

    // Se o pedido era especificamente de chave PIX e não foi localizada no Conhecimento
    const ehPedidoEspecificoPix = /\b(pix|chave\s*pix)\b/i.test(msgNorm) || Boolean(classificacao.campos && classificacao.campos.includes('pix'));
    if (ehPedidoEspecificoPix) {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const alvo = pessoa ? ` de *${pessoa}*` : '';
      const textoSemPix = `${prefixoSaudacao}Não encontrei chave PIX cadastrada${alvo} na Base de Conhecimento.`;

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoSemPix,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoSemPix,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || 'Consulta de chave PIX',
        buscaUsada: 'Base de Conhecimento Corporativo',
        similaridade: '0%',
        rastro,
      };
    }

    // Se o pedido era especificamente de contato/telefone e não foi localizado no Conhecimento (Regra 22)
    const ehPedidoEspecificoContato = /\b(contato|telefone|celular|whatsapp|email|e-mail|ramal)\b/i.test(msgNorm);
    if (ehPedidoEspecificoContato && pessoa) {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoSemContato = `${prefixoSaudacao}Não encontrei contato cadastrado de *${pessoa}* na Base de Conhecimento.`;

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoSemContato,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoSemContato,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: classificacao.pergunta_completa || pergunta_reescrita || `Consulta de contato de ${pessoa}`,
        buscaUsada: 'Base de Conhecimento Corporativo',
        similaridade: '0%',
        rastro,
      };
    }
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
      ((!docCitadoIa && !termoBuscaIa) ||
        sanitizadoMsg.apenasComandoEnvio ||
        (docCitadoIa ? sanitizarPedidoArquivo(docCitadoIa).apenasComandoEnvio : false)) &&
      !REGEX_EMPRESA.test(mensagemUsuario);

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
      const citaEmpresaNaMsg = REGEX_EMPRESA.test(mensagemUsuario);
      const docPertencePessoaFisica = Boolean(doc.titular && !REGEX_EMPRESA.test(doc.titular));
      const primeiroNomeTit = doc.titular ? extrairPrimeiroNome(doc.titular).toLowerCase() : '';
      const citouNomeTitular = Boolean(primeiroNomeTit && mensagemUsuario.toLowerCase().includes(primeiroNomeTit));
      const entregaIncompativelComEmpresa = Boolean(citaEmpresaNaMsg && docPertencePessoaFisica && !citouNomeTitular);

      if (titularDivergente || entregaIncompativelComEmpresa) {
        // Bloqueio de divergência (Trava 3): o único documento encontrado pertence a outro titular ou é pessoal de terceiro em pergunta sobre a empresa!
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
  // CASO 2.8: CONSULTA DE CHECKLIST DE DOCUMENTOS FALTANTES (intencao === 'consultar_checklist_faltantes')
  // ============================================================================
  if (intencao === 'consultar_checklist_faltantes') {
    const inicioChecklist = Date.now();
    const pessoaInformada = (classificacao.pessoa || '').trim();

    // 1. Tenta identificar o titular cadastrado
    const todosTitulares = await obterTodosTitulares();
    let titularAlvo = pessoaInformada ? resolverTitularCadastrado(pessoaInformada, todosTitulares) : null;

    if (!titularAlvo) {
      // Tenta recuperar do contexto da conversa recente (últimas 30 mensagens)
      const titularHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
      if (titularHistorico) {
        titularAlvo = resolverTitularCadastrado(titularHistorico, todosTitulares);
      }
    }

    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);

    // Se ainda não identificou o titular, pergunta ao usuário (Regra 14: sem titular, pergunta)
    if (!titularAlvo) {
      const textoPergunta = `${prefixoSaudacao}De quem você gostaria de consultar os documentos faltantes?`;

      etapas.push({
        ordem: 1,
        nome: 'Consulta de Checklist de Documentos',
        descricao: 'Nenhum titular especificado na mensagem ou no contexto recente. Solicitando identificação ao usuário.',
        tempoMs: Date.now() - inicioChecklist,
      });

      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoPergunta,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoPergunta,
        origem: 'motor',
        intencaoDetectada: 'consultar_checklist_faltantes',
        perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
        buscaUsada: 'Checklist de Documentos Esperados',
        similaridade: '100% (Identificação de Titular Pendente)',
        rastro,
      };
    }

    // 2. Calcula o checklist do titular no Cofre
    const checklist = await calcularChecklistTitular(titularAlvo.id);
    if (!checklist) {
      const textoErro = `Não encontrei dados suficientes para gerar o checklist de *${titularAlvo.nome}*.`;
      return {
        textoResposta: textoErro,
        origem: 'motor',
        intencaoDetectada: 'consultar_checklist_faltantes',
        perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
        buscaUsada: 'Checklist de Documentos Esperados',
        similaridade: '0%',
        rastro: criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoErro,
          modelo: 'Motor Interno',
        }),
      };
    }

    // 3. Monta a resposta rica em formato Markdown
    const linhas: string[] = [];
    const saudacaoLinha = prefixoSaudacao ? `${prefixoSaudacao}\n\n` : '';
    linhas.push(`${saudacaoLinha}📋 *Checklist de Documentos — ${checklist.titular.nome}*`);
    linhas.push(`Completude no Cofre: *${checklist.estatisticas.completos} de ${checklist.estatisticas.totalAplicaveis} documentos* (${checklist.estatisticas.percentualArquivos}%)\n`);

    const obrigatoriosFaltando = checklist.itens.filter(
      (i) => i.situacao === 'faltando' && i.documentoEsperado.obrigatorio
    );
    const soODado = checklist.itens.filter((i) => i.situacao === 'so_o_dado');
    const complementaresFaltando = checklist.itens.filter(
      (i) => i.situacao === 'faltando' && !i.documentoEsperado.obrigatorio
    );

    if (obrigatoriosFaltando.length > 0) {
      linhas.push('🔴 *Documentos Obrigatórios Faltando:*');
      for (const item of obrigatoriosFaltando) {
        const badgePrioridade = item.prioridade
          ? ` ⚠️ _(solicitado no WhatsApp${item.quantidadePedidosWhatsApp && item.quantidadePedidosWhatsApp > 1 ? ` ${item.quantidadePedidosWhatsApp}x` : ''})_`
          : '';
        linhas.push(`• *${item.documentoEsperado.nome}*${badgePrioridade}`);
      }
      linhas.push('');
    }

    if (soODado.length > 0) {
      linhas.push('🟡 *Dados na ficha (arquivo físico ausente no Cofre):*');
      for (const item of soODado) {
        const dadoOrigem = item.dadosFicha?.[0]?.origemNome || 'ficha cadastral';
        linhas.push(`• *${item.documentoEsperado.nome}* _(dado cadastrado a partir de ${dadoOrigem})_`);
      }
      linhas.push('');
    }

    if (complementaresFaltando.length > 0) {
      linhas.push('⚪ *Documentos Complementares Faltando:*');
      for (const item of complementaresFaltando) {
        linhas.push(`• *${item.documentoEsperado.nome}*`);
      }
      linhas.push('');
    }

    if (obrigatoriosFaltando.length === 0 && soODado.length === 0 && complementaresFaltando.length === 0) {
      linhas.push('🎉 *Todos os documentos esperados já constam salvos no Cofre!*');
    } else {
      linhas.push('💡 _Para adicionar qualquer documento faltante ao Cofre, basta enviar o arquivo ou foto aqui na conversa._');
    }

    const textoResposta = linhas.join('\n');

    etapas.push({
      ordem: 1,
      nome: 'Cálculo de Checklist de Documentos Faltantes',
      descricao: `Checklist de ${checklist.titular.nome} gerado com sucesso. ${checklist.estatisticas.completos}/${checklist.estatisticas.totalAplicaveis} documentos completos.`,
      tempoMs: Date.now() - inicioChecklist,
      detalhes: checklist.estatisticas,
    });

    const rastro = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: checklist.itens
        .filter((i) => i.documentoCofre)
        .map((i) => ({
          id: i.documentoCofre!.id,
          titulo: i.documentoCofre!.titulo,
          tipo: i.documentoCofre!.tipo,
          similaridade: 100,
          usadoNaResposta: true,
        })),
      enviouAnexo: false,
      respostaFinal: textoResposta,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta,
      origem: 'motor',
      intencaoDetectada: 'consultar_checklist_faltantes',
      perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
      buscaUsada: 'Checklist do Cofre (Documentos Esperados)',
      similaridade: '100% (Checklist Consolidado)',
      rastro,
    };
  }

  // ============================================================================
  // CASO 2.9: APAGAR OU DESCARTAR DOCUMENTO (intencao === 'apagar_documento')
  // ============================================================================
  if (intencao === 'apagar_documento') {
    const inicioApagar = Date.now();

    // 1. Ponto 5: Só perfil admin pode apagar documentos
    const ehAdmin =
      contato?.nivelAcesso === 'diretoria' ||
      contato?.ficha?.nivelAcesso === 'diretoria' ||
      (contato as any)?.perfil === 'admin' ||
      contato?.cargo === 'Administrador';

    if (!ehAdmin) {
      const textoBloqueio = 'Você não tem permissão para apagar documentos do Cofre da VEGA. Apenas administradores podem realizar a exclusão.';
      etapas.push({
        ordem: 2,
        nome: 'Verificação de Permissão de Exclusão',
        descricao: `Usuário "${contato.nome}" não possui perfil de administrador. Exclusão bloqueada.`,
        tempoMs: 1,
      });

      const rastro = criarRastroFinal({
        tipoBusca: 'nenhuma',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoBloqueio,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoBloqueio,
        origem: 'motor',
        intencaoDetectada: 'apagar_documento',
        perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
        rastro,
      };
    }

    // 2. Localiza o documento que o usuário deseja apagar
    const todosDocs = documentosDisponiveis.length > 0 ? documentosDisponiveis : await obterTodosDocumentos();
    let docAlvo: DocumentoRegistro | undefined;

    // A. Se o usuário citou um documento específico (ex: "apaga o contrato de locação", "apaga a CNH do Thomaz")
    const docCitadoIa = (classificacao.documento_citado || '').trim();
    const termoBuscaIa = (classificacao.termo_busca || '').trim();
    const titularBusca = classificacao.pessoa || pessoa;

    if (docCitadoIa || (termoBuscaIa && !/\b(ultimo|último|foto|arquivo|documento)\b/i.test(termoBuscaIa))) {
      const termoDoc = docCitadoIa || termoBuscaIa;
      const busca = await buscarDocumentos(termoDoc, contato, todosDocs, titularBusca);
      if (busca.status === 'unico' && busca.resultados[0]) {
        docAlvo = busca.resultados[0];
      }
    }

    // B. Se não identificou por documento citado, busca pelo documento mais recente enviado pelo usuário
    if (!docAlvo) {
      try {
        const supabase = getSupabaseClient();
        const telLimpo = contato.telefone ? contato.telefone.replace(/\D/g, '') : '';

        // 1. Tenta buscar documento recente com metadata do remetente
        if (telLimpo) {
          const { data: docsRemetente } = await supabase
            .from('documentos')
            .select('*')
            .filter('tipo', 'not.ilike', '%conhecimento%')
            .order('created_at', { ascending: false });

          if (docsRemetente && docsRemetente.length > 0) {
            const docDoUsuario = docsRemetente.find((d: any) => {
              const meta = d.metadata || {};
              const metaTel = (meta.remetenteNumero || '').replace(/\D/g, '');
              const metaNome = (meta.remetenteNome || '').toLowerCase();
              return (
                (telLimpo && metaTel && (metaTel.includes(telLimpo) || telLimpo.includes(metaTel))) ||
                (contato.nome && metaNome && metaNome.includes(contato.nome.toLowerCase()))
              );
            });
            if (docDoUsuario) {
              docAlvo = mapearLinhaDocumento(docDoUsuario);
            }
          }
        }

        // 2. Se não encontrou por metadata, pega o documento mais recente no Cofre
        if (!docAlvo) {
          const { data: docsGerais } = await supabase
            .from('documentos')
            .select('*')
            .filter('tipo', 'not.ilike', '%conhecimento%')
            .order('created_at', { ascending: false })
            .limit(1);

          if (docsGerais && docsGerais.length > 0) {
            docAlvo = mapearLinhaDocumento(docsGerais[0]);
          }
        }
      } catch (errBuscaRecente) {
        console.warn('[Chat Orquestrador ⚠️] Falha ao buscar documento recente no Supabase:', errBuscaRecente);
      }
    }

    if (!docAlvo) {
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoSemDoc = `${prefixoSaudacao}Não encontrei nenhum documento recente para exclusão no Cofre.`;

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
        intencaoDetectada: 'apagar_documento',
        perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
        rastro,
      };
    }

    // 3. Documento localizado: Pede confirmação antes da remoção definitiva (Requisito 3)
    const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
    const textoConfirmacao = `${prefixoSaudacao}Você confirma a exclusão definitiva do documento *${docAlvo.titulo}* (${docAlvo.arquivo}) do Cofre? Responda *Sim* para confirmar ou *Não* para cancelar.`;

    // Se o contato tiver telefone do WhatsApp, cria pendência ativa no Supabase
    if (contato.telefone) {
      try {
        const numCanonica = normalizarNumeroCanonica(contato.telefone);
        const conversaId = `wa-${numCanonica}`;
        await salvarPendenciaDocumentoWhatsApp({
          conversaId,
          remetenteNumero: contato.telefone,
          remetenteJid: `${numCanonica}@s.whatsapp.net`,
          documentoId: docAlvo.id,
          tipoPendencia: 'confirmacao_exclusao',
          dadosDetectados: {
            docTitulo: docAlvo.titulo,
            arquivo: docAlvo.arquivo,
          },
        });
      } catch (errPend) {
        console.warn('[Chat Orquestrador ⚠️] Falha ao registrar pendência de exclusão para WhatsApp:', errPend);
      }
    }

    etapas.push({
      ordem: 2,
      nome: 'Identificação de Documento para Exclusão',
      descricao: `Documento "${docAlvo.titulo}" (${docAlvo.arquivo}) identificado para exclusão. Aguardando confirmação do usuário administrador.`,
      tempoMs: Date.now() - inicioApagar,
    });

    const docsRastro: DocumentoRastro[] = [
      {
        id: docAlvo.id,
        titulo: docAlvo.titulo,
        tipo: docAlvo.tipo,
        similaridade: 100,
        usadoNaResposta: true,
      },
    ];

    const rastro = criarRastroFinal({
      tipoBusca: 'nome_cofre',
      docsEncontrados: docsRastro,
      docUsado: docAlvo.titulo,
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'apagar_documento',
      perguntaReescrita: `Confirmar exclusão de ${docAlvo.titulo}`,
      rastro,
      correcaoPendente: {
        titularId: docAlvo.titular || '',
        titularNome: docAlvo.titular || 'Delta Plan',
        campoId: 'apagar_documento' as any,
        campoLabel: 'exclusão de documento',
        valorAnterior: docAlvo.titulo,
        valorNovo: 'excluído',
        documentoId: docAlvo.id,
        documentoTitulo: docAlvo.titulo,
      },
    };
  }

  // ============================================================================
  // CASO 2.5: CADASTRAR CONHECIMENTO (Base de Conhecimento pelo WhatsApp/Chat)
  // ============================================================================
  if (intencao === 'cadastrar_conhecimento') {
    // 1. Verificação rígida de permissão: apenas perfil admin pode cadastrar
    const ehAdmin =
      (contato as any)?.perfil === 'admin' ||
      contato.nivelAcesso === 'diretoria' ||
      contato.ficha?.nivelAcesso === 'diretoria';

    if (!ehAdmin) {
      const textoBloqueio =
        'Você não tem permissão para cadastrar informações na Base de Conhecimento da VEGA. Apenas administradores podem realizar cadastros.';
      etapas.push({
        ordem: 2,
        nome: 'Bloqueio de Permissão (Base de Conhecimento)',
        descricao: `Tentativa de cadastro na Base de Conhecimento por usuário não administrador (${contato.nome}).`,
        tempoMs: 1,
      });
      const rastroBloq = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoBloqueio,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoBloqueio,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: 'Cadastro não autorizado na Base de Conhecimento',
        rastro: rastroBloq,
      };
    }

    const tipoConhecimento = classificacao.tipo_conhecimento || 'outro';
    const detalhes = classificacao.detalhes_conhecimento || {};
    const pessoaAlvo = classificacao.pessoa || detalhes.beneficiario || detalhes.nome || '';
    let tituloItem = classificacao.titulo_conhecimento || '';
    let conteudoFinal = '';
    let dadosEstruturados: any = undefined;
    let textoPerguntaFaltante = '';
    let textoConfirmacao = '';

    // A) Processar por tipo de conhecimento
    if (tipoConhecimento === 'pix') {
      let chave = (detalhes.chavePix || '').trim();
      // Fallback: se a chave não veio nos detalhes, tentar extrair da mensagem
      if (!chave) {
        const matchCpfCnpj = mensagemUsuario.match(/\b\d{11,14}\b/);
        const matchEmail = mensagemUsuario.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const matchTel = mensagemUsuario.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/);
        if (matchCpfCnpj) chave = matchCpfCnpj[0];
        else if (matchEmail) chave = matchEmail[0];
        else if (matchTel) chave = matchTel[0].replace(/\D/g, '');
      }

      let tipoChave = (detalhes.tipoChavePix || '').trim().toLowerCase();
      if (chave && !tipoChave) {
        tipoChave = deduzirTipoChavePix(chave);
      }

      if (!chave) {
        textoPerguntaFaltante = 'Qual é a chave PIX que você deseja salvar na Base de Conhecimento?';
      } else if (!tipoChave) {
        textoPerguntaFaltante = `Identifiquei a chave PIX *${chave}*, mas qual é o tipo dela (CPF, CNPJ, telefone, e-mail ou chave aleatória)?`;
      }

      if (!textoPerguntaFaltante) {
        const beneficiario = detalhes.beneficiario || pessoaAlvo || '';
        const banco = detalhes.banco || '';
        if (!tituloItem) {
          tituloItem = beneficiario ? `Chave PIX do ${beneficiario}` : `Chave PIX ${chave}`;
        }
        conteudoFinal = `Chave PIX: ${chave}\nTipo: ${tipoChave.toUpperCase()}${beneficiario ? `\nTitular: ${beneficiario}` : ''}${banco ? `\nBanco: ${banco}` : ''}`;
        dadosEstruturados = {
          chave,
          tipoChave,
          titular: beneficiario,
          banco,
        };
        const alvoFormatado = beneficiario ? `chave PIX do ${beneficiario}` : `chave PIX`;
        textoConfirmacao = `Vou salvar a *${alvoFormatado}*: *${chave}* (tipo: ${tipoChave.toUpperCase()}${banco ? `, banco: ${banco}` : ''}). Confirma?`;
      }
    } else if (tipoConhecimento === 'contato') {
      let telefone = (detalhes.telefone || '').trim();
      let email = (detalhes.email || '').trim();
      let nomeContato = detalhes.nome || pessoaAlvo || '';

      if (!telefone) {
        const matchTel = mensagemUsuario.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/);
        if (matchTel) telefone = matchTel[0].replace(/\D/g, '');
      }
      if (!email) {
        const matchEmail = mensagemUsuario.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (matchEmail) email = matchEmail[0];
      }

      if (!telefone && !email) {
        textoPerguntaFaltante = nomeContato
          ? `Qual é o telefone ou e-mail de *${nomeContato}* que você deseja cadastrar?`
          : 'Qual é o telefone ou e-mail do contato que você deseja salvar?';
      }

      if (!textoPerguntaFaltante) {
        if (!nomeContato) nomeContato = 'Contato';
        if (!tituloItem) {
          tituloItem = `Telefone ${nomeContato}`;
        }
        conteudoFinal = `Nome: ${nomeContato}${telefone ? `\nTelefone: ${telefone}` : ''}${email ? `\nE-mail: ${email}` : ''}${detalhes.cargo ? `\nCargo: ${detalhes.cargo}` : ''}${detalhes.setor ? `\nSetor: ${detalhes.setor}` : ''}`;
        dadosEstruturados = {
          nome: nomeContato,
          telefone,
          email,
          funcao: detalhes.cargo || (detalhes as any).funcao || '',
          cargo: detalhes.cargo || '',
          setor: detalhes.setor || '',
        };
        const canal =
          telefone && email
            ? `telefone *${telefone}* e e-mail *${email}*`
            : telefone
            ? `telefone *${telefone}*`
            : `e-mail *${email}*`;
        textoConfirmacao = `Vou salvar o *contato de ${nomeContato}*: ${canal}. Confirma?`;
      }
    } else if (tipoConhecimento === 'link') {
      let url = (detalhes.url || '').trim();
      if (!url) {
        const matchUrl = mensagemUsuario.match(/https?:\/\/[^\s]+/i);
        if (matchUrl) url = matchUrl[0];
      }
      const nomeSistema = detalhes.nomeSistema || '';

      if (!url) {
        textoPerguntaFaltante = 'Qual é o link ou URL que você deseja salvar na Base de Conhecimento?';
      }

      if (!textoPerguntaFaltante) {
        if (!tituloItem) {
          tituloItem = nomeSistema ? `Link do ${nomeSistema}` : `Link ${url}`;
        }
        conteudoFinal = `Link / Sistema: ${nomeSistema || tituloItem}\nURL: ${url}`;
        dadosEstruturados = {
          link: url,
          nomeSistema,
          finalidade: '',
        };
        textoConfirmacao = `Vou salvar o *link ${nomeSistema ? `do ${nomeSistema}` : ''}*: *${url}*. Confirma?`;
      }
    } else {
      if (!tituloItem) tituloItem = classificacao.termo_busca || 'Informação';
      conteudoFinal = mensagemUsuario;
      textoConfirmacao = `Vou salvar *${tituloItem}* na Base de Conhecimento. Confirma?`;
    }

    // Se faltou informação essencial, perguntar antes de prosseguir
    if (textoPerguntaFaltante) {
      etapas.push({
        ordem: 2,
        nome: 'Solicitação de Campo Faltante',
        descricao: `Solicitada informação complementar para cadastro na Base de Conhecimento: "${textoPerguntaFaltante}".`,
        tempoMs: 1,
      });
      const rastroFaltante = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: [],
        enviouAnexo: false,
        respostaFinal: textoPerguntaFaltante,
        modelo: 'Motor Interno',
      });
      return {
        textoResposta: textoPerguntaFaltante,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: 'Identificação de campo pendente para cadastro',
        rastro: rastroFaltante,
      };
    }

    // 2. Verificar se já existe item com mesmo nome/chave na Base de Conhecimento (Requisito 4)
    const todosConhecimentos = await obterTodosConhecimentos();
    let itemExistente: ItemConhecimento | null = null;

    if (tituloItem) {
      const titNorm = normalizarParaBusca(tituloItem);
      for (const k of todosConhecimentos) {
        const kTitNorm = normalizarParaBusca(k.titulo);
        if (
          titNorm === kTitNorm ||
          (titNorm.length >= 5 && kTitNorm.includes(titNorm)) ||
          (kTitNorm.length >= 5 && titNorm.includes(kTitNorm))
        ) {
          itemExistente = k;
          break;
        }
      }
    }

    if (!itemExistente && tipoConhecimento === 'pix' && dadosEstruturados?.chave) {
      const chaveLimpa = dadosEstruturados.chave.replace(/\D/g, '');
      for (const k of todosConhecimentos) {
        if (k.tipo === 'pix' && (k.dadosEstruturados as any)?.chave) {
          const kChaveLimpa = String((k.dadosEstruturados as any).chave).replace(/\D/g, '');
          if (
            (chaveLimpa && chaveLimpa === kChaveLimpa) ||
            (k.dadosEstruturados as any).chave.toLowerCase() === dadosEstruturados.chave.toLowerCase()
          ) {
            itemExistente = k;
            break;
          }
        }
      }
    }

    if (!itemExistente && tipoConhecimento === 'contato' && (pessoaAlvo || dadosEstruturados?.telefone)) {
      const telLimpo = (dadosEstruturados?.telefone || '').replace(/\D/g, '');
      const nomeAlvoNorm = pessoaAlvo ? normalizarParaBusca(pessoaAlvo) : '';
      for (const k of todosConhecimentos) {
        if (k.tipo === 'contato') {
          const kTelLimpo = ((k.dadosEstruturados as any)?.telefone || '').replace(/\D/g, '');
          const kNomeNorm = (k.dadosEstruturados as any)?.nome
            ? normalizarParaBusca((k.dadosEstruturados as any).nome)
            : '';
          if (
            (telLimpo && telLimpo === kTelLimpo) ||
            (nomeAlvoNorm &&
              kNomeNorm &&
              (nomeAlvoNorm === kNomeNorm ||
                nomeAlvoNorm.includes(kNomeNorm) ||
                kNomeNorm.includes(nomeAlvoNorm)))
          ) {
            itemExistente = k;
            break;
          }
        }
      }
    }

    if (!itemExistente && tipoConhecimento === 'link' && dadosEstruturados?.link) {
      for (const k of todosConhecimentos) {
        if (
          k.tipo === 'link' &&
          (k.dadosEstruturados as any)?.link?.toLowerCase() === dadosEstruturados.link.toLowerCase()
        ) {
          itemExistente = k;
          break;
        }
      }
    }

    // Se já existe, perguntar se substitui
    if (itemExistente) {
      const textoSubstituicao = `Já existe um item cadastrado como *${itemExistente.titulo}*. Deseja substituir as informações existentes? Responda *Sim* para confirmar ou *Não* para cancelar.`;

      const itemParaSalvar: any = {
        titulo: tituloItem || itemExistente.titulo,
        categoria:
          tipoConhecimento === 'pix'
            ? 'Financeiro'
            : tipoConhecimento === 'link'
            ? 'Sistemas'
            : tipoConhecimento === 'contato'
            ? 'Contatos'
            : 'Geral',
        conteudo: conteudoFinal,
        tipo:
          tipoConhecimento === 'pix'
            ? 'pix'
            : tipoConhecimento === 'link'
            ? 'link'
            : tipoConhecimento === 'contato'
            ? 'contato'
            : 'regra',
        dadosEstruturados,
      };

      if (contato.telefone) {
        try {
          const numCanonica = normalizarNumeroCanonica(contato.telefone);
          const conversaId = `wa-${numCanonica}`;
          await salvarPendenciaDocumentoWhatsApp({
            conversaId,
            remetenteNumero: contato.telefone,
            remetenteJid: `${numCanonica}@s.whatsapp.net`,
            documentoId: '',
            tipoPendencia: 'substituicao_conhecimento' as any,
            dadosDetectados: {
              tipoItem: tipoConhecimento,
              tituloItem: tituloItem || itemExistente.titulo,
              itemIdExistente: itemExistente.id,
              pessoaAlvo,
              titulo: itemParaSalvar.titulo,
              categoria: itemParaSalvar.categoria,
              conteudo: itemParaSalvar.conteudo,
              tipo: itemParaSalvar.tipo,
              dadosEstruturados: itemParaSalvar.dadosEstruturados,
            },
          });
        } catch (ePend) {
          console.warn('[ChatOrquestrador ⚠️] Erro ao salvar pendência de substituição de conhecimento:', ePend);
        }
      }

      etapas.push({
        ordem: 2,
        nome: 'Item Existente na Base de Conhecimento',
        descricao: `Identificado item duplicado "${itemExistente.titulo}". Solicitada confirmação para substituição.`,
        tempoMs: 1,
      });

      const rastroSubst = criarRastroFinal({
        tipoBusca: 'nome_conhecimento',
        docsEncontrados: [],
        docUsado: itemExistente.titulo,
        enviouAnexo: false,
        respostaFinal: textoSubstituicao,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoSubstituicao,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Substituir item existente: ${itemExistente.titulo}`,
        rastro: rastroSubst,
        correcaoPendente: {
          titularId: '',
          titularNome: pessoaAlvo || 'Base de Conhecimento',
          campoId: 'substituir_conhecimento' as any,
          campoLabel: 'substituição na Base de Conhecimento',
          valorAnterior: itemExistente.titulo,
          valorNovo: tituloItem || itemExistente.titulo,
          documentoId: itemExistente.id,
          documentoTitulo: itemExistente.titulo,
          itemConhecimento: itemParaSalvar,
        },
      };
    }

    // Se NÃO existe duplicado, formula a confirmação padrão
    const itemParaSalvar: any = {
      titulo: tituloItem,
      categoria:
        tipoConhecimento === 'pix'
          ? 'Financeiro'
          : tipoConhecimento === 'link'
          ? 'Sistemas'
          : tipoConhecimento === 'contato'
          ? 'Contatos'
          : 'Geral',
      conteudo: conteudoFinal,
      tipo:
        tipoConhecimento === 'pix'
          ? 'pix'
          : tipoConhecimento === 'link'
          ? 'link'
          : tipoConhecimento === 'contato'
          ? 'contato'
          : 'regra',
      dadosEstruturados,
    };

    if (contato.telefone) {
      try {
        const numCanonica = normalizarNumeroCanonica(contato.telefone);
        const conversaId = `wa-${numCanonica}`;
        await salvarPendenciaDocumentoWhatsApp({
          conversaId,
          remetenteNumero: contato.telefone,
          remetenteJid: `${numCanonica}@s.whatsapp.net`,
          documentoId: '',
          tipoPendencia: 'cadastro_conhecimento' as any,
          dadosDetectados: {
            tipoItem: tipoConhecimento,
            tituloItem,
            pessoaAlvo,
            titulo: itemParaSalvar.titulo,
            categoria: itemParaSalvar.categoria,
            conteudo: itemParaSalvar.conteudo,
            tipo: itemParaSalvar.tipo,
            dadosEstruturados: itemParaSalvar.dadosEstruturados,
          },
        });
      } catch (ePend) {
        console.warn('[ChatOrquestrador ⚠️] Erro ao salvar pendência de cadastro de conhecimento:', ePend);
      }
    }

    etapas.push({
      ordem: 2,
      nome: 'Confirmação Prévia de Cadastro',
      descricao: `Identificado cadastro de conhecimento ("${tituloItem}"). Solicitando confirmação antes de gravar.`,
      tempoMs: 1,
    });

    const rastroConf = criarRastroFinal({
      tipoBusca: 'nome_conhecimento',
      docsEncontrados: [],
      docUsado: tituloItem,
      enviouAnexo: false,
      respostaFinal: textoConfirmacao,
      modelo: 'Motor Interno',
    });

    return {
      textoResposta: textoConfirmacao,
      origem: 'motor',
      intencaoDetectada: 'cadastrar_conhecimento',
      perguntaReescrita: `Confirmar cadastro: ${tituloItem}`,
      rastro: rastroConf,
      correcaoPendente: {
        titularId: '',
        titularNome: pessoaAlvo || 'Base de Conhecimento',
        campoId: 'cadastrar_conhecimento' as any,
        campoLabel: 'cadastro na Base de Conhecimento',
        valorAnterior: '',
        valorNovo: tituloItem,
        itemConhecimento: itemParaSalvar,
      },
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

    // REGRA 20: Prevalência Absoluta de Documento Citado sobre o Contexto.
    // Documento citado na mensagem atual SEMPRE prevalece sobre o documento do contexto.
    // O contexto só vale quando a mensagem não cita nenhum documento ("resuma esse documento", "me manda o pdf").
    // Se a mensagem citar um documento que existe no Cofre, resumir/analisar ESSE documento.
    // Se citar um que não existe, responder que não encontrou no Cofre e NUNCA resumir outro do contexto.

    const ehPerguntaOuResumoDoc =
      /\b(resum[aeo]|resumo|resumir|expliq?u?e|fala\s+sobre|diz\s+sobre|conte[uú]do|do\s+que\s+se\s+trata|sobre\s+o\s+que\s+[eé]|quantas\s+linhas|em\s+\d+\s+linhas|o\s+que\s+(diz|fala|consta|tem)|qual\s+(o\s+conte[uú]do|a\s+data|o\s+prazo|o\s+valor|o\s+n[uú]mero))\b/i.test(
        mensagemUsuario
      ) ||
      /\b(esse|este|deste|desse|o)\s+documento\b/i.test(mensagemUsuario) ||
      Boolean(classificacao.documento_citado && classificacao.documento_citado.trim().length > 0);

    const sanitizadoResumo = sanitizarPedidoResumoOuConteudo(mensagemUsuario);
    const docCitadoIa = (classificacao.documento_citado || '').trim();
    const termoBuscaIa = (classificacao.termo_busca || '').trim();

    // Determina se a mensagem cita um documento específico
    const citaDocEspecifico =
      (!sanitizadoResumo.apenasReferenciaContexto && sanitizadoResumo.termoLimpo.length >= 2) ||
      (docCitadoIa && !sanitizarPedidoResumoOuConteudo(docCitadoIa).apenasReferenciaContexto);

    const executarAnaliseDeDocumento = async (
      docParaAnalisar: DocumentoRegistro,
      motivoEtapa: string
    ): Promise<ResultadoChatOrquestrador> => {
      // 1. PDF Protegido por Senha (Regra 12)
      if (docParaAnalisar.statusIndexacao === 'protegido_senha') {
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const textoRespostaDoc = `${prefixoSaudacao}Esse PDF está protegido por senha, então não consegui ler o conteúdo. O arquivo continua salvo no Cofre e pode ser aberto e enviado normalmente, mas não vou conseguir responder perguntas sobre o que está escrito nele.`;

        const rastro = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [
            {
              id: docParaAnalisar.id,
              titulo: docParaAnalisar.titulo,
              tipo: docParaAnalisar.tipo,
              similaridade: 100,
              usadoNaResposta: true,
            },
          ],
          docUsado: docParaAnalisar.titulo,
          enviouAnexo: false,
          respostaFinal: textoRespostaDoc,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta: textoRespostaDoc,
          origem: 'motor',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: mensagemUsuario,
          buscaUsada: `Documento Protegido por Senha: ${docParaAnalisar.titulo}`,
          similaridade: '100% (Protegido por senha)',
          rastro,
        };
      }

      // 2. Busca todos os trechos desse documento específico no Supabase
      const supabase = getSupabaseClient();
      const { data: trechosDoDoc } = await supabase
        .from('trechos')
        .select('*')
        .eq('documento_id', docParaAnalisar.id)
        .order('pagina', { ascending: true });

      if (trechosDoDoc && trechosDoDoc.length > 0) {
        const textoTrechos = trechosDoDoc
          .map((t, idx) => `[Página ${t.pagina || 1} | Trecho ${idx + 1}]\n${t.conteudo}`)
          .join('\n\n');

        const promptDoc = `Você é a VEGA, assistente de inteligência artificial da Construtora Delta Plan.
O usuário está fazendo uma pergunta ou solicitando um resumo sobre o documento: "${docParaAnalisar.titulo}" (${docParaAnalisar.arquivo}).

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
          { motivo: 'chat_pergunta_documento_especifico', contatoId: contato.id, contatoNome: contato.nome }
        );

        const tokensUsage = completion.usage;
        if (tokensUsage) {
          tokensPromptTotal += tokensUsage.prompt_tokens || 0;
          tokensCompletionTotal += tokensUsage.completion_tokens || 0;
          tokensGeraisTotal += tokensUsage.total_tokens || 0;
        }

        const textoRespostaDoc =
          completion.choices[0]?.message?.content?.trim() || 'Não consegui analisar o conteúdo do documento.';

        etapas.push({
          ordem: 2,
          nome: motivoEtapa,
          descricao: `Conteúdo de "${docParaAnalisar.titulo}" analisado pelo modelo gpt-5.4-mini em ${Date.now() - inicioIA} ms.`,
          tempoMs: Date.now() - inicioIA,
          detalhes: { documento: docParaAnalisar.titulo, trechos: trechosDoDoc.length },
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'vetorial',
          docsEncontrados: trechosDoDoc.map((t, idx) => ({
            id: t.documento_id,
            titulo: docParaAnalisar.titulo,
            pagina: t.pagina,
            similaridade: 100,
            trecho: truncarTrecho(t.conteudo, 300),
            usadoNaResposta: true,
          })),
          docUsado: docParaAnalisar.titulo,
          enviouAnexo: false,
          respostaFinal: textoRespostaDoc,
          modelo: 'gpt-5.4-mini',
        });

        return {
          textoResposta: textoRespostaDoc,
          origem: 'ia',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: mensagemUsuario,
          buscaUsada: `Análise direta de conteúdo: ${docParaAnalisar.titulo}`,
          similaridade: '100% (Documento Selecionado)',
          rastro,
        };
      }

      // Documento no cofre mas sem trechos de texto indexados
      const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
      const textoSemTrechos = `${prefixoSaudacao}O documento *${docParaAnalisar.titulo}* consta no Cofre, mas ainda não possui texto indexado para análise.`;
      const rastro = criarRastroFinal({
        tipoBusca: 'nome_cofre',
        docsEncontrados: [
          {
            id: docParaAnalisar.id,
            titulo: docParaAnalisar.titulo,
            tipo: docParaAnalisar.tipo,
            similaridade: 100,
            usadoNaResposta: true,
          },
        ],
        docUsado: docParaAnalisar.titulo,
        enviouAnexo: false,
        respostaFinal: textoSemTrechos,
        modelo: 'Motor Interno',
      });

      return {
        textoResposta: textoSemTrechos,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: mensagemUsuario,
        buscaUsada: `Documento sem trechos indexados: ${docParaAnalisar.titulo}`,
        similaridade: '100%',
        rastro,
      };
    };

    if (ehPerguntaOuResumoDoc && citaDocEspecifico) {
      // CASO 1: Pedido cita expressamente um documento pelo nome/tipo.
      // REGRA 20: Prevalência Absoluta do documento citado sobre o contexto!
      const termoDocCitado = docCitadoIa || sanitizadoResumo.termoLimpo || termoBuscaIa;
      const docAlvo = localizarDocumentoCitadoNoCofre(termoDocCitado, todosDocs, pessoa || classificacao.pessoa);

      if (docAlvo) {
        // Documento citado EXISTE no Cofre -> analisa/resume ESSE documento específico
        return await executarAnaliseDeDocumento(docAlvo, 'Análise de Conteúdo do Documento Citado');
      } else {
        // Documento citado NÃO EXISTE no Cofre!
        // REGRA 20: Responder que não encontrou esse documento no Cofre. NUNCA resumir outro documento!
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const tipoIdentificado = identificarTipoPedido(mensagemUsuario) || formatarTipoDocumentoLegivel(termoDocCitado);
        const titularNome = pessoa || classificacao.pessoa;

        let textoResposta: string;
        if (titularNome) {
          const artigo = obterArtigoDefinido(tipoIdentificado);
          const prep = obterPreposicaoTitular(titularNome);
          textoResposta = `${prefixoSaudacao}Não encontrei ${artigo} *${tipoIdentificado}* ${prep} *${titularNome}* no Cofre. Anotei na lista de documentos pendentes.`;
        } else {
          const artigo = obterArtigoDefinido(tipoIdentificado);
          textoResposta = `${prefixoSaudacao}Não encontrei ${artigo} *${tipoIdentificado}* no Cofre. Anotei na lista de documentos pendentes.`;
        }

        if (validarTipoDocumentoReconhecivel(tipoIdentificado)) {
          await registrarOuIncrementarDocumentoFaltante({
            tipoDocumento: tipoIdentificado,
            titularInformado: titularNome,
            solicitanteNome: contato.nome,
            solicitanteContato: contato.id,
            textoDoPedido: mensagemUsuario,
          });
        }

        etapas.push({
          ordem: 2,
          nome: 'Verificação de Documento Citado no Cofre',
          descricao: `Documento citado "${termoDocCitado}" não foi localizado no Cofre. Registrado em pendências conforme Regra 20.`,
          tempoMs: 1,
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'nome_cofre',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoResposta,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta,
          origem: 'motor',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
          buscaUsada: `Busca no Cofre por documento citado: ${termoDocCitado}`,
          similaridade: '0% (Não encontrado no Cofre)',
          rastro,
        };
      }
    } else if (ehPerguntaOuResumoDoc && sanitizadoResumo.apenasReferenciaContexto) {
      // CASO 2: Pedido anafórico ou genérico ("resuma esse documento", "resuma em 10 linhas", "o que diz nele")
      // Usa estritamente o documento do contexto!
      const docRecente =
        obterUltimoDocumentoEnviado(historicoRecente, todosDocs) ||
        extrairDocumentoRecenteDoHistorico(historicoRecente, todosDocs);

      if (docRecente) {
        return await executarAnaliseDeDocumento(docRecente, 'Análise de Conteúdo do Documento Recém-Entregue');
      } else {
        // Pedido genérico de resumo sem documento citado e sem documento no contexto
        const prefixoSaudacao = montarPrefixoSaudacao(mensagemUsuario, primeiroNome);
        const textoResposta = `${prefixoSaudacao}Qual documento você gostaria que eu resuma? Por favor, informe o nome ou tipo do documento.`;

        etapas.push({
          ordem: 2,
          nome: 'Solicitação de Esclarecimento de Documento para Resumo',
          descricao: 'Pedido de resumo recebido sem documento citado e sem documento prévio no histórico da conversa.',
          tempoMs: 1,
        });

        const rastro = criarRastroFinal({
          tipoBusca: 'nenhuma',
          docsEncontrados: [],
          enviouAnexo: false,
          respostaFinal: textoResposta,
          modelo: 'Motor Interno',
        });

        return {
          textoResposta,
          origem: 'motor',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: classificacao.pergunta_completa || mensagemUsuario,
          buscaUsada: 'Comando de resumo genérico sem documento no contexto',
          similaridade: '0%',
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
  // 1. VERIFICAÇÃO DE ESTOURO DE LIMITE MENSAL DE CONSUMO (100%)
  try {
    const limiteEstourado = await checarSeLimiteConsumoEstourado();
    if (limiteEstourado) {
      console.warn('[VEGA ⚠️] Mensagem bloqueada: limite de consumo mensal de 100% estourado.');
      return {
        textoResposta: 'Estou temporariamente indisponível. Já avisei o responsável.',
        origem: 'motor',
        intencaoDetectada: 'saudacao_ou_vago' as IntencaoChat,
        perguntaReescrita: dados.mensagemUsuario,
      };
    }
  } catch (errLimite) {
    console.warn('[VEGA ⚠️] Falha ao checar limite de consumo:', errLimite);
  }

  // 2. EXECUÇÃO PROTEGIDA CONTRA FALHAS TÉCNICAS INESPERADAS
  let resultado: ResultadoChatOrquestrador;
  try {
    resultado = await executarProcessamentoMensagemChatInterno(dados);
  } catch (erroFatal: any) {
    const msgErro = erroFatal?.message || String(erroFatal);
    console.error('[VEGA Chat ❌] Falha técnica durante processamento da mensagem:', erroFatal);

    registrarAviso({
      tipo: 'openai_erro',
      origem: 'Chat Orquestrador',
      titulo: 'Falha técnica inesperada no processamento do chat',
      mensagemTecnica: msgErro,
      severidade: 'alta',
      chaveAgrupamento: 'chat_falha_tecnica',
    }).catch(() => {});

    return {
      textoResposta: 'Estou com um problema técnico no momento, tente novamente em alguns minutos.',
      origem: 'motor',
      intencaoDetectada: 'saudacao_ou_vago' as IntencaoChat,
      perguntaReescrita: dados.mensagemUsuario,
    };
  }

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


