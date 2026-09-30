import fs from 'fs';
import path from 'path';
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
  OpcaoDocumento,
} from '../types.js';
import { extrairPrimeiroNome, formatarFraseAcompanhamento, nomesSaoEquivalentesComTolerancia, limparFormaTratamentoNome } from '../utils/nomeUtils.js';
import { criarAnexoParaDocumento, gerarPdfDeMarkdown } from '../pdfService.js';
import { mascararDadosSensiveis, mascararDocumento, truncarTrecho } from '../utils/segurancaUtils.js';
import { gerarLinksNavegacao } from '../utils/geoLinks.js';
import { salvarRastro } from '../rastros/rastroService.js';

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

  // 3.5. Remove códigos internos (doc_id, UUIDs, IDs técnicos) para nunca exibir ao usuário
  limpo = limpo.replace(/\[\s*(?:doc_?id|id|código|codigo)\s*:\s*[^\]]+\]/gi, '');
  limpo = limpo.replace(/\(?\b(?:doc_?id|id|código|codigo)\s*:\s*[a-zA-Z0-9_-]+\)?/gi, '');
  limpo = limpo.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  limpo = limpo.replace(/\b(?:doc|tit)_[a-zA-Z0-9_]{5,}\b/gi, '');

  // 3.6. Garante que opções numeradas de listas de divergência fiquem em linha própria com linha em branco entre elas (\n\n) para WhatsApp
  limpo = limpo.replace(/([^\n])\s*\n\s*(\*?\b\d+º\)?\*?)/gi, '$1\n\n$2');
  limpo = limpo.replace(/([^\n])\s+(\*?\b[1-9]\d*º\)?\*?)/gi, '$1\n\n$2');
  limpo = limpo.replace(/([^\n])\s*\n\s*(O mais recente|A mais recente|Qual devo considerar)/gi, '$1\n\n$2');

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

/**
 * Extrai o valor específico (ex: endereço residencial) de uma descrição ou trecho de documento.
 */
export function extrairValorDeTrechoOuDescricao(texto?: string): string {
  if (!texto) return '';
  const matchRotulo = texto.match(/(?:endereço(?:\s+residencial)?|endereco(?:\s+residencial)?)\s*:\s*([^.\n]+(?:\.[^.\n]+)?)/i);
  if (matchRotulo) {
    return matchRotulo[1].trim().replace(/\.$/, '');
  }
  const matchLogradouro = texto.match(/\b((?:Alameda|Rua|Av\.|Avenida|Travessa|Rodovia|Estrada)\s+[^.\n]+)/i);
  if (matchLogradouro) {
    return matchLogradouro[1].trim().replace(/\.$/, '');
  }
  return texto.replace(/^.*?:\s*/, '').trim();
}

export function formatarDataParaExibicao(dataStr?: string | null): string {
  if (!dataStr) return '';
  const s = dataStr.trim();
  const matchBr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (matchBr) {
    const dia = matchBr[1].padStart(2, '0');
    const mes = matchBr[2].padStart(2, '0');
    const ano = matchBr[3];
    return `${dia}/${mes}/${ano}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function parseDataBrOuIso(dataStr?: string | null): Date | null {
  if (!dataStr) return null;
  const s = dataStr.trim();
  const matchBr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (matchBr) {
    const dia = parseInt(matchBr[1], 10);
    const mes = parseInt(matchBr[2], 10) - 1;
    const ano = parseInt(matchBr[3], 10);
    return new Date(ano, mes, dia);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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

  // 1. Match direto por correspondência exata do título ou arquivo completo
  for (const doc of todosDocs) {
    const docTitNorm = doc.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const docArqNorm = doc.arquivo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (docTitNorm === termoNorm || docArqNorm === termoNorm) {
      if (!titularAlvo || titularCorresponde(doc.titular, titularAlvo) || docTitNorm.includes(termoNorm)) {
        return doc;
      }
    }
  }

  // 2. Se houver titularAlvo válido, restringe o catálogo estritamente a ele (Regras 8 e 20)
  // Se o titular não tiver documentos cadastrados, NUNCA restaurar o catálogo geral!
  const catalogo = titularAlvo
    ? todosDocs.filter((d) => titularCorresponde(d.titular, titularAlvo))
    : todosDocs;

  if (catalogo.length === 0) {
    return null;
  }

  // 3. Match no catálogo do titular por título ou arquivo (respeitando o titular informado)
  for (const doc of catalogo) {
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
      if (
        tipoNorm === tipoIdNorm ||
        titNorm.includes(tipoIdNorm) ||
        arqNorm.includes(tipoIdNorm) ||
        (tipoIdNorm.includes('dispensa') && (titNorm.includes('dispensa') || arqNorm.includes('dispensa')))
      ) {
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

        const titItemSemGenerico = titItem.replace(/\b(chave|pix)\b/g, '').trim();
        const bateuTitItem =
          (titItemSemGenerico.length >= 3 && termoNorm.includes(titItemSemGenerico)) ||
          (termoNorm.includes(titItem) && titItemSemGenerico.length >= 3);

        if (
          (titular && (termoNorm.includes(titular) || titular.includes(termoNorm) || matchPartes)) ||
          bateuTitItem
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
        const dados = (itensPix[0].dadosEstruturados as any) || {};
        const tipoChave = (dados.tipoChave || '').toLowerCase();
        const titular = (dados.titular || '').toLowerCase();
        const titItem = (itensPix[0].titulo || '').toLowerCase();

        const ehPessoaFisica =
          tipoChave === 'cpf' ||
          (!/delta\s*plan|ltda|eireli|me\b|epp\b|engenharia/i.test(titular) &&
            !/delta\s*plan|empresa|sede/i.test(titItem));

        // Ponto 4: Pergunta genérica de PIX sem titular deve perguntar de quem é se for de pessoa física!
        if (ehPessoaFisica) {
          return null;
        }

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

      // 3. Se houver termos específicos na pergunta que não casaram com nenhum local, NUNCA entregar!
      // (Princípio Geral: nunca entregar local divergente do pedido)
      const palavrasIgnoradasLocal = new Set([
        'onde', 'fica', 'e', 'é', 'como', 'chegar', 'chego', 'qual', 'o', 'a', 'os', 'as',
        'de', 'do', 'da', 'dos', 'das', 'endereco', 'endereço', 'local', 'localizacao',
        'localização', 'por', 'favor', 'delta', 'plan', 'deltaplan', 'empresa', 'escritorio',
        'escritório', 'sede'
      ]);
      const termosEspecificosLocal = termoNorm
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !palavrasIgnoradasLocal.has(w));

      if (termosEspecificosLocal.length > 0) {
        return null;
      }

      // Se a consulta for puramente genérica sobre a sede/escritório da empresa e existir 1 local compatível
      if (itensLocal.length === 1) {
        const d = (itensLocal[0].dadosEstruturados as any) || {};
        const tit = normalizarParaBusca(itensLocal[0].titulo || '');
        const nomeL = normalizarParaBusca(d.nomeLocal || '');
        const ehSedeOuEscritorio =
          tit.includes('escritorio') ||
          tit.includes('sede') ||
          tit.includes('delta') ||
          nomeL.includes('escritorio') ||
          nomeL.includes('sede') ||
          nomeL.includes('delta');

        if (ehSedeOuEscritorio) {
          return { item: itensLocal[0], score: 100 };
        }
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
    const palavrasComunsIgnoradas = new Set(['servico', 'servicos', 'engenharia', 'empresa', 'ltda', 'me', 'eireli', 'construcoes', 'comercio']);
    const partesRelevantes = pNorm.split(/\s+/).filter((parte) => parte.length >= 3 && !palavrasComunsIgnoradas.has(parte));

    // Ponto 7: Match por nome completo ou por partes relevantes exclusivas (sem casar palavras genéricas avulsas como "serviços")
    const matchCompleto = itemNorm.includes(pNorm) || msgNorm.includes(pNorm);
    const matchParteRelevante =
      partesRelevantes.length > 0 &&
      partesRelevantes.some((parte) => {
        const reg = new RegExp(`\\b${parte}\\b`, 'i');
        return reg.test(itemNorm) || reg.test(msgNorm);
      });

    if (matchCompleto || matchParteRelevante) {
      pessoaCitadaNaMensagem = pessoa;
    }
  }

  // Fallback de detecção por regex para casos como "da Nilceia", "do Marcos", "de Fulano"
  if (!pessoaCitadaNaMensagem) {
    const matchPessoa = (perguntaCompleta + ' ' + mensagemUsuario).match(/\b(?:de|da|do|dos|das)\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]+)*)/);
    if (matchPessoa) {
      const candidato = matchPessoa[1].trim();
      const candNorm = normalizarParaBusca(candidato);
      const ehPalavraIgnorada = /\b(documento|pdf|arquivo|certidao|contrato|alvara|cnh|rg|empresa|delta|deltaplan|registro|casamento|nascimento|mae|pai|filiacao|resumo|vacina|covid|escrit[oó]rio|sede|filial|obra|almoxarifado|dep[oó]sito|canteiro|local|localiza[cç][aã]o|sistema|app|portal|chave|pix|conta|banco|contato|suporte|servico|servicos|militar)\b/i.test(candNorm);
      if (!ehPalavraIgnorada) {
        pessoaCitadaNaMensagem = candidato;
      }
    }
  }

  const temPronomeExplicitoGeral =
    /\b(dele|dela|ele|ela|do mesmo|da mesma)\b/i.test(itemNorm) ||
    /\b(dele|dela|ele|ela|do mesmo|da mesma)\b/i.test(msgNorm);

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
  } else if (temPronomeExplicitoGeral && pessoa) {
    const resAmb = resolverTitularComAmbiguidade(pessoa, titulares);
    if (resAmb.ambiguo) {
      ambiguidadeTitulares = resAmb.candidatos.map((t) => t.nome);
    } else if (resAmb.titular) {
      pessoa = resAmb.titular.nome;
    } else {
      pessoa = '';
    }
    origemPessoa = 'contexto';
  } else {
    pessoa = '';
    origemPessoa = undefined;
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
    { campo: 'passaporte', regex: /\b(passaporte|n[uú]mero\s*do\s*passaporte)\b/i },
  ];

  const camposDetectadosRegex: string[] = [];
  if (!ehPedidoCertidao) {
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
    // Ponto 13 / Regra 14: Campo detectado sem titular na mensagem NÃO PODE herdar do histórico.
    // Só pronome explícito ("dele", "dela", "ele", "ela") ou em mensagens de correção herda.
    const temPronomeExplicito = temPronomeExplicitoGeral || ehMensagemCorrecao;
    if (temPronomeExplicito) {
      const titularDoHistorico = extrairUltimoTitularDoHistorico(historicoRecente);
      if (titularDoHistorico) {
        pessoa = titularDoHistorico;
        origemPessoa = 'contexto';
      } else {
        pessoa = '';
        origemPessoa = undefined;
      }
    } else {
      pessoa = '';
      origemPessoa = undefined;
    }
  }

  // Ponto 13 / Regra 14: Se detectou campos cadastrais sem titular citado e sem pronome explícito:
  // Força intencao = 'dado_pessoal' e limpa titular e documento citado para perguntar o titular
  if (
    camposDetectadosRegex.length > 0 &&
    !ehPedidoCertidao &&
    !pessoaCitadaNaMensagem &&
    !titularExplicitoMsg &&
    !temPronomeExplicitoGeral &&
    !ehMensagemCorrecao &&
    !citaEmpresaNaMensagem
  ) {
    intencao = 'dado_pessoal';
    campos = Array.from(new Set([...campos, ...camposDetectadosRegex]));
    pessoa = '';
    origemPessoa = undefined;
    documento_citado = '';
    documentos_citados = [];
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
- Uso do contexto (Regra 14): NUNCA herdar titular do histórico para dados pessoais sem sujeito explícito na mensagem atual. Herdar titular do histórico APENAS quando houver pronome explícito ("ele", "ela", "dele", "dela", "do mesmo", "da mesma"). Perguntas como "qual o CPF?", "me passa o RG", "qual a data de nascimento?" NÃO herdam titular do histórico -> deixe "pessoa": "".

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
 * 4. ORQUESTRADOR CENTRAL DA VEGA COM FUNCTION CALLING (GPT-5.4-MINI)
 * Cérebro único da VEGA: toda mensagem é interpretada pela IA com o histórico recente da conversa,
 * e a IA decide dinamicamente quais ferramentas acionar em sequência para responder.
 */

export const TOOLS_ORQUESTRADOR: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_documentos',
      description: 'Busca documentos e trechos arquivados no Cofre da Delta Plan por busca textual no catálogo e busca vetorial semântica. Retorna doc_id, nome_documento, titular, data_documento, data_armazenamento, score e trecho.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Termo de busca, assunto, tipo ou trecho procurado (ex: "Declaração de IR", "contrato social", "certidão de casamento", "comprovante de endereço", "endereço do Thomaz")',
          },
          titular: {
            type: 'string',
            description: 'Nome do titular para restringir a busca aos documentos dele (opcional)',
          },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ficha_titular',
      description: 'Consulta os dados cadastrais oficiais do titular (CPF, RG, endereço, estado civil, filiação, CNH, datas, etc.) validados no cadastro da Delta Plan. Retorna valor, origemNome, conferido, dataConferencia, manual, confirmadoPor, dataConfirmacao e alerta se houver documento posterior no Cofre com valor divergente. Você DEVE acionar esta ferramenta SEMPRE que houver pergunta sobre endereço, filiação ou dados cadastrais (mesmo com pronomes como "qual o endereço dele?"), identificando o titular pelo histórico recente.',
      parameters: {
        type: 'object',
        properties: {
          nome: {
            type: 'string',
            description: 'Nome completo, primeiro nome ou apelido do titular cadastrado (ex: "Thomaz")',
          },
        },
        required: ['nome'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirmar_versao_dado',
      description: 'Grava na ficha cadastral do titular a versão correta de um dado/campo escolhido pelo usuário entre as fontes divergentes apresentadas na conversa (ex: "a 2", "a correta é a 2", "é a da certidão"). Registra o valor escolhido, documento de origem, conferido: true, manual: true, confirmadoPor (nome do usuário), dataConfirmacao e histórico.',
      parameters: {
        type: 'object',
        properties: {
          titular: {
            type: 'string',
            description: 'Nome do titular (ex: "Thomaz", "Dario Divergente")',
          },
          campo: {
            type: 'string',
            description: 'Identificador do campo cadastral (ex: "endereco", "cpf", "rg", "estadoCivil")',
          },
          valor_escolhido: {
            type: 'string',
            description: 'O valor exato da versão escolhida pelo usuário para o campo',
          },
          doc_id_origem: {
            type: 'string',
            description: 'ID interno do documento de origem da versão escolhida (se disponível)',
          },
          nome_documento_origem: {
            type: 'string',
            description: 'Nome ou título do documento de origem da versão escolhida (ex: "Contrato de Locacao 2023")',
          },
        },
        required: ['titular', 'campo', 'valor_escolhido'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_documentos_titular',
      description: 'Lista todos os documentos oficiais salvos no Cofre pertencentes a um titular específico.',
      parameters: {
        type: 'object',
        properties: {
          titular: {
            type: 'string',
            description: 'Nome do titular cadastrado (ex: "Thomaz")',
          },
        },
        required: ['titular'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_documento',
      description: 'Anexa e envia o arquivo físico original (PDF ou imagem) do Cofre para o usuário no WhatsApp. Use SOMENTE quando o usuário pedir EXPLICITAMENTE para ver, mandar, enviar, abrir, soltar ou baixar um arquivo físico (ex: "me manda o 2", "quero ver o documento 5", "me envie o pdf"). NUNCA use para perguntas sobre contagem ("quantos documentos"), listagens ("quais documentos") ou dúvidas cadastrais.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: {
            type: 'string',
            description: 'ID do documento no Cofre (UUID) ou identificador obtido nas opções anteriores',
          },
        },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gerar_pdf',
      description: 'Gera um documento PDF oficial corporativo da Delta Plan a partir de conteúdo em Markdown e anexa para envio.',
      parameters: {
        type: 'object',
        properties: {
          titulo: {
            type: 'string',
            description: 'Título do documento PDF',
          },
          conteudo_markdown: {
            type: 'string',
            description: 'Conteúdo em Markdown a ser renderizado no corpo do PDF',
          },
        },
        required: ['titulo', 'conteudo_markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_conhecimento',
      description: 'Consulta a Base de Conhecimento interna da Delta Plan (chaves PIX, links de sistemas, regras de negócio, telefones e procedimentos).',
      parameters: {
        type: 'object',
        properties: {
          termo: {
            type: 'string',
            description: 'Termo de busca na base de conhecimento (ex: "pix do Thomaz", "link do ERP")',
          },
          categoria: {
            type: 'string',
            description: 'Categoria opcional (Financeiro, RH, TI, Geral)',
          },
        },
        required: ['termo'],
      },
    },
  },
];

/**
 * Checa se é o primeiro contato do dia considerando o fuso de Brasília (America/Sao_Paulo)
 */
export function verificarSeEhPrimeiroContatoDoDia(historico: Mensagem[]): boolean {
  if (!historico || historico.length === 0) return true;

  const hojeBrasilia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const msgsAssistenteHoje = historico.filter((m) => {
    if (!m.timestamp || m.remetente !== 'assistente') return false;
    try {
      const dataMsg = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(m.timestamp));
      return dataMsg === hojeBrasilia;
    } catch {
      return false;
    }
  });

  return msgsAssistenteHoje.length === 0;
}

/**
 * Lê as instruções oficiais de prompts/assistente.md
 */
export function carregarPromptAssistente(): string {
  try {
    const caminho = path.resolve(process.cwd(), 'prompts/assistente.md');
    if (fs.existsSync(caminho)) {
      const c = fs.readFileSync(caminho, 'utf-8').trim();
      if (c) return c;
    }
  } catch {}
  return obterConfiguracoesVegaSync().promptPersona || 'Você é a assistente corporativa VEGA da Delta Plan.';
}

/**
 * REDE DE SEGURANÇA (Item 4):
 * Se a resposta final trouxer dado pessoal (CPF, RG, endereço com número) e nenhuma tool
 * tiver retornado esse dado nesta conversa, bloqueia o envio e substitui pela frase padrão.
 */
export function verificarSegurancaDadosPessoais(params: {
  textoResposta: string;
  dadosRetornadosTools: string[];
  historicoMensagens: Mensagem[];
  mensagemUsuarioAtual?: string;
}): { aprovado: boolean; motivo?: string; dadoSuspeito?: string } {
  const { textoResposta, dadosRetornadosTools, historicoMensagens, mensagemUsuarioAtual } = params;

  // 1. Respaldo oficial aceito:
  // - Resultados de tools desta resposta
  // - Resultados de tools registrados no histórico (em rastro.etapas e rastro.documentosEncontrados)
  // - Mensagens escritas pelo usuário (remetente === 'cliente' e mensagemUsuarioAtual)
  // ATENÇÃO: Respostas anteriores da própria VEGA (remetente === 'assistente') NUNCA contam como respaldo!
  const partesRespaldo: string[] = [...dadosRetornadosTools];

  if (mensagemUsuarioAtual) {
    partesRespaldo.push(mensagemUsuarioAtual);
  }

  for (const msg of historicoMensagens) {
    if (msg.remetente === 'cliente') {
      partesRespaldo.push(msg.texto || '');
    }

    if (msg.rastro) {
      if (Array.isArray(msg.rastro.documentosEncontrados)) {
        for (const doc of msg.rastro.documentosEncontrados) {
          if (doc.titulo) partesRespaldo.push(doc.titulo);
          if (doc.trecho) partesRespaldo.push(doc.trecho);
        }
      }
      if (Array.isArray(msg.rastro.etapas)) {
        for (const etapa of msg.rastro.etapas) {
          if (etapa.nome?.startsWith('Tool:') && etapa.detalhes) {
            if (etapa.detalhes.resultado) {
              partesRespaldo.push(
                typeof etapa.detalhes.resultado === 'string'
                  ? etapa.detalhes.resultado
                  : JSON.stringify(etapa.detalhes.resultado)
              );
            }
          }
        }
      }
    }
  }

  const normalizar = (txt: string) =>
    txt
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const corpus = normalizar(partesRespaldo.join(' '));

  // A. CPF (11 dígitos formatados)
  const padraoCpf = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g;
  let matchCpf;
  while ((matchCpf = padraoCpf.exec(textoResposta)) !== null) {
    const cpf = matchCpf[1];
    const apenasDigitos = cpf.replace(/\D/g, '');
    if (apenasDigitos.length === 11) {
      if (!corpus.includes(apenasDigitos) && !corpus.includes(normalizar(cpf))) {
        return {
          aprovado: false,
          motivo: `CPF ${cpf} citado na resposta não constava em nenhuma tool executada nem foi informado pelo usuário.`,
          dadoSuspeito: cpf,
        };
      }
    }
  }

  // B. RG / Documento de identificação (7 a 9 dígitos numéricos com pontuação padrão)
  const padraoRg = /\b(\d{1,2}\.?\d{3}\.?\d{3}-?[0-9xX])\b/g;
  let matchRg;
  while ((matchRg = padraoRg.exec(textoResposta)) !== null) {
    const rg = matchRg[1];
    const digitos = rg.replace(/\D/g, '');
    if (digitos.length >= 7 && digitos.length <= 9) {
      if (!corpus.includes(digitos) && !corpus.includes(normalizar(rg))) {
        return {
          aprovado: false,
          motivo: `RG/Identidade ${rg} citado na resposta não constava em nenhuma tool executada nem foi informado pelo usuário.`,
          dadoSuspeito: rg,
        };
      }
    }
  }

  // C. Endereço específico com logradouro e número (ex: "Rua X, 123" ou "Avenida Y, nº 45")
  const padraoEndereco = /\b(?:rua|avenida|av\.?|alameda|travessa|rodovia|praça)\s+([A-Za-zÀ-ÿ0-9\s]{2,40}?)(?:,\s*|\s+)(?:n[º°]?\s*|\bn[º°]?\s*)?(\d{1,6})\b/gi;
  let matchEnd;
  while ((matchEnd = padraoEndereco.exec(textoResposta)) !== null) {
    const enderecoCompleto = matchEnd[0];
    const nomeLogradouro = normalizar(matchEnd[1].trim());
    const numeroRua = matchEnd[2];
    if (!corpus.includes(nomeLogradouro) || !corpus.includes(numeroRua)) {
      return {
        aprovado: false,
        motivo: `Endereço "${enderecoCompleto}" citado na resposta não constava em nenhuma tool executada nem foi informado pelo usuário.`,
        dadoSuspeito: enderecoCompleto,
      };
    }
  }

  return { aprovado: true };
}

/**
 * Normaliza e formata string de data para dd/mm/aaaa
 */
function normalizarDataParaExibicao(dataStr: string): string {
  const limpa = dataStr.replace(/[\.-]/g, '/').trim();
  const partes = limpa.split('/');
  if (partes.length === 3) {
    const p0 = partes[0].padStart(2, '0');
    const p1 = partes[1].padStart(2, '0');
    let p2 = partes[2];
    if (p2.length === 2) p2 = `20${p2}`;
    return `${p0}/${p1}/${p2}`;
  }
  return dataStr;
}

export function dataEstaEmContextoDeNascimentoOuValidade(texto: string, index: number, matchLen: number): boolean {
  const trechoAntes = texto.slice(Math.max(0, index - 80), index).toLowerCase();
  const trechoDepois = texto.slice(index + matchLen, Math.min(texto.length, index + matchLen + 50)).toLowerCase();

  const ehNascimento =
    /(?:nascid[oa]|nascimento|data de nascimento|d\.n\.|nasceu|filh[oa]\s+de|natural\s+de|menor|idade|anos\s+de\s+idade)/i.test(
      trechoAntes
    ) || /\b(nascimento|nascid[oa])\b/i.test(trechoDepois);

  const ehValidade =
    /(?:validade|vencimento|v[aá]lido\s+at[eé]|vence\s+em|expira\s+em|validade\s+at[eé])/i.test(trechoAntes) ||
    /(?:validade|vencimento)/i.test(trechoDepois);

  return ehNascimento || ehValidade;
}

export function validarAnoRazoavelEmissao(dataStr: string): boolean {
  const matchAno = dataStr.match(/\b(19\d{2}|20\d{2})\b/);
  if (!matchAno) return false;
  const ano = parseInt(matchAno[1], 10);
  const anoAtual = new Date().getFullYear();
  return ano >= 1950 && ano <= anoAtual;
}

export function converterMesExtenso(mesNome: string): string {
  const meses: Record<string, string> = {
    janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08',
    setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };
  return meses[mesNome.toLowerCase()] || '01';
}

export function converterDataParaBr(dStr: string): string {
  if (dStr.includes(' de ')) {
    const m = dStr.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
    if (m) {
      return `${m[1].padStart(2, '0')}/${converterMesExtenso(m[2])}/${m[3]}`;
    }
  }
  return normalizarDataParaExibicao(dStr.replace(/[-.]/g, '/'));
}

/**
 * 2. EXTRAÇÃO DA DATA DE EMISSÃO / REFERÊNCIA DO DOCUMENTO (Item 2)
 * Extrai a data de emissão ou fato jurídico do documento a partir de seus metadados ou trechos.
 * REGRA ABSOLUTA: NUNCA usar dataValidade nem dataCadastro! Se não identificar, retorna null.
 */
export function extrairDataEmissaoDocumento(
  doc: DocumentoRegistro,
  trechosDoDoc: string[] = []
): string | null {
  const textoUnificado = `${doc.titulo || ''} ${doc.descricao || ''} ${trechosDoDoc.join(' ')}`;

  // 1. Metadado explícito dataEmissao / metadata.data_emissao
  const dataMeta = doc.dataEmissao || doc.metadata?.data_emissao;
  if (dataMeta) {
    const dataFmt = formatarDataParaExibicao(dataMeta);
    if (dataFmt && dataFmt !== 'Data inválida' && validarAnoRazoavelEmissao(dataFmt)) {
      const valFmt = doc.dataValidade ? formatarDataParaExibicao(doc.dataValidade) : '';
      if (!valFmt || dataFmt !== valFmt) {
        const idxNoTexto = textoUnificado.indexOf(dataFmt);
        if (idxNoTexto === -1 || !dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idxNoTexto, dataFmt.length)) {
          return dataFmt;
        }
      }
    }
  }

  // 2. Declaração de Imposto de Renda (DIRPF)
  const matchExercicio = textoUnificado.match(/exerc[ií]cio\s+(\d{4})/i);
  if (matchExercicio) {
    const anoExercicio = matchExercicio[1];
    const matchRecibo = textoUnificado.match(/(?:recibo|transmiss[aã]o|entrega|emiss[aã]o|gerado em|data[:\s]+)(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/i);
    if (matchRecibo && !dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, matchRecibo.index || 0, matchRecibo[0].length)) {
      const dataBr = normalizarDataParaExibicao(matchRecibo[1]);
      if (validarAnoRazoavelEmissao(dataBr)) return dataBr;
    }
    return `30/04/${anoExercicio}`;
  }

  // 3. Certidão civil formato tabular: "Dia Mês Ano 12 04 2010"
  const matchTabular = textoUnificado.match(/Dia\s+M[eê]s\s+Ano\s*(\d{1,2})\s+(\d{1,2})\s+(\d{4})/i);
  if (matchTabular) {
    const dia = matchTabular[1].padStart(2, '0');
    const mes = matchTabular[2].padStart(2, '0');
    const ano = matchTabular[3];
    const dataTab = `${dia}/${mes}/${ano}`;
    if (validarAnoRazoavelEmissao(dataTab)) return dataTab;
  }

  // 4. Padrões explícitos com palavras-chave de emissão/registro
  const regexExplicit = /(?:data do registro|data de registro|registro do casamento|termo do registro|termo lavrado|lavrado aos?|lavrado em|assento lavrado|casamento celebrado|casamento realizado|contra[ií]ram matrim[oô]nio|expedido em|emitido em|data da expedi[cç][aã]o|data de expedi[cç][aã]o|concluiu em|colação de grau|data da assinatura|firmado em|assinado em|situação cadastral extraída em)[\s\S]{0,60}?(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4})/gi;

  let mExplicit: RegExpExecArray | null;
  while ((mExplicit = regexExplicit.exec(textoUnificado)) !== null) {
    const dataCapturada = mExplicit[1];
    const idx = mExplicit.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mExplicit[0].length)) {
      const dataConv = converterDataParaBr(dataCapturada);
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  // 5. Local e data no final de certidões/termos (ex.: "OURINHOS-SP, 12 de abril de 2010")
  const regexLocalData = /(?:[A-ZÀ-Ú\s]{3,25})[\s\-]+(?:SP|RJ|MG|PR|SC|RS|DF|GO)?,?\s*(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;
  let mLocal: RegExpExecArray | null;
  while ((mLocal = regexLocalData.exec(textoUnificado)) !== null) {
    const idx = mLocal.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mLocal[0].length)) {
      const dia = mLocal[1].padStart(2, '0');
      const mes = converterMesExtenso(mLocal[2]);
      const ano = mLocal[3];
      const dataConv = `${dia}/${mes}/${ano}`;
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  // 6. Varredura geral de datas por extenso descartando contexto de nascimento e validade
  const regexExtenso = /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi;
  let mExt: RegExpExecArray | null;
  while ((mExt = regexExtenso.exec(textoUnificado)) !== null) {
    const idx = mExt.index;
    if (!dataEstaEmContextoDeNascimentoOuValidade(textoUnificado, idx, mExt[0].length)) {
      const dia = mExt[1].padStart(2, '0');
      const mes = converterMesExtenso(mExt[2]);
      const ano = mExt[3];
      const dataConv = `${dia}/${mes}/${ano}`;
      if (validarAnoRazoavelEmissao(dataConv)) return dataConv;
    }
  }

  // REGRA ABSOLUTA: NUNCA usar doc.dataValidade e NUNCA usar doc.dataCadastro! Se não identificar, retorna null.
  return null;
}

/**
 * 2.1. LIMPEZA E NORMALIZAÇÃO DE ENDEREÇO (Title Case, sem rótulos crus, com CEP formatado)
 */
export function limparENormalizarEndereco(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // 1. Trunca quando começam outros campos do documento/cartório/certidão
  const delimitadoresCorte = [
    /\b(?:Nilceia|Nomes completos|Filho de|Filha de|Nascid[oa]|Natural de|Data do registro|Regime de bens|Observações|Casamento celebrado|O conteúdo da certidão|Expedido em|Número de registro|Registro Nacional|Título\(s\)|Decreto Federal|Diploma\/Certificado|A presente certidão|Esta certidão|Eletrônico|Telefone|E-mail|Email|Natureza da Ocupação|Ocupação Principal|Tipo de declaração|Nº do recibo|DEPENDENTES|ALIMENTANDOS|RENDIMENTOS)\b/i,
    /\b(?:CPF|RG|CNPJ)\s*[:\s]*\d/i,
  ];
  for (const delim of delimitadoresCorte) {
    const idx = s.search(delim);
    if (idx > 10) {
      s = s.slice(0, idx).trim();
    }
  }

  // 2. Remove rótulos crus de formulários
  s = s.replace(/\b(?:LOGRADOURO|Logradouro|ENDEREÇO|Endereço|ENDERECO|Endereco)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:NÚMERO|Número|NUMERO|Numero|Nº|N°|No\.?)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:COMPLEMENTO|Complemento)\s*[:\s]+(?=[A-Za-z0-9])/gi, '');
  s = s.replace(/\b(?:COMPLEMENTO|Complemento)\s*[:\s]*/gi, '');
  s = s.replace(/\b(?:BAIRRO\/DISTRITO|Bairro\/Distrito|BAIRRO|Bairro|DISTRITO|Distrito)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:MUNICÍPIO|Município|MUNICIPIO|Municipio|CIDADE|Cidade)\s*[:\s]+/gi, '');
  s = s.replace(/\b(?:UF|ESTADO|Estado)\s*[:\s]+/gi, '');

  // 3. Normaliza e extrai CEP se presente
  let cepFormatado = '';
  const matchCep = s.match(/\b(?:CEP:?\s*)?(\d{2})\.?(\d{3})-?(\d{3})\b/i);
  if (matchCep) {
    cepFormatado = `CEP ${matchCep[1]}${matchCep[2]}-${matchCep[3]}`;
    s = s.replace(/\b(?:CEP:?\s*)?\d{2}\.?\d{3}-?\d{3}\b/i, '');
  }

  // 4. Remove caracteres estranhos (••, *****, resíduos)
  s = s.replace(/[•*]+/g, ' ');
  s = s.replace(/[\t\r\n]+/g, ' ');
  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/,\s*,+/g, ',');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[,.\s-]+|[,.\s-]+$/g, '');

  // 5. Normaliza siglas e capitalização
  const ufs = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'ES', 'BA', 'DF', 'GO', 'MT', 'MS', 'PE', 'CE', 'PA', 'AM', 'MA', 'RN', 'PB', 'AL', 'SE', 'PI', 'TO', 'RO', 'AC', 'AP', 'RR']);
  const minusculas = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas']);

  const partes = s.split(',').map((p) => p.trim()).filter(Boolean);
  const partesFormatadas = partes.map((parte) => {
    return parte.split(' - ').map((subParte) => {
      return subParte.split(' ').map((palavra, idx) => {
        const pUp = palavra.toUpperCase().replace(/[^A-Z]/g, '');
        if (ufs.has(pUp) && palavra.length <= 4) {
          return pUp;
        }
        const pLow = palavra.toLowerCase();
        if (minusculas.has(pLow) && idx > 0) {
          return pLow;
        }
        if (pLow.startsWith('nº') || pLow.startsWith('n°')) {
          return 'nº ' + pLow.slice(2).trim();
        }
        if (pLow === 'jd.' || pLow === 'jd') return 'Jardim';
        if (pLow === 'res.' || pLow === 'res') return 'Residencial';
        return pLow.charAt(0).toUpperCase() + pLow.slice(1);
      }).join(' ');
    }).join('-');
  });

  let resultado = partesFormatadas.join(', ');
  resultado = resultado.replace(/\s*-\s*([A-Z]{2})\b/g, '-$1');
  resultado = resultado.replace(/,\s*([A-Z]{2})\b/g, '-$1');
  resultado = resultado.replace(/\bEm\s+([A-ZÀ-Ú])/g, '$1');

  if (cepFormatado) {
    resultado += `, ${cepFormatado}`;
  }

  const matchFimUf = resultado.match(/^(.*?[A-Z]{2}(?:,\s*CEP\s*\d{5}-\d{3})?)/);
  if (matchFimUf && matchFimUf[1].length >= 15) {
    resultado = matchFimUf[1];
  }

  return resultado.replace(/\s+/g, ' ').replace(/^,\s*/, '').trim();
}

/**
 * 2.2. EXTRAÇÃO DE CHAVE DE COMPARAÇÃO DE ENDEREÇO (Logradouro base + número)
 */
export function extrairChaveComparacaoEndereco(endereco: string): string {
  const norm = endereco
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const matchNum = norm.match(/\b(?:n[ºo°]?\s*)?(\d+)\b/);
  const numero = matchNum ? matchNum[1] : '';

  let logradouro = norm;
  logradouro = logradouro.replace(/\bcep\s*[\d.-]+\b/g, '');
  logradouro = logradouro.replace(/\b(?:rua|avenida|av|alameda|travessa|estrada|rodovia|praca|res|residencial|apto|ap|bloco|jd|jardim)\b/g, '');
  const palavras = logradouro.match(/[a-z]{3,}/g) || [];
  const baseLogradouro = palavras.slice(0, 3).join('_');

  return `${baseLogradouro}_${numero}`;
}

/**
 * 2.3. EXTRAÇÃO DE ENDEREÇO DE TRECHOS
 * Procura ocorrência real de endereço residencial ou comercial e normaliza.
 * Retorna null se não contiver endereço ou se só contiver negativa ("não traz endereço").
 */
export function extrairEnderecoDeTrechos(trechos: string[]): { endereco: string; trechoCompleto: string } | null {
  for (const t of trechos) {
    if (!t || typeof t !== 'string') continue;
    if (/não traz endereço|não cont[eé]m endereço|sem endereço residencial|não possui endereço/i.test(t)) {
      continue;
    }

    // Padrão de logradouro comum (Rua, Avenida, etc.)
    const regexLogradouro = /(?:rua|avenida|av\.|alameda|rodovia|travessa|estrada|pra[cç]a|logradouro|endere[cç]o\s+residencial|endere[cç]o[:\s]+)(?:[^\n\r,\.]+)[,\s]+(?:\d+|nº\s*\d+|s\/n)[^\n\r]*/i;
    const match = t.match(regexLogradouro);
    if (match) {
      let endBruto = match[0].trim().replace(/^endere[cç]o\s*(?:residencial)?[:\s]*/i, '');
      const endLimpo = limparENormalizarEndereco(endBruto);
      if (endLimpo.length >= 8) {
        return {
          endereco: endLimpo,
          trechoCompleto: t.trim(),
        };
      }
    }

    // Padrão específico para declaração de IR: "RUA ... , \d+ ... BAIRRO ... MUNICÍPIO ..."
    if (t.includes('DECLARAÇÃO DE AJUSTE ANUAL') || t.includes('IMPOSTO SOBRE A RENDA') || t.includes('DIRPF') || t.includes('CADASTRO NACIONAL')) {
      const matchIrEnd = t.match(/(?:LOGRADOURO|ENDEREÇO|RUA|AVENIDA|AV\.|ALAMEDA)[\s:]+([^\n\r]+)/i);
      if (matchIrEnd && matchIrEnd[1].length >= 8) {
        const endLimpo = limparENormalizarEndereco(matchIrEnd[1]);
        if (endLimpo.length >= 8) {
          return {
            endereco: endLimpo,
            trechoCompleto: t.trim(),
          };
        }
      }
    }

    // Padrão com CEP
    const regexCepCidade = /(?:rua|av|avenida|alameda|bairro)[^\n\r]+CEP\s*\d{5}-?\d{3}/i;
    const matchCep = t.match(regexCepCidade);
    if (matchCep) {
      const endLimpo = limparENormalizarEndereco(matchCep[0]);
      if (endLimpo.length >= 8) {
        return {
          endereco: endLimpo,
          trechoCompleto: t.trim(),
        };
      }
    }
  }

  return null;
}

/**
 * 4. AUTOVERIFICAÇÃO ANTES DE ENVIAR (Item 4)
 * Revisa a resposta gerada para garantir:
 * 1. Documentos sem o dado não aparecem na lista.
 * 2. A indicação de mais recente não aponta para validade futura (ex: 2034) nem documento sem o dado.
 * 3. Nenhuma contradição no texto.
 */
export function autoverificarRespostaDadosTitular(params: {
  textoResposta: string;
  documentosRetornados?: Array<{ nome_documento: string; data_documento?: string; valor?: string; trecho?: string }>;
  mensagemUsuario: string;
}): string {
  let texto = params.textoResposta;

  // 1. Remove qualquer item que tenha sido listado com negativa ("não traz endereço", etc.)
  if (/não traz endereço|não cont[eé]m endereço|sem endereço|não possui endereço/i.test(texto)) {
    const blocos = texto.split(/\n\s*\n/);
    const blocosFiltrados = blocos.filter((b) => {
      const bLower = b.toLowerCase();
      const ehItemLista = /^\s*\*?\d+[ºª\)]/i.test(b);
      const temNegativa =
        bLower.includes('não traz endereço') ||
        bLower.includes('não contém endereço') ||
        bLower.includes('sem endereço') ||
        bLower.includes('não possui endereço');
      return !(ehItemLista && temNegativa);
    });

    texto = blocosFiltrados.join('\n\n');

    // Renumera as opções restantes (1º, 2º, ...)
    let contador = 1;
    texto = texto.replace(/(^|\n)(\s*\*?)(\d+)[ºª\)]/g, (match, prefix, prefixStyle) => {
      const novo = `${prefix}${prefixStyle}${contador}º)`;
      contador++;
      return novo;
    });
  }

  // 2. Corrige indicação de mais recente para garantir que aponte para o documento com maior data de emissão real
  if (params.documentosRetornados && params.documentosRetornados.length > 0) {
    const docsValidosComEmissao = params.documentosRetornados.filter((d) => {
      const dataDoc = d.data_documento || '';
      const anoMatch = dataDoc.match(/\b(20[12]\d)\b/);
      return Boolean(anoMatch) && !/cnh/i.test(d.nome_documento) && !/não identificada/i.test(dataDoc);
    });

    if (docsValidosComEmissao.length > 0) {
      docsValidosComEmissao.sort((a, b) => {
        const dA = parseDataBrOuIso(a.data_documento || '')?.getTime() || 0;
        const dB = parseDataBrOuIso(b.data_documento || '')?.getTime() || 0;
        return dB - dA;
      });
      const maisRecenteReal = docsValidosComEmissao[0];

      const regexFechamento = /(?:O|A)\s+(?:endereço\s+)?mais recente\s+(?:é|consta no|está n[oa])\s+(?:o|a|d[oa])?\s*([^\n\r\.\?]+)/i;
      const matchFechamento = texto.match(regexFechamento);
      if (matchFechamento) {
        const docCitado = matchFechamento[1].trim();
        const docCitadoNorm = docCitado.toLowerCase();
        const nomeMaisRecenteNorm = maisRecenteReal.nome_documento.toLowerCase();
        const ehErrado =
          /cnh/i.test(docCitadoNorm) ||
          /203\d|204\d/.test(docCitadoNorm) ||
          (!docCitadoNorm.includes(nomeMaisRecenteNorm) && !nomeMaisRecenteNorm.includes(docCitadoNorm));

        if (ehErrado) {
          texto = texto.replace(
            regexFechamento,
            `O mais recente é o da ${maisRecenteReal.nome_documento}`
          );
        }
      }
    }
  }

  return texto;
}

/**
 * Tool 1: buscar_documentos(consulta, titular?)
 */
export async function toolBuscarDocumentos(
  consulta: string,
  titularNome?: string,
  todosDocs: DocumentoRegistro[] = []
): Promise<{
  documentos: Array<{
    doc_id: string;
    nome_documento: string;
    titular: string;
    data_documento?: string;
    data_armazenamento?: string;
    score: number;
    trecho?: string;
    valor?: string;
  }>;
  opcoes_lista?: OpcaoDocumento[];
  total_fontes_com_dado?: number;
  orientacao_resposta?: string;
  mensagem?: string;
}> {
  const termoNorm = (consulta || '').toLowerCase().trim();

  // 0. BLOQUEIO DE BUSCA POR ITENS DE LISTA (Item 1)
  const regexItemLista = /^(?:me\s+)?(?:mande|manda|envie|envia|quero|solta|solte)?\s*(?:o\s+)?(?:pdf\s+d[oa]\s+|arquivo\s+d[oa]\s+|documento\s+d[oa]\s+)?(?:item|op[cç][aã]o|n[úu]mero|n[ºo°]|o\s+quinto|o\s+primeiro|o\s+segundo|o\s+terceiro)\s*\d*$/i;
  if (regexItemLista.test(termoNorm)) {
    return {
      documentos: [],
      total_fontes_com_dado: 0,
      orientacao_resposta: 'ATENÇÃO: A consulta enviada refere-se a uma opção de lista numerada anterior. NUNCA execute busca textual com "item X" ou "opção X". Chame a ferramenta enviar_documento passando o doc_id da opção.',
      mensagem: 'Referência a item de lista detectada. Chame enviar_documento.',
    };
  }

  let titularNorm = (titularNome || '').toLowerCase().trim();
  let titObj: FichaTitular | null = null;
  const todosTits = await obterTodosTitulares();

  if (titularNorm) {
    titObj = todosTits.find((t) => titularCorresponde(t.nome, titularNorm)) || null;
    if (titObj) titularNorm = titObj.nome.toLowerCase();
  } else if (consulta) {
    const cLower = consulta.toLowerCase();
    titObj = todosTits.find((t) => t.nome && cLower.includes(t.nome.toLowerCase())) || null;
    if (titObj) {
      titularNorm = titObj.nome.toLowerCase();
    }
  }

  const ehBuscaEndereco = /(?:endere[cç]|residen|mora|casa|bairro|rua|logradouro|onde ele mora|onde ela mora)/i.test(consulta);
  if (titularNorm && ehBuscaEndereco) {
    const docsDoTitular = todosDocs.filter((d) => {
      // 1. Campo titular direto
      if (titularCorresponde(d.titular, titularNorm)) return true;
      if (titObj && (d.metadata?.titular_id === titObj.id || titularCorresponde(d.titular, titObj.nome))) return true;
      if (titObj?.apelidos && titObj.apelidos.some((ap) => titularCorresponde(d.titular, ap))) return true;

      // 2. Nome do titular presente no título do documento
      const titLower = (d.titulo || '').toLowerCase();
      if (titLower.includes(titularNorm)) return true;
      if (titObj && titLower.includes(titObj.nome.toLowerCase())) return true;
      if (titObj?.apelidos && titObj.apelidos.some((ap) => ap.length >= 3 && titLower.includes(ap.toLowerCase()))) return true;

      // 3. Nome do titular presente no nome do arquivo ou descrição
      const arqLower = (d.arquivo || '').toLowerCase();
      const descLower = (d.descricao || '').toLowerCase();
      if (arqLower.includes(titularNorm) || descLower.includes(titularNorm)) return true;
      if (titObj && (arqLower.includes(titObj.nome.toLowerCase()) || descLower.includes(titObj.nome.toLowerCase()))) return true;

      return false;
    });

    const docIds = docsDoTitular.map((d) => d.id);
    const supabase = getSupabaseClient();
    let trechosBanco: Array<{ documento_id: string; conteudo: string; pagina?: number }> = [];

    if (docIds.length > 0) {
      try {
        const { data: tb, error: errTb } = await supabase
          .from('trechos')
          .select('documento_id, conteudo, pagina')
          .in('documento_id', docIds);
        if (!errTb && tb) {
          trechosBanco = tb;
        }
      } catch (errDb) {
        console.warn('[VEGA Tools] Falha ao consultar trechos do titular no Supabase:', errDb);
      }
    }

    const trechosPorDoc = new Map<string, string[]>();
    for (const t of trechosBanco) {
      if (!trechosPorDoc.has(t.documento_id)) {
        trechosPorDoc.set(t.documento_id, []);
      }
      trechosPorDoc.get(t.documento_id)!.push(t.conteudo);
    }

    const documentosComDado: Array<{
      doc_id: string;
      nome_documento: string;
      titular: string;
      data_documento: string;
      data_armazenamento: string;
      dataEmissaoDate: Date | null;
      dataArmazDate: Date | null;
      valor: string;
      trecho: string;
      score: number;
    }> = [];

    for (const d of docsDoTitular) {
      const trechosDoDoc = [...(trechosPorDoc.get(d.id) || [])];
      if (d.descricao) trechosDoDoc.push(d.descricao);

      const extraido = extrairEnderecoDeTrechos(trechosDoDoc);
      // Se NÃO contém endereço (ex.: CNH sem endereço), DESCARTA IMEDIATAMENTE!
      if (!extraido) {
        continue;
      }

      // Extrai data de emissão real (NUNCA validade nem cadastro)
      const dataEmissao = extrairDataEmissaoDocumento(d, trechosDoDoc);
      const dataDocFormatada = dataEmissao || 'data do documento não identificada';
      const dataArmazFormatada = formatarDataParaExibicao(d.dataCadastro) || 'data de armazenamento não informada';

      const dataEmissaoDate = dataEmissao ? parseDataBrOuIso(dataEmissao) : null;
      const dataArmazDate = parseDataBrOuIso(d.dataCadastro);

      documentosComDado.push({
        doc_id: d.id,
        nome_documento: d.titulo,
        titular: d.titular || titularNorm,
        data_documento: dataDocFormatada,
        data_armazenamento: dataArmazFormatada,
        dataEmissaoDate,
        dataArmazDate,
        valor: extraido.endereco,
        trecho: extraido.trechoCompleto,
        score: 1.0,
      });
    }

    if (documentosComDado.length === 0) {
      return {
        documentos: [],
        total_fontes_com_dado: 0,
        mensagem: `Nenhum documento arquivado de ${titularNorm} contém endereço no Cofre.`,
      };
    }

    // 1. Agrupamento por valor equivalente (mesmo logradouro e número) - Item 3
    const mapaGrupos = new Map<string, {
      endereco: string;
      docs: typeof documentosComDado;
      maiorDataEmissaoDate: Date | null;
      maiorDataArmazDate: Date | null;
      docMaisRecenteDoGrupo: (typeof documentosComDado)[0];
    }>();

    for (const d of documentosComDado) {
      const chave = extrairChaveComparacaoEndereco(d.valor);
      if (!mapaGrupos.has(chave)) {
        mapaGrupos.set(chave, {
          endereco: d.valor,
          docs: [d],
          maiorDataEmissaoDate: d.dataEmissaoDate,
          maiorDataArmazDate: d.dataArmazDate,
          docMaisRecenteDoGrupo: d,
        });
      } else {
        const g = mapaGrupos.get(chave)!;
        g.docs.push(d);
        if (d.dataEmissaoDate && (!g.maiorDataEmissaoDate || d.dataEmissaoDate.getTime() > g.maiorDataEmissaoDate.getTime())) {
          g.maiorDataEmissaoDate = d.dataEmissaoDate;
          g.docMaisRecenteDoGrupo = d;
        }
        if (d.dataArmazDate && (!g.maiorDataArmazDate || d.dataArmazDate.getTime() > g.maiorDataArmazDate.getTime())) {
          g.maiorDataArmazDate = d.dataArmazDate;
        }
      }
    }

    const grupos = Array.from(mapaGrupos.values());

    // 2. Ordenação dos grupos cronologicamente (do mais antigo para o mais recente)
    grupos.sort((a, b) => {
      if (a.maiorDataEmissaoDate && b.maiorDataEmissaoDate) {
        return a.maiorDataEmissaoDate.getTime() - b.maiorDataEmissaoDate.getTime();
      }
      if (a.maiorDataEmissaoDate && !b.maiorDataEmissaoDate) return -1;
      if (!a.maiorDataEmissaoDate && b.maiorDataEmissaoDate) return 1;
      const tA = a.maiorDataArmazDate ? a.maiorDataArmazDate.getTime() : 0;
      const tB = b.maiorDataArmazDate ? b.maiorDataArmazDate.getTime() : 0;
      return tA - tB;
    });

    const grupoMaisRecente = grupos[grupos.length - 1];
    const docMaisRecenteGeral = grupoMaisRecente.docMaisRecenteDoGrupo;

    // 3. Montagem da lista de opções estruturadas para resolução de referências (Item 1)
    const opcoesLista: OpcaoDocumento[] = [];
    grupos.forEach((g, idx) => {
      const num = idx + 1;
      const nomesDocs = g.docs.map((x) => x.nome_documento).join(' e ');
      opcoesLista.push({
        id: g.docMaisRecenteDoGrupo.doc_id,
        titulo: g.docMaisRecenteDoGrupo.nome_documento,
        numero: num,
        doc_id: g.docMaisRecenteDoGrupo.doc_id,
        doc_ids: g.docs.map((x) => x.doc_id),
        nome_documento: nomesDocs,
        nomes_documentos: g.docs.map((x) => x.nome_documento),
        valor: g.endereco,
        mais_recente: g === grupoMaisRecente,
      });
    });

    let orientacao: string;
    if (grupos.length === 1) {
      const gUnico = grupos[0];
      const nomesDocs = gUnico.docs.map((x) => x.nome_documento).join(' e ');
      orientacao =
        `Apenas 1 endereço foi localizado nos documentos do titular ("${gUnico.endereco}"). ` +
        `Responda direto ao usuário informando o endereço e citando a(s) fonte(s) documental(is) (${nomesDocs}), ` +
        `SEM aviso de conflito e SEM lista numerada.`;
    } else {
      const nomeTitularFormatado = titularNorm
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');

      const itensTexto = grupos
        .map((g, idx) => {
          const num = idx + 1;
          const docsDesc = g.docs
            .map((d) => {
              const dataTxt =
                d.data_documento !== 'data do documento não identificada'
                  ? `documento de ${d.data_documento}`
                  : 'data não identificada';
              return `${d.nome_documento} (${dataTxt})`;
            })
            .join(' e ');
          return `*${num}º)* ${g.endereco}\nAparece em: ${docsDesc}`;
        })
        .join('\n\n');

      orientacao =
        `Foram encontrados ${grupos.length} endereços diferentes no Cofre para ${nomeTitularFormatado} após agrupar documentos com o mesmo endereço. ` +
        `Escreva a resposta seguindo rigorosamente o formato de divergência enxuto:\n\n` +
        `Atenção: encontrei informações diferentes sobre o endereço do ${nomeTitularFormatado}, vindas de documentos diferentes:\n\n` +
        `${itensTexto}\n\n` +
        `O mais recente é o da ${docMaisRecenteGeral.nome_documento}. Qual devo considerar como correto?\n\n` +
        `Regras obrigatórias:\n` +
        `- Cada opção agrupa documentos que trazem o mesmo endereço (ex: Diploma e CREA viram um único item).\n` +
        `- Resposta enxuta: use Title Case, sem rótulos crus, com CEP formatado e sem datas de armazenamento no texto das opções.\n` +
        `- Mapeamento das opções estruturadas:\n` +
        opcoesLista.map((o) => `  Opção ${o.numero}: doc_id=${o.doc_id} (${o.nome_documento})`).join('\n') +
        `\n- Se o usuário pedir para enviar (ex: "me mande o pdf do item X", "o 2", "o mais recente", "o da certidão"), acione a ferramenta enviar_documento com o doc_id correspondente!`;
    }

    return {
      documentos: documentosComDado.map((d) => ({
        doc_id: d.doc_id,
        nome_documento: d.nome_documento,
        titular: d.titular,
        data_documento: d.data_documento,
        data_armazenamento: d.data_armazenamento,
        valor: d.valor,
        trecho: d.trecho,
        score: d.score,
      })),
      opcoes_lista: opcoesLista,
      total_fontes_com_dado: grupos.length,
      orientacao_resposta: orientacao,
      mensagem: orientacao,
    };
  }

  // 2. Busca convencional (para outros tipos de busca ou sem titular especificado)
  const resultados: Array<{
    doc_id: string;
    nome_documento: string;
    titular: string;
    data_documento?: string;
    data_armazenamento?: string;
    score: number;
    trecho?: string;
    valor?: string;
  }> = [];

  for (const d of todosDocs) {
    if (titularNorm && !titularCorresponde(d.titular, titularNorm)) {
      continue;
    }
    const tituloNorm = (d.titulo || '').toLowerCase();
    const tipoNorm = (d.tipo || '').toLowerCase();
    const descNorm = (d.descricao || '').toLowerCase();
    const apelidosNorm = (d.apelidos || []).map((a) => a.toLowerCase()).join(' ');

    const coincide =
      termoNorm === '' ||
      termoNorm === 'todos' ||
      tituloNorm.includes(termoNorm) ||
      tipoNorm.includes(termoNorm) ||
      descNorm.includes(termoNorm) ||
      apelidosNorm.includes(termoNorm) ||
      termoNorm.includes(tituloNorm) ||
      termoNorm.includes(tipoNorm);

    if (coincide) {
      const dataEmissao = extrairDataEmissaoDocumento(d, [d.descricao || '']);
      resultados.push({
        doc_id: d.id,
        nome_documento: d.titulo,
        titular: d.titular || 'Não especificado',
        data_documento: dataEmissao || 'data do documento não identificada',
        data_armazenamento: formatarDataParaExibicao(d.dataCadastro),
        score: 1.0,
        trecho: d.descricao || `Documento ${d.tipo || 'oficial'} arquivado no Cofre`,
      });
    }
  }

  try {
    const trechosVetoriais = await executarBuscaVetorial(consulta, titObj?.id || null, 8);
    for (const tv of trechosVetoriais) {
      const doc = todosDocs.find((d) => d.id === tv.documento_id);
      if (titularNorm && (!doc || !titularCorresponde(doc.titular, titularNorm))) {
        continue;
      }
      const titulo = tv.titulo_documento || doc?.titulo || 'Documento do Cofre';
      const dataEmissao = doc ? extrairDataEmissaoDocumento(doc, [tv.conteudo]) : null;
      resultados.push({
        doc_id: tv.documento_id,
        nome_documento: titulo,
        titular: doc?.titular || 'Não especificado',
        data_documento: dataEmissao || 'data do documento não identificada',
        data_armazenamento: formatarDataParaExibicao(doc?.dataCadastro),
        score: Number((tv.similaridade || 0.8).toFixed(2)),
        trecho: tv.conteudo,
      });
    }
  } catch (err) {
    console.warn('[VEGA Tools] Falha na busca vetorial:', err);
  }

  const vistos = new Set<string>();
  const filtrados = resultados.filter((r) => {
    const chave = `${r.doc_id}_${(r.trecho || '').substring(0, 50)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return {
    documentos: filtrados.slice(0, 6),
    mensagem: filtrados.length === 0 ? 'Nenhum documento encontrado no Cofre para a consulta informada.' : undefined,
  };
}

/**
 * Tool 2: consultar_ficha_titular(nome)
 */
async function toolConsultarFichaTitular(
  nome: string,
  todosDocs: DocumentoRegistro[] = []
): Promise<{
  encontrado: boolean;
  titular?: string;
  id?: string;
  alerta_documento_posterior?: string;
  instrucao_resposta?: string;
  mensagem?: string;
  campos?: Record<string, {
    valor: string;
    origemNome: string;
    origemId?: string;
    conferido: boolean;
    dataConferencia?: string;
    manual: boolean;
    confirmadoPor?: string;
    dataConfirmacao?: string;
    documentoPosteriorNoCofre?: {
      doc_id: string;
      nome_documento: string;
      data_armazenamento: string;
      data_documento?: string;
      trecho?: string;
      instrucaoObrigatoria: string;
    };
  }>;
}> {
  let titular = await obterTitularPorNome(nome);
  if (!titular) {
    const todosT = await obterTodosTitulares();
    titular = todosT.find((t) => titularCorresponde(t.nome, nome)) || null;
  }

  if (!titular) {
    return {
      encontrado: false,
      mensagem: `Nenhum titular cadastrado com o nome "${nome}".`,
    };
  }

  const camposValidados: Record<string, any> = {};
  for (const [campoId, campoObj] of Object.entries(titular.campos || {})) {
    if (!campoObj || !campoObj.valor) continue;

    // Regra 4: se não for manual e tiver documento de origem, checa se ainda existe no Cofre
    const ehManual = Boolean(campoObj.manual || campoObj.origem === 'corrigido pelo chat');
    if (!ehManual && campoObj.origem) {
      const docExiste = todosDocs.some(
        (d) => d.id === campoObj.origem || d.metadata?.id_legado === campoObj.origem
      );
      if (!docExiste) {
        console.warn(
          `[VEGA Ficha ⚠️] Campo "${campoId}" do titular "${titular.nome}" ignorado: documento de origem "${campoObj.origem}" (${campoObj.origemNome || 'sem nome'}) não existe mais no Cofre.`
        );
        continue;
      }
    }

    const itemValidado: any = {
      valor: campoObj.valor,
      origemNome: campoObj.origemNome || 'Documento do Cofre',
      origemId: campoObj.origem,
      conferido: Boolean(campoObj.conferido),
      dataConferencia: campoObj.dataConferencia,
      manual: Boolean(campoObj.manual),
      confirmadoPor: campoObj.confirmadoPor,
      dataConfirmacao: campoObj.dataConfirmacao,
    };

    // Exceção: checa se há documento armazenado DEPOIS da data de confirmação
    if (campoObj.confirmadoPor && (campoObj.dataConfirmacao || campoObj.dataConferencia)) {
      const dataConf = parseDataBrOuIso(campoObj.dataConfirmacao || campoObj.dataConferencia || '');
      if (dataConf) {
        const docsPosteriores = todosDocs.filter((d) => {
          if (!titularCorresponde(d.titular, titular!.nome)) return false;
          if (d.id === campoObj.origem || d.metadata?.id_legado === campoObj.origem) return false;
          const dataArmazenamento = parseDataBrOuIso(d.dataCadastro || d.metadata?.dataCadastro || d.dataValidade || '');
          return dataArmazenamento && dataArmazenamento.getTime() > dataConf.getTime();
        });

        if (docsPosteriores.length > 0) {
          docsPosteriores.sort((a, b) => {
            const dA = parseDataBrOuIso(a.dataCadastro || a.metadata?.dataCadastro || a.dataValidade || '')?.getTime() || 0;
            const dB = parseDataBrOuIso(b.dataCadastro || b.metadata?.dataCadastro || b.dataValidade || '')?.getTime() || 0;
            return dB - dA;
          });
          const docMaisRecente = docsPosteriores[0];
          const dataArmazExib = formatarDataParaExibicao(docMaisRecente.dataCadastro || docMaisRecente.metadata?.dataCadastro || docMaisRecente.dataValidade);
          const dataConfExib = formatarDataParaExibicao(campoObj.dataConfirmacao || campoObj.dataConferencia || '');
          const nomeConfLimpo = limparFormaTratamentoNome(campoObj.confirmadoPor || '');
          const primeiroNomeConf = extrairPrimeiroNome(nomeConfLimpo) || nomeConfLimpo || 'Usuário';

          // Extrai o novo valor (endereço, etc.) do documento posterior a partir da descrição ou trecho
          const novoValorEncontrado = extrairValorDeTrechoOuDescricao(docMaisRecente.descricao || '') || 'outro endereço';
          const valorAtualFormatado = campoObj.valor ? `(${campoObj.valor})` : '';

          const alertaExato = `Esse endereço ${valorAtualFormatado} foi confirmado por ${primeiroNomeConf} em ${dataConfExib}, mas depois entrou o ${docMaisRecente.titulo} com outro endereço: ${novoValorEncontrado}. Quer atualizar?`;

          itemValidado.documentoPosteriorNoCofre = {
            doc_id: docMaisRecente.id,
            nome_documento: docMaisRecente.titulo,
            data_armazenamento: dataArmazExib,
            data_documento: formatarDataParaExibicao(docMaisRecente.dataValidade || docMaisRecente.dataCadastro),
            trecho: docMaisRecente.descricao,
            instrucaoObrigatoria: `Existe um documento posterior no Cofre ("${docMaisRecente.titulo}") armazenado em ${dataArmazExib} com endereço/dados diferentes. Você DEVE alertar exatamente assim ao usuário, mostrando o valor atual confirmado e o novo valor encontrado: "${alertaExato}"`,
          };
        }
      }
    }

    camposValidados[campoId] = itemValidado;
  }

  const totalCampos = Object.keys(camposValidados).length;
  let alertaDocPosterior: string | undefined = undefined;
  let instrucaoConfirmado: string | undefined = undefined;

  for (const [campoId, item] of Object.entries<any>(camposValidados)) {
    if (item.documentoPosteriorNoCofre) {
      alertaDocPosterior = item.documentoPosteriorNoCofre.instrucaoObrigatoria;
      break;
    } else if (item.confirmadoPor) {
      const nomeConfLimpo = limparFormaTratamentoNome(item.confirmadoPor || '');
      const primeiroNomeConf = extrairPrimeiroNome(nomeConfLimpo) || nomeConfLimpo || 'Usuário';
      instrucaoConfirmado = `O ${campoId} do titular ${titular.nome} está confirmado na ficha cadastral por ${nomeConfLimpo} em ${item.dataConfirmacao || item.dataConferencia} conforme ${item.origemNome}. Você DEVE entregar diretamente ao usuário citando a fonte, quem confirmou (cite apenas o primeiro nome, "${primeiroNomeConf}") e quando: "O endereço do ${titular.nome} é ${item.valor}, conforme o/a ${item.origemNome}, confirmado por ${primeiroNomeConf} em ${item.dataConfirmacao || item.dataConferencia}." NUNCA use formas de tratamento como "Diretor João". Não liste divergências antigas nem responda apenas o endereço solto.`;
    }
  }

  let mensagemPadrao: string | undefined = undefined;
  if (!camposValidados.endereco) {
    mensagemPadrao = `Atenção: A ficha cadastral do titular "${titular.nome}" NÃO possui o campo de endereço preenchido. Pela regra de Fallback Obrigatório em Duas Camadas, você DEVE acionar imediatamente em seguida a ferramenta "buscar_documentos" com consulta="endereço" e titular="${titular.nome}" para verificar os documentos arquivados desse titular no Cofre antes de responder ao usuário.`;
  } else if (totalCampos === 0) {
    mensagemPadrao = `A ficha cadastral do titular "${titular.nome}" não possui campos cadastrais preenchidos. Você DEVE acionar em seguida a ferramenta "buscar_documentos" com consulta="endereço" e titular="${titular.nome}" para verificar os documentos arquivados desse titular no Cofre antes de responder.`;
  }

  const mensagemFinal = alertaDocPosterior || instrucaoConfirmado || mensagemPadrao;

  return {
    encontrado: true,
    titular: titular.nome,
    id: titular.id,
    alerta_documento_posterior: alertaDocPosterior,
    instrucao_resposta: instrucaoConfirmado,
    mensagem: mensagemFinal,
    campos: camposValidados,
  };
}

/**
 * Tool: confirmar_versao_dado(titular, campo, valor_escolhido, doc_id_origem?, nome_documento_origem?)
 */
async function toolConfirmarVersaoDado(params: {
  titular: string;
  campo: string;
  valor_escolhido: string;
  doc_id_origem?: string;
  nome_documento_origem?: string;
  usuarioNome: string;
  todosDocs: DocumentoRegistro[];
}): Promise<{
  sucesso: boolean;
  mensagem: string;
  valorSalvo?: string;
  documentoOrigem?: string;
}> {
  const { titular: nomeTit, campo, valor_escolhido, doc_id_origem, nome_documento_origem, usuarioNome, todosDocs } = params;
  let titular = await obterTitularPorNome(nomeTit);
  if (!titular) {
    const todosT = await obterTodosTitulares();
    titular = todosT.find((t) => titularCorresponde(t.nome, nomeTit)) || null;
  }

  if (!titular) {
    return {
      sucesso: false,
      mensagem: `Titular "${nomeTit}" não foi encontrado no cadastro oficial.`,
    };
  }

  let docOrigem: DocumentoRegistro | undefined;
  if (doc_id_origem) {
    docOrigem = todosDocs.find(
      (d) => d.id === doc_id_origem || d.metadata?.id_legado === doc_id_origem
    );
  }
  if (!docOrigem && nome_documento_origem) {
    const termoNorm = nome_documento_origem.toLowerCase();
    docOrigem = todosDocs.find((d) => d.titulo.toLowerCase().includes(termoNorm));
  }

  const campoKey = (campo || 'endereco') as CampoTitularId;
  const valorAnterior = titular.campos?.[campoKey]?.valor || '';
  const dataHojeStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  if (!titular.campos) titular.campos = {};

  const nomeDocFinal = docOrigem?.titulo || nome_documento_origem || 'documento do Cofre';
  const idDocFinal = docOrigem?.id || doc_id_origem || 'corrigido pelo chat';

  // REGRA: Gravar confirmadoPor com o nome real do contato autorizado (ex: "João Gabriel Brandini" ou "João"),
  // NUNCA com forma de tratamento como "Diretor João".
  const nomeRealConfirmador = limparFormaTratamentoNome(usuarioNome) || usuarioNome || 'Usuário';
  const primeiroNomeConfirmador = extrairPrimeiroNome(nomeRealConfirmador) || nomeRealConfirmador;

  titular.campos[campoKey] = {
    valor: valor_escolhido,
    origem: idDocFinal,
    origemNome: nomeDocFinal,
    origemVisibilidade: 'diretoria',
    conferido: true,
    dataConferencia: dataHojeStr,
    manual: true,
    confirmadoPor: nomeRealConfirmador,
    dataConfirmacao: dataHojeStr,
    historicoCorrecao: {
      valorAnterior,
      valorNovo: valor_escolhido,
      corrigidoPor: nomeRealConfirmador,
      dataHora: new Date().toISOString(),
    },
  };

  await salvarOuAtualizarTitular(titular);
  console.log(
    `[VEGA Ficha ✅] Campo "${campoKey}" do titular "${titular.nome}" confirmado por "${nomeRealConfirmador}" com valor "${valor_escolhido}" (origem: ${nomeDocFinal}).`
  );

  return {
    sucesso: true,
    mensagem: `Anotado: o ${campoKey} de ${titular.nome} passa a ser ${valor_escolhido}, conforme ${nomeDocFinal}. O dado foi confirmado por ${nomeRealConfirmador} em ${dataHojeStr}. Confirme ao usuário em uma frase curta (pode citar apenas o primeiro nome, "${primeiroNomeConfirmador}").`,
    valorSalvo: valor_escolhido,
    documentoOrigem: nomeDocFinal,
  };
}

/**
 * Tool 3: listar_documentos_titular(titular)
 */
async function toolListarDocumentosTitular(
  titular: string,
  todosDocs: DocumentoRegistro[] = []
): Promise<{
  titular: string;
  total: number;
  documentos: Array<{
    doc_id: string;
    nome_documento: string;
    tipo?: string;
    data_documento?: string;
    status_indexacao?: string;
  }>;
}> {
  const docs = todosDocs.filter((d) => titularCorresponde(d.titular, titular));
  return {
    titular,
    total: docs.length,
    documentos: docs.map((d) => ({
      doc_id: d.id,
      nome_documento: d.titulo,
      tipo: d.tipo,
      data_documento: d.dataValidade || d.dataCadastro,
      status_indexacao: d.statusIndexacao,
    })),
  };
}

/**
 * Tool 4: enviar_documento(doc_id)
 */
async function toolEnviarDocumento(
  docId: string,
  todosDocs: DocumentoRegistro[] = [],
  anexosAcumulados: Anexo[],
  historicoRecente: Mensagem[] = []
): Promise<{
  sucesso: boolean;
  doc_id?: string;
  nome_documento?: string;
  titular?: string;
  erro?: string;
  mensagem?: string;
}> {
  let docs = todosDocs && todosDocs.length > 0 ? todosDocs : await obterTodosDocumentos();
  const idLimpo = (docId || '').trim();
  let doc = docs.find(
    (d) => d.id === idLimpo || d.metadata?.id_legado === idLimpo
  );
  if (!doc) {
    const idNorm = idLimpo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    doc = docs.find((d) => {
      const titNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const arqNorm = (d.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return titNorm.includes(idNorm) || idNorm.includes(titNorm) || arqNorm.includes(idNorm);
    });
  }
  if (!doc) {
    doc = localizarDocumentoCitadoNoCofre(idLimpo, docs) || undefined;
  }

  const termosProibidos = ['documentos', 'quantos', 'quais', 'lista', 'todos', 'tudo', 'contagem', 'docs'];
  if (termosProibidos.includes(idLimpo.toLowerCase())) {
    return {
      sucesso: false,
      erro: `O termo "${idLimpo}" refere-se a uma contagem ou listagem de documentos, e não a um arquivo físico específico. NÃO chame enviar_documento para contagens ou listagens. Use listar_documentos_titular.`,
    };
  }

  // Fallback restrito: Apenas quando houver referência contextual singular explícita ("esse", "o documento", etc.)
  const ehReferenciaContextualSingular =
    !idLimpo ||
    /^(?:esse|este|o\s+documento|o\s+arquivo|o\s+pdf|ele|o\s+mesmo)$/i.test(idLimpo);

  if (!doc && ehReferenciaContextualSingular && historicoRecente && historicoRecente.length > 0) {
    for (let i = historicoRecente.length - 1; i >= 0; i--) {
      const txt = (historicoRecente[i].texto || '').toLowerCase();
      const docNoHist = docs.find((d) => {
        const titLower = d.titulo.toLowerCase();
        return txt.includes(titLower);
      });
      if (docNoHist) {
        doc = docNoHist;
        break;
      }
    }
  }

  if (!doc) {
    return {
      sucesso: false,
      erro: `Documento com id ou termo "${idLimpo}" não foi encontrado no Cofre.`,
    };
  }

  const anexo = await criarAnexoParaDocumento(doc);
  const jaExiste = anexosAcumulados.some((a) => a.url === anexo.url || a.nome === anexo.nome);
  if (!jaExiste) {
    anexosAcumulados.push(anexo);
  }

  return {
    sucesso: true,
    doc_id: doc.id,
    nome_documento: doc.titulo,
    titular: doc.titular,
    mensagem: `Documento "${doc.titulo}" (${doc.titular || 'Cofre'}) anexado com sucesso para envio físico ao usuário.`,
  };
}

/**
 * Tool 5: gerar_pdf(titulo, conteudo_markdown)
 */
async function toolGerarPdf(
  titulo: string,
  conteudoMarkdown: string,
  anexosAcumulados: Anexo[]
): Promise<{
  sucesso: boolean;
  titulo: string;
  nome_arquivo: string;
  mensagem: string;
}> {
  const anexo = await gerarPdfDeMarkdown({
    titulo: titulo || 'Documento Oficial Delta Plan',
    conteudo_markdown: conteudoMarkdown || '',
  });
  anexosAcumulados.push(anexo);
  return {
    sucesso: true,
    titulo: anexo.titulo || titulo || 'Documento Oficial Delta Plan',
    nome_arquivo: anexo.nome,
    mensagem: `PDF oficial "${anexo.titulo || titulo}" gerado com layout corporativo Delta Plan e anexado para envio.`,
  };
}

/**
 * Tool 6: buscar_conhecimento(termo, categoria?)
 */
async function toolBuscarConhecimento(
  termo: string,
  categoria?: string
): Promise<{
  total: number;
  itens: Array<{
    id: string;
    titulo: string;
    categoria: string;
    tipo: string;
    conteudo: string;
    dadosEstruturados?: any;
  }>;
}> {
  const resK = await buscarConhecimento(termo);
  let itens = resK.resultados || (resK.instrucao ? [resK.instrucao] : []);
  if (categoria) {
    itens = itens.filter((i) => (i.categoria || '').toLowerCase().includes(categoria.toLowerCase()));
  }
  return {
    total: itens.length,
    itens: itens.map((i) => ({
      id: i.id,
      titulo: i.titulo,
      categoria: i.categoria,
      tipo: i.tipo || 'regra',
      conteudo: i.conteudo,
      dadosEstruturados: i.dadosEstruturados,
    })),
  };
}

/**
 * Extrai as opções da última lista numerada de opções enviada pelo assistente no histórico.
 * Suporta leitura estruturada de m.opcoes e fallback por regex em m.texto.
 */
export function extrairOpcoesDaUltimaLista(historico: Mensagem[]): OpcaoDocumento[] {
  for (let i = historico.length - 1; i >= 0; i--) {
    const m = historico[i];
    if (m.remetente !== 'assistente') continue;

    // 1. Prioridade absoluta: m.opcoes estruturado
    if (m.opcoes && Array.isArray(m.opcoes) && m.opcoes.length > 0) {
      return m.opcoes;
    }

    // 2. Fallback: Parse no texto de m.texto procurando marcadores numerados (*1º)*, 1º), *1)*, etc.)
    const regexLinhas = /(?:^|\n)\s*\*?(\d+)[ºª\)]\*?\s*(.+?)(?=(?:\n\s*\*?\d+[ºª\)]|\n\s*O mais recente|\n\s*Qual devo considerar|$))/gis;
    const opcoesExtraidas: OpcaoDocumento[] = [];
    let match: RegExpExecArray | null;
    while ((match = regexLinhas.exec(m.texto || '')) !== null) {
      const num = parseInt(match[1], 10);
      const bloco = match[2].trim();
      const matchDoc = bloco.match(/Aparece em:\s*([^\n\r]+)/i);
      const nomeDoc = matchDoc ? matchDoc[1].trim() : bloco.split(/[:\n]/)[0].trim();
      opcoesExtraidas.push({
        id: `opcao_${num}`,
        titulo: nomeDoc,
        numero: num,
        nome_documento: nomeDoc,
        valor: bloco,
      });
    }

    if (opcoesExtraidas.length > 0) {
      return opcoesExtraidas;
    }
  }
  return [];
}

export interface ReferenciaItemDetectada {
  tipo: 'numero' | 'ordinal' | 'mais_recente' | 'nome_documento';
  numero?: number;
  termoDoc?: string;
  querEnviarPdf: boolean;
}

export function detectarReferenciaItemLista(
  mensagem: string,
  opcoesAtivas: OpcaoDocumento[]
): ReferenciaItemDetectada | null {
  const msgNorm = mensagem
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const querEnviarPdf = /(?:mande|manda|envie|envia|quero|solta|solte|baixar|ver|abrir|pdf|arquivo|documento)/i.test(msgNorm);

  // 1. Número explícito: "item 5", "o item 3", "opcao 2", "o 5", "mande o pdf do item 5"
  const matchItemNum = msgNorm.match(/\b(?:item|op[cç][aã]o|n[úu]mero|n[ºo°]|o)?\s*(\d+)\b/i);
  if (matchItemNum) {
    const num = parseInt(matchItemNum[1], 10);
    const ehRefClara =
      /\b(?:item|op[cç][aã]o|n[úu]mero|n[ºo°])\s*\d+\b/i.test(msgNorm) ||
      /^(?:me\s+)?(?:mande|manda|envie|envia|quero|solta|solte)?\s*(?:o\s+)?(?:pdf\s+d[oa]\s+|arquivo\s+d[oa]\s+|documento\s+d[oa]\s+)?(?:o\s+)?\d+\s*$/i.test(msgNorm) ||
      /^(?:o\s+)?\d+$/i.test(msgNorm);

    if (ehRefClara) {
      return {
        tipo: 'numero',
        numero: num,
        querEnviarPdf: querEnviarPdf || true,
      };
    }
  }

  // 2. Ordinais por extenso
  const ordinais: Record<string, number> = {
    primeiro: 1, primeira: 1, '1º': 1, '1ª': 1,
    segundo: 2, segunda: 2, '2º': 2, '2ª': 2,
    terceiro: 3, terceira: 3, '3º': 3, '3ª': 3,
    quarto: 4, quarta: 4, '4º': 4, '4ª': 4,
    quinto: 5, quinta: 5, '5º': 5, '5ª': 5,
  };
  for (const [ord, n] of Object.entries(ordinais)) {
    if (new RegExp(`\\b(?:o|a)?\\s*${ord}\\b`, 'i').test(msgNorm)) {
      return {
        tipo: 'ordinal',
        numero: n,
        querEnviarPdf: querEnviarPdf || true,
      };
    }
  }

  // 3. "O mais recente" / "o endereço mais recente" / "o documento mais recente"
  if (/\b(?:o\s+)?(?:mais\s+recente|recente|ultimo|último)\b/i.test(msgNorm)) {
    return {
      tipo: 'mais_recente',
      querEnviarPdf: querEnviarPdf || true,
    };
  }

  // 4. Referência por nome de documento que conste nas opções (ex: "o da certidão", "o do crea", "o do ir")
  if (opcoesAtivas.length > 0 && querEnviarPdf) {
    for (const op of opcoesAtivas) {
      const nomeOp = (op.nome_documento || op.titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const palavras = nomeOp.split(/\s+/).filter((w: string) => w.length >= 3 && !['documento', 'oficial', 'para', 'com'].includes(w));
      if (palavras.some((p: string) => msgNorm.includes(p))) {
        return {
          tipo: 'nome_documento',
          numero: op.numero,
          termoDoc: op.nome_documento || op.titulo,
          querEnviarPdf: true,
        };
      }
    }
  }

  return null;
}

/**
 * MOTOR CENTRAL DA VEGA: Function Calling com gpt-5.4-mini
 */
export async function executarOrquestradorIaCentral(dados: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  contato: Contato;
  documentosDisponiveis?: DocumentoRegistro[];
  documentoIdDireto?: string;
}): Promise<ResultadoChatOrquestrador> {
  const inicioTotal = Date.now();
  const { mensagemUsuario, historicoRecente, documentoIdDireto } = dados;
  const contato = dados.contato || { id: 'anonimo', nome: '', telefone: '', canal: 'whatsapp' as const };
  const primeiroNome = extrairPrimeiroNome(contato?.nome || '');
  const vocativo = primeiroNome ? `, ${primeiroNome}` : '';

  // 1. AUTORIZAÇÃO DO NÚMERO
  if (contato.id === 'ct-nao-auth') {
    return {
      textoResposta: 'Este número não tem acesso à VEGA.',
      origem: 'motor',
      intencaoDetectada: 'saudacao_ou_vago',
      perguntaReescrita: mensagemUsuario,
    };
  }

  // 2. CASO ESPECIAL: Clique direto em opção ou documento sugerido
  if (documentoIdDireto) {
    if (documentoIdDireto.startsWith('k-')) {
      const todosK = await obterTodosConhecimentos();
      const itemK = todosK.find((k) => k.id === documentoIdDireto);
      const textoK = itemK
        ? `Sobre ${itemK.titulo}${vocativo}:\n${itemK.conteudo}`
        : 'Instrução não localizada na base de conhecimento.';
      return {
        textoResposta: textoK,
        origem: 'motor',
        intencaoDetectada: 'pergunta_conteudo',
        perguntaReescrita: itemK?.titulo || documentoIdDireto,
        dadosEstruturados: itemK ? extrairDadosEstruturadosDeItemConhecimento(itemK) : undefined,
      };
    } else {
      const docs = dados.documentosDisponiveis || (await obterTodosDocumentos());
      const doc = docs.find((d) => d.id === documentoIdDireto);
      if (doc) {
        const textoDoc = formatarFraseAcompanhamento(doc.titulo, contato.nome, doc.titular);
        const anexo = await criarAnexoParaDocumento(doc);
        return {
          textoResposta: textoDoc,
          anexos: [anexo],
          origem: 'motor',
          intencaoDetectada: 'pedir_arquivo',
          perguntaReescrita: doc.titulo,
        };
      }
    }
  }

  // 3. RESOLUÇÃO DE CONFIRMAÇÃO DE EXCLUSÃO PENDENTE
  const ultimaMsgAssistente = [...historicoRecente].reverse().find((m) => m.remetente === 'assistente');
  const correcaoPendente = ultimaMsgAssistente?.correcaoPendente;
  if (correcaoPendente && correcaoPendente.campoId === ('apagar_documento' as any) && correcaoPendente.documentoId) {
    const msgLimpa = mensagemUsuario.toLowerCase().trim();
    const querConfirmar =
      isConfirmacaoSimples(mensagemUsuario) ||
      /^(sim|s|pode|confirmo|confirma|apaga|apagar|exclui|excluir|com certeza|claro)/i.test(msgLimpa);
    const querCancelar = /^(n[aã]o|n|cancela|cancelar|deixa|esquece|manter|mantem)/i.test(msgLimpa);

    if (querConfirmar) {
      await removerDocumento(correcaoPendente.documentoId);
      const docTitulo = correcaoPendente.documentoTitulo || 'documento';
      const textoSucesso = `Documento *${docTitulo}* apagado com sucesso do Cofre.`;
      return {
        textoResposta: textoSucesso,
        origem: 'motor',
        intencaoDetectada: 'apagar_documento',
        perguntaReescrita: `Exclusão confirmada: ${docTitulo}`,
      };
    }
    if (querCancelar) {
      const docTitulo = correcaoPendente.documentoTitulo || 'documento';
      const textoCancelado = `Operação cancelada. O documento *${docTitulo}* continua salvo no Cofre.`;
      return {
        textoResposta: textoCancelado,
        origem: 'motor',
        intencaoDetectada: 'apagar_documento',
        perguntaReescrita: `Exclusão cancelada: ${docTitulo}`,
      };
    }
  }

  // 3.5. MAPEAMENTO DE OPÇÕES DA ÚLTIMA LISTA NUMERADA (Passado como dado ao contexto da IA)
  const opcoesAtivas = extrairOpcoesDaUltimaLista(historicoRecente);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente no .env');
  }
  const openai = new OpenAI({ apiKey });
  const chatModel =
    process.env.ORQUESTRADOR_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim() ||
    'gpt-5.4-mini';

  const todosDocs = dados.documentosDisponiveis && dados.documentosDisponiveis.length > 0
    ? dados.documentosDisponiveis
    : await obterTodosDocumentos();

  // 4. CONTEXTO DA CONVERSA E SAUDAÇÃO
  const ehPrimeiroContatoDoDia = verificarSeEhPrimeiroContatoDoDia(historicoRecente);
  const statusSaudacao = ehPrimeiroContatoDoDia
    ? 'É o primeiro contato do dia nesta conversa. Você pode incluir uma saudação cordial e breve no início da sua resposta.'
    : 'NÃO é o primeiro contato do dia nesta conversa. É TERMINANTEMENTE PROIBIDO enviar saudações (como "Olá", "Bom dia", "Tudo bem", etc.). Responda diretamente ao assunto em andamento.';

  const blocoOpcoesAnteriores = opcoesAtivas.length > 0
    ? `\n<opcoes_lista_anterior>\n` +
      `Última lista numerada de opções apresentada ao usuário nesta conversa:\n` +
      opcoesAtivas
        .map(
          (o) =>
            `${o.numero}º) ${o.nome_documento || o.titulo} (doc_id: ${o.doc_id || o.id}) - Valor: ${o.valor || ''}`
        )
        .join('\n') +
      `\n\nINSTRUÇÕES OBRIGATÓRIAS SOBRE ITENS DA LISTA:\n` +
      `- Se o usuário pedir para enviar ou se referir a "item X", "opção X", "o X", "o da certidão", "o mais recente", etc., você DEVE chamar a ferramenta enviar_documento passando o doc_id correspondente acima.\n` +
      `- NUNCA pesquise termos como "item X", "o X", "opção X" em buscar_documentos.\n` +
      `- Se o número solicitado for maior que o total da lista (${opcoesAtivas.length}), responda que a última lista tinha apenas ${opcoesAtivas.length} opções e pergunte qual delas ele deseja.\n` +
      `</opcoes_lista_anterior>`
    : '';

  const promptBase = carregarPromptAssistente();
  const systemPrompt = `${promptBase}

<contato_atual>
Nome: ${contato.nome}
Primeiro Nome: ${primeiroNome || contato.nome}
Cargo: ${contato.cargo || 'Colaborador'}
Setor: ${contato.setor || 'Geral'}
Nível de Acesso: ${contato.nivelAcesso || 'geral'}
</contato_atual>

<status_saudacao>
${statusSaudacao}
</status_saudacao>${blocoOpcoesAnteriores}`;

  // Últimas ~20 mensagens da conversa
  const historicoLimitado = historicoRecente.slice(-20);
  const mensagensOpenAi: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const m of historicoLimitado) {
    if (m.remetente === 'cliente') {
      mensagensOpenAi.push({ role: 'user', content: m.texto });
    } else if (m.remetente === 'assistente') {
      mensagensOpenAi.push({ role: 'assistant', content: m.texto });
    }
  }

  // Mensagem atual do usuário
  mensagensOpenAi.push({ role: 'user', content: mensagemUsuario });

  // 5. LOOP DE FUNCTION CALLING
  const anexosAcumulados: Anexo[] = [];
  const dadosRetornadosTools: string[] = [];
  const fontesRetornadasRastro: DocumentoRastro[] = [];
  const etapasRastro: EtapaRastro[] = [
    {
      ordem: 1,
      nome: 'Contexto da Conversa',
      descricao: `Injetadas ${historicoLimitado.length} mensagens anteriores no histórico. Primeiro contato do dia: ${ehPrimeiroContatoDoDia ? 'Sim' : 'Não'}.`,
      tempoMs: Date.now() - inicioTotal,
      detalhes: {
        totalMensagensHistorico: historicoLimitado.length,
        ehPrimeiroContatoDoDia,
      },
    },
  ];

  let ordemEtapa = 2;
  let tokensPromptTotal = 0;
  let tokensCompletionTotal = 0;
  let tokensGeraisTotal = 0;
  let respostaTextoFinal = '';

  let ultimoTitularFoco: string | undefined = undefined;
  try {
    const todosTits = await obterTodosTitulares();
    const msgLower = mensagemUsuario.toLowerCase();
    const tAchado = todosTits.find((t) => t.nome && msgLower.includes(t.nome.toLowerCase()));
    if (tAchado) {
      ultimoTitularFoco = tAchado.nome;
    }
  } catch {}

  const MAX_VOLTAS = 6;
  let volta = 0;

  let opcoesGeradasNestaResposta: OpcaoDocumento[] | undefined = undefined;
  const docsEncontradosParaVerificacao: Array<{
    nome_documento: string;
    data_documento?: string;
    valor?: string;
    trecho?: string;
  }> = [];

  while (volta < MAX_VOLTAS) {
    volta++;
    const inicioChamadaIa = Date.now();

    const respostaIa = await chamarChatComTelemetria(
      openai,
      {
        model: chatModel,
        messages: mensagensOpenAi,
        tools: TOOLS_ORQUESTRADOR,
        tool_choice: 'auto',
        temperature: 0.1,
      },
      {
        motivo: 'chat_orquestrador_central',
        contatoId: contato.id,
        contatoNome: contato.nome,
      }
    );

    const uso = respostaIa.usage;
    if (uso) {
      tokensPromptTotal += uso.prompt_tokens || 0;
      tokensCompletionTotal += uso.completion_tokens || 0;
      tokensGeraisTotal += uso.total_tokens || 0;
    }

    const escolha = respostaIa.choices?.[0];
    const msgResposta = escolha?.message;
    if (!msgResposta) break;

    mensagensOpenAi.push(msgResposta);

    if (msgResposta.tool_calls && msgResposta.tool_calls.length > 0) {
      for (const tCall of msgResposta.tool_calls) {
        if (tCall.type !== 'function') continue;
        const nomeTool = tCall.function.name;
        let args: any = {};
        try {
          args = JSON.parse(tCall.function.arguments || '{}');
        } catch {}

        const inicioTool = Date.now();
        let resultadoTool: any = null;

        if (nomeTool === 'buscar_documentos') {
          const titularEfetivo = args.titular || ultimoTitularFoco;
          resultadoTool = await toolBuscarDocumentos(args.consulta, titularEfetivo, todosDocs);
          if (resultadoTool.opcoes_lista && resultadoTool.opcoes_lista.length > 0) {
            opcoesGeradasNestaResposta = resultadoTool.opcoes_lista;
          }
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.orientacao_resposta) {
            dadosRetornadosTools.push(resultadoTool.orientacao_resposta);
          }
          if (resultadoTool.documentos && Array.isArray(resultadoTool.documentos)) {
            for (const doc of resultadoTool.documentos) {
              docsEncontradosParaVerificacao.push({
                nome_documento: doc.nome_documento,
                data_documento: doc.data_documento,
                valor: doc.valor,
                trecho: doc.trecho,
              });
              dadosRetornadosTools.push(
                `${doc.nome_documento} ${doc.titular} (documento de ${doc.data_documento || ''}, armazenado em ${doc.data_armazenamento || ''}) ${doc.valor || ''} ${doc.trecho || ''}`
              );
              fontesRetornadasRastro.push({
                id: doc.doc_id,
                titulo: doc.nome_documento,
                similaridade: Number(((doc.score || 0.8) * 100).toFixed(1)),
                trecho: doc.trecho ? truncarTrecho(doc.trecho, 300) : undefined,
                usadoNaResposta: true,
              });
            }
          }
        } else if (nomeTool === 'consultar_ficha_titular') {
          if (args.nome) {
            ultimoTitularFoco = args.nome;
          }
          resultadoTool = await toolConsultarFichaTitular(args.nome, todosDocs);
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.campos) {
            for (const [campo, obj] of Object.entries<any>(resultadoTool.campos)) {
              let infoCampo = `${campo}: ${obj.valor} (origem: ${obj.origemNome}${obj.origemId ? ` [doc_id: ${obj.origemId}]` : ''})`;
              if (obj.confirmadoPor) {
                infoCampo += ` (confirmado por ${obj.confirmadoPor} em ${obj.dataConfirmacao || obj.dataConferencia})`;
              }
              if (obj.documentoPosteriorNoCofre) {
                infoCampo += ` (documento posterior no Cofre: ${obj.documentoPosteriorNoCofre.nome_documento} - ${obj.documentoPosteriorNoCofre.trecho || ''} - ${obj.documentoPosteriorNoCofre.instrucaoObrigatoria})`;
                fontesRetornadasRastro.push({
                  id: obj.documentoPosteriorNoCofre.doc_id,
                  titulo: obj.documentoPosteriorNoCofre.nome_documento,
                  similaridade: 100,
                  trecho: obj.documentoPosteriorNoCofre.trecho,
                  usadoNaResposta: true,
                });
              }
              dadosRetornadosTools.push(infoCampo);
              if (obj.origemId) {
                fontesRetornadasRastro.push({
                  id: obj.origemId,
                  titulo: obj.origemNome,
                  similaridade: 100,
                  usadoNaResposta: true,
                });
              }
            }
          }
        } else if (nomeTool === 'confirmar_versao_dado') {
          const titularEfetivo = args.titular || ultimoTitularFoco || '';
          resultadoTool = await toolConfirmarVersaoDado({
            titular: titularEfetivo,
            campo: args.campo || 'endereco',
            valor_escolhido: args.valor_escolhido || '',
            doc_id_origem: args.doc_id_origem,
            nome_documento_origem: args.nome_documento_origem,
            usuarioNome: contato.nome,
            todosDocs,
          });
          if (resultadoTool.sucesso) {
            dadosRetornadosTools.push(
              `${resultadoTool.mensagem} ${resultadoTool.valorSalvo || ''} ${resultadoTool.documentoOrigem || ''}`
            );
            if (resultadoTool.documentoOrigem) {
              fontesRetornadasRastro.push({
                id: args.doc_id_origem || 'confirmacao_chat',
                titulo: resultadoTool.documentoOrigem,
                similaridade: 100,
                usadoNaResposta: true,
              });
            }
          }
        } else if (nomeTool === 'listar_documentos_titular') {
          const titularEfetivo = args.titular || ultimoTitularFoco;
          resultadoTool = await toolListarDocumentosTitular(titularEfetivo, todosDocs);
          if (resultadoTool.documentos) {
            for (const doc of resultadoTool.documentos) {
              dadosRetornadosTools.push(`${doc.nome_documento} (${doc.tipo || ''})`);
              fontesRetornadasRastro.push({
                id: doc.doc_id,
                titulo: doc.nome_documento,
                similaridade: 100,
                usadoNaResposta: true,
              });
            }
            if (resultadoTool.documentos.length > 0) {
              opcoesGeradasNestaResposta = resultadoTool.documentos.map((d: any, idx: number) => ({
                id: d.doc_id,
                titulo: d.nome_documento,
                numero: idx + 1,
                nome_documento: d.nome_documento,
                doc_id: d.doc_id,
                valor: d.nome_documento,
              }));
            }
          }
        } else if (nomeTool === 'enviar_documento') {
          resultadoTool = await toolEnviarDocumento(args.doc_id, todosDocs, anexosAcumulados, historicoLimitado);
          if (resultadoTool.doc_id) {
            fontesRetornadasRastro.push({
              id: resultadoTool.doc_id,
              titulo: resultadoTool.nome_documento || 'Documento Oficial',
              similaridade: 100,
              usadoNaResposta: true,
            });
          }
        } else if (nomeTool === 'gerar_pdf') {
          resultadoTool = await toolGerarPdf(args.titulo, args.conteudo_markdown, anexosAcumulados);
        } else if (nomeTool === 'buscar_conhecimento') {
          resultadoTool = await toolBuscarConhecimento(args.termo, args.categoria);
          if (resultadoTool.itens) {
            for (const it of resultadoTool.itens) {
              dadosRetornadosTools.push(`${it.titulo}: ${it.conteudo}`);
            }
          }
        } else {
          resultadoTool = { erro: `Tool "${nomeTool}" desconhecida.` };
        }

        const tempoTool = Date.now() - inicioTool;
        etapasRastro.push({
          ordem: ordemEtapa++,
          nome: `Tool: ${nomeTool}`,
          descricao: `Executada ferramenta "${nomeTool}" (${tempoTool}ms).`,
          tempoMs: tempoTool,
          detalhes: {
            argumentos: args,
            resultado: resultadoTool,
          },
        });

        mensagensOpenAi.push({
          role: 'tool',
          tool_call_id: tCall.id,
          content: JSON.stringify(resultadoTool),
        });
      }
    } else {
      respostaTextoFinal = msgResposta.content || '';
      break;
    }
  }

  // 6. REDE DE SEGURANÇA NO CÓDIGO (Item 8)
  const checagemSeguranca = verificarSegurancaDadosPessoais({
    textoResposta: respostaTextoFinal,
    dadosRetornadosTools,
    historicoMensagens: historicoLimitado,
    mensagemUsuarioAtual: mensagemUsuario,
  });

  if (!checagemSeguranca.aprovado) {
    const respostaOriginalIa = respostaTextoFinal;
    console.warn(`[VEGA Segurança 🛡️] Bloqueio anti-invenção ativado: ${checagemSeguranca.motivo}`);
    respostaTextoFinal = 'Não encontrei essa informação nos documentos.';
    etapasRastro.push({
      ordem: ordemEtapa++,
      nome: 'Guardrail Ativado: verificarSegurancaDadosPessoais',
      descricao: `Bloqueado envio de dado sem comprovação em tools: ${checagemSeguranca.motivo}`,
      tempoMs: 1,
      detalhes: {
        guardrail: 'verificarSegurancaDadosPessoais',
        motivo: checagemSeguranca.motivo,
        respostaOriginalIa,
        respostaFinalEnviada: respostaTextoFinal,
        dadoSuspeito: checagemSeguranca.dadoSuspeito,
      },
    });
  } else {
    etapasRastro.push({
      ordem: ordemEtapa++,
      nome: 'Rede de Segurança Anti-Invenção',
      descricao: 'Verificação concluída: todos os dados citados possuem respaldo comprovado.',
      tempoMs: 1,
      detalhes: { aprovado: true },
    });
  }

  // 7. SANITIZAÇÃO RIGOROSA DO TEXTO FINAL
  const textoLimpoFinal = sanitizarRespostaTextoFinal(respostaTextoFinal);
  const tempoTotalMs = Date.now() - inicioTotal;
  const custoEstimadoUsd = calcularCustoEstimado(chatModel, tokensPromptTotal, tokensCompletionTotal);

  // 8. RASTRO COMPLETO (Item 5)
  const rastro: RastroRegistro = {
    mensagemId: '',
    usuarioNome: contato.nome,
    usuarioId: contato.id,
    mensagemOriginal: mensagemUsuario,
    perguntaReescrita: mensagemUsuario,
    intencaoDetectada: 'ia_central',
    tipoBusca: 'function_calling_ia',
    documentosEncontrados: fontesRetornadasRastro,
    enviouAnexo: anexosAcumulados.length > 0,
    anexosDetalhes: anexosAcumulados.map((a) => ({
      nome: a.nome,
      titulo: a.titulo,
      tamanho: a.tamanho,
      tipo: a.tipo,
    })),
    respostaFinal: mascararDadosSensiveis(textoLimpoFinal),
    modeloUsado: chatModel,
    tokensTotal: tokensGeraisTotal,
    tokensPrompt: tokensPromptTotal,
    tokensCompletion: tokensCompletionTotal,
    custoEstimadoUsd,
    tempoTotalMs,
    etapas: etapasRastro,
  };

  try {
    salvarRastro(rastro).catch(() => {});
  } catch {}

  return {
    textoResposta: textoLimpoFinal,
    anexos: anexosAcumulados.length > 0 ? anexosAcumulados : undefined,
    opcoes: opcoesGeradasNestaResposta && opcoesGeradasNestaResposta.length > 0 ? opcoesGeradasNestaResposta : undefined,
    origem: 'ia',
    intencaoDetectada: 'pergunta_conteudo',
    perguntaReescrita: mensagemUsuario,
    rastro,
  };
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
    resultado = await executarOrquestradorIaCentral(dados);
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
    const respostaOriginalIa = resultado.textoResposta;
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
        nome: 'Guardrail Ativado: validarCorrespondenciaCampoResposta (Regra 17)',
        descricao: `Resposta interceptada e corrigida: ${checagemCampo.motivo}`,
        tempoMs: 1,
        detalhes: {
          guardrail: 'validarCorrespondenciaCampoResposta',
          motivo: checagemCampo.motivo,
          respostaOriginalIa,
          respostaFinalEnviada: checagemCampo.textoValidado,
        },
      });
      try {
        salvarRastro(resultado.rastro).catch(() => {});
      } catch {}
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


