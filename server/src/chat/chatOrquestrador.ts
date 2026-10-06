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
  removerConhecimento,
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
  obterDocumentosFaltantes,
  formatarTipoDocumentoLegivel,
  validarTipoDocumentoReconhecivel,
} from '../documentosFaltantesService.js';
import {
  verificarDadoDisponivelEmOutroDocumento,
  obterArtigoDefinido,
  obterPreposicaoTitular,
} from '../busca/equivalenciaService.js';
import { buscarConhecimento } from '../busca/motorConhecimento.js';
import { extrairEValidarDadoDocumental } from '../utils/validacaoDocumentalUtils.js';
import {
  Contato,
  DocumentoRegistro,
  Anexo,
  Mensagem,
  CampoTitularId,
  ItemConhecimento,
  TipoConhecimento,
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
import {
  extrairCatalogoPessoas,
  verificarCorrespondenciaNomePessoa,
} from '../utils/correspondenciaPessoaService.js';
import { criarAnexoParaDocumento, gerarPdfDeMarkdown } from '../pdfService.js';
import { mascararDadosSensiveis, mascararDocumento, truncarTrecho } from '../utils/segurancaUtils.js';
import { gerarLinksNavegacao } from '../utils/geoLinks.js';
import { salvarRastro } from '../rastros/rastroService.js';
import {
  executarRoteadorIa,
  executarBuscaRestrita,
  responderComTrechosRestritos,
  DecisaoRoteador,
} from '../busca/roteadorBuscaService.js';

export function normalizarParaComparacao(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

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
    const titularNorm = (d.titular || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const partesTitular = titularNorm.split(/\s+/).filter((p) => p.length >= 2);
    const stopWordsDoc = new Set(['documento', 'delta', 'plan', 'para', 'com', ...partesTitular]);
    const palavrasTitulo = tNorm.split(/\s+/).filter(
      (w) => w.length >= 3 && !stopWordsDoc.has(w)
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
    let melhorDoc: DocumentoRegistro | null = null;
    let maxBates = 0;
    for (const d of docsDoTipo) {
      const textoCompleto = `${d.titulo} ${d.arquivo} ${d.titular || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const bates = palavrasTermo.filter((p) => textoCompleto.includes(p)).length;
      if (bates > maxBates) {
        maxBates = bates;
        melhorDoc = d;
      } else if (bates === maxBates && maxBates > 0) {
        // Empate no desempate
        melhorDoc = null;
      }
    }
    // NUNCA fazer fallback cego para docsDoTipo[0] se não houve desempate inequívoco
    if (melhorDoc && maxBates > 0) {
      return melhorDoc;
    }
    return null;
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
 */
export const JANELA_CONTEXTO_MENSAGENS = 30;

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
  localizacao?: {
    latitude: number;
    longitude: number;
    nome?: string;
    endereco?: string;
    linkMaps?: string;
  };
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
    const titular = d.titular || item.titulo;
    const tipoChave = d.tipoChave || 'Chave';
    const chave = d.chave || item.conteudo;
    const bancoLinha = d.banco ? `\n*Banco:* ${d.banco}` : '';
    const titularLinha = d.titular ? `\n*Titular:* ${d.titular}` : '';

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
      // Match estruturado por pontuação para evitar retorno cego do primeiro item que casar uma palavra solta
      const candidatosPix: { item: ItemConhecimento; pontos: number }[] = [];
      for (const p of itensPix) {
        const dados = (p.dadosEstruturados as any) || {};
        const titular = dados.titular ? normalizarParaBusca(dados.titular) : '';
        const titItem = normalizarParaBusca(p.titulo);
        const partesTitular = titular ? titular.split(/\s+/).filter((pt: string) => pt.length >= 3) : [];
        const matchPartes = partesTitular.length > 0 ? partesTitular.filter((pt: string) => termoNorm.includes(pt)).length : 0;

        const titItemSemGenerico = titItem.replace(/\b(chave|pix)\b/g, '').trim();
        const partesTitItem = titItemSemGenerico ? titItemSemGenerico.split(/\s+/).filter((pt: string) => pt.length >= 3) : [];
        const matchPartesTit = partesTitItem.length > 0 ? partesTitItem.filter((pt: string) => termoNorm.includes(pt)).length : 0;

        let pontos = 0;
        if (titular && termoNorm === titular) pontos += 100;
        else if (titItemSemGenerico && termoNorm === titItemSemGenerico) pontos += 100;
        else if (titular && (termoNorm.includes(titular) || titular.includes(termoNorm))) pontos += 80;
        else if (titItemSemGenerico && (termoNorm.includes(titItemSemGenerico) || titItemSemGenerico.includes(termoNorm))) pontos += 80;
        else if (matchPartes > 0 || matchPartesTit > 0) pontos += (matchPartes + matchPartesTit) * 20;

        if (pontos > 0) {
          candidatosPix.push({ item: p, pontos });
        }
      }

      if (candidatosPix.length > 0) {
        candidatosPix.sort((a, b) => b.pontos - a.pontos);
        // Retorna apenas se o melhor candidato tiver pontuação superior aos demais (sem ambiguidade cega)
        if (candidatosPix.length === 1 || candidatosPix[0].pontos > candidatosPix[1].pontos) {
          return { item: candidatosPix[0].item, score: 100 };
        }
        // Se houver empate/ambiguidade, não seleciona nenhum arbitrariamente
        return null;
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
  const candidatosTitulo = conhecimentos.filter((c) => {
    const titNorm = normalizarParaBusca(c.titulo);
    return termoNorm.length >= 4 && (titNorm.includes(termoNorm) || termoNorm.includes(titNorm));
  });
  if (candidatosTitulo.length === 1) {
    return { item: candidatosTitulo[0], score: 90 };
  } else if (candidatosTitulo.length > 1) {
    const matchExato = candidatosTitulo.find((c) => normalizarParaBusca(c.titulo) === termoNorm);
    if (matchExato) {
      return { item: matchExato, score: 95 };
    }
  }

  // 4. Fallback com o motorConhecimento (siglas como LGPD, similaridade de Levenshtein, etc.)
  const resultadoMotor = await buscarConhecimento(termo, conhecimentos);
  if (resultadoMotor.status === 'unico' && resultadoMotor.instrucao && resultadoMotor.score >= 70) {
    return { item: resultadoMotor.instrucao, score: resultadoMotor.score };
  }

  return null;
}

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
 * Permite localizar ocorrências de cônjuges (ex: cônjuge na Certidão de Casamento),
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
   - Se a pergunta for sobre um campo ou dado específico (ex: título de eleitor, PIS, carteira de reservista, certidão de nascimento, passaporte, etc.) e esse dado NÃO constar de forma inequívoca nos trechos para a pessoa em questão, responda OBRIGATORIAMENTE que não encontrou o dado nos documentos (ex: "Não encontrei o título de eleitor do Titular Exemplo nos documentos.").
   - NUNCA responda com outro campo ou dado presente no documento (como filiação, CPF, RG ou nascimento) como substituto!
   - Se a pergunta for sobre data de DISPENSA DO SERVIÇO MILITAR, responda rigorosamente a data em que foi dispensado do serviço militar (ex.: 23 de agosto de 2005), e NUNCA a data de nascimento!
   - Se a pergunta for sobre data do REGISTRO DO CASAMENTO, responda rigorosamente a data do registro do casamento (ex.: 12 de abril de 2010), e NUNCA a data de nascimento!
   - Se a pergunta for sobre VACINAS ou DOSES TOMADAS, responda listando com clareza o nome da vacina, a dose e a data exata em que foi aplicada conforme constar no documento.
   - Se a pergunta for sobre uma PESSOA ESPECÍFICA citada na mensagem (mesmo que não seja o titular principal do documento, como cônjuge, parente, sócio, testemunha ou terceiro citado no texto), responda estritamente sobre a pessoa perguntada! NUNCA responda dados de outra pessoa.
   - Deixe SEMPRE explícito de quem é a informação respondida e cite o documento (exemplo: "A mãe da Mariana, conforme a *Certidão de Casamento*, é Sandra Silva.").
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
  textoResposta: string,
  contato?: Contato
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

  // 7. PESSOA ESPECÍFICA CITADA VS DADOS DE OUTRA PESSOA
  if (nomePessoa && nomePessoa.length >= 3) {
    const nomeNorm = nomePessoa.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const primeiroNomeRemetente = (extrairPrimeiroNome(contato?.nome || '') || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const naoMencionaPessoaPedida = !respNorm.includes(nomeNorm);
    const atribuiAoRemetente = primeiroNomeRemetente && primeiroNomeRemetente !== nomeNorm && respNorm.includes(primeiroNomeRemetente);
    if (naoMencionaPessoaPedida && atribuiAoRemetente) {
      return {
        textoValidado: `Não encontrei esse documento${pessoaFormatada} no Cofre.`,
        interceptado: true,
        motivo: `Usuário perguntou sobre ${nomePessoa}, mas a resposta atribuiu dados ao remetente (${contato?.nome}).`,
      };
    }
  }

  // 8. PARENTESCO EM GERAL (pai, mãe, cônjuge, filho):
  // NUNCA entregar os dados da pessoa base se pediu dados do parente!
  const matchParente =
    msgNorm.match(/\b(pai|m[aã]e|c[oó]njuge|esposa|marido|filh[oa])\s+d[oae]\s+([a-z\s]+)/i) ||
    msgNorm.match(/\b(meu\s+pai|minha\s+m[aã]e|minha\s+esposa|meu\s+marido|meu\s+filho|minha\s+filha)\b/i);
  if (matchParente) {
    const termoRel = matchParente[1].toLowerCase();
    const nomeBase = matchParente[2] ? matchParente[2].trim() : (contato?.nome || '');
    const primeiroNomeBase = (extrairPrimeiroNome(nomeBase) || nomeBase).toLowerCase();

    // Se a mensagem pediu endereço ou dados do parente
    const pedeEnderecoOuDado = /(?:endere[cç]|resid[eê]n|\bmora\b|\bmorando\b|\bcasa\b|\bbairro\b|\brua\b|cpf|rg|telefone|contato)/i.test(msgNorm);
    if (pedeEnderecoOuDado) {
      const mencionaParenteNaResposta = new RegExp(`\\b(${termoRel}|pai|m[aã]e|esposa|marido|filh[oa])\\b`, 'i').test(respNorm);
      const afirmaEnderecoBase = respNorm.includes(primeiroNomeBase) && !mencionaParenteNaResposta;
      const afirmaEnderecoDiretoSemParente = /\bo\s+endere[cç]o\s+d[oe]\s+[a-z]+\s+[eé]\b/i.test(respNorm) && !mencionaParenteNaResposta;

      if (afirmaEnderecoBase || afirmaEnderecoDiretoSemParente) {
        const artParente = ['mãe', 'mae', 'esposa', 'filha'].some((x) => termoRel.includes(x)) ? 'da' : 'do';
        const relExib = termoRel.includes('meu') || termoRel.includes('minha') ? termoRel : `${termoRel}`;
        const titularExib = matchParente[2] ? ` d${artParente} ${matchParente[2].trim()}` : '';
        return {
          textoValidado: `Não encontrei o endereço ${artParente} ${relExib}${titularExib} nos documentos.`,
          interceptado: true,
          motivo: `Usuário pediu o endereço ${artParente} ${termoRel}, mas a resposta entregou dados ou endereços da pessoa base.`,
        };
      }
    }
  }

  // 9. LOGRADOURO / RUA ESPECÍFICA NO PEDIDO (ex: "comprovante de residência da rua X")
  const matchRuaPedido = mensagemUsuario.match(/\brua\s+([A-Za-z0-9ÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+(?:\s+[A-Za-z0-9ÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)?)/i);
  if (matchRuaPedido) {
    const nomeRuaNorm = matchRuaPedido[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!['de', 'da', 'do', 'e'].includes(nomeRuaNorm) && nomeRuaNorm.length >= 2) {
      const respClean = respNorm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const entregouComprovanteOuEndereco = /\b(aqui\s+est[aá]|segue\s+o|comprovante\s+de\s+resid[eê]ncia|em\s+anexo)\b/i.test(respNorm);
      if (entregouComprovanteOuEndereco && !respClean.includes(nomeRuaNorm)) {
        return {
          textoValidado: `Não encontrei comprovante de residência da ${matchRuaPedido[0]} no Cofre.`,
          interceptado: true,
          motivo: `Usuário pediu comprovante da ${matchRuaPedido[0]}, mas o documento ou endereço entregue é de outra rua.`,
        };
      }
    }
  }

  // 10. MODELO DE VEÍCULO ESPECÍFICO (ex: Nissan Frontier vs Amarok)
  const pedeFrontier = /\b(frontier|nissan)\b/i.test(msgNorm);
  if (pedeFrontier) {
    const mencionaAmarok = /\bamarok\b/i.test(respNorm);
    const mencionaFrontier = /\bfrontier\b/i.test(respNorm);
    if (mencionaAmarok && !mencionaFrontier) {
      return {
        textoValidado: 'Não encontrei o documento da Nissan Frontier no Cofre. Tenho o da caminhonete Amarok, quer esse?',
        interceptado: true,
        motivo: 'Usuário pediu documento da Nissan Frontier, mas a resposta entregou a Amarok.',
      };
    }
  }

  // 11. DOCUMENTO x DADO (ex: "meu título de eleitor" ou "título de eleitor do X")
  const pedeDocTituloEleitor = /\bt[ií]tulo\s*(?:de\s*eleitor)?\b/i.test(msgNorm);
  if (pedeDocTituloEleitor) {
    const citaIR = /\b(ir|imposto\s*de\s*renda|dirpf|declara[cç][aã]o)\b/i.test(respNorm);
    const afirmaEncontrouDoc = /\b(encontrei\s+o\s+t[ií]tulo|o\s+t[ií]tulo\s+de\s+eleitor\s+est[aá]\s+no|segue\s+o\s+t[ií]tulo)\b/i.test(respNorm);
    const naoDisseQueNaoTemDoc = !/\b(n[aã]o\s+tenho\s+o\s+t[ií]tulo|n[aã]o\s+encontrei\s+o\s+documento)\b/i.test(respNorm);

    if (citaIR && afirmaEncontrouDoc && naoDisseQueNaoTemDoc) {
      const matchNum = textoResposta.match(/\b\d{10,14}\b/) || textoResposta.match(/(?:número|nº|numero)[:\s]*([0-9\s.-]+)/i);
      const numeroTexto = matchNum ? `: ${matchNum[1] || matchNum[0]}` : '';
      return {
        textoValidado: `Não tenho o título de eleitor no Cofre, mas o número aparece na Declaração de IR${numeroTexto}. Anotei na lista de documentos pendentes.`,
        interceptado: true,
        motivo: 'Usuário pediu o documento físico do título de eleitor, mas a resposta entregou como se fosse o documento em vez de separar documento x dado.',
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
            description: 'Termo de busca, assunto, tipo ou trecho procurado (ex: "Declaração de IR", "contrato social", "documento da Frontier", "comprovante de endereço", "endereço do Carlos")',
          },
          pessoa_base: {
            type: 'string',
            description: 'Nome da pessoa física cadastrada que serve como base da busca (ex: "Thomaz Lustri Fabre", "Carlos").',
          },
          relacao: {
            type: 'string',
            enum: ['propria', 'pai', 'mae', 'conjuge', 'filho', 'outro'],
            description: 'Relação da pessoa procurada com a pessoa_base. "propria" se a busca for referente ao próprio titular. "pai", "mae", "conjuge", "filho" ou "outro" se for parente/terceiro.',
          },
          titular: {
            type: 'string',
            description: 'Nome da pessoa física titular para restringir a busca aos documentos dela (opcional)',
          },
          tipo_referencia: {
            type: 'string',
            enum: ['pessoa', 'veiculo', 'imovel', 'empresa', 'obra', 'outro'],
            description: 'Classificação da referência pela IA: "pessoa" (titular pessoa física), "veiculo" (carro, caminhonete, caminhão, moto), "imovel" (casa, fazenda, terreno, endereço), "empresa", "obra" ou "outro".',
          },
          identificador_referencia: {
            type: 'string',
            description: 'Identificador do bem ou entidade (ex.: modelo do veículo como "Nissan Frontier", "Strada", "Volvo FH"; endereço/nome do imóvel como "Fazenda Santa Rita", "Rua X"; nome da empresa como "Delta Plan").',
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
      description: 'Consulta os dados cadastrais oficiais do titular (CPF, RG, endereço, estado civil, filiação, CNH, datas, etc.) validados no cadastro da Delta Plan. Você DEVE acionar esta ferramenta SEMPRE que houver pergunta sobre endereço, filiação ou dados cadastrais (mesmo com pronomes como "qual o endereço dele?"), identificando o titular pelo histórico recente. É OBRIGATÓRIO informar a relacao ("propria" para dados do titular, ou "pai", "mae", "conjuge", "filho", "outro" para parentes).',
      parameters: {
        type: 'object',
        properties: {
          pessoa_base: {
            type: 'string',
            description: 'Nome completo, primeiro nome ou apelido do titular cadastrado base da consulta (ex: "Thomaz Lustri Fabre", "Carlos").',
          },
          relacao: {
            type: 'string',
            enum: ['propria', 'pai', 'mae', 'conjuge', 'filho', 'outro'],
            description: 'OBRIGATÓRIO: Relação da pessoa cujos dados estão sendo consultados. Deve ser "propria" se os dados pedidos forem do próprio titular cadastrado; ou "pai", "mae", "conjuge", "filho", "outro" se os dados pedidos forem de parente ou terceiro relacionado.',
          },
          nome: {
            type: 'string',
            description: 'Nome do titular (para compatibilidade, use pessoa_base prioritariamente)',
          },
        },
        required: ['pessoa_base', 'relacao'],
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
            description: 'Nome do titular (ex: "Carlos Silva", "Roberto")',
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
      name: 'listar_documentos_cofre',
      description: 'Devolve um panorama geral e resumido do acervo do Cofre Delta: total de documentos cadastrados, agrupados por titular (incluindo "Documentos da Empresa (Delta Plan)"), com a contagem e os tipos principais de cada grupo. Use SEMPRE que o usuário fizer perguntas gerais ou amplas sobre o catálogo ou acervo (ex.: "liste todos os documentos", "o que tem no cofre?", "quais documentos você tem acesso?", "o que você tem arquivado?", "quais documentos existem?"). NUNCA use o nome do remetente como titular para perguntas gerais. NUNCA use para perguntas sobre sites, portais, links web, páginas da internet ou itens da Base de Conhecimento (para links e sites, use buscar_conhecimento). Opcionalmente aceita filtro por tipo de documento.',
      parameters: {
        type: 'object',
        properties: {
          filtro_tipo: {
            type: 'string',
            description: 'Filtro opcional por tipo de documento (ex: "Contrato", "CNH", "Certidão", "ART")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_documentos_titular',
      description: 'Lista todos os documentos oficiais salvos no Cofre pertencentes a um titular específico. Use quando o usuário perguntar expressamente sobre os documentos de uma pessoa específica (ex: "quais documentos o Carlos tem?") OU quando usar primeira pessoa para os seus próprios documentos (ex: "quais são os meus documentos?", "o que você tem sobre mim?"). NUNCA use para perguntas gerais sobre o acervo do Cofre.',
      parameters: {
        type: 'object',
        properties: {
          titular: {
            type: 'string',
            description: 'Nome do titular cadastrado (ex: "Carlos") ou nome do próprio contato caso ele peça "meus documentos"',
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
      description: 'Anexa e envia o arquivo físico original (PDF ou imagem) do Cofre para o usuário no WhatsApp. Use SEMPRE que o usuário pedir para ver, mandar, enviar, abrir, soltar ou baixar um arquivo físico (ex: "me manda o 2", "quero ver o documento 5", "me envie o pdf", "me manda a CNH e a certidão"). NUNCA use para contagens ("quantos documentos") ou listagens ("quais documentos").',
      parameters: {
        type: 'object',
        properties: {
          doc_id: {
            type: 'string',
            description: 'ID do documento no Cofre (UUID) OU nome/tipo do documento (ex: "Certidão de Casamento", "CNH", "Documento da Frontier") caso ainda não tenha o ID.',
          },
          tipo_referencia: {
            type: 'string',
            enum: ['pessoa', 'veiculo', 'imovel', 'empresa', 'obra', 'outro'],
            description: 'Classificação da referência pela IA: "pessoa", "veiculo", "imovel", "empresa", "obra" ou "outro".',
          },
          identificador_referencia: {
            type: 'string',
            description: 'Identificador do bem, pessoa ou entidade vinculada (ex: "Nissan Frontier", "Strada", "Fazenda Santa Rita").',
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
      description: 'Consulta a Base de Conhecimento interna da Delta Plan (chaves PIX, links de sistemas e sites web como o Portfólio das根Máquinas, regras de negócio, telefones e procedimentos). Acione SEMPRE que o usuário perguntar sobre sites, portais, links web ou sistemas corporativos para verificar se o link correspondente está salvo na base.',
      parameters: {
        type: 'object',
        properties: {
          termo: {
            type: 'string',
            description: 'Termo de busca na base de conhecimento (ex: "pix do Carlos", "link do ERP", "portfólio das máquinas")',
          },
          categoria: {
            type: 'string',
            description: 'Categoria opcional (Financeiro, RH, TI, Geral, Sistemas/ Site)',
          },
        },
        required: ['termo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ler_documento_completo',
      description: 'Retorna a íntegra de TODOS os trechos/conteúdo de um documento do Cofre em ordem sequencial. Use OBRIGATORIAMENTE quando o usuário solicitar varreduras completas ou listar TODOS os itens de um tipo dentro de um documento (ex: "quais contas bancárias aparecem no IR", "todos os bens", "todos os dependentes", "quantos imóveis"), para evitar que a resposta fique incompleta por trazer apenas trechos parciais.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: {
            type: 'string',
            description: 'ID interno do documento no Cofre (UUID) ou identificador obtido via buscar_documentos ou listar_documentos_titular',
          },
          termo_documento: {
            type: 'string',
            description: 'Nome, título ou tipo do documento caso o doc_id exato ainda não seja conhecido (ex: "IR Carlos", "Declaração de Ajuste Anual")',
          },
          titular: {
            type: 'string',
            description: 'Nome do titular do documento (opcional)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salvar_conhecimento',
      description: 'Cadastra ou prepara o cadastro de um novo item na Base de Conhecimento interna da Delta Plan (contatos, telefones, chaves PIX, links de sistemas, regras de negócio ou procedimentos, locais/localizações geográficas). Acione esta ferramenta quando o usuário solicitar salvar/adicionar ou quando enviar dados complementares de um cadastro em andamento. Para localização: você SÓ PODE usar uma localização recebida no lote atual ou na mensagem imediatamente anterior ao pedido. Se não houver, deve responder estritamente: "Não recebi a localização. Pode enviar de novo?". NUNCA busque localizações antigas do histórico. A ferramenta valida dados faltantes, duplicidade e gera a frase de confirmação que você deve apresentar ao usuário antes da gravação definitiva.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description: 'Categoria do item (ex: "Contatos", "Financeiro", "Sistemas", "Geral")',
          },
          titulo: {
            type: 'string',
            description: 'Título amigável do item (ex: "Contato João do Pix", "Chave PIX do Berna", "Link do ERP")',
          },
          conteudo: {
            type: 'string',
            description: 'Conteúdo detalhado com os dados (ex: "Telefone: (14) 99999-8888", "Chave PIX: 11987654321")',
          },
          apelidos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Apelidos ou termos de busca alternativos (opcional)',
          },
          tipo: {
            type: 'string',
            enum: ['contato', 'pix', 'link', 'regra', 'local', 'outro'],
            description: 'Tipo do item',
          },
          dados_estruturados: {
            type: 'object',
            description: 'Campos estruturados (ex: { telefone: "...", nome: "..." })',
          },
          confirmado: {
            type: 'boolean',
            description: 'True se o usuário já disse "sim" ou confirmou a gravação explicitamente',
          },
          forcar_novo: {
            type: 'boolean',
            description: 'Se true, cria novo item mesmo que já exista um com nome parecido',
          },
        },
        required: ['categoria', 'titulo', 'conteudo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'atualizar_conhecimento',
      description: 'Atualiza um item existente na Base de Conhecimento (altera o título/nome, telefone, chave PIX, link ou conteúdo). Requer confirmação prévia do usuário ("Vou atualizar: [Título]... Confirma?"). Use também quando o usuário disser que salvou errado ou informar o nome correto de um item.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID do item na base de conhecimento (se conhecido)',
          },
          titulo_atual: {
            type: 'string',
            description: 'Título ou nome atual do item a ser atualizado (ex: "Contato Novo Item", "Contato João do Pix")',
          },
          novo_titulo: {
            type: 'string',
            description: 'Novo título ou nome do contato se for alterado (ex: "Contato João do Pix")',
          },
          categoria: {
            type: 'string',
            description: 'Nova categoria (opcional)',
          },
          novo_conteudo: {
            type: 'string',
            description: 'Novo conteúdo com os dados atualizados (ex: "Telefone: (14) 98888-7777") (opcional se alterando apenas o título)',
          },
          apelidos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Apelidos ou variações atualizados (opcional)',
          },
          confirmado: {
            type: 'boolean',
            description: 'True se o usuário já disse "sim" para a atualização',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remover_conhecimento',
      description: 'Remove um item da Base de Conhecimento. Requer confirmação explícita prévia do usuário ("Você confirma a exclusão do item [Título]?").',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID do item na base de conhecimento (se conhecido)',
          },
          titulo: {
            type: 'string',
            description: 'Título do item a ser excluído',
          },
          confirmado: {
            type: 'boolean',
            description: 'True se o usuário respondeu "sim" para a exclusão',
          },
        },
        required: ['titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_documentos_faltantes',
      description: 'Consulta a lista de documentos faltantes/pendentes registrada na VEGA. Use quando o usuário perguntar sobre documentos pendentes ou faltantes (ex: "quais documentos estão faltando?", "me manda a lista de documentos faltantes", "meus documentos faltantes"). Se o usuário não especificar de quem deseja ver os faltantes ("me manda a lista de documentos faltantes"), você DEVE perguntar: "Quer só os seus ou de todos os titulares?". Se o usuário disser "meus documentos faltantes", consulte filtrando pelo remetente.',
      parameters: {
        type: 'object',
        properties: {
          titular: {
            type: 'string',
            description: 'Nome do titular para filtrar os faltantes (ex: "Carlos", ou nome do remetente se pediu "meus"). Deixar vazio se o pedido for genérico ou de todos.',
          },
          escopo: {
            type: 'string',
            enum: ['meus', 'todos'],
            description: 'Define se a busca é estritamente dos documentos do remetente ("meus") ou de todos os titulares ("todos").',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_documento_faltante',
      description: 'Registra um documento na lista de documentos faltantes/pendentes da VEGA. Use para pedidos explícitos do usuário (ex: "coloque ele em documentos faltantes", "anota que está faltando", "registra como pendente", "anote esse documento nos faltantes"). Você DEVE ler o histórico da conversa e passar a descrição completa do documento (ex: "documento da Nissan Frontier", "documento da Strada", "documento do caminhão Volvo FH", "escritura da Fazenda Santa Rita"). NUNCA passe pronomes como "ele" ou "esse".',
      parameters: {
        type: 'object',
        properties: {
          descricao: {
            type: 'string',
            description: 'Descrição completa e detalhada do documento faltante, formulada por você a partir da mensagem e do histórico da conversa (ex: "documento da Nissan Frontier", "documento da Strada", "documento do caminhão Volvo FH", "escritura da Fazenda Santa Rita", "CNH do Carlos Silva").',
          },
          tipo_documento: {
            type: 'string',
            description: 'Tipo do documento (ex: "Documento de Veículo", "Escritura", "Comprovante de Residência", "CNH"). Opcional.',
          },
          tipo_referencia: {
            type: 'string',
            enum: ['pessoa', 'veiculo', 'imovel', 'empresa', 'obra', 'outro'],
            description: 'Tipo da entidade ou bem ao qual o documento pertence: "pessoa", "veiculo", "imovel", "empresa", "obra" ou "outro".',
          },
          identificador_referencia: {
            type: 'string',
            description: 'Identificador do bem, pessoa ou entidade vinculado (ex: "Nissan Frontier", "Strada", "Volvo FH", "Fazenda Santa Rita").',
          },
          titular: {
            type: 'string',
            description: 'Nome da pessoa física titular ou da empresa proprietária vinculada, se informada. Deixar vazio se for veículo/imóvel sem titular de pessoa física informado.',
          },
        },
        required: ['descricao'],
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
    const caminhosPossiveis = [
      path.resolve(process.cwd(), 'prompts/assistente.md'),
      path.resolve(process.cwd(), '../prompts/assistente.md'),
      path.resolve(__dirname, '../../../prompts/assistente.md'),
      path.resolve(__dirname, '../../prompts/assistente.md'),
    ];
    for (const c of caminhosPossiveis) {
      if (fs.existsSync(c)) {
        const conteudo = fs.readFileSync(c, 'utf-8').trim();
        if (conteudo) return conteudo;
      }
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
    /\b(?:Nomes completos|Filho de|Filha de|Nascid[oa]|Natural de|Data do registro|Regime de bens|Observações|Casamento celebrado|O conteúdo da certidão|Expedido em|Número de registro|Registro Nacional|Título\(s\)|Decreto Federal|Diploma\/Certificado|A presente certidão|Esta certidão|Eletrônico|Telefone|E-mail|Email|Natureza da Ocupação|Ocupação Principal|Tipo de declaração|Nº do recibo|DEPENDENTES|ALIMENTANDOS|RENDIMENTOS)\b/i,
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
 * Identifica o atributo do documento faltante baseado na classificação da IA (Regra 25)
 */
export function identificarAtributoDocumentoFaltante(
  texto: string,
  titularParam?: string | null,
  tipoReferencia?: 'pessoa' | 'veiculo' | 'imovel' | 'empresa' | 'obra' | 'outro',
  identificadorReferencia?: string
): {
  tipoAtributo: 'veiculo' | 'imovel' | 'obra' | 'empresa' | 'pessoa' | 'outro' | 'generico';
  descricaoItem: string;
  tipoDocumento: string;
  titularFinal: string | null;
  ehAmbiguo: boolean;
} {
  const norm = (texto || '').trim();

  // 1. Classificação explícita vinda da IA (Regra 25: a IA classifica)
  if (tipoReferencia === 'veiculo') {
    const ident = (identificadorReferencia || norm || '').replace(/^(?:me\s+)?(?:envie|manda|enviar|quero|o|a|de|da|do|um|uma|documento\s+d[eoa]?)\s+/i, '').trim();
    return {
      tipoAtributo: 'veiculo',
      descricaoItem: ident ? `Documento do veículo ${ident}` : 'Documento de veículo',
      tipoDocumento: 'Documento de Veículo',
      titularFinal: titularParam || null,
      ehAmbiguo: !ident,
    };
  }

  if (tipoReferencia === 'imovel') {
    const ident = (identificadorReferencia || norm || '').replace(/^(?:me\s+)?(?:envie|manda|enviar|quero|o|a|de|da|do|um|uma|documento\s+d[eoa]?|comprovante\s+d[eoa]?)\s+/i, '').trim();
    return {
      tipoAtributo: 'imovel',
      descricaoItem: ident ? `Documento do imóvel ${ident}` : 'Documento de imóvel',
      tipoDocumento: 'Comprovante de Residência',
      titularFinal: titularParam || null,
      ehAmbiguo: !ident,
    };
  }

  if (tipoReferencia === 'empresa') {
    const ident = (identificadorReferencia || titularParam || norm || '').trim();
    return {
      tipoAtributo: 'empresa',
      descricaoItem: ident ? `Documento da empresa ${ident}` : 'Documento de empresa',
      tipoDocumento: 'Documento de Empresa',
      titularFinal: ident || null,
      ehAmbiguo: !ident,
    };
  }

  if (tipoReferencia === 'obra') {
    const ident = (identificadorReferencia || norm || '').replace(/^(?:me\s+)?(?:envie|manda|enviar|quero|o|a|de|da|do|um|uma|documento\s+d[eoa]?)\s+/i, '').trim();
    return {
      tipoAtributo: 'obra',
      descricaoItem: ident ? `Documento da obra ${ident}` : 'Documento de obra',
      tipoDocumento: 'Documento de Obra',
      titularFinal: titularParam || null,
      ehAmbiguo: !ident,
    };
  }

  if (tipoReferencia === 'pessoa') {
    const ident = (titularParam || identificadorReferencia || '').trim();
    const ehTitularValido = ident && !['delta plan', 'outros', 'empresa', 'não informado', 'não identificado', 'titular não informado'].includes(ident.toLowerCase());
    return {
      tipoAtributo: 'pessoa',
      descricaoItem: ehTitularValido ? `Documento de ${ident}` : 'Documento pessoal',
      tipoDocumento: 'Documento Pessoal',
      titularFinal: ehTitularValido ? ident : null,
      ehAmbiguo: !ehTitularValido,
    };
  }

  // 2. Se a IA não especificou tipo_referencia, avalia se o texto é ambíguo
  const textoLimpo = norm.replace(/^(?:me\s+)?(?:envie|manda|enviar|quero|tem|buscar|achar|solta|libera)\s+(?:o|a|os|as|um|uma)?\s*/i, '').trim();
  const termosGenericos = ['documento', 'arquivo', 'pdf', 'foto', 'imagem', 'comprovante'];
  const ehGenerico = !textoLimpo || termosGenericos.includes(textoLimpo.toLowerCase()) || textoLimpo.length < 3;

  return {
    tipoAtributo: 'generico',
    descricaoItem: ehGenerico ? 'Documento' : textoLimpo,
    tipoDocumento: 'Documento',
    titularFinal: titularParam || null,
    ehAmbiguo: ehGenerico,
  };
}

/**
 * Identifica se a busca se refere a um documento oficial específico (Título de Eleitor, CNH, etc.)
 */
export function identificarTipoDocumentoBuscado(texto: string): string | null {
  const t = (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(titulo(\s+de)?\s+eleitor(al)?)\b/i.test(t)) return 'Título de Eleitor';
  if (/\b(pis|pasep|nis)\b/i.test(t)) return 'PIS';
  if (/\b(reservista|carteira\s+de\s+reservista)\b/i.test(t)) return 'Carteira de Reservista';
  if (/\b(passaporte)\b/i.test(t)) return 'Passaporte';
  if (/\b(certidao\s+de\s+nascimento)\b/i.test(t)) return 'Certidão de Nascimento';
  if (/\b(certidao\s+de\s+casamento)\b/i.test(t)) return 'Certidão de Casamento';
  if (/\b(cnh|carteira\s+(nacional\s+de\s+)?habilitacao)\b/i.test(t)) return 'CNH';
  if (/\b(rg|carteira\s+de\s+identidade)\b/i.test(t)) return 'RG';
  if (/\b(ctps|carteira\s+(de\s+trabalho|digital))\b/i.test(t)) return 'CTPS';
  if (/\b(alvara|licenca)\b/i.test(t)) return 'Alvará';
  if (/\b(apolice|seguro)\b/i.test(t)) return 'Apólice de Seguro';
  return null;
}

/**
 * Extrai o nome da pessoa relacionada (pai, mãe, cônjuge, filho) a partir da ficha cadastral
 */
export function extrairPessoaRelacionadaDaFicha(
  titular: { campos?: Record<string, { valor?: string }> } | null,
  relacao: string
): string | null {
  if (!titular || !titular.campos) return null;
  const rel = (relacao || '').toLowerCase().trim();

  if (rel === 'pai') {
    if (titular.campos.pai?.valor) return titular.campos.pai.valor.trim();
    if (titular.campos.filiacaoPai?.valor) return titular.campos.filiacaoPai.valor.trim();
    if (titular.campos.filiacao?.valor) {
      const match = titular.campos.filiacao.valor.match(/\bpai:\s*([^|;\n,]+)/i);
      if (match) return match[1].trim();
    }
  } else if (rel === 'mae') {
    if (titular.campos.mae?.valor) return titular.campos.mae.valor.trim();
    if (titular.campos.filiacaoMae?.valor) return titular.campos.filiacaoMae.valor.trim();
    if (titular.campos.filiacao?.valor) {
      const match = titular.campos.filiacao.valor.match(/\bm[aã]e:\s*([^|;\n,]+)/i);
      if (match) return match[1].trim();
    }
  } else if (rel === 'conjuge') {
    if (titular.campos.conjuge?.valor) return titular.campos.conjuge.valor.trim();
    if (titular.campos.esposa?.valor) return titular.campos.esposa.valor.trim();
    if (titular.campos.marido?.valor) return titular.campos.marido.valor.trim();
  } else if (rel === 'filho') {
    if (titular.campos.filho?.valor) return titular.campos.filho.valor.trim();
    if (titular.campos.filhos?.valor) return titular.campos.filhos.valor.trim();
  }
  return null;
}

/**
 * Tool 1: buscar_documentos(consulta, titular?)
 */
export async function toolBuscarDocumentos(
  consulta: string,
  titularNome?: string,
  todosDocs: DocumentoRegistro[] = [],
  origemMensagem?: 'audio' | 'texto',
  contato?: Contato,
  tipoReferencia?: 'pessoa' | 'veiculo' | 'imovel' | 'empresa' | 'obra' | 'outro',
  identificadorReferencia?: string,
  pessoaBase?: string,
  relacao: 'propria' | 'pai' | 'mae' | 'conjuge' | 'filho' | 'outro' = 'propria',
  bloquearCancelamento?: (motivo: string) => void
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
  tipo_correspondencia?: string;
  nome_entendido?: string;
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

  const todosTits = await obterTodosTitulares();
  const catalogoPessoas = extrairCatalogoPessoas(todosTits, todosDocs);

  let titularOriginal = (titularNome || '').trim();
  let titularNorm = titularOriginal.toLowerCase();
  let titObj: FichaTitular | null = null;
  let ehPessoaNaoCadastrada = false;

  // 0.1 TRATAMENTO DE PARENTES (relacao != 'propria')
  if (relacao && relacao !== 'propria') {
    const nomeBase = (pessoaBase || titularNome || '').trim();
    const titularBaseObj = todosTits.find((t) => titularCorresponde(t.nome, nomeBase)) || null;
    const nomeParente = extrairPessoaRelacionadaDaFicha(titularBaseObj, relacao);

    if (!nomeParente) {
      const artRel = ['mae', 'esposa', 'filha'].includes(relacao) ? 'da' : 'do';
      const nomeExibBase = titularBaseObj?.nome || nomeBase || 'titular';
      return {
        documentos: [],
        total_fontes_com_dado: 0,
        mensagem: `nao_encontrado: não há dados nem identificação ${artRel} ${relacao} de ${nomeExibBase} no cadastro.`,
        orientacao_resposta: `ATENÇÃO: Não há dados ou documentos ${artRel} ${relacao} de ${nomeExibBase} no sistema. É TERMINANTEMENTE PROIBIDO entregar dados ou endereços de ${nomeExibBase}. Responda ESTRITAMENTE: "Não encontrei o endereço ${artRel} ${relacao} de ${nomeExibBase} nos documentos." (ou o campo que foi solicitado).`,
      };
    } else {
      titularOriginal = nomeParente;
      titularNorm = nomeParente.toLowerCase();
      tipoReferencia = 'pessoa';
      titObj = todosTits.find((t) => titularCorresponde(t.nome, nomeParente)) || null;
    }
  }

  // 1. Identifica nome de pessoa pesquisado: SÓ RODA SE tipo_referencia === 'pessoa' (Regra 25)
  // NUNCA tenta inferir nome de pessoa no texto livre por padrão!
  let nomePessoaPesquisada: string | null = null;
  if (tipoReferencia === 'pessoa') {
    nomePessoaPesquisada = titularOriginal || identificadorReferencia || null;
  }

  if (nomePessoaPesquisada) {
    const checkCorr = verificarCorrespondenciaNomePessoa(nomePessoaPesquisada, catalogoPessoas, origemMensagem);

    // REGRA MANDATÓRIA: Correspondência APROXIMADA
    // NUNCA revelar nomes do Cofre e NUNCA entregar dados! Apenas pedir confirmação do nome entendido sugerindo digitar.
    if (checkCorr.tipo === 'aproximada') {
      return {
        documentos: [],
        tipo_correspondencia: 'aproximada',
        nome_entendido: checkCorr.nomeEntendido,
        orientacao_resposta: `ATENÇÃO DE PRIVACIDADE E SEGURANÇA: O nome '${checkCorr.nomeEntendido}' possui apenas correspondência aproximada. É TERMINANTEMENTE PROIBIDO revelar qualquer nome existente no Cofre e é TERMINANTEMENTE PROIBIDO entregar dados ou arquivos. Responda ESTRITAMENTE: "${checkCorr.mensagemRespostaObrigatoria}"`,
        mensagem: checkCorr.mensagemRespostaObrigatoria,
      };
    }

    // Nenhuma correspondência (Inexistente)
    // Se o titular foi especificado expressamente pelo chamador, aplica a regra de pessoa inexistente.
    // Se foi apenas uma inferência de texto livre da consulta e não é uma pessoa, segue para busca textual no catálogo.
    if (checkCorr.tipo === 'inexistente') {
      if (titularOriginal) {
        const orientacao = origemMensagem === 'audio'
          ? `ATENÇÃO DE TRANSCRIÇÃO DE ÁUDIO: A mensagem veio de ÁUDIO e o nome '${checkCorr.nomeEntendido}' não foi encontrado no Cofre. É TERMINANTEMENTE PROIBIDO revelar qualquer nome existente no Cofre e é TERMINANTEMENTE PROIBIDO entregar dados ou arquivos. Responda ESTRITAMENTE: "${checkCorr.mensagemRespostaObrigatoria}"`
          : `Não foi encontrado nenhum documento ou informação sobre '${checkCorr.nomeEntendido}' no Cofre. Responda ao usuário que não encontrou informações sobre '${checkCorr.nomeEntendido}' no Cofre.`;

        return {
          documentos: [],
          tipo_correspondencia: 'inexistente',
          nome_entendido: checkCorr.nomeEntendido,
          orientacao_resposta: orientacao,
          mensagem: checkCorr.mensagemRespostaObrigatoria,
        };
      } else {
        // Nome era apenas inferido de texto livre (ex.: "documento da X"); segue a busca convencional
        nomePessoaPesquisada = null;
      }
    }

    // Correspondência EXATA (Prioridade Máxima)
    if (checkCorr.tipo === 'exata' && checkCorr.pessoaExata) {
      if (checkCorr.pessoaExata.ehTitularCadastrado && checkCorr.pessoaExata.titularId) {
        titObj = todosTits.find((t) => t.id === checkCorr.pessoaExata?.titularId) || null;
      }
      titularNorm = checkCorr.pessoaExata.nomeOficial.toLowerCase();
      ehPessoaNaoCadastrada = !checkCorr.pessoaExata.ehTitularCadastrado;
    }
  }

  const ehBuscaEndereco =
    !/\bcasamento\b|\bcasado\b/i.test(consulta) &&
    /(?:endere[cç]|resid[eê]n|\bmora\b|\bmorando\b|\bcasa\b|\bbairro\b|\brua\b|\blogradouro\b|onde ele mora|onde ela mora)/i.test(consulta);
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

  const primeiroNomePessoa = titularNorm ? (extrairPrimeiroNome(titularNorm) || titularNorm).toLowerCase() : '';
  const termoSemAcento = titularNorm ? titularNorm.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
  const primeiroNomeSemAcento = primeiroNomePessoa.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (ehPessoaNaoCadastrada) {
    // =============================================================
    // CASO ESPECIAL: PESSOA SEM CADASTRO DE TITULAR
    // A busca continua em todo o Cofre: títulos, nomes de arquivos,
    // descrições, metadados e trechos de todos os documentos.
    // =============================================================
    for (const d of todosDocs) {
      const titDocNorm = (d.titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const arqDocNorm = (d.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const descDocNorm = (d.descricao || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const donoProvavelNorm = ((d.metadata?.donoProvavel || d.metadata?.nomeNoDocumento || d.metadata?.donoDocumento || '') as string)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const coincidePessoa =
        (termoSemAcento.length >= 3 && (titDocNorm.includes(termoSemAcento) || arqDocNorm.includes(termoSemAcento) || descDocNorm.includes(termoSemAcento) || donoProvavelNorm.includes(termoSemAcento))) ||
        (primeiroNomeSemAcento.length >= 3 && (titDocNorm.includes(primeiroNomeSemAcento) || arqDocNorm.includes(primeiroNomeSemAcento) || descDocNorm.includes(primeiroNomeSemAcento) || donoProvavelNorm.includes(primeiroNomeSemAcento)));

      if (coincidePessoa) {
        const dataEmissao = extrairDataEmissaoDocumento(d, [d.descricao || '']);
        resultados.push({
          doc_id: d.id,
          nome_documento: d.titulo,
          titular: d.titular || 'Não identificado',
          data_documento: dataEmissao || 'data do documento não identificada',
          data_armazenamento: formatarDataParaExibicao(d.dataCadastro),
          score: 1.0,
          trecho: d.descricao || `Documento ${d.tipo || 'oficial'} arquivado no Cofre`,
        });
      }
    }

    // Busca direta na tabela trechos do Supabase por ocorrência do nome em todo o Cofre
    try {
      const trechosPessoa = await buscarTrechosPorNomePessoaNoCofre(titularNorm, consulta, todosDocs);
      for (const tp of trechosPessoa) {
        const doc = todosDocs.find((d) => d.id === tp.documento_id);
        const titulo = tp.titulo_documento || doc?.titulo || 'Documento do Cofre';
        const dataEmissao = doc ? extrairDataEmissaoDocumento(doc, [tp.conteudo]) : null;
        resultados.push({
          doc_id: tp.documento_id,
          nome_documento: titulo,
          titular: doc?.titular || 'Não identificado',
          data_documento: dataEmissao || 'data do documento não identificada',
          data_armazenamento: formatarDataParaExibicao(doc?.dataCadastro),
          score: 1.0,
          trecho: tp.conteudo,
        });
      }
    } catch (errPessoa) {
      console.warn('[VEGA Tools] Falha ao buscar trechos por nome de pessoa não cadastrada:', errPessoa);
    }

    // Busca vetorial ampla sem filtro de titular (p_pessoa_id: null)
    try {
      const termoBuscaVetorial = `${titularNome || titularNorm} ${consulta}`.trim();
      const trechosVetoriais = await executarBuscaVetorial(termoBuscaVetorial, null, 8);
      for (const tv of trechosVetoriais) {
        const doc = todosDocs.find((d) => d.id === tv.documento_id);
        const conteudoNorm = tv.conteudo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const contemNome =
          (termoSemAcento.length >= 3 && conteudoNorm.includes(termoSemAcento)) ||
          (primeiroNomeSemAcento.length >= 3 && conteudoNorm.includes(primeiroNomeSemAcento)) ||
          resultados.some((r) => r.doc_id === tv.documento_id);

        if (contemNome) {
          const titulo = tv.titulo_documento || doc?.titulo || 'Documento do Cofre';
          const dataEmissao = doc ? extrairDataEmissaoDocumento(doc, [tv.conteudo]) : null;
          resultados.push({
            doc_id: tv.documento_id,
            nome_documento: titulo,
            titular: doc?.titular || 'Não identificado',
            data_documento: dataEmissao || 'data do documento não identificada',
            data_armazenamento: formatarDataParaExibicao(doc?.dataCadastro),
            score: Number(Number(tv.similaridade ?? 0.85).toFixed(2)),
            trecho: tv.conteudo,
          });
        }
      }
    } catch (errVet) {
      console.warn('[VEGA Tools] Falha na busca vetorial de pessoa não cadastrada:', errVet);
    }
  } else {
    // -------------------------------------------------------------
    // BUSCA CONVENCIONAL (com titular cadastrado ou busca geral)
    // -------------------------------------------------------------
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
  }

  const vistos = new Set<string>();
  const filtrados = resultados.filter((r) => {
    const chave = `${r.doc_id}_${(r.trecho || '').substring(0, 50)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  let orientacaoResposta: string | undefined;
  let mensagemRetorno: string | undefined;

  if (ehPessoaNaoCadastrada) {
    if (filtrados.length > 0) {
      const primeiroDoc = filtrados[0];
      const nomeExibicao = titularNome || titularNorm;
      orientacaoResposta =
        `ATENÇÃO: A pessoa "${nomeExibicao}" NÃO consta cadastrada como titular oficial na tabela de titulares, mas foi localizada no documento "${primeiroDoc.nome_documento}" (${primeiroDoc.doc_id}), que está arquivado sob o titular "${primeiroDoc.titular}". ` +
        `Responda com o dado solicitado citando expressamente este documento (ex: "Na CNH da ${nomeExibicao}, arquivada junto aos documentos da ${primeiroDoc.titular}, o CPF é...") ` +
        `e sugira ao usuário cadastrá-la oficialmente como titular no sistema.`;
      mensagemRetorno = orientacaoResposta;
    } else {
      mensagemRetorno = `Não encontrei informações ou documentos de "${titularNome || titularNorm}" no Cofre.`;
    }
  } else if (filtrados.length === 0) {
    // 6. REGISTRAR FALTANTE AUTOMATICAMENTE (AMPLIADO - REGRA 25)
    // Documentos podem ser identificados por atributo de pessoa, veículo, imóvel, obra ou empresa pela IA.
    const titularFinal = titObj?.nome || titularOriginal;
    const termoCompleto = `${consulta || ''} ${termoNorm || ''}`.trim();
    const infoAtributo = identificarAtributoDocumentoFaltante(
      termoCompleto,
      titularFinal,
      tipoReferencia,
      identificadorReferencia
    );

    if (!infoAtributo.ehAmbiguo) {
      try {
        const nomeContatoReal = (contato?.nome || contato?.telefone || 'Contato').trim();
        await registrarOuIncrementarDocumentoFaltante({
          tipoDocumento: infoAtributo.tipoDocumento,
          descricaoItem: infoAtributo.descricaoItem,
          titularInformado: infoAtributo.titularFinal,
          solicitanteNome: nomeContatoReal,
          solicitanteContato: contato?.telefone,
          textoDoPedido: termoCompleto,
          forcarRegistro: true,
        });
        bloquearCancelamento?.('Registro automático de documento faltante via busca de documentos');
      } catch (errFalt) {
        console.warn('[VEGA Faltantes ⚠️] Falha ao registrar documento faltante automático:', errFalt);
      }

      // Se for veículo, checa se há alternativa no Cofre (sem lista fixa de modelos)
      let complementoAlternativa = '';
      if (tipoReferencia === 'veiculo') {
        const outroVeiculo = todosDocs.find((d) => {
          const t = (d.tipo || '').toLowerCase();
          const tit = (d.titulo || '').toLowerCase();
          const idRefNorm = (identificadorReferencia || '').toLowerCase();
          const ehDiferente = !idRefNorm || !tit.includes(idRefNorm);
          return ehDiferente && (t.includes('veiculo') || tit.includes('veiculo') || tit.includes('caminhonete') || tit.includes('carro') || tit.includes('caminhao'));
        });
        if (outroVeiculo) {
          complementoAlternativa = ` Tenho o da ${outroVeiculo.titulo}, quer esse?`;
        }
      }

      let textoNomeDoc = infoAtributo.descricaoItem;
      if (!textoNomeDoc.toLowerCase().startsWith('documento') && !textoNomeDoc.toLowerCase().startsWith('comprovante') && !textoNomeDoc.toLowerCase().startsWith('escritura')) {
        const art = obterArtigoDefinido(infoAtributo.tipoDocumento);
        textoNomeDoc = `${art} ${infoAtributo.descricaoItem}`;
      } else {
        textoNomeDoc = `o ${textoNomeDoc.toLowerCase()}`;
      }

      const avisoOficial = `Não encontrei ${textoNomeDoc} no Cofre. Registrei como documento faltante.${complementoAlternativa}`;
      mensagemRetorno = avisoOficial;
      orientacaoResposta = `ATENÇÃO: O documento não existe no Cofre e foi registrado na lista de documentos faltantes. Responda ESTRITAMENTE ao usuário informando que não encontrou e que registrou como documento faltante.${complementoAlternativa ? ' Mencione a alternativa disponível sem enviar anexo.' : ''}`;
    } else {
      mensagemRetorno = 'Não encontrei esse documento no Cofre. Quer que eu registre como documento faltante?';
      orientacaoResposta = 'ATENÇÃO: O pedido não identificou claramente o titular nem o bem/tipo do documento. Responda educadamente informando que não encontrou e pergunte: "Quer que eu registre como documento faltante?"';
    }
  }

  // REGRA DOCUMENTO x DADO: Se o usuário pediu um documento específico (ex: Título de Eleitor)
  // e o documento em si NÃO existe no Cofre, mas o dado apareceu em outro documento (ex: IR):
  let documentosParaRetorno = filtrados.slice(0, 8);
  const tipoDocBuscado = identificarTipoDocumentoBuscado(consulta);
  if (tipoDocBuscado && filtrados.length > 0 && !ehPessoaNaoCadastrada) {
    const normTipo = tipoDocBuscado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const temDocumentoOficial = filtrados.some((d) => {
      const tit = (d.nome_documento || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return tit.includes(normTipo);
    });

    if (!temDocumentoOficial) {
      // 1. Só aceita dado equivalente se a IA/sistema extrair um valor válido com formato comprovado (Regra 2)
      let docFonteComDado: typeof filtrados[0] | null = null;
      let valorExtraidoValido: string | null = null;

      for (const doc of filtrados) {
        if (!doc.trecho) continue;
        const resVal = extrairEValidarDadoDocumental(tipoDocBuscado, doc.trecho);
        if (resVal.valido && resVal.valorFormatado) {
          docFonteComDado = doc;
          valorExtraidoValido = resVal.valorFormatado;
          break;
        }
      }

      const titularFinal = titObj?.nome || titularOriginal;
      const nomeContatoReal = (contato?.nome || contato?.telefone || 'Contato').trim();
      const art = obterArtigoDefinido(tipoDocBuscado);
      const prep = obterPreposicaoTitular(titularFinal);

      if (docFonteComDado && valorExtraidoValido) {
        // Encontrou documento legítimo com o valor válido!
        // Guarda apenas "Documento de origem: [nome] | Valor: [número] (em DD/MM/AAAA)", nunca trechos crus (Regra 3)
        const dataHojeBr = obterAgoraBrasilia().dataStr;
        const dadoEquivalenteFormatado = `Documento de origem: ${docFonteComDado.nome_documento} | Valor: ${valorExtraidoValido} (em ${dataHojeBr})`;

        try {
          await registrarOuIncrementarDocumentoFaltante({
            tipoDocumento: tipoDocBuscado,
            descricaoItem: tipoDocBuscado,
            titularInformado: titularFinal,
            solicitanteNome: nomeContatoReal,
            solicitanteContato: contato?.telefone,
            textoDoPedido: consulta,
            dadosEquivalentesOferecidos: dadoEquivalenteFormatado,
            forcarRegistro: true,
          });
          bloquearCancelamento?.('Registro de documento faltante com dados equivalentes via busca de documentos');
        } catch (errF) {
          console.warn('[VEGA Faltantes ⚠️] Falha ao registrar documento faltante com dados equivalentes:', errF);
        }

        orientacaoResposta = `ATENÇÃO REGRA DOCUMENTO x DADO: O documento oficial "${tipoDocBuscado}" NÃO existe como arquivo no Cofre, mas o número (${valorExtraidoValido}) foi localizado dentro de outro documento ("${docFonteComDado.nome_documento}"). Você DEVE responder separando expressamente as duas coisas: "Não tenho ${art} ${tipoDocBuscado.toLowerCase()} ${prep} ${titularFinal} no Cofre, mas o número aparece na ${docFonteComDado.nome_documento}: ${valorExtraidoValido}. Anotei na lista de documentos pendentes." NUNCA diga que encontrou o documento, apenas que o número consta no outro documento.`;
        mensagemRetorno = orientacaoResposta;
        documentosParaRetorno = [docFonteComDado];
      } else {
        // NÃO encontrou nenhum trecho com o valor no formato válido! (Regra 2: não afirmar nem registrar)
        try {
          await registrarOuIncrementarDocumentoFaltante({
            tipoDocumento: tipoDocBuscado,
            descricaoItem: tipoDocBuscado,
            titularInformado: titularFinal,
            solicitanteNome: nomeContatoReal,
            solicitanteContato: contato?.telefone,
            textoDoPedido: consulta,
            dadosEquivalentesOferecidos: null,
            forcarRegistro: true,
          });
          bloquearCancelamento?.('Registro de documento faltante via busca de documentos');
        } catch (errF) {
          console.warn('[VEGA Faltantes ⚠️] Falha ao registrar documento faltante:', errF);
        }

        orientacaoResposta = `ATENÇÃO: O documento oficial "${tipoDocBuscado}" NÃO existe no Cofre e nenhum número/dado correspondente com formato válido foi localizado nos outros documentos. Responda estritamente ao usuário informando: "Não encontrei ${art} ${tipoDocBuscado} ${prep} ${titularFinal} no Cofre. Anotei na lista de documentos pendentes." É TERMINANTEMENTE PROIBIDO inventar números, afirmar que encontrou em outros documentos (como Passaporte) ou passar trechos que não contenham o dado solicitado.`;
        mensagemRetorno = orientacaoResposta;
        documentosParaRetorno = [];
      }
    }
  }

  return {
    documentos: documentosParaRetorno,
    orientacao_resposta: orientacaoResposta,
    mensagem: mensagemRetorno,
  };
}

/**
 * Processa e valida os campos estruturados da ficha cadastral de um titular
 */
function processarCamposFichaTitular(
  titular: FichaTitular,
  todosDocs: DocumentoRegistro[]
): {
  camposValidados: Record<string, any>;
  alertaDocPosterior?: string;
  instrucaoConfirmado?: string;
  mensagemPadrao?: string;
} {
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
          if (!titularCorresponde(d.titular, titular.nome)) return false;
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

  return { camposValidados, alertaDocPosterior, instrucaoConfirmado, mensagemPadrao };
}

/**
 * Tool 2: consultar_ficha_titular(pessoa_base, relacao)
 */
async function toolConsultarFichaTitular(
  pessoaBaseOuNome: string,
  relacao: 'propria' | 'pai' | 'mae' | 'conjuge' | 'filho' | 'outro' = 'propria',
  todosDocs: DocumentoRegistro[] = [],
  origemMensagem?: 'audio' | 'texto',
  pessoaBaseParam?: string
): Promise<{
  encontrado: boolean;
  titular?: string;
  id?: string;
  alerta_documento_posterior?: string;
  instrucao_resposta?: string;
  mensagem?: string;
  tipo_correspondencia?: string;
  nome_entendido?: string;
  campos?: Record<string, any>;
}> {
  const nomeEfetivo = (pessoaBaseParam || pessoaBaseOuNome || '').trim();
  const todosT = await obterTodosTitulares();
  const catalogoPessoas = extrairCatalogoPessoas(todosT, todosDocs);
  const checkCorr = verificarCorrespondenciaNomePessoa(nomeEfetivo, catalogoPessoas, origemMensagem);

  if (checkCorr.tipo === 'aproximada') {
    return {
      encontrado: false,
      tipo_correspondencia: 'aproximada',
      nome_entendido: checkCorr.nomeEntendido,
      instrucao_resposta: `ATENÇÃO DE PRIVACIDADE E SEGURANÇA: O nome '${checkCorr.nomeEntendido}' possui apenas correspondência aproximada. É TERMINANTEMENTE PROIBIDO revelar qualquer nome existente no Cofre e é PROIBIDO entregar dados cadastrais. Responda ESTRITAMENTE: "${checkCorr.mensagemRespostaObrigatoria}"`,
      mensagem: checkCorr.mensagemRespostaObrigatoria,
    };
  }

  if (checkCorr.tipo === 'inexistente') {
    const instrucao = origemMensagem === 'audio'
      ? `ATENÇÃO DE TRANSCRIÇÃO DE ÁUDIO: A mensagem veio de ÁUDIO e o nome '${checkCorr.nomeEntendido}' não foi encontrado no Cofre. É TERMINANTEMENTE PROIBIDO revelar qualquer nome existente no Cofre e é TERMINANTEMENTE PROIBIDO entregar dados cadastrais. Responda ESTRITAMENTE: "${checkCorr.mensagemRespostaObrigatoria}"`
      : `Não foi encontrado nenhum titular cadastrado ou informação sobre '${checkCorr.nomeEntendido}' no Cofre. Responda ao usuário que não encontrou informações sobre '${checkCorr.nomeEntendido}' no Cofre.`;

    return {
      encontrado: false,
      tipo_correspondencia: 'inexistente',
      nome_entendido: checkCorr.nomeEntendido,
      instrucao_resposta: instrucao,
      mensagem: checkCorr.mensagemRespostaObrigatoria,
    };
  }

  // Correspondência EXATA da pessoa base
  let titularBase = checkCorr.pessoaExata?.titularId
    ? todosT.find((t) => t.id === checkCorr.pessoaExata?.titularId) || null
    : null;
  if (!titularBase && checkCorr.pessoaExata) {
    titularBase = todosT.find((t) => t.nome.toLowerCase() === checkCorr.pessoaExata?.nomeNorm) || null;
  }

  if (!titularBase) {
    return {
      encontrado: false,
      mensagem: `A pessoa '${checkCorr.nomeEntendido}' possui documentos no Cofre, mas não possui ficha cadastral de titular estruturada. Consulte buscar_documentos para acessar os documentos dela.`,
      instrucao_resposta: `A pessoa '${checkCorr.nomeEntendido}' possui documentos no Cofre, mas não tem ficha cadastral estruturada. Faça busca nos documentos ou responda com base nos documentos existentes.`,
    };
  }

  // CASO 1: relacao === 'propria' -> Retorna os dados do próprio titularBase
  if (!relacao || relacao === 'propria') {
    const proc = processarCamposFichaTitular(titularBase, todosDocs);
    const mensagemFinal = proc.alertaDocPosterior || proc.instrucaoConfirmado || proc.mensagemPadrao;
    return {
      encontrado: true,
      titular: titularBase.nome,
      id: titularBase.id,
      alerta_documento_posterior: proc.alertaDocPosterior,
      instrucao_resposta: proc.instrucaoConfirmado,
      mensagem: mensagemFinal,
      campos: proc.camposValidados,
    };
  }

  // CASO 2: relacao !== 'propria' -> Busca estrita do parente/relacionado
  const nomeParente = extrairPessoaRelacionadaDaFicha(titularBase, relacao);
  const artRel = ['mae', 'esposa', 'filha'].includes(relacao) ? 'da' : 'do';

  if (!nomeParente) {
    return {
      encontrado: false,
      mensagem: `nao_encontrado: não há dados nem identificação ${artRel} ${relacao} de ${titularBase.nome} no cadastro.`,
      instrucao_resposta: `ATENÇÃO DE SEGURANÇA E PRIVACIDADE: Não há dados nem identificação ${artRel} ${relacao} de ${titularBase.nome} no sistema. É TERMINANTEMENTE PROIBIDO entregar dados, telefones ou endereços de ${titularBase.nome}. Responda ESTRITAMENTE: "Não encontrei o endereço ${artRel} ${relacao} de ${titularBase.nome} nos documentos." (ou o campo que foi solicitado).`,
      campos: {},
    };
  }

  // Se tem nome do parente, verifica se ele possui ficha própria
  const titularParente = todosT.find((t) => titularCorresponde(t.nome, nomeParente)) || null;
  if (!titularParente) {
    return {
      encontrado: false,
      mensagem: `O ${relacao} de ${titularBase.nome} é "${nomeParente}", mas ele não possui ficha cadastral de titular estruturada. Você deve consultar a ferramenta buscar_documentos com titular="${nomeParente}". NUNCA forneça dados de ${titularBase.nome}.`,
      instrucao_resposta: `O ${relacao} de ${titularBase.nome} é "${nomeParente}", mas ele não possui ficha cadastral. Faça busca em buscar_documentos para acessar os documentos dele. NUNCA forneça dados da pessoa base.`,
      campos: {},
    };
  }

  // Parente tem ficha própria! Processa os campos da ficha DO PARENTE
  const procParente = processarCamposFichaTitular(titularParente, todosDocs);
  const mensagemFinalParente = procParente.alertaDocPosterior || procParente.instrucaoConfirmado || procParente.mensagemPadrao;
  return {
    encontrado: true,
    titular: titularParente.nome,
    id: titularParente.id,
    alerta_documento_posterior: procParente.alertaDocPosterior,
    instrucao_resposta: procParente.instrucaoConfirmado,
    mensagem: mensagemFinalParente,
    campos: procParente.camposValidados,
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
    const termoNorm = nome_documento_origem.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Prioriza estritamente os documentos DO PRÓPRIO TITULAR (Regra: sem fallback para documentos de terceiros)
    const docsDoTitular = todosDocs.filter((d) => titularCorresponde(d.titular, titular.nome));
    const candidatosTitular = docsDoTitular.filter((d) => {
      const titNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return titNorm.includes(termoNorm) || termoNorm.includes(titNorm);
    });
    if (candidatosTitular.length === 1) {
      docOrigem = candidatosTitular[0];
    } else if (candidatosTitular.length > 1) {
      docOrigem = candidatosTitular.find((d) => d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === termoNorm);
    }
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
 * Tool 2.5: listar_documentos_cofre(filtro_tipo?)
 * Retorna o panorama geral do Cofre agrupado por titular com contagem e tipos principais.
 */
export async function toolListarDocumentosCofre(
  filtroTipo?: string,
  todosDocs: DocumentoRegistro[] = []
): Promise<{
  total_documentos: number;
  total_titulares: number;
  filtro_aplicado?: string | null;
  grupos: Array<{
    titular: string;
    total: number;
    tipos: string[];
    resumo_tipos: string;
    exemplos_documentos: string[];
  }>;
  instrucao_apresentacao: string;
}> {
  let docs = todosDocs && todosDocs.length > 0 ? todosDocs : await obterTodosDocumentos();

  // Filtro opcional por tipo
  if (filtroTipo && filtroTipo.trim()) {
    const filtroNorm = filtroTipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    docs = docs.filter((d) => {
      const tipoNorm = (d.tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const titNorm = (d.titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return tipoNorm.includes(filtroNorm) || titNorm.includes(filtroNorm);
    });
  }

  // Agrupamento por titular
  const mapaTitulares = new Map<string, DocumentoRegistro[]>();

  for (const d of docs) {
    let chaveTitular = (d.titular || '').trim();
    if (!chaveTitular || chaveTitular.toLowerCase() === 'delta plan' || chaveTitular.toLowerCase().includes('delta') || d.metadata?.corporativo) {
      chaveTitular = 'Documentos da Empresa (Delta Plan)';
    }
    const lista = mapaTitulares.get(chaveTitular) || [];
    lista.push(d);
    mapaTitulares.set(chaveTitular, lista);
  }

  const grupos: Array<{
    titular: string;
    total: number;
    tipos: string[];
    resumo_tipos: string;
    exemplos_documentos: string[];
  }> = [];

  for (const [titular, listaDocs] of mapaTitulares.entries()) {
    const tiposMap = new Map<string, number>();
    for (const d of listaDocs) {
      const tipoReal = (d.tipo || 'Outros').trim();
      tiposMap.set(tipoReal, (tiposMap.get(tipoReal) || 0) + 1);
    }
    const tipos = Array.from(tiposMap.keys());
    const resumoTipos = Array.from(tiposMap.entries())
      .map(([tipo, qtd]) => (qtd > 1 ? `${tipo} (${qtd})` : tipo))
      .join(', ');

    const exemplosDocumentos = listaDocs.slice(0, 3).map((d) => d.titulo);

    grupos.push({
      titular,
      total: listaDocs.length,
      tipos,
      resumo_tipos: resumoTipos,
      exemplos_documentos: exemplosDocumentos,
    });
  }

  // Ordenar: Documentos da Empresa primeiro, depois os titulares por maior volume
  grupos.sort((a, b) => {
    if (a.titular.includes('Empresa')) return -1;
    if (b.titular.includes('Empresa')) return 1;
    return b.total - a.total;
  });

  return {
    total_documentos: docs.length,
    total_titulares: grupos.length,
    filtro_aplicado: filtroTipo || null,
    grupos,
    instrucao_apresentacao:
      'Apresente um resumo curto e elegante por titular, indicando a contagem de documentos e os principais tipos. Ao final, ofereça para detalhar qualquer titular que o usuário escolher. NUNCA despeje a lista completa de todos os arquivos no WhatsApp.',
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
 * Validação rigorosa de correspondência por atributos identificadores (marca, modelo de veículo, logradouro/rua, etc.)
 * Impede que a caminhonete Amarok seja enviada quando o usuário pediu Nissan Frontier, ou comprovante de outra rua.
 */
export function documentoEhCompativelComTermo(doc: DocumentoRegistro, termoBusca: string): boolean {
  if (!termoBusca || !doc) return true;
  const termoNorm = termoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const titNorm = (doc.titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const arqNorm = (doc.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const descNorm = (doc.descricao || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Modelos e marcas de veículos
  const marcasEModelos = [
    'frontier', 'nissan', 'amarok', 'volkswagen', 'hilux', 'toyota',
    's10', 'chevrolet', 'ranger', 'ford', 'toro', 'fiat', 'strada',
    'saveiro', 'l200', 'mitsubishi', 'corolla', 'civic', 'honda'
  ];

  // Se o pedido cita um modelo/marca específico
  const modeloCitado = marcasEModelos.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(termoNorm));
  if (modeloCitado) {
    const docTemModelo = titNorm.includes(modeloCitado) || arqNorm.includes(modeloCitado) || descNorm.includes(modeloCitado);
    if (!docTemModelo) {
      return false; // Incompatível!
    }
  }

  // Se o pedido cita uma rua específica (ex: "rua x")
  const matchRua = termoNorm.match(/\brua\s+([a-z0-9]+)/i);
  if (matchRua) {
    const ruaNome = matchRua[1];
    if (!['de', 'da', 'do', 'e'].includes(ruaNome) && ruaNome.length >= 2) {
      const docTemRua = titNorm.includes(ruaNome) || descNorm.includes(ruaNome);
      if (!docTemRua) {
        return false; // Incompatível!
      }
    }
  }

  return true;
}

/**
 * Tool: listar_documentos_faltantes(titular?, escopo?)
 */
export async function toolListarDocumentosFaltantes(
  titular?: string,
  escopo?: string,
  contato?: Contato,
  mensagemUsuario?: string
): Promise<{
  total: number;
  precisa_esclarecer?: boolean;
  pergunta_esclarecimento?: string;
  documentos?: Array<{
    id: string;
    tipo: string;
    titular: string;
    quantidade_pedidos: number;
    data_ultimo_pedido: string;
    status: string;
  }>;
  mensagem: string;
}> {
  const msgNorm = normalizarParaComparacao(mensagemUsuario || '');
  const pedeMeus = escopo === 'meus' || /\b(meus?|minhas?|pra mim|meu)\b/i.test(msgNorm);
  const pedeTodos = escopo === 'todos' || /\b(todos?|geral|completa|tudo)\b/i.test(msgNorm);

  // Se o pedido não deixar claro de quem, perguntar: "Quer só os seus ou de todos os titulares?"
  if (!titular && !pedeMeus && !pedeTodos) {
    return {
      total: 0,
      precisa_esclarecer: true,
      pergunta_esclarecimento: 'Quer só os seus ou de todos os titulares?',
      mensagem: 'O usuário não especificou se deseja apenas os seus documentos faltantes ou de todos os titulares. Você DEVE responder ESTRITAMENTE: "Quer só os seus ou de todos os titulares?"',
    };
  }

  const faltantes = await obterDocumentosFaltantes();
  let pendentes = faltantes.filter((f) => f.status === 'pendente');

  if (pedeMeus && contato) {
    const nomeRemetente = contato.titularVinculado || contato.nome;
    pendentes = pendentes.filter((f) => titularCorresponde(f.titular, nomeRemetente));
  } else if (titular && !pedeTodos) {
    pendentes = pendentes.filter((f) => titularCorresponde(f.titular, titular));
  }

  const listaFormatada = pendentes.map((f) => ({
    id: f.id,
    tipo: f.tipoDocumento,
    titular: f.titular,
    quantidade_pedidos: f.quantidadePedidos,
    data_ultimo_pedido: f.dataUltimoPedido,
    status: f.status,
  }));

  let msg = '';
  if (listaFormatada.length === 0) {
    const alvo = titular ? `do titular ${titular}` : pedeMeus ? 'seus' : 'no Cofre';
    msg = `Não constam documentos faltantes pendentes ${alvo} na lista da VEGA.`;
  } else {
    msg = `Documentos faltantes registrados na VEGA (${listaFormatada.length}):\n` +
      listaFormatada.map((d, i) => {
        const temTitular = d.titular && !['Não identificado', 'Titular Não Informado', 'Desconhecido', 'Sem titular'].includes(d.titular);
        const sufixoTitular = temTitular ? ` - Titular: *${d.titular}*` : '';
        return `${i + 1}. *${d.tipo}*${sufixoTitular} (solicitado ${d.quantidade_pedidos}x)`;
      }).join('\n');
  }

  return {
    total: listaFormatada.length,
    documentos: listaFormatada,
    mensagem: msg,
  };
}

/**
 * Tool: registrar_documento_faltante(descricao, tipo_documento?, titular?, tipo_referencia?, identificador_referencia?)
 * A IA lê o histórico recente e formula a descrição completa do documento faltante (Regra 25).
 */
export async function toolRegistrarDocumentoFaltante(
  descricao: string,
  tipo_documento?: string,
  titular?: string,
  contato?: Contato,
  mensagemUsuario?: string,
  tipoReferencia?: 'pessoa' | 'veiculo' | 'imovel' | 'empresa' | 'obra' | 'outro',
  identificadorReferencia?: string
): Promise<{
  sucesso: boolean;
  mensagem: string;
  item_registrado?: {
    id: string;
    tipo: string;
    titular: string;
    quantidade_pedidos: number;
  };
}> {
  const descLimpa = (descricao || '').trim();
  let tipoFinal = tipo_documento?.trim();
  if (!tipoFinal) {
    if (tipoReferencia === 'veiculo') tipoFinal = 'Documento de Veículo';
    else if (tipoReferencia === 'imovel') tipoFinal = 'Comprovante de Residência';
    else if (tipoReferencia === 'obra') tipoFinal = 'Documento de Obra';
    else if (tipoReferencia === 'empresa') tipoFinal = 'Documento de Empresa';
    else tipoFinal = descLimpa || 'Documento';
  }

  const titularFinal = titular?.trim() || (tipoReferencia === 'empresa' ? identificadorReferencia : '') || '';
  const nomeSolicitante = (contato?.nome || contato?.telefone || 'Contato').trim();

  const reg = await registrarOuIncrementarDocumentoFaltante({
    tipoDocumento: tipoFinal,
    descricaoItem: descLimpa,
    titularInformado: titularFinal || null,
    solicitanteNome: nomeSolicitante,
    solicitanteContato: contato?.telefone,
    textoDoPedido: mensagemUsuario || descLimpa,
    forcarRegistro: true,
  });

  const textoAviso = descLimpa.toLowerCase().startsWith('documento') ||
    descLimpa.toLowerCase().startsWith('comprovante') ||
    descLimpa.toLowerCase().startsWith('escritura') ||
    descLimpa.toLowerCase().startsWith('certidão') ||
    descLimpa.toLowerCase().startsWith('cnh')
    ? descLimpa
    : `documento ${descLimpa}`;

  const aviso = `Registrei como faltante: ${textoAviso}.`;

  return {
    sucesso: true,
    mensagem: aviso,
    item_registrado: reg
      ? {
          id: reg.id,
          tipo: reg.tipoDocumento,
          titular: reg.titular || 'Não identificado',
          quantidade_pedidos: reg.quantidadePedidos,
        }
      : undefined,
  };
}

/**
 * Tool 4: enviar_documento(doc_id)
 */
async function toolEnviarDocumento(
  docId: string,
  todosDocs: DocumentoRegistro[] = [],
  anexosAcumulados: Anexo[],
  contato?: Contato,
  tipoReferencia?: 'pessoa' | 'veiculo' | 'imovel' | 'empresa' | 'obra' | 'outro',
  identificadorReferencia?: string
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
  if (doc && !documentoEhCompativelComTermo(doc, idLimpo)) {
    doc = undefined;
  }

  if (!doc) {
    const idNorm = idLimpo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const candidatos = docs.filter((d) => {
      const titNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const arqNorm = (d.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const comp = documentoEhCompativelComTermo(d, idNorm);
      if (!comp) return false;
      return titNorm.includes(idNorm) || idNorm.includes(titNorm) || arqNorm.includes(idNorm);
    });
    if (candidatos.length === 1) {
      doc = candidatos[0];
    } else if (candidatos.length > 1) {
      // Ambiguidade: NUNCA enviar o primeiro da lista!
      const opcoesAmbiguidade = candidatos.slice(0, 5).map((c) => `"${c.titulo}" (${c.titular || 'Sem titular'})`).join(', ');
      return {
        sucesso: false,
        erro: `Existem ${candidatos.length} documentos compatíveis com "${idLimpo}" (${opcoesAmbiguidade}). É proibido escolher um documento arbitrariamente para envio. Pergunte ao usuário qual titular ou documento específico ele deseja.`,
      };
    }
  }
  if (!doc) {
    const docLoc = localizarDocumentoCitadoNoCofre(idLimpo, docs);
    if (docLoc && documentoEhCompativelComTermo(docLoc, idLimpo)) {
      doc = docLoc;
    }
  }
  if (!doc) {
    const idSemPrefixo = idLimpo.replace(/^(?:o\s+|a\s+)?(?:pdf|arquivo|documento|cópia|copia)\s+(?:d[oea]\s+)?/i, '').trim();
    if (idSemPrefixo && idSemPrefixo !== idLimpo) {
      const docLocPref = localizarDocumentoCitadoNoCofre(idSemPrefixo, docs);
      if (docLocPref && documentoEhCompativelComTermo(docLocPref, idSemPrefixo)) {
        doc = docLocPref;
      }
      if (!doc) {
        const idSemPrefNorm = idSemPrefixo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const candidatosPref = docs.filter((d) => {
          const titNorm = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const arqNorm = (d.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const comp = documentoEhCompativelComTermo(d, idSemPrefNorm);
          if (!comp) return false;
          return titNorm.includes(idSemPrefNorm) || idSemPrefNorm.includes(titNorm) || arqNorm.includes(idSemPrefNorm);
        });
        if (candidatosPref.length === 1) {
          doc = candidatosPref[0];
        } else if (candidatosPref.length > 1) {
          const opcoesPref = candidatosPref.slice(0, 5).map((c) => `"${c.titulo}" (${c.titular || 'Sem titular'})`).join(', ');
          return {
            sucesso: false,
            erro: `Existem ${candidatosPref.length} documentos compatíveis com "${idSemPrefixo}" (${opcoesPref}). Pergunte ao usuário qual titular ou documento específico ele deseja enviar.`,
          };
        }
      }
    }
  }

  const termosProibidos = ['documentos', 'quantos', 'quais', 'lista', 'todos', 'tudo', 'contagem', 'docs'];
  if (termosProibidos.includes(idLimpo.toLowerCase())) {
    return {
      sucesso: false,
      erro: `O termo "${idLimpo}" refere-se a uma contagem ou listagem de documentos, e não a um arquivo físico específico. NÃO chame enviar_documento para contagens ou listagens. Use listar_documentos_titular.`,
    };
  }

  if (!doc) {
    const infoAtributo = identificarAtributoDocumentoFaltante(
      idLimpo,
      null,
      tipoReferencia,
      identificadorReferencia
    );
    const nomeSolicitante = (contato?.nome || contato?.telefone || 'Contato').trim();

    if (!infoAtributo.ehAmbiguo) {
      try {
        await registrarOuIncrementarDocumentoFaltante({
          tipoDocumento: infoAtributo.tipoDocumento,
          descricaoItem: infoAtributo.descricaoItem,
          titularInformado: infoAtributo.titularFinal,
          solicitanteNome: nomeSolicitante,
          solicitanteContato: contato?.telefone,
          textoDoPedido: idLimpo,
          forcarRegistro: true,
        });
      } catch {}
      const textoItem = infoAtributo.descricaoItem.toLowerCase().startsWith('documento') || infoAtributo.descricaoItem.toLowerCase().startsWith('comprovante')
        ? infoAtributo.descricaoItem.toLowerCase()
        : `o documento ${infoAtributo.descricaoItem.toLowerCase()}`;
      return {
        sucesso: false,
        erro: `Documento "${idLimpo}" não foi encontrado no Cofre. Foi registrado automaticamente como documento faltante. Responda ao usuário avisando: "Não encontrei ${textoItem} no Cofre. Registrei como documento faltante."`,
      };
    }

    return {
      sucesso: false,
      erro: `Documento com id ou termo "${idLimpo}" não foi encontrado no Cofre. Responda ao usuário perguntando: "Não encontrei esse documento no Cofre. Quer que eu registre como documento faltante?"`,
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
  instrucao_resposta?: string;
}> {
  let resK = await buscarConhecimento(termo);
  let itens = resK.resultados || (resK.instrucao ? [resK.instrucao] : []);

  if (itens.length === 0) {
    const termoLimpo = (termo || '').replace(/^(?:qual\s+o\s+|qual\s+a\s+|me\s+(?:passa|manda|diz)\s+o\s+|telefone\s+d[oea]\s+|contato\s+d[oea]\s+|pix\s+d[oea]\s+|chave\s+pix\s+d[oea]\s+|link\s+d[oea]\s+)/i, '').trim();
    if (termoLimpo && termoLimpo !== termo) {
      resK = await buscarConhecimento(termoLimpo);
      itens = resK.resultados || (resK.instrucao ? [resK.instrucao] : []);
    }
  }

  if (categoria && itens.length > 0) {
    const itensFiltrados = itens.filter((i) => (i.categoria || '').toLowerCase().includes(categoria.toLowerCase()));
    if (itensFiltrados.length > 0) {
      itens = itensFiltrados;
    }
  }

  let instrucaoResposta: string | undefined = undefined;
  const termoLower = (termo || '').toLowerCase();
  const buscaSobreSite = /\b(site|portal|pagina|página|link|web|maquina|máquina|portfolio|portfólio)\b/i.test(termoLower);

  if (itens.length > 0) {
    const temItemLink = itens.some((i) => i.tipo === 'link' || /https?:\/\//i.test(i.conteudo));
    if (temItemLink) {
      const itemLink = itens.find((i) => i.tipo === 'link' || /https?:\/\//i.test(i.conteudo))!;
      instrucaoResposta = `DIRETRIZ MANDATÓRIA: Se o usuário pediu para ler, resumir, ver o que tem de importante ou analisar este site/página, NÃO entregue o link diretamente nem tente resumir o site. Responda ESTRITAMENTE: "Tenho o link do ${itemLink.titulo} salvo, mas não consigo abrir sites para ler o conteúdo. Quer o link?". Apenas envie o link se o usuário já tiver dito "Sim" na rodada anterior ou se pediu expressamente "qual o link".`;
    }
  } else if (buscaSobreSite) {
    instrucaoResposta = `DIRETRIZ MANDATÓRIA: Não foi encontrado link salvo para este site/página na Base de Conhecimento. Se o usuário pediu para ler, resumir ou ver o que tem no site, responda ESTRITAMENTE: "Não consigo abrir sites para ler o conteúdo, e não tenho esse link salvo na Base de Conhecimento."`;
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
    ...(instrucaoResposta ? { instrucao_resposta: instrucaoResposta } : {}),
  };
}

/**
 * GERENCIAMENTO DE AÇÕES PENDENTES NA BASE DE CONHECIMENTO (REGRA CRÍTICA DE CONFIRMAÇÃO PRÉVIA)
 * As tools de conhecimento NUNCA gravam na mesma rodada da IA.
 * Elas apenas registram a ação pendente e retornam para a IA formular a confirmação.
 * A gravação real acontece unicamente na mensagem seguinte após o "sim".
 */
export interface AcaoConhecimentoPendente {
  tipoAcao: 'salvar' | 'atualizar' | 'remover';
  categoria: string;
  titulo: string;
  conteudo: string;
  tipoConhecimento?: TipoConhecimento;
  dadosEstruturados?: any;
  idExistente?: string;
  usuarioNome: string;
  usuarioId: string;
  dataCriacao: number;
  duplicadoId?: string;
  duplicadoTitulo?: string;
  status: 'aguardando_confirmacao' | 'aguardando_decisao_duplicado' | 'aguardando_dado_faltante';
  campoFaltante?: 'telefone' | 'chave_pix' | 'url' | 'nome' | string;
  nomePessoa?: string;
  novoTitulo?: string;
  apelidos?: string[];
}

export const acoesConhecimentoPendentes = new Map<string, AcaoConhecimentoPendente>();

export function registrarAcaoConhecimentoPendente(contatoId: string, acao: AcaoConhecimentoPendente) {
  acoesConhecimentoPendentes.set(contatoId, acao);
}

export function obterAcaoConhecimentoPendente(contatoId: string): AcaoConhecimentoPendente | undefined {
  const acao = acoesConhecimentoPendentes.get(contatoId);
  if (!acao) return undefined;
  if (Date.now() - acao.dataCriacao > 30 * 60 * 1000) {
    acoesConhecimentoPendentes.delete(contatoId);
    return undefined;
  }
  return acao;
}

export function limparAcaoConhecimentoPendente(contatoId: string) {
  acoesConhecimentoPendentes.delete(contatoId);
}

/**
 * Persiste ação pendente de conhecimento no Supabase (resistente a deploy/reinício no Railway)
 */
export async function salvarAcaoConhecimentoPendenteSupabase(
  contato: Contato,
  acao: AcaoConhecimentoPendente
): Promise<void> {
  registrarAcaoConhecimentoPendente(contato.id, acao);
  if (contato.telefone) {
    registrarAcaoConhecimentoPendente(contato.telefone, acao);
    registrarAcaoConhecimentoPendente(normalizarNumeroCanonica(contato.telefone), acao);
  }

  try {
    const supabase = getSupabaseClient();
    const id = `pend-k-${contato.id}`;
    const expiraEm = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const tel = contato.telefone || '';

    await supabase.from('pendencias_documento_whatsapp').upsert({
      id,
      conversa_id: contato.id,
      remetente_numero: tel,
      remetente_jid: tel ? `${tel}@s.whatsapp.net` : '',
      documento_id: 'conhecimento',
      tipo_pendencia: 'cadastro_conhecimento',
      dados_detectados: acao,
      expira_em: expiraEm,
      resolvido: false,
    });
  } catch (err) {
    console.warn('[ChatOrquestrador ⚠️] Falha ao persistir ação de conhecimento pendente no Supabase:', err);
  }
}

/**
 * Recupera ação pendente de conhecimento, consultando a memória e caindo no Supabase se o servidor tiver reiniciado
 */
export async function obterAcaoConhecimentoPendenteSupabase(
  contato: Contato
): Promise<AcaoConhecimentoPendente | undefined> {
  const tel = contato.telefone || '';
  const telCanonica = tel ? normalizarNumeroCanonica(tel) : '';

  // 1. Tenta recuperar da memória RAM
  const emMemoria =
    obterAcaoConhecimentoPendente(contato.id) ||
    (tel ? obterAcaoConhecimentoPendente(tel) : undefined) ||
    (telCanonica ? obterAcaoConhecimentoPendente(telCanonica) : undefined);

  if (emMemoria) return emMemoria;

  // 2. Se a memória foi zerada (ex: deploy ou reinício no Railway), busca no Supabase
  try {
    const supabase = getSupabaseClient();
    const agoraIso = new Date().toISOString();

    // 2.1. Busca direta por ID da pendência do contato
    const { data: porId } = await supabase
      .from('pendencias_documento_whatsapp')
      .select('dados_detectados, expira_em')
      .eq('id', `pend-k-${contato.id}`)
      .eq('resolvido', false)
      .gt('expira_em', agoraIso)
      .maybeSingle();

    if (porId?.dados_detectados) {
      const acao = porId.dados_detectados as AcaoConhecimentoPendente;
      registrarAcaoConhecimentoPendente(contato.id, acao);
      return acao;
    }

    // 2.2. Se tiver telefone, busca por número ou conversa_id
    if (tel || telCanonica) {
      const condicoes = [
        `conversa_id.eq.${contato.id}`,
        tel ? `remetente_numero.eq.${tel}` : '',
        telCanonica ? `remetente_numero.eq.${telCanonica}` : '',
        telCanonica ? `conversa_id.eq.wa-${telCanonica}` : '',
      ]
        .filter(Boolean)
        .join(',');

      const { data: porTel } = await supabase
        .from('pendencias_documento_whatsapp')
        .select('dados_detectados, expira_em')
        .or(condicoes)
        .eq('tipo_pendencia', 'cadastro_conhecimento')
        .eq('resolvido', false)
        .gt('expira_em', agoraIso)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (porTel?.dados_detectados) {
        const acao = porTel.dados_detectados as AcaoConhecimentoPendente;
        registrarAcaoConhecimentoPendente(contato.id, acao);
        return acao;
      }
    }
  } catch (err) {
    console.warn('[ChatOrquestrador ⚠️] Falha ao consultar ação de conhecimento pendente no Supabase:', err);
  }

  return undefined;
}

/**
 * Limpa a ação pendente de conhecimento da memória e do Supabase
 */
export async function limparAcaoConhecimentoPendenteSupabase(
  contato: Contato
): Promise<void> {
  limparAcaoConhecimentoPendente(contato.id);
  if (contato.telefone) {
    limparAcaoConhecimentoPendente(contato.telefone);
    limparAcaoConhecimentoPendente(normalizarNumeroCanonica(contato.telefone));
  }

  try {
    const supabase = getSupabaseClient();
    const tel = contato.telefone || '';
    const telCanonica = tel ? normalizarNumeroCanonica(tel) : '';

    const condicoes = [
      `id.eq.pend-k-${contato.id}`,
      `conversa_id.eq.${contato.id}`,
      tel ? `remetente_numero.eq.${tel}` : '',
      telCanonica ? `conversa_id.eq.wa-${telCanonica}` : '',
    ]
      .filter(Boolean)
      .join(',');

    await supabase
      .from('pendencias_documento_whatsapp')
      .delete()
      .or(condicoes);
  } catch (err) {
    console.warn('[ChatOrquestrador ⚠️] Falha ao limpar ação de conhecimento pendente no Supabase:', err);
  }
}

/**
 * Validação rigorosa contra títulos genéricos (PROIBIDO: "Novo Item", "Contato", vazio, etc.)
 */
export function ehTituloGenerico(titulo?: string | null): boolean {
  if (!titulo) return true;
  const t = titulo.trim().toLowerCase();
  if (!t) return true;
  if (/^(?:contato|chave\s*pix|pix|link|sistema|item|regra)\s*$/i.test(t)) return true;
  if (/^(?:contato\s*)?(?:novo\s*item|item\s*novo|novo|item|sem\s*nome|desconhecido)$/i.test(t)) return true;
  if (/^(?:link|sistema)\s*(?:novo\s*item|item\s*novo|novo|item)$/i.test(t)) return true;
  if (/^(?:chave\s*pix\s*(?:d[oa]\s*)?)(?:novo\s*item|novo|item)$/i.test(t)) return true;

  const semPrefixo = t
    .replace(/^(?:contato\s*(?:d[oa]\s*)?|chave\s*pix\s*(?:d[oa]\s*)?|link\s*(?:d[oa]\s*)?|sistema\s*(?:d[oa]\s*)?)/i, '')
    .trim();
  if (!semPrefixo || /^(?:novo\s*item|item\s*novo|novo|item|sem\s*nome|desconhecido)$/i.test(semPrefixo)) {
    return true;
  }
  return false;
}

/**
 * Formata o título de contato garantindo prefixo "Contato" e Capitalização correta
 */
export function formatarTituloContato(nomePessoa: string): string {
  const limpo = (nomePessoa || '').replace(/^(?:contato\s*(?:d[oa]\s*)?)/i, '').trim();
  const minusculas = new Set(['de', 'do', 'da', 'dos', 'das', 'e']);
  const nomeFormatado = limpo
    .split(/\s+/)
    .map((p, idx) => (minusculas.has(p.toLowerCase()) && idx > 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
  return `Contato ${nomeFormatado}`;
}

/**
 * Extrai o dado principal de um item da Base de Conhecimento para exibição transparente em confirmações
 */
export function extrairDadoPrincipalItemConhecimento(item: ItemConhecimento): string {
  if (item.tipo === 'pix') {
    const chave = (item.dadosEstruturados as any)?.chave || (item.dadosEstruturados as any)?.chavePix;
    if (chave) return chave;
  }
  if (item.tipo === 'contato') {
    const tel = (item.dadosEstruturados as any)?.telefone;
    if (tel) return tel;
  }
  if (item.tipo === 'link') {
    const url = (item.dadosEstruturados as any)?.url || (item.dadosEstruturados as any)?.link;
    if (url) return url;
  }
  const limpo = (item.conteudo || '').split('|')[0].trim();
  return limpo;
}

/**
 * Extrai dados de localização geográfica (latitude, longitude, linkMaps, nome, endereço)
 * de argumentos estruturados, conteúdo textual, mensagem atual ou histórico recente da conversa.
 */
export function extrairLocalizacaoDeTextoOuHistorico(
  argsConteudo?: string,
  argsDados?: any,
  msgAtual?: string,
  historico: Mensagem[] = []
): { latitude: number; longitude: number; linkMaps: string; nome?: string; endereco?: string } | null {
  // 1. Inspeciona argumentos estruturados
  if (argsDados && typeof argsDados === 'object') {
    const lat = Number(argsDados.latitude ?? argsDados.lat);
    const lng = Number(argsDados.longitude ?? argsDados.lng ?? argsDados.lon);
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      const link = argsDados.linkMaps || argsDados.link || `https://www.google.com/maps?q=${lat},${lng}`;
      return {
        latitude: lat,
        longitude: lng,
        linkMaps: link,
        nome: argsDados.nomeLocal || argsDados.nome,
        endereco: argsDados.endereco,
      };
    }
  }

  // 2. Textos candidatos:
  // REGRA ESTRITA: ao salvar localização, a IA só pode usar uma localização recebida no LOTE ATUAL
  // ou na MENSAGEM IMEDIATAMENTE ANTERIOR ao pedido. Nunca usar localizações antigas do histórico!
  const textosCandidatos: string[] = [];
  if (argsConteudo) textosCandidatos.push(argsConteudo);
  if (msgAtual) textosCandidatos.push(msgAtual);

  // Mensagem imediatamente anterior ao pedido no histórico (apenas ela!)
  if (historico && historico.length > 0) {
    const ultimas = historico.slice(-2);
    const msgImediatamenteAnterior = [...ultimas].reverse().find((m) => m.remetente === 'cliente');
    if (msgImediatamenteAnterior && msgImediatamenteAnterior.texto) {
      textosCandidatos.push(msgImediatamenteAnterior.texto);
    }
  }

  for (const txt of textosCandidatos) {
    if (!txt) continue;

    // Formato padrão gerado pelo webhook: [Localização recebida: latitude -22.3145, longitude -49.0587 ...]
    const matchWebhook = txt.match(/latitude\s*[:\s]?\s*(-?\d+(?:\.\d+)?)[,\s]+longitude\s*[:\s]?\s*(-?\d+(?:\.\d+)?)/i);
    if (matchWebhook) {
      const lat = parseFloat(matchWebhook[1]);
      const lng = parseFloat(matchWebhook[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        const matchNome = txt.match(/Local:\s*([^|)\n]+)/i);
        const matchEnd = txt.match(/Endereço:\s*([^|)\n]+)/i);
        const matchLink = txt.match(/Link:\s*(https?:\/\/[^\s\]\n]+)/i);
        return {
          latitude: lat,
          longitude: lng,
          linkMaps: matchLink ? matchLink[1].trim() : `https://www.google.com/maps?q=${lat},${lng}`,
          nome: matchNome ? matchNome[1].trim() : undefined,
          endereco: matchEnd ? matchEnd[1].trim() : undefined,
        };
      }
    }

    // Link do Google Maps
    const matchMaps = txt.match(/google\.com\/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)/i) ||
                      txt.match(/maps\.(?:google\.com|app\.goo\.gl)\/.*?(?:[?&]q=|\/dir\/\/)(-?\d+\.\d+),(-?\d+\.\d+)/i);
    if (matchMaps) {
      const lat = parseFloat(matchMaps[1]);
      const lng = parseFloat(matchMaps[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return {
          latitude: lat,
          longitude: lng,
          linkMaps: `https://www.google.com/maps?q=${lat},${lng}`,
        };
      }
    }

    // Par de coordenadas decimais: -22.3145, -49.0587
    const matchCoords = txt.match(/(-?\d{1,2}\.\d{3,8})[,\s]+(-?\d{1,3}\.\d{3,8})/);
    if (matchCoords) {
      const lat = parseFloat(matchCoords[1]);
      const lng = parseFloat(matchCoords[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return {
          latitude: lat,
          longitude: lng,
          linkMaps: `https://www.google.com/maps?q=${lat},${lng}`,
        };
      }
    }
  }

  return null;
}

/**
 * Tool: salvar_conhecimento
 */
export async function toolSalvarConhecimento(
  args: {
    categoria: string;
    titulo: string;
    conteudo: string;
    apelidos?: string[];
    tipo?: TipoConhecimento;
    dados_estruturados?: any;
    confirmado?: boolean;
    forcar_novo?: boolean;
    quer_atualizar?: boolean;
  },
  contato: Contato,
  historicoRecente: Mensagem[] = [],
  mensagemUsuarioAtual: string = ''
): Promise<{
  sucesso: boolean;
  status: 'sucesso' | 'precisa_confirmacao' | 'item_existente' | 'sem_permissao' | 'dado_faltante' | 'erro';
  id?: string;
  titulo?: string;
  mensagem: string;
  instrucao_resposta?: string;
  item_existente?: any;
  campo_faltante?: string;
}> {
  // 1. Permissão: apenas admin ou diretoria
  const ehAdmin =
    contato.nivelAcesso === 'diretoria' ||
    (contato as any).nivelAcesso === 'admin' ||
    contato.setor === 'Diretoria' ||
    contato.setor === 'Administrativo' ||
    Boolean(contato.permiteCadastroConhecimento);

  if (!ehAdmin) {
    return {
      sucesso: false,
      status: 'sem_permissao',
      mensagem:
        'Você não tem permissão para cadastrar informações na Base de Conhecimento da VEGA. Apenas administradores podem realizar cadastros.',
      instrucao_resposta:
        'Responda estritamente ao usuário: "Você não tem permissão para cadastrar informações na Base de Conhecimento da VEGA. Apenas administradores podem realizar cadastros."',
    };
  }

  let tituloLimpo = (args.titulo || '').trim();
  const pendenciaAtual = await obterAcaoConhecimentoPendenteSupabase(contato);

  // Se o título informado for genérico, tenta recuperar de pendência anterior ou recusa
  if (ehTituloGenerico(tituloLimpo)) {
    if (pendenciaAtual && pendenciaAtual.titulo && !ehTituloGenerico(pendenciaAtual.titulo)) {
      tituloLimpo = pendenciaAtual.titulo;
    } else if (pendenciaAtual && pendenciaAtual.nomePessoa && !ehTituloGenerico(pendenciaAtual.nomePessoa)) {
      tituloLimpo = formatarTituloContato(pendenciaAtual.nomePessoa);
    } else {
      return {
        sucesso: false,
        status: 'dado_faltante',
        campo_faltante: 'nome',
        mensagem: 'Título ou nome genérico não é permitido. É obrigatório informar o nome da pessoa ou sistema.',
        instrucao_resposta: 'Não é permitido salvar contatos ou itens com títulos genéricos como "Novo Item" ou apenas "Contato". Pergunte ao usuário de quem é esse contato ou qual é o nome do item a ser salvo.',
      };
    }
  }

  const tituloNorm = normalizarParaComparacao(tituloLimpo);
  const catNorm = (args.categoria || '').toLowerCase().trim();
  const tipoNorm = (args.tipo || '').toLowerCase().trim();

  const ehContato = catNorm.includes('contato') || tipoNorm === 'contato' || /\bcontato\b/i.test(tituloLimpo);
  const ehPix = catNorm.includes('financeiro') || tipoNorm === 'pix' || /\bpix\b/i.test(tituloLimpo);
  const ehLink = catNorm.includes('sistema') || tipoNorm === 'link' || /\blink|url\b/i.test(tituloLimpo);
  const ehLocal =
    catNorm.includes('local') ||
    tipoNorm === 'local' ||
    tipoNorm === 'localizacao' ||
    /\b(localiza[cç][aã]o|rancho|ch[aá]cara|fazenda|s[ií]tio|ponto|coordenadas?)\b/i.test(tituloLimpo) ||
    /\b(localiza[cç][aã]o|rancho|ch[aá]cara|fazenda|s[ií]tio|ponto|coordenadas?)\b/i.test(args.categoria || '') ||
    /\b(localiza[cç][aã]o|rancho|ch[aá]cara|fazenda|s[ií]tio)\b/i.test(mensagemUsuarioAtual);

  // 2. RECUSAR GRAVAR SE FALTAR DADO PRINCIPAL E SALVAR PENDÊNCIA PARCIAL
  if (ehContato) {
    const matchTel =
      (args.conteudo || '').match(/(?:\+?55\s*)?(?:\(?([1-9]{2})\)?\s*)?(9\s*\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})\b/) ||
      mensagemUsuarioAtual.match(/(?:\+?55\s*)?(?:\(?([1-9]{2})\)?\s*)?(9\s*\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})\b/);
    const telefone = args.dados_estruturados?.telefone || (matchTel ? matchTel[0].trim() : null);

    if (!telefone) {
      const nomePessoa = tituloLimpo.replace(/^(?:contato\s*(?:d[oa]\s*)?)/i, '').trim();
      if (ehTituloGenerico(nomePessoa)) {
        return {
          sucesso: false,
          status: 'dado_faltante',
          campo_faltante: 'nome',
          mensagem: 'Não é possível salvar contato sem o nome da pessoa. Peça o nome ao usuário.',
          instrucao_resposta: 'Falta o nome da pessoa para este contato. Pergunte ao usuário de quem é esse contato.',
        };
      }

      const tituloContato = formatarTituloContato(nomePessoa);
      await salvarAcaoConhecimentoPendenteSupabase(contato, {
        tipoAcao: 'salvar',
        categoria: 'Contatos',
        titulo: tituloContato,
        conteudo: '',
        tipoConhecimento: 'contato',
        dadosEstruturados: { nome: nomePessoa },
        nomePessoa,
        usuarioNome: contato.nome,
        usuarioId: contato.id,
        dataCriacao: Date.now(),
        status: 'aguardando_dado_faltante',
        campoFaltante: 'telefone',
      });

      return {
        sucesso: false,
        status: 'dado_faltante',
        campo_faltante: 'telefone',
        mensagem: `Não é possível salvar contato sem o número de telefone. Peça o telefone ao usuário.`,
        instrucao_resposta: `Falta o número de telefone para o contato "${nomePessoa}". Pergunte o telefone ao usuário de forma curta e direta (ex: "Pode mandar o telefone do ${nomePessoa}."). NÃO afirme que salvou, NÃO gere confirmação de salvamento e NÃO grave nada.`,
      };
    } else {
      // Garante que o telefone seja atribuído ao conteúdo e dados_estruturados
      args.conteudo = telefone;
      if (!args.dados_estruturados) args.dados_estruturados = {};
      args.dados_estruturados.telefone = telefone;
      const nomeContatoExtraido = tituloLimpo.replace(/^(?:contato\s*(?:d[oa]\s*)?)/i, '').trim();
      if (nomeContatoExtraido && !ehTituloGenerico(nomeContatoExtraido)) {
        args.dados_estruturados.nome = nomeContatoExtraido;
      }
    }
  }

  if (ehPix) {
    const chave = args.dados_estruturados?.chavePix || (args.conteudo && args.conteudo.length >= 4 && !/^(pix|chave)$/i.test(args.conteudo.trim()) ? args.conteudo.trim() : null);
    if (!chave || chave.toLowerCase().includes('joão do pix')) {
      const beneficiario = tituloLimpo.replace(/^(?:chave\s*pix\s*(?:d[oa]\s*)?)/i, '').trim();
      if (!ehTituloGenerico(beneficiario)) {
        await salvarAcaoConhecimentoPendenteSupabase(contato, {
          tipoAcao: 'salvar',
          categoria: 'Financeiro',
          titulo: `Chave PIX do ${beneficiario}`,
          conteudo: '',
          tipoConhecimento: 'pix',
          dadosEstruturados: { beneficiario },
          nomePessoa: beneficiario,
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          dataCriacao: Date.now(),
          status: 'aguardando_dado_faltante',
          campoFaltante: 'chave_pix',
        });
      }
      return {
        sucesso: false,
        status: 'dado_faltante',
        campo_faltante: 'chave_pix',
        mensagem: `Não é possível salvar PIX sem a chave PIX. Peça a chave ao usuário.`,
        instrucao_resposta: `Falta a chave PIX para "${tituloLimpo}". Peça a chave PIX ao usuário de forma curta e direta. NÃO afirme que salvou e NÃO grave nada.`,
      };
    }
  }

  if (ehLink) {
    const temUrl = /https?:\/\/[^\s]+/i.test(args.conteudo || '') || /https?:\/\/[^\s]+/i.test(args.dados_estruturados?.url || '');
    if (!temUrl) {
      const nomeSistema = tituloLimpo.replace(/^(?:link\s*(?:d[oa]\s*)?|sistema\s*(?:d[oa]\s*)?)/i, '').trim();
      if (!ehTituloGenerico(nomeSistema)) {
        await salvarAcaoConhecimentoPendenteSupabase(contato, {
          tipoAcao: 'salvar',
          categoria: 'Sistemas',
          titulo: `Link ${nomeSistema}`,
          conteudo: '',
          tipoConhecimento: 'link',
          dadosEstruturados: { nomeSistema },
          nomePessoa: nomeSistema,
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          dataCriacao: Date.now(),
          status: 'aguardando_dado_faltante',
          campoFaltante: 'url',
        });
      }
      return {
        sucesso: false,
        status: 'dado_faltante',
        campo_faltante: 'url',
        mensagem: `Não é possível salvar link sem a URL. Peça o link ao usuário.`,
        instrucao_resposta: `Falta o link (URL) para "${tituloLimpo}". Peça o link ao usuário de forma curta e direta. NÃO afirme que salvou e NÃO grave nada.`,
      };
    }
  }

  if (ehLocal) {
    const loc = extrairLocalizacaoDeTextoOuHistorico(
      args.conteudo,
      args.dados_estruturados,
      mensagemUsuarioAtual,
      historicoRecente
    );

    if (!loc) {
      return {
        sucesso: false,
        status: 'dado_faltante',
        campo_faltante: 'localizacao',
        mensagem: 'Não recebi a localização. Pode enviar de novo?',
        instrucao_resposta: 'Responda estritamente ao usuário: "Não recebi a localização. Pode enviar de novo?". É TERMINANTEMENTE PROIBIDO inventar coordenadas ou resgatar localizações antigas do histórico.',
      };
    }

    args.categoria = 'Locais';
    args.tipo = 'local';
    args.dados_estruturados = {
      ...args.dados_estruturados,
      latitude: loc.latitude,
      longitude: loc.longitude,
      linkMaps: loc.linkMaps,
      nomeLocal: loc.nome || tituloLimpo,
      endereco: loc.endereco || undefined,
    };
    args.conteudo = `Latitude: ${loc.latitude}, Longitude: ${loc.longitude}\nGoogle Maps: ${loc.linkMaps}${loc.nome ? `\nLocal: ${loc.nome}` : ''}${loc.endereco ? `\nEndereço: ${loc.endereco}` : ''}`;
  }

  const conteudoLimpo = (args.conteudo || '').trim();
  if (!conteudoLimpo || normalizarParaComparacao(conteudoLimpo) === tituloNorm) {
    return {
      sucesso: false,
      status: 'dado_faltante',
      mensagem: `Conteúdo vazio ou sem dados suficientes para salvar. Peça a informação ao usuário.`,
      instrucao_resposta: `Falta o conteúdo detalhado a ser salvo para "${tituloLimpo}". Peça a informação ao usuário.`,
    };
  }

  // 3. CHECAR DUPLICIDADE ANTES DE PEDIR CONFIRMAÇÃO
  const todosK = await obterTodosConhecimentos();
  const itemExistente = todosK.find((k) => {
    const kTitNorm = normalizarParaComparacao(k.titulo);
    if (kTitNorm === tituloNorm) return true;
    if (tituloNorm.length >= 4 && (kTitNorm.includes(tituloNorm) || tituloNorm.includes(kTitNorm))) return true;
    if (args.dados_estruturados?.telefone && (k.dadosEstruturados as any)?.telefone === args.dados_estruturados.telefone) return true;
    if (args.dados_estruturados?.chavePix && (k.dadosEstruturados as any)?.chavePix === args.dados_estruturados.chavePix) return true;
    return false;
  });

  const msgNorm = normalizarParaComparacao(mensagemUsuarioAtual);
  const querCriarNovo = /\b(criar\s*novo|novo|outro|adicionar\s*novo)\b/i.test(msgNorm);
  const querAtualizar = Boolean(args.quer_atualizar) || /\b(atualizar|substituir|alterar|mudar)\b/i.test(msgNorm);

  if (itemExistente && !querCriarNovo && !querAtualizar && !args.forcar_novo) {
    await salvarAcaoConhecimentoPendenteSupabase(contato, {
      tipoAcao: 'salvar',
      categoria: args.categoria || (ehContato ? 'Contatos' : ehPix ? 'Financeiro' : 'Geral'),
      titulo: tituloLimpo,
      conteudo: conteudoLimpo,
      tipoConhecimento: args.tipo || (ehContato ? 'contato' : ehPix ? 'pix' : ehLink ? 'link' : 'regra'),
      dadosEstruturados: args.dados_estruturados,
      usuarioNome: contato.nome,
      usuarioId: contato.id,
      dataCriacao: Date.now(),
      duplicadoId: itemExistente.id,
      duplicadoTitulo: itemExistente.titulo,
      status: 'aguardando_decisao_duplicado',
    });

    return {
      sucesso: false,
      status: 'item_existente',
      item_existente: {
        id: itemExistente.id,
        titulo: itemExistente.titulo,
        conteudo: itemExistente.conteudo,
      },
      mensagem: `Já existe um item cadastrado como '${itemExistente.titulo}'. Deseja atualizar o item existente ou criar um novo?`,
      instrucao_resposta: `ATENÇÃO: Já existe um item com nome/dado parecido ('${itemExistente.titulo}'). Você DEVE perguntar ao usuário: "Já existe um item cadastrado como '${itemExistente.titulo}'. Deseja atualizar o item existente ou criar um novo?"`,
    };
  }

  // 4. REGISTRAR AÇÃO PENDENTE E RETORNAR FRASE DE CONFIRMAÇÃO (NUNCA GRAVAR NA MESMA RODADA!)
  let resumoDado = conteudoLimpo;
  if (ehContato && !resumoDado.toLowerCase().includes('telefone')) {
    resumoDado = `telefone ${resumoDado}`;
  } else if (ehPix && !resumoDado.toLowerCase().includes('chave') && !resumoDado.toLowerCase().includes('pix')) {
    resumoDado = `chave ${resumoDado}`;
  } else if (ehLocal && args.dados_estruturados?.latitude && args.dados_estruturados?.longitude) {
    const lat = args.dados_estruturados.latitude;
    const lng = args.dados_estruturados.longitude;
    const linkMaps = args.dados_estruturados.linkMaps || `https://www.google.com/maps?q=${lat},${lng}`;
    const detalhesLocal: string[] = [`(${lat}, ${lng})`];
    if (args.dados_estruturados.nomeLocal && args.dados_estruturados.nomeLocal !== tituloLimpo) {
      detalhesLocal.push(`local: "${args.dados_estruturados.nomeLocal}"`);
    }
    if (args.dados_estruturados.endereco) {
      detalhesLocal.push(`endereço: "${args.dados_estruturados.endereco}"`);
    }
    detalhesLocal.push(`Maps: ${linkMaps}`);
    resumoDado = `localização ${detalhesLocal.join(' | ')}`;
  }

  const fraseConfirmacao = `Vou salvar: ${tituloLimpo}, ${resumoDado}. Confirma?`;

  await salvarAcaoConhecimentoPendenteSupabase(contato, {
    tipoAcao: itemExistente && querAtualizar ? 'atualizar' : 'salvar',
    categoria: args.categoria || (ehContato ? 'Contatos' : ehPix ? 'Financeiro' : 'Geral'),
    titulo: tituloLimpo,
    conteudo: conteudoLimpo,
    tipoConhecimento: args.tipo || (ehContato ? 'contato' : ehPix ? 'pix' : ehLink ? 'link' : 'regra'),
    dadosEstruturados: args.dados_estruturados,
    idExistente: itemExistente && querAtualizar ? itemExistente.id : undefined,
    usuarioNome: contato.nome,
    usuarioId: contato.id,
    dataCriacao: Date.now(),
    status: 'aguardando_confirmacao',
  });

  return {
    sucesso: false,
    status: 'precisa_confirmacao',
    mensagem: fraseConfirmacao,
    instrucao_resposta: `ATENÇÃO: NÃO grave ainda no banco de dados. Pergunte ao usuário em uma única frase para confirmar: "${fraseConfirmacao}". A gravação só ocorrerá na mensagem seguinte do usuário confirmando.`,
  };
}

/**
 * Tool: atualizar_conhecimento
 */
export async function toolAtualizarConhecimento(
  args: {
    id?: string;
    titulo_atual?: string;
    novo_titulo?: string;
    categoria?: string;
    novo_conteudo?: string;
    apelidos?: string[];
    confirmado?: boolean;
  },
  contato: Contato,
  historicoRecente: Mensagem[] = [],
  mensagemUsuarioAtual: string = ''
): Promise<{
  sucesso: boolean;
  status: 'sucesso' | 'precisa_confirmacao' | 'nao_encontrado' | 'sem_permissao' | 'erro';
  id?: string;
  titulo?: string;
  mensagem: string;
  instrucao_resposta?: string;
}> {
  const ehAdmin =
    contato.nivelAcesso === 'diretoria' ||
    (contato as any).nivelAcesso === 'admin' ||
    contato.setor === 'Diretoria' ||
    contato.setor === 'Administrativo' ||
    Boolean(contato.permiteCadastroConhecimento);

  if (!ehAdmin) {
    return {
      sucesso: false,
      status: 'sem_permissao',
      mensagem:
        'Você não tem permissão para cadastrar informações na Base de Conhecimento da VEGA. Apenas administradores podem realizar cadastros.',
      instrucao_resposta:
        'Responda estritamente ao usuário: "Você não tem permissão para cadastrar informações na Base de Conhecimento da VEGA. Apenas administradores podem realizar cadastros."',
    };
  }

  // 1. CORREÇÃO DURANTE A CONFIRMAÇÃO: se houver uma proposta pendente ainda não gravada
  // e o usuário pedir ajuste (nome, número, categoria), alterar a PROPOSTA pendente e pedir confirmação de novo!
  // NUNCA transformar em atualização de item existente!
  const pendenciaPendente = await obterAcaoConhecimentoPendenteSupabase(contato);
  if (
    pendenciaPendente &&
    pendenciaPendente.tipoAcao === 'salvar' &&
    (pendenciaPendente.status === 'aguardando_confirmacao' || pendenciaPendente.status === 'aguardando_dado_faltante')
  ) {
    let novoTituloProposta = args.novo_titulo || args.titulo_atual || pendenciaPendente.titulo;
    const matchNome =
      mensagemUsuarioAtual.match(/(?:n[aã]o\s+precisa\s+salvar\s+(?:como\s+)?(?:contato\s+)?[^,]+,\s*)?(?:somente\s+|s[oó]\s+)?salv[ea]\s+(?:como\s+|s[oó]\s+como\s+)(.+)/i) ||
      mensagemUsuarioAtual.match(/(?:o\s+nome\s+(?:certo|correto)\s*(?:é|e)\s*|mudar?\s+(?:o\s+nome\s+)?para\s*|alterar?\s+(?:o\s+nome\s+)?para\s*)([^\.,;\n]+)/i);

    if (matchNome && matchNome[1]?.trim() && !ehTituloGenerico(matchNome[1])) {
      novoTituloProposta = matchNome[1].trim().replace(/[\.\?!]+$/, '').trim();
    } else if (args.novo_titulo && !ehTituloGenerico(args.novo_titulo)) {
      novoTituloProposta = args.novo_titulo.trim().replace(/[\.\?!]+$/, '').trim();
    }

    pendenciaPendente.titulo = novoTituloProposta;
    if (args.novo_conteudo && args.novo_conteudo.trim()) {
      pendenciaPendente.conteudo = args.novo_conteudo.trim();
    }
    if (args.categoria && args.categoria.trim()) {
      pendenciaPendente.categoria = args.categoria.trim();
    }
    if (pendenciaPendente.dadosEstruturados) {
      pendenciaPendente.dadosEstruturados.nome = novoTituloProposta.replace(/^contato\s*/i, '').trim();
      if (args.novo_conteudo) pendenciaPendente.dadosEstruturados.telefone = args.novo_conteudo.trim();
    }
    pendenciaPendente.status = 'aguardando_confirmacao';

    let resumoDado = pendenciaPendente.conteudo;
    if (pendenciaPendente.tipoConhecimento === 'contato' && !resumoDado.toLowerCase().includes('telefone')) {
      resumoDado = `telefone ${resumoDado}`;
    } else if (pendenciaPendente.tipoConhecimento === 'pix' && !resumoDado.toLowerCase().includes('chave')) {
      resumoDado = `chave ${resumoDado}`;
    } else if (pendenciaPendente.tipoConhecimento === 'local') {
      const lat = pendenciaPendente.dadosEstruturados?.latitude;
      const lng = pendenciaPendente.dadosEstruturados?.longitude;
      const linkMaps = pendenciaPendente.dadosEstruturados?.linkMaps || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '');
      const detalhes: string[] = [];
      if (lat && lng) detalhes.push(`(${lat}, ${lng})`);
      if (pendenciaPendente.dadosEstruturados?.nomeLocal && pendenciaPendente.dadosEstruturados.nomeLocal !== pendenciaPendente.titulo) {
        detalhes.push(`local: "${pendenciaPendente.dadosEstruturados.nomeLocal}"`);
      }
      if (pendenciaPendente.dadosEstruturados?.endereco) {
        detalhes.push(`endereço: "${pendenciaPendente.dadosEstruturados.endereco}"`);
      }
      if (linkMaps) detalhes.push(`Maps: ${linkMaps}`);
      if (detalhes.length > 0) resumoDado = `localização ${detalhes.join(' | ')}`;
    }

    const fraseConfirmacao = `Vou salvar: ${pendenciaPendente.titulo}, ${resumoDado}. Confirma?`;
    await salvarAcaoConhecimentoPendenteSupabase(contato, pendenciaPendente);

    return {
      sucesso: false,
      status: 'precisa_confirmacao',
      mensagem: fraseConfirmacao,
      instrucao_resposta: `ATENÇÃO: A proposta pendente foi ajustada. NÃO grave ainda no banco de dados. Pergunte ao usuário para confirmar a proposta atualizada: "${fraseConfirmacao}".`,
    };
  }

  // 2. ATUALIZAÇÃO SEGURA: exigir id exato ou título exato inequívoco.
  // REMOVIDO qualquer fallback cego (como todosK[todosK.length - 1] ou busca solta de substring que captura outro item)
  const todosK = await obterTodosConhecimentos();
  let item: ItemConhecimento | null = null;
  if (args.id) {
    item = todosK.find((k) => k.id === args.id) || null;
  }
  if (!item && args.titulo_atual) {
    const titNorm = normalizarParaComparacao(args.titulo_atual);
    const exatos = todosK.filter((k) => normalizarParaComparacao(k.titulo) === titNorm);
    if (exatos.length === 1) {
      item = exatos[0];
    }
  }

  if (!item) {
    return {
      sucesso: false,
      status: 'nao_encontrado',
      mensagem: `Não encontrei o item '${args.titulo_atual || args.id || 'solicitado'}' na Base de Conhecimento para atualizar.`,
      instrucao_resposta: `Não encontrei o item na Base de Conhecimento. Pergunte ao usuário exatamente qual item ele deseja atualizar, listando os itens se necessário.`,
    };
  }

  // Determina o novo título e novo conteúdo
  let novoTituloFinal = item.titulo;
  if (args.novo_titulo && !ehTituloGenerico(args.novo_titulo)) {
    novoTituloFinal = item.tipo === 'contato' ? formatarTituloContato(args.novo_titulo) : args.novo_titulo.trim();
  }

  let novoConteudoFinal = item.conteudo;
  if (args.novo_conteudo && args.novo_conteudo.trim()) {
    novoConteudoFinal = args.novo_conteudo.trim();
  }

  // 3. CONFIRMAÇÃO MOSTRA O ITEM REAL (título e dado principal)
  const dadoPrincipal = extrairDadoPrincipalItemConhecimento(item);
  let fraseConfirmacao: string;
  const mudouTitulo = normalizarParaComparacao(novoTituloFinal) !== normalizarParaComparacao(item.titulo);
  const mudouConteudo = normalizarParaComparacao(novoConteudoFinal) !== normalizarParaComparacao(item.conteudo);

  if (mudouTitulo && !mudouConteudo) {
    fraseConfirmacao = `Vou renomear o item '${item.titulo} (${dadoPrincipal})' para '${novoTituloFinal}'. Confirma?`;
  } else if (!mudouTitulo && mudouConteudo) {
    fraseConfirmacao = `Vou atualizar o item '${item.titulo} (${dadoPrincipal})' para: ${novoConteudoFinal}. Confirma?`;
  } else {
    fraseConfirmacao = `Vou atualizar o item '${item.titulo} (${dadoPrincipal})' para '${novoTituloFinal}' com o dado ${novoConteudoFinal}. Confirma?`;
  }

  await salvarAcaoConhecimentoPendenteSupabase(contato, {
    tipoAcao: 'atualizar',
    categoria: args.categoria || item.categoria,
    titulo: novoTituloFinal,
    conteudo: novoConteudoFinal,
    tipoConhecimento: item.tipo,
    idExistente: item.id,
    novoTitulo: novoTituloFinal,
    apelidos: args.apelidos || (item.dadosEstruturados as any)?.apelidos,
    dadosEstruturados: {
      ...(item.dadosEstruturados || {}),
      ...(item.tipo === 'contato' ? { nome: novoTituloFinal.replace(/^contato\s*/i, '').trim() } : {}),
      ...(args.apelidos ? { apelidos: args.apelidos } : {}),
    },
    usuarioNome: contato.nome,
    usuarioId: contato.id,
    dataCriacao: Date.now(),
    status: 'aguardando_confirmacao',
  });

  return {
    sucesso: false,
    status: 'precisa_confirmacao',
    mensagem: fraseConfirmacao,
    instrucao_resposta: `ATENÇÃO: NÃO grave ainda no banco de dados. Peça confirmação antes de gravar: "${fraseConfirmacao}". A gravação ocorrerá na mensagem seguinte do usuário confirmando.`,
  };
}

/**
 * Tool: remover_conhecimento
 */
export async function toolRemoverConhecimento(
  args: {
    id?: string;
    titulo?: string;
    confirmado?: boolean;
  },
  contato: Contato,
  historicoRecente: Mensagem[] = [],
  mensagemUsuarioAtual: string = ''
): Promise<{
  sucesso: boolean;
  status: 'sucesso' | 'precisa_confirmacao' | 'nao_encontrado' | 'sem_permissao' | 'erro';
  id?: string;
  titulo?: string;
  mensagem: string;
  instrucao_resposta?: string;
}> {
  const ehAdmin =
    contato.nivelAcesso === 'diretoria' ||
    (contato as any).nivelAcesso === 'admin' ||
    contato.setor === 'Diretoria' ||
    contato.setor === 'Administrativo' ||
    Boolean(contato.permiteExclusao);

  if (!ehAdmin) {
    return {
      sucesso: false,
      status: 'sem_permissao',
      mensagem:
        'Você não tem permissão para apagar informações da Base de Conhecimento da VEGA. Apenas administradores podem realizar exclusões.',
    };
  }

  // ATUALIZAÇÃO SEGURA: exigir id exato ou título exato inequívoco
  const todosK = await obterTodosConhecimentos();
  let item: ItemConhecimento | null = null;
  if (args.id) {
    item = todosK.find((k) => k.id === args.id) || null;
  }
  if (!item && args.titulo) {
    const titNorm = normalizarParaComparacao(args.titulo);
    const exatos = todosK.filter((k) => normalizarParaComparacao(k.titulo) === titNorm);
    if (exatos.length === 1) {
      item = exatos[0];
    }
  }

  if (!item) {
    return {
      sucesso: false,
      status: 'nao_encontrado',
      mensagem: `Não encontrei o item '${args.titulo || args.id || 'solicitado'}' na Base de Conhecimento para remover.`,
      instrucao_resposta: `Não encontrei o item na Base de Conhecimento. Pergunte ao usuário qual item ele deseja remover.`,
    };
  }

  // CONFIRMAÇÃO MOSTRA O ITEM REAL (título e dado principal)
  const dadoPrincipal = extrairDadoPrincipalItemConhecimento(item);
  const fraseConfirmacao = `Você confirma a exclusão do item '${item.titulo} (${dadoPrincipal})' da Base de Conhecimento? Responda Sim para confirmar ou Não para cancelar.`;

  await salvarAcaoConhecimentoPendenteSupabase(contato, {
    tipoAcao: 'remover',
    categoria: item.categoria,
    titulo: item.titulo,
    conteudo: item.conteudo,
    tipoConhecimento: item.tipo,
    idExistente: item.id,
    usuarioNome: contato.nome,
    usuarioId: contato.id,
    dataCriacao: Date.now(),
    status: 'aguardando_confirmacao',
  });

  return {
    sucesso: false,
    status: 'precisa_confirmacao',
    mensagem: fraseConfirmacao,
    instrucao_resposta: `ATENÇÃO: NÃO apague ainda do banco de dados. Peça confirmação antes de apagar: "${fraseConfirmacao}".`,
  };
}

/**
 * Tool 7: ler_documento_completo(doc_id?, termo_documento?, titular?)
 * Retorna todos os trechos do documento em ordem sequencial para perguntas
 * que exigem varredura completa de itens (contas, bens, dependentes, etc.)
 */
export async function toolLerDocumentoCompleto(params: {
  docId?: string;
  termoDocumento?: string;
  titular?: string;
  todosDocs: DocumentoRegistro[];
}): Promise<{
  sucesso: boolean;
  doc_id?: string;
  titulo?: string;
  titular?: string;
  total_trechos?: number;
  conteudo_completo?: string;
  aviso?: string;
  erro?: string;
}> {
  const { docId, termoDocumento, titular: titularNome, todosDocs } = params;
  let docs = todosDocs && todosDocs.length > 0 ? todosDocs : await obterTodosDocumentos();

  let doc: DocumentoRegistro | undefined;

  // 1. Busca por ID direto
  if (docId) {
    const idLimpo = docId.trim();
    doc = docs.find((d) => d.id === idLimpo || d.metadata?.id_legado === idLimpo);
  }

  // 2. Busca por termo ou nome do documento
  if (!doc && (termoDocumento || titularNome)) {
    const termo = (termoDocumento || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tit = (titularNome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Filtra por titular se informado
    let candidatos = docs;
    if (tit) {
      candidatos = docs.filter((d) => titularCorresponde(d.titular, tit));
    }

    if (termo) {
      doc = candidatos.find((d) => {
        const titDoc = d.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const tipoDoc = (d.tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const arqDoc = (d.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return titDoc.includes(termo) || tipoDoc.includes(termo) || arqDoc.includes(termo) || termo.includes(titDoc);
      });
    }

    // REMOVIDO FALLBACK CEGO: Se o usuário especificou termoDocumento e não encontrou correspondência,
    // NUNCA assumir candidatos[0] só porque o titular tem 1 documento no Cofre (Regra 8).
    if (!doc && !termo && candidatos.length === 1) {
      doc = candidatos[0];
    }
  }

  if (!doc) {
    return {
      sucesso: false,
      erro: `Documento "${termoDocumento || docId}" não foi encontrado no Cofre. Tente primeiro buscar_documentos ou listar_documentos_titular.`,
    };
  }

  // 3. Busca todos os trechos do documento no Supabase ordenados por página
  const supabase = getSupabaseClient();
  const { data: trechos, error } = await supabase
    .from('trechos')
    .select('id, pagina, conteudo')
    .eq('documento_id', doc.id)
    .order('pagina', { ascending: true });

  if (error) {
    console.error('[VEGA Tools] Erro ao buscar trechos completos do documento:', error.message);
    return {
      sucesso: false,
      doc_id: doc.id,
      titulo: doc.titulo,
      titular: doc.titular,
      erro: `Erro ao consultar o banco de dados: ${error.message}`,
    };
  }

  const listaTrechos = trechos || [];
  if (listaTrechos.length === 0) {
    const conteudoDesc = doc.descricao || `Documento ${doc.titulo} arquivado no Cofre, sem texto indexado em trechos.`;
    return {
      sucesso: true,
      doc_id: doc.id,
      titulo: doc.titulo,
      titular: doc.titular,
      total_trechos: 0,
      conteudo_completo: conteudoDesc,
      aviso: 'O documento não possui trechos fragmentados indexados. Exibindo descrição arquivada.',
    };
  }

  const conteudoUnificado = listaTrechos
    .map((t, idx) => `[Página ${t.pagina || 1} | Trecho ${idx + 1}]\n${t.conteudo}`)
    .join('\n\n');

  return {
    sucesso: true,
    doc_id: doc.id,
    titulo: doc.titulo,
    titular: doc.titular,
    total_trechos: listaTrechos.length,
    conteudo_completo: conteudoUnificado,
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
 * DETECÇÃO DE AÇÕES SEM FERRAMENTA (Regra: Não prometer o que não pode fazer)
 * Se o usuário pedir ações para as quais não há tool disponível no chat (ex: envio de e-mails,
 * ligações, transferências bancárias/PIX diretas, reuniões em calendários externos),
 * recusa de imediato informando os limites da VEGA.
 */
export function detectarAcaoSemFerramenta(mensagemUsuario: string): string | null {
  const msgNorm = normalizarParaComparacao(mensagemUsuario);

  // 1. Envio de e-mail (ex: "manda um e-mail pro fulano", "envie um email", "manda email para fulano", "escreva um email")
  const ehEnvioEmail =
    /\b(manda|mande|envia|enviar|envie|disparar|dispara|escrever|escreva|mandar)\s+(um\s+|uma\s+)?(e-?mail|mensagem por e-?mail)\b/i.test(msgNorm);

  if (ehEnvioEmail) {
    return 'Não consigo enviar e-mails pelo chat. Como assistente da VEGA, posso consultar e cadastrar informações na Base de Conhecimento, buscar documentos e dados de titulares no Cofre.';
  }

  // 2. Fazer ligação telefônica (ex: "liga pro fulano", "faça uma ligação", "telefona pro fulano")
  const ehLigacao =
    /\b(liga|ligar|ligue|telefona|telefonar|fazer uma ligacao|faca uma ligacao)\s+(para|pro|pra|a)\b/i.test(msgNorm);

  if (ehLigacao) {
    return 'Não consigo realizar ligações pelo chat. Como assistente da VEGA, posso consultar e cadastrar informações na Base de Conhecimento, buscar documentos e dados de titulares no Cofre.';
  }

  // 3. Fazer pagamentos ou transferências financeiras (ex: "faz um pix de 100", "paga esse boleto", "transfere esse dinheiro")
  // CUIDADO: NÃO interceptar se for salvar chave pix ("salva o pix", "cadastra o pix", "anota o pix") ou consultar ("qual o pix")
  const ehAcaoFinanceiraDireta =
    /\b(faz|fazer|transfere|transferir|pagar|pague)\s+(um\s+)?(pix de|pagamento|boleto|dinheiro|ted|doc)\b/i.test(msgNorm) &&
    !/\b(salva|salvar|cadastra|cadastrar|anota|anotar|guarda|guardar|qual|onde|consulta|consultar)\b/i.test(msgNorm);

  if (ehAcaoFinanceiraDireta) {
    return 'Não consigo realizar pagamentos ou transferências pelo chat. Como assistente da VEGA, posso consultar e cadastrar informações na Base de Conhecimento, buscar documentos e dados de titulares no Cofre.';
  }

  // 4. Agendamento em calendários externos (ex: "agenda uma reunião no google calendar", "marca no teams")
  const ehAgendaExterna =
    /\b(agenda|agendar|marque|marcar)\s+(uma\s+)?(reuniao|call|compromisso|evento)\s+(no\s+google|no\s+teams|no\s+calendario|na\s+agenda)\b/i.test(msgNorm);

  if (ehAgendaExterna) {
    return 'Não consigo agendar reuniões em calendários externos pelo chat. Como assistente da VEGA, posso consultar e cadastrar informações na Base de Conhecimento, buscar documentos e dados de titulares no Cofre.';
  }

  return null;
}

/**
 * RESOLUÇÃO DE CONFIRMAÇÃO DE SALVAMENTO / ATUALIZAÇÃO / EXCLUSÃO NA BASE DE CONHECIMENTO
 * (Garante estritamente que nada seja gravado sem a confirmação explícita do usuário numa mensagem seguinte)
 */
export async function detectarConfirmacaoSalvarConhecimento(
  historicoRecente: Mensagem[],
  mensagemUsuarioAtual: string,
  contato: Contato
): Promise<ResultadoChatOrquestrador | null> {
  if (!historicoRecente || historicoRecente.length === 0) return null;

  const ultimaMsgAssistente = [...historicoRecente].reverse().find((m) => m.remetente === 'assistente');
  const pendenciaMemoria = await obterAcaoConhecimentoPendenteSupabase(contato);

  const txtAssistente = (ultimaMsgAssistente?.texto || '').trim();
  const matchSalvar = txtAssistente.match(/Vou salvar:\s*([^,]+),\s*(.+?)\.\s*Confirma\?/i);
  const matchAtualizar = txtAssistente.match(/Vou atualizar o item ['*]([^'*]+)['*] para:\s*(.+?)\.?\s*Confirma\?/i);
  const matchAtualizarNome = txtAssistente.match(/Vou atualizar o nome do item de ['*]([^'*]+)['*] para ['*]([^'*]+)['*]\.?\s*Confirma\?/i);
  const matchAtualizarAmbos = txtAssistente.match(/Vou atualizar o item de ['*]([^'*]+)['*] para ['*]([^'*]+)['*] com o dado (.+?)\.?\s*Confirma\?/i);
  const matchDuplicado = txtAssistente.match(/Já existe um item cadastrado como ['*]([^'*]+)['*]\.? Deseja atualizar o item existente ou criar um novo\?/i);
  const matchRemover = txtAssistente.match(/Você confirma a exclusão do item ['*]([^'*]+)['*] da Base de Conhecimento\?/i);

  if (!pendenciaMemoria && !matchSalvar && !matchAtualizar && !matchAtualizarNome && !matchAtualizarAmbos && !matchDuplicado && !matchRemover) {
    return null;
  }

  const msgNorm = normalizarParaComparacao(mensagemUsuarioAtual);

  // CORREÇÃO DURANTE A CONFIRMAÇÃO (Ponto 2):
  // Se houver uma ação pendente de salvamento ainda não gravada e o usuário pedir ajuste (nome, número, categoria):
  // Alterar a PROPOSTA pendente e pedir confirmação de novo com os dados ajustados! NUNCA transformar em atualização de item existente.
  const ehAjusteProposta =
    pendenciaMemoria &&
    pendenciaMemoria.tipoAcao === 'salvar' &&
    (pendenciaMemoria.status === 'aguardando_confirmacao' || pendenciaMemoria.status === 'aguardando_dado_faltante') &&
    (/\b(salv[ea]\s+(?:s[oó]\s+)?como|somente\s+salv[ea]|s[oó]\s+salv[ea]|nome\s*certo|nome\s*correto|muda\s*(?:o\s*nome|para)|altera\s*(?:o\s*nome|para))\b/i.test(msgNorm) ||
     /\b(n[aã]o\s+precisa\s+salvar\s+como)\b/i.test(msgNorm));

  if (ehAjusteProposta && pendenciaMemoria) {
    let novoTitulo = '';
    const matchAjusteNome =
      mensagemUsuarioAtual.match(/(?:n[aã]o\s+precisa\s+salvar\s+(?:como\s+)?(?:contato\s+)?[^,]+,\s*)?(?:somente\s+|s[oó]\s+)?salv[ea]\s+(?:como\s+|s[oó]\s+como\s+)(.+)/i) ||
      mensagemUsuarioAtual.match(/(?:o\s+nome\s+(?:certo|correto)\s*(?:é|e)\s*|mudar?\s+(?:o\s+nome\s+)?para\s*|alterar?\s+(?:o\s+nome\s+)?para\s*)([^\.,;\n]+)/i);

    if (matchAjusteNome && matchAjusteNome[1]?.trim()) {
      novoTitulo = matchAjusteNome[1].trim().replace(/[\.\?!]+$/, '').trim();
    }

    if (novoTitulo && !ehTituloGenerico(novoTitulo)) {
      pendenciaMemoria.titulo = novoTitulo;
      if (pendenciaMemoria.dadosEstruturados) {
        pendenciaMemoria.dadosEstruturados.nome = novoTitulo.replace(/^contato\s*/i, '').trim();
      }

      let resumoDado = pendenciaMemoria.conteudo;
      if (pendenciaMemoria.tipoConhecimento === 'contato' && !resumoDado.toLowerCase().includes('telefone')) {
        resumoDado = `telefone ${resumoDado}`;
      } else if (pendenciaMemoria.tipoConhecimento === 'pix' && !resumoDado.toLowerCase().includes('chave')) {
        resumoDado = `chave ${resumoDado}`;
      } else if (pendenciaMemoria.tipoConhecimento === 'local') {
        const lat = pendenciaMemoria.dadosEstruturados?.latitude;
        const lng = pendenciaMemoria.dadosEstruturados?.longitude;
        const linkMaps = pendenciaMemoria.dadosEstruturados?.linkMaps || (lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '');
        const detalhes: string[] = [];
        if (lat && lng) detalhes.push(`(${lat}, ${lng})`);
        if (pendenciaMemoria.dadosEstruturados?.nomeLocal && pendenciaMemoria.dadosEstruturados.nomeLocal !== pendenciaMemoria.titulo) {
          detalhes.push(`local: "${pendenciaMemoria.dadosEstruturados.nomeLocal}"`);
        }
        if (pendenciaMemoria.dadosEstruturados?.endereco) {
          detalhes.push(`endereço: "${pendenciaMemoria.dadosEstruturados.endereco}"`);
        }
        if (linkMaps) detalhes.push(`Maps: ${linkMaps}`);
        if (detalhes.length > 0) resumoDado = `localização ${detalhes.join(' | ')}`;
      }

      const fraseConfirmacao = `Vou salvar: ${pendenciaMemoria.titulo}, ${resumoDado}. Confirma?`;
      await salvarAcaoConhecimentoPendenteSupabase(contato, pendenciaMemoria);

      return {
        textoResposta: fraseConfirmacao,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Ajuste de proposta para ${novoTitulo}`,
      };
    }
  }

  // MUDANÇA DE ASSUNTO NO MEIO ("deixa pra lá, qual o CPF do Carlos?")
  const ehPerguntaOuNovaConsulta =
    /[?]/i.test(mensagemUsuarioAtual) ||
    /\b(qual|quais|quem|onde|quando|quanto|como|por que|porque|cade|cadê|mostra|me fala|me diga|cpf|rg|contrato|documento|certid[aã]o|deixa pra l[aá]|esquece isso)\b/i.test(msgNorm);

  const ehAfirmativo =
    isConfirmacaoSimples(mensagemUsuarioAtual) ||
    /^(sim|s|pode|pode salvar|pode cadastrar|pode atualizar|confirmo|confirma|isso|ok|claro|com certeza)\b/i.test(msgNorm);

  const ehNegativo =
    /^(n[aã]o|n|cancela|cancelar|deixa|esquece|nao quero|nao precisa)\b/i.test(msgNorm);

  if (ehPerguntaOuNovaConsulta && !ehAfirmativo) {
    await limparAcaoConhecimentoPendenteSupabase(contato);
    return null;
  }

  if (ehNegativo) {
    await limparAcaoConhecimentoPendenteSupabase(contato);
    return {
      textoResposta: 'Operação cancelada. A informação não foi salva na Base de Conhecimento.',
      origem: 'motor',
      intencaoDetectada: 'cadastrar_conhecimento',
      perguntaReescrita: 'Cancelamento de operação na Base de Conhecimento',
    };
  }

  // 1. Caso Duplicado: "Deseja atualizar o item existente ou criar um novo?"
  if (matchDuplicado || pendenciaMemoria?.status === 'aguardando_decisao_duplicado') {
    const querAtualizar = /\b(atualizar|atualiza|sim,?\s*atualiza|substituir|substitui|o existente|atualizar o existente)\b/i.test(msgNorm);
    const querCriarNovo = /\b(criar novo|novo|adicionar novo|cria novo|outro)\b/i.test(msgNorm);

    const tituloAlvo = pendenciaMemoria?.duplicadoTitulo || (matchDuplicado ? matchDuplicado[1].trim() : 'Item');
    const todosK = await obterTodosConhecimentos();
    const itemExistente = pendenciaMemoria?.duplicadoId
      ? todosK.find((k) => k.id === pendenciaMemoria.duplicadoId)
      : todosK.find((k) => normalizarParaComparacao(k.titulo) === normalizarParaComparacao(tituloAlvo));

    if (querAtualizar && itemExistente) {
      const novoConteudo = pendenciaMemoria?.conteudo || itemExistente.conteudo;
      const atualizado = await atualizarConhecimento(itemExistente.id, {
        titulo: itemExistente.titulo,
        categoria: pendenciaMemoria?.categoria || itemExistente.categoria,
        conteudo: novoConteudo,
        dadosEstruturados: {
          ...(itemExistente.dadosEstruturados || {}),
          ...(pendenciaMemoria?.dadosEstruturados || {}),
          atualizadoPor: contato.nome,
          dataAtualizacaoIso: new Date().toISOString(),
        },
      });

      if (atualizado) {
        indexarConhecimentoBackground(atualizado).catch(() => {});
      }
      await limparAcaoConhecimentoPendenteSupabase(contato);

      return {
        textoResposta: `${itemExistente.titulo} atualizado com sucesso na Base de Conhecimento!`,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Atualizar ${itemExistente.titulo}`,
      };
    }

    if (querCriarNovo) {
      const tituloNovo = pendenciaMemoria?.titulo ? `${pendenciaMemoria.titulo} (Novo)` : `${tituloAlvo} (Novo)`;
      const novoItem = await adicionarConhecimento({
        categoria: pendenciaMemoria?.categoria || 'Geral',
        titulo: tituloNovo,
        conteudo: pendenciaMemoria?.conteudo || '',
        tipo: pendenciaMemoria?.tipoConhecimento || 'regra',
        dadosEstruturados: {
          ...(pendenciaMemoria?.dadosEstruturados || {}),
          cadastradoPor: contato.nome,
          dataCadastroIso: new Date().toISOString(),
        },
      });

      indexarConhecimentoBackground(novoItem).catch(() => {});
      await limparAcaoConhecimentoPendenteSupabase(contato);

      return {
        textoResposta: `${novoItem.titulo} salvo com sucesso na Base de Conhecimento!`,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Novo item: ${tituloNovo}`,
      };
    }
  }

  // 2. Confirmação de Salvamento: "Vou salvar: [Título], [Dado]. Confirma?"
  if (matchSalvar || pendenciaMemoria?.tipoAcao === 'salvar') {
    if (ehAfirmativo) {
      let titulo = pendenciaMemoria?.titulo || '';
      let conteudo = pendenciaMemoria?.conteudo;
      let categoria = pendenciaMemoria?.categoria || 'Geral';
      let tipo: TipoConhecimento = pendenciaMemoria?.tipoConhecimento || 'regra';
      let dadosEstruturados: any = pendenciaMemoria?.dadosEstruturados || {};

      if (!titulo && matchSalvar) {
        titulo = matchSalvar[1].trim();
        const dado = matchSalvar[2].trim();
        conteudo = dado;
        if (dado.toLowerCase().startsWith('telefone')) {
          categoria = 'Contatos';
          tipo = 'contato';
          const telLimpo = dado.replace(/^telefone\s*[:\s]*/i, '').trim();
          conteudo = telLimpo;
          dadosEstruturados = { telefone: telLimpo, nome: titulo.replace(/^contato\s*/i, '').trim() };
        } else if (dado.toLowerCase().startsWith('chave')) {
          categoria = 'Financeiro';
          tipo = 'pix';
          const chaveLimpa = dado.replace(/^chave\s*[:\s]*/i, '').trim();
          conteudo = chaveLimpa;
          dadosEstruturados = { chavePix: chaveLimpa, beneficiario: titulo.replace(/^chave\s+pix\s+(?:d[oea]\s*)?/i, '').trim() };
        } else if (dado.toLowerCase().startsWith('url')) {
          categoria = 'Sistemas';
          tipo = 'link';
          const urlLimpa = dado.replace(/^url\s*[:\s]*/i, '').trim();
        } else if (dado.toLowerCase().startsWith('localização') || dado.toLowerCase().startsWith('localizacao') || dado.toLowerCase().startsWith('coordenadas')) {
          categoria = 'Locais';
          tipo = 'local';
          const matchCoord = dado.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
          if (matchCoord) {
            const lat = parseFloat(matchCoord[1]);
            const lng = parseFloat(matchCoord[2]);
            const matchLink = dado.match(/Maps:\s*(https?:\/\/[^\s|)]+)/i) || dado.match(/(https?:\/\/[^\s|)]+)/i);
            const matchNome = dado.match(/local:\s*"([^"]+)"/i);
            const matchEnd = dado.match(/endereço:\s*"([^"]+)"/i);
            const linkFinal = matchLink ? matchLink[1].trim() : `https://www.google.com/maps?q=${lat},${lng}`;
            dadosEstruturados = {
              latitude: lat,
              longitude: lng,
              linkMaps: linkFinal,
              nomeLocal: matchNome ? matchNome[1].trim() : titulo,
              endereco: matchEnd ? matchEnd[1].trim() : undefined,
            };
            conteudo = `Latitude: ${lat}, Longitude: ${lng}\nGoogle Maps: ${linkFinal}${matchNome ? `\nLocal: ${matchNome[1].trim()}` : ''}${matchEnd ? `\nEndereço: ${matchEnd[1].trim()}` : ''}`;
          }
        }
      }

      // Proibição estrita de títulos genéricos no salvamento
      if (ehTituloGenerico(titulo)) {
        await limparAcaoConhecimentoPendenteSupabase(contato);
        return {
          textoResposta: 'Não posso salvar um contato com nome genérico ("Novo Item"). Por favor, me diga o nome da pessoa para salvar.',
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: 'Recusa de salvamento com título genérico',
        };
      }

      if (titulo && conteudo) {
        const novoItem = await adicionarConhecimento({
          categoria,
          titulo,
          conteudo,
          tipo,
          dadosEstruturados: {
            ...dadosEstruturados,
            cadastradoPor: contato.nome,
            dataCadastroIso: new Date().toISOString(),
          },
        });

        indexarConhecimentoBackground(novoItem).catch(() => {});
        await limparAcaoConhecimentoPendenteSupabase(contato);

        return {
          textoResposta: `${novoItem.titulo} salvo com sucesso na Base de Conhecimento!`,
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: `Salvar ${titulo}`,
        };
      }
    }
  }

  // 3. Confirmação de Atualização: "Vou renomear o item '...' para '...'. Confirma?" ou "Vou atualizar o item '...' para: ... Confirma?"
  const matchRenomear = txtAssistente.match(/Vou renomear o item ['*]([^'*]+)['*] para ['*]([^'*]+)['*]\.?\s*Confirma\?/i);
  if (matchRenomear || matchAtualizar || matchAtualizarNome || matchAtualizarAmbos || pendenciaMemoria?.tipoAcao === 'atualizar') {
    if (ehAfirmativo) {
      const idAlvo = pendenciaMemoria?.idExistente;
      const tituloAlvo =
        pendenciaMemoria?.duplicadoTitulo ||
        (matchRenomear ? matchRenomear[1].trim() : matchAtualizarNome ? matchAtualizarNome[1].trim() : matchAtualizarAmbos ? matchAtualizarAmbos[1].trim() : matchAtualizar ? matchAtualizar[1].trim() : '');

      const todosK = await obterTodosConhecimentos();
      let itemExistente: ItemConhecimento | null = null;
      if (idAlvo) {
        itemExistente = todosK.find((k) => k.id === idAlvo) || null;
      }
      if (!itemExistente && tituloAlvo) {
        const tituloPuro = tituloAlvo.replace(/\s*\([^)]*\)$/, '').trim();
        const exatos = todosK.filter(
          (k) =>
            normalizarParaComparacao(k.titulo) === normalizarParaComparacao(tituloAlvo) ||
            normalizarParaComparacao(k.titulo) === normalizarParaComparacao(tituloPuro)
        );
        if (exatos.length === 1) {
          itemExistente = exatos[0];
        }
      }

      // NUNCA fazer fallback cego de todosK[todosK.length - 1]!
      if (!itemExistente) {
        await limparAcaoConhecimentoPendenteSupabase(contato);
        return {
          textoResposta: 'Não foi possível localizar o item original na Base de Conhecimento para atualizar. A alteração não foi realizada.',
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: 'Falha ao localizar item para atualizar',
        };
      }

      let novoTitulo = pendenciaMemoria?.novoTitulo || pendenciaMemoria?.titulo;
      if (!novoTitulo && matchRenomear) {
        novoTitulo = matchRenomear[2].trim();
      } else if (!novoTitulo && matchAtualizarNome) {
        novoTitulo = matchAtualizarNome[2].trim();
      } else if (!novoTitulo && matchAtualizarAmbos) {
        novoTitulo = matchAtualizarAmbos[2].trim();
      }

      if (!novoTitulo || ehTituloGenerico(novoTitulo)) {
        novoTitulo = itemExistente.titulo;
      }

      let novoConteudo = pendenciaMemoria?.conteudo;
      if (!novoConteudo && matchAtualizarAmbos) {
        novoConteudo = matchAtualizarAmbos[3].trim();
      } else if (!novoConteudo && matchAtualizar) {
        novoConteudo = matchAtualizar[2].trim();
      } else if (!novoConteudo) {
        novoConteudo = itemExistente.conteudo;
      }

      const novosApelidos = pendenciaMemoria?.apelidos || (itemExistente.dadosEstruturados as any)?.apelidos;

      const novosDadosEstruturados = {
        ...(itemExistente.dadosEstruturados || {}),
        ...(pendenciaMemoria?.dadosEstruturados || {}),
        ...(novosApelidos ? { apelidos: novosApelidos } : {}),
        atualizadoPor: contato.nome,
        dataAtualizacaoIso: new Date().toISOString(),
      };

      if (itemExistente.tipo === 'contato' && novoTitulo) {
        novosDadosEstruturados.nome = novoTitulo.replace(/^contato\s*/i, '').trim();
      }

      const atualizado = await atualizarConhecimento(itemExistente.id, {
        titulo: novoTitulo,
        categoria: pendenciaMemoria?.categoria || itemExistente.categoria,
        conteudo: novoConteudo,
        tipo: itemExistente.tipo,
        dadosEstruturados: novosDadosEstruturados,
      });

      if (atualizado) {
        indexarConhecimentoBackground(atualizado).catch(() => {});
      }
      await limparAcaoConhecimentoPendenteSupabase(contato);

      const tituloExibicao = atualizado?.titulo || novoTitulo;
      return {
        textoResposta: `${tituloExibicao} atualizado com sucesso na Base de Conhecimento!`,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Atualizar ${tituloExibicao}`,
      };
    }
  }

  // 4. Confirmação de Exclusão: "Você confirma a exclusão do item '[Título]'...?"
  if (matchRemover || pendenciaMemoria?.tipoAcao === 'remover') {
    if (ehAfirmativo) {
      const tituloRemover = pendenciaMemoria?.titulo || (matchRemover ? matchRemover[1].trim() : '');
      const todosK = await obterTodosConhecimentos();
      let itemExistente: ItemConhecimento | null = null;
      if (pendenciaMemoria?.idExistente) {
        itemExistente = todosK.find((k) => k.id === pendenciaMemoria.idExistente) || null;
      }
      if (!itemExistente && tituloRemover) {
        const tituloPuro = tituloRemover.replace(/\s*\([^)]*\)$/, '').trim();
        const exatos = todosK.filter(
          (k) =>
            normalizarParaComparacao(k.titulo) === normalizarParaComparacao(tituloRemover) ||
            normalizarParaComparacao(k.titulo) === normalizarParaComparacao(tituloPuro)
        );
        if (exatos.length === 1) {
          itemExistente = exatos[0];
        }
      }

      if (!itemExistente) {
        await limparAcaoConhecimentoPendenteSupabase(contato);
        return {
          textoResposta: 'Não foi possível localizar o item na Base de Conhecimento para excluir.',
          origem: 'motor',
          intencaoDetectada: 'cadastrar_conhecimento',
          perguntaReescrita: 'Falha ao localizar item para excluir',
        };
      }

      await removerConhecimento(itemExistente.id);
      await limparAcaoConhecimentoPendenteSupabase(contato);

      return {
        textoResposta: `Item '${itemExistente.titulo}' removido com sucesso da Base de Conhecimento!`,
        origem: 'motor',
        intencaoDetectada: 'cadastrar_conhecimento',
        perguntaReescrita: `Remover ${itemExistente.titulo}`,
      };
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
  origemMensagem?: 'audio' | 'texto';
  idsMensagensLoteAtual?: string[];
  abortSignal?: AbortSignal;
  bloquearCancelamento?: (motivo: string) => void;
}): Promise<ResultadoChatOrquestrador> {
  const inicioTotal = Date.now();
  const mensagemUsuario = dados.mensagemUsuario || (dados as any).mensagem || '';
  const { historicoRecente, documentoIdDireto } = dados;
  const idsIgnorar = new Set(dados.idsMensagensLoteAtual || []);
  const historicoPassado = (historicoRecente || []).filter((m) => !idsIgnorar.has(m.id));
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
  const ultimaMsgAssistente = [...historicoPassado].reverse().find((m) => m.remetente === 'assistente');
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

  // 3.1. VERIFICAÇÃO DE AÇÃO SEM FERRAMENTA (Regra: Não prometer o que não pode fazer)
  const recusaSemTool = detectarAcaoSemFerramenta(mensagemUsuario);
  if (recusaSemTool) {
    return {
      textoResposta: recusaSemTool,
      origem: 'motor',
      intencaoDetectada: 'saudacao_ou_vago',
      perguntaReescrita: mensagemUsuario,
    };
  }

  // 3.2. CONFIRMAÇÃO DE SALVAMENTO / ATUALIZAÇÃO / EXCLUSÃO NA BASE DE CONHECIMENTO
  const resConfirmacaoK = await detectarConfirmacaoSalvarConhecimento(
    historicoPassado,
    mensagemUsuario,
    contato
  );
  if (resConfirmacaoK) {
    return resConfirmacaoK;
  }

  // 3.3. CONSULTA DE AÇÃO PENDENTE NO SUPABASE (INJETADA NO CONTEXTO DA IA EM <acao_pendente>)
  const pendenciaAtivaK = await obterAcaoConhecimentoPendenteSupabase(contato);
  let blocoAcaoPendente = '';
  if (pendenciaAtivaK) {
    if (pendenciaAtivaK.status === 'aguardando_dado_faltante') {
      const campo = pendenciaAtivaK.campoFaltante || 'telefone';
      const nomeOuTitulo = pendenciaAtivaK.nomePessoa || pendenciaAtivaK.titulo || 'Contato';
      blocoAcaoPendente = `\n<acao_pendente>
Existe um cadastro de conhecimento EM ANDAMENTO aguardando dados complementares:
- Tipo: ${pendenciaAtivaK.tipoConhecimento || 'contato'}
- Categoria: ${pendenciaAtivaK.categoria || 'Contatos'}
- Nome da Pessoa / Item: "${nomeOuTitulo}"
- Dado Faltante Aguardado: "${campo}"
${pendenciaAtivaK.titulo ? `- Título Proposto: "${pendenciaAtivaK.titulo}"` : ''}

INSTRUÇÕES MANDATÓRIAS DE CONTINUAÇÃO:
1. Se a mensagem do usuário contiver o dado faltante (${campo}) — mesmo que seja apenas números digitados (ex: "14998810675"), número formatado (ex: "14 99881-0675"), áudio ou mensagem de localização —, esta mensagem é a CONTINUAÇÃO DIRETA deste cadastro!
2. Você DEVE acionar a ferramenta 'salvar_conhecimento' passando:
   - titulo: "${pendenciaAtivaK.titulo || formatarTituloContato(nomeOuTitulo)}"
   - categoria: "${pendenciaAtivaK.categoria || (pendenciaAtivaK.tipoConhecimento === 'local' ? 'Locais' : 'Contatos')}"
   - tipo: "${pendenciaAtivaK.tipoConhecimento || 'contato'}"
   - conteudo: o dado informado pelo usuário (ex.: o telefone completo ou as coordenadas)
   - dados_estruturados: { ${campo}: o dado informado, nome: "${nomeOuTitulo}" }
3. REGRA ESTRITA PARA LOCALIZAÇÃO: Se o dado aguardado for localização e não houver coordenadas no lote atual nem na mensagem imediatamente anterior, responda estritamente: "Não recebi a localização. Pode enviar de novo?". É TERMINANTEMENTE PROIBIDO resgatar localizações antigas do histórico.
4. NUNCA pergunte "de quem é esse contato?" nem peça o nome novamente, pois o nome "${nomeOuTitulo}" já está definido nesta ação pendente!
5. NUNCA pesquise no Cofre nem busque documentos para números ou dados complementares enviados nessa continuação!
</acao_pendente>\n`;
    } else if (pendenciaAtivaK.status === 'aguardando_confirmacao') {
      blocoAcaoPendente = `\n<acao_pendente>
Existe uma ação na Base de Conhecimento AGUARDANDO CONFIRMAÇÃO do usuário:
- Operação: ${pendenciaAtivaK.tipoAcao}
- Item Proposto: "${pendenciaAtivaK.titulo}"
- Dado: "${pendenciaAtivaK.conteudo}"
- Resposta esperada:
  1. Se o usuário confirmar (ex: "sim", "pode salvar", "confirmo"), a confirmação será processada.
  2. REGRA CRÍTICA DE AJUSTE NA PROPOSTA: Se o usuário pedir qualquer ajuste nos dados propostos (ex: "não precisa salvar como contato X, somente salve como X", "o nome certo é Y", "o telefone é Z", "salve na categoria W"):
     - NUNCA acione 'atualizar_conhecimento' (o item ainda NÃO foi gravado no banco de dados).
     - Acione a ferramenta 'salvar_conhecimento' com o título e dado ajustados para atualizar a proposta pendente, gerando nova confirmação: "Vou salvar: [TítuloAjustado], [Dado]. Confirma?".
  3. Se ele mudar de assunto ou perguntar outra coisa, responda à nova pergunta normalmente.
</acao_pendente>\n`;
    }
  }

  // 3.5. MAPEAMENTO DE OPÇÕES DA ÚLTIMA LISTA NUMERADA (Passado como dado ao contexto da IA)
  const opcoesAtivas = extrairOpcoesDaUltimaLista(historicoPassado);

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

  // 3.6. ORQUESTRAÇÃO EM DUAS ETAPAS: ROTEADOR DA BUSCA (ETAPA A) E BUSCA RESTRITA (ETAPA B)
  const todosConhecimentosDisponiveis = await obterTodosConhecimentos();
  const emAcaoPendenteDado = pendenciaAtivaK && pendenciaAtivaK.status === 'aguardando_dado_faltante';

  let decisaoRoteador: DecisaoRoteador | null = null;
  if (!emAcaoPendenteDado && mensagemUsuario.trim()) {
    try {
      const inicioRoteador = Date.now();
      decisaoRoteador = await executarRoteadorIa({
        mensagemUsuario,
        historicoRecente: historicoPassado,
        contato,
        todosDocs,
        todosConhecimentos: todosConhecimentosDisponiveis,
        abortSignal: dados.abortSignal,
      });

      console.log(
        `[RoteadorBusca 🎯] Intenção: ${decisaoRoteador.intencao} | Entidade: ${decisaoRoteador.entidade_alvo || 'N/A'} | Docs: [${decisaoRoteador.documentos_escolhidos.join(', ')}] | Justificativa: ${decisaoRoteador.justificativa}`
      );

      // TRATAMENTO DA INTENÇÃO 1: entregar_arquivo
      if (decisaoRoteador.intencao === 'entregar_arquivo') {
        const tempoRoteador = Date.now() - inicioRoteador;
        if (decisaoRoteador.documentos_escolhidos.length > 0) {
          const docIdEscolhido = decisaoRoteador.documentos_escolhidos[0];
          const docEscolhido = todosDocs.find((d) => d.id === docIdEscolhido);
          if (docEscolhido) {
            const anexo = await criarAnexoParaDocumento(docEscolhido);
            const textoResposta = formatarFraseAcompanhamento(
              docEscolhido.titulo,
              contato.nome,
              docEscolhido.titular
            );

            const etapasRastroRoteador: EtapaRastro[] = [
              {
                ordem: 1,
                nome: 'Roteador da Busca (Etapa A)',
                descricao: `Classificado como entrega de arquivo. Documento selecionado: "${docEscolhido.titulo}".`,
                tempoMs: tempoRoteador,
                detalhes: {
                  entidade_identificada: decisaoRoteador.entidade_alvo,
                  intencao: decisaoRoteador.intencao,
                  documentos_escolhidos: decisaoRoteador.documentos_escolhidos,
                  documento_entregue: docEscolhido.titulo,
                  justificativa: decisaoRoteador.justificativa,
                  trechos_retornados: [
                    {
                      doc: docEscolhido.titulo,
                      score: 1.0,
                      origem: 'catalogo_roteador',
                    },
                  ],
                },
              },
            ];

            const rastro: RastroRegistro = {
              mensagemId: '',
              usuarioNome: contato.nome,
              usuarioId: contato.id,
              mensagemOriginal: mensagemUsuario,
              perguntaReescrita: mensagemUsuario,
              intencaoDetectada: 'pedir_arquivo',
              tipoBusca: 'roteador_busca_restrita',
              documentosEncontrados: [
                {
                  id: docEscolhido.id,
                  titulo: docEscolhido.titulo,
                  tipo: docEscolhido.tipo,
                  similaridade: 1.0,
                  usadoNaResposta: true,
                },
              ],
              enviouAnexo: true,
              anexosDetalhes: [
                {
                  nome: anexo.nome,
                  titulo: anexo.titulo,
                  tamanho: anexo.tamanho,
                  tipo: anexo.tipo,
                },
              ],
              respostaFinal: mascararDadosSensiveis(textoResposta),
              modeloUsado: chatModel,
              tokensTotal: 0,
              tokensPrompt: 0,
              tokensCompletion: 0,
              custoEstimadoUsd: 0,
              tempoTotalMs: Date.now() - inicioTotal,
              etapas: etapasRastroRoteador,
            };

            return {
              textoResposta,
              anexos: [anexo],
              origem: 'motor',
              intencaoDetectada: 'pedir_arquivo',
              perguntaReescrita: docEscolhido.titulo,
              rastro,
            };
          }
        }

        // Se a intenção é entregar_arquivo mas documentos_escolhidos está vazio (ou não achou no Cofre)
        const textoNaoEncontrado = decisaoRoteador.entidade_alvo
          ? `Não encontrei esse documento de ${decisaoRoteador.entidade_alvo} no Cofre.`
          : 'Não encontrei esse documento no Cofre.';

        const etapasRastroRoteador: EtapaRastro[] = [
          {
            ordem: 1,
            nome: 'Roteador da Busca (Etapa A)',
            descricao: `Documento solicitado não existe no Cofre para a entidade "${decisaoRoteador.entidade_alvo || 'N/A'}".`,
            tempoMs: tempoRoteador,
            detalhes: {
              entidade_identificada: decisaoRoteador.entidade_alvo,
              intencao: decisaoRoteador.intencao,
              documentos_escolhidos: [],
              justificativa: decisaoRoteador.justificativa,
              trechos_retornados: [],
            },
          },
        ];

        const rastro: RastroRegistro = {
          mensagemId: '',
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          mensagemOriginal: mensagemUsuario,
          perguntaReescrita: mensagemUsuario,
          intencaoDetectada: 'pedir_arquivo',
          tipoBusca: 'roteador_busca_restrita',
          documentosEncontrados: [],
          enviouAnexo: false,
          anexosDetalhes: [],
          respostaFinal: mascararDadosSensiveis(textoNaoEncontrado),
          modeloUsado: chatModel,
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: Date.now() - inicioTotal,
          etapas: etapasRastroRoteador,
        };

        return {
          textoResposta: textoNaoEncontrado,
          origem: 'motor',
          intencaoDetectada: 'pedir_arquivo',
          perguntaReescrita: mensagemUsuario,
          rastro,
        };
      }

      // TRATAMENTO DA INTENÇÃO 2: responder_dado
      if (decisaoRoteador.intencao === 'responder_dado') {
        const tempoInicioB = Date.now();

        // 2.1 Item de Conhecimento escolhido
        const itemK = todosConhecimentosDisponiveis.find((k) =>
          decisaoRoteador!.documentos_escolhidos.includes(k.id)
        );
        if (itemK) {
          let textoResp = '';
          const titK = itemK.titulo;
          const titLower = titK.toLowerCase();
          if (titLower.includes('escritório central') || titLower.includes('escritorio central')) {
            const dEst = itemK.dadosEstruturados as any;
            const end = dEst?.endereco || itemK.conteudo;
            textoResp = `O endereço do Escritório Central da Delta Plan é:\n${end}\n\n(Fonte: Base de Conhecimento - ${titK})`;
          } else {
            textoResp = `${itemK.conteudo}\n\n(Fonte: Base de Conhecimento - ${titK})`;
          }

          const etapasRastroK: EtapaRastro[] = [
            {
              ordem: 1,
              nome: 'Roteador da Busca (Etapa A)',
              descricao: `Selecionado item de conhecimento: "${titK}". Justificativa: ${decisaoRoteador.justificativa}`,
              tempoMs: tempoInicioB - inicioRoteador,
              detalhes: {
                entidade_identificada: decisaoRoteador.entidade_alvo,
                intencao: decisaoRoteador.intencao,
                documentos_escolhidos: [itemK.id],
                justificativa: decisaoRoteador.justificativa,
                trechos_retornados: [
                  {
                    doc: titK,
                    score: 1.0,
                    origem: 'base_conhecimento',
                  },
                ],
              },
            },
          ];

          const rastro: RastroRegistro = {
            mensagemId: '',
            usuarioNome: contato.nome,
            usuarioId: contato.id,
            mensagemOriginal: mensagemUsuario,
            perguntaReescrita: mensagemUsuario,
            intencaoDetectada: 'pergunta_conteudo',
            tipoBusca: 'roteador_conhecimento',
            documentosEncontrados: [],
            enviouAnexo: false,
            anexosDetalhes: [],
            respostaFinal: mascararDadosSensiveis(textoResp),
            modeloUsado: chatModel,
            tokensTotal: 0,
            tokensPrompt: 0,
            tokensCompletion: 0,
            custoEstimadoUsd: 0,
            tempoTotalMs: Date.now() - inicioTotal,
            etapas: etapasRastroK,
          };

          return {
            textoResposta: textoResp,
            origem: 'ia',
            intencaoDetectada: 'pergunta_conteudo',
            perguntaReescrita: titK,
            rastro,
          };
        }

        // 2.2 Busca Restrita (Etapa B) em documentos do Cofre
        if (decisaoRoteador.documentos_escolhidos.length > 0) {
          const trechosRestritos = await executarBuscaRestrita({
            consulta: mensagemUsuario,
            documentosIds: decisaoRoteador.documentos_escolhidos,
            entidadeAlvo: decisaoRoteador.entidade_alvo,
            todosDocs,
            todosConhecimentos: todosConhecimentosDisponiveis,
          });

          if (trechosRestritos.length > 0) {
            const respostaGerada = await responderComTrechosRestritos({
              perguntaUsuario: mensagemUsuario,
              trechos: trechosRestritos,
              entidadeAlvo: decisaoRoteador.entidade_alvo,
              contato,
              abortSignal: dados.abortSignal,
            });

            const docsFontes: DocumentoRastro[] = trechosRestritos.map((t) => {
              const d = todosDocs.find((doc) => doc.id === t.documento_id);
              return {
                id: t.documento_id,
                titulo: t.titulo_documento,
                tipo: d?.tipo || 'Documento',
                similaridade: t.similaridade,
                trecho: t.conteudo.slice(0, 300),
                usadoNaResposta: true,
              };
            });

            const etapasRastroB: EtapaRastro[] = [
              {
                ordem: 1,
                nome: 'Roteador da Busca (Etapa A)',
                descricao: `Entidade: "${decisaoRoteador.entidade_alvo || 'N/A'}". Documentos escolhidos: ${decisaoRoteador.documentos_escolhidos.length}. Justificativa: ${decisaoRoteador.justificativa}`,
                tempoMs: tempoInicioB - inicioRoteador,
                detalhes: {
                  entidade_identificada: decisaoRoteador.entidade_alvo,
                  intencao: decisaoRoteador.intencao,
                  documentos_escolhidos: decisaoRoteador.documentos_escolhidos,
                  justificativa: decisaoRoteador.justificativa,
                },
              },
              {
                ordem: 2,
                nome: 'Busca Restrita e Resposta IA (Etapa B)',
                descricao: `Encontrados ${trechosRestritos.length} trechos restritos aos documentos da entidade. Resposta sintetizada com sucesso.`,
                tempoMs: Date.now() - tempoInicioB,
                detalhes: {
                  entidade_alvo: decisaoRoteador.entidade_alvo,
                  documentos_consultados: decisaoRoteador.documentos_escolhidos,
                  trechos_retornados: trechosRestritos.map((t) => ({
                    documento: t.titulo_documento,
                    score: t.similaridade,
                    origem: t.origem,
                    trecho: t.conteudo.slice(0, 200),
                  })),
                },
              },
            ];

            const rastro: RastroRegistro = {
              mensagemId: '',
              usuarioNome: contato.nome,
              usuarioId: contato.id,
              mensagemOriginal: mensagemUsuario,
              perguntaReescrita: mensagemUsuario,
              intencaoDetectada: 'pergunta_conteudo',
              tipoBusca: 'roteador_busca_restrita',
              documentosEncontrados: docsFontes,
              enviouAnexo: false,
              anexosDetalhes: [],
              respostaFinal: mascararDadosSensiveis(respostaGerada),
              modeloUsado: chatModel,
              tokensTotal: 0,
              tokensPrompt: 0,
              tokensCompletion: 0,
              custoEstimadoUsd: 0,
              tempoTotalMs: Date.now() - inicioTotal,
              etapas: etapasRastroB,
            };

            return {
              textoResposta: respostaGerada,
              origem: 'ia',
              intencaoDetectada: 'pergunta_conteudo',
              perguntaReescrita: mensagemUsuario,
              rastro,
            };
          }
        }

        // Se a intenção era responder_dado e não encontramos trechos ou a entidade não tem docs
        // Aplica TRAVA DE ENTIDADE obrigatória
        const textoBloqueioEntidade = decisaoRoteador.entidade_alvo
          ? `Não encontrei essa informação nos documentos de ${decisaoRoteador.entidade_alvo} no Cofre.`
          : 'Não encontrei essa informação nos documentos do Cofre.';

        const etapasBloqueio: EtapaRastro[] = [
          {
            ordem: 1,
            nome: 'Roteador da Busca e Trava de Entidade',
            descricao: `Nenhum documento ou dado localizado para a entidade "${decisaoRoteador.entidade_alvo || 'N/A'}". Trava de entidade acionada.`,
            tempoMs: Date.now() - inicioRoteador,
            detalhes: {
              entidade_identificada: decisaoRoteador.entidade_alvo,
              intencao: decisaoRoteador.intencao,
              documentos_escolhidos: decisaoRoteador.documentos_escolhidos,
              justificativa: decisaoRoteador.justificativa,
              trechos_retornados: [],
            },
          },
        ];

        const rastro: RastroRegistro = {
          mensagemId: '',
          usuarioNome: contato.nome,
          usuarioId: contato.id,
          mensagemOriginal: mensagemUsuario,
          perguntaReescrita: mensagemUsuario,
          intencaoDetectada: 'pergunta_conteudo',
          tipoBusca: 'roteador_busca_restrita',
          documentosEncontrados: [],
          enviouAnexo: false,
          anexosDetalhes: [],
          respostaFinal: mascararDadosSensiveis(textoBloqueioEntidade),
          modeloUsado: chatModel,
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: Date.now() - inicioTotal,
          etapas: etapasBloqueio,
        };

        return {
          textoResposta: textoBloqueioEntidade,
          origem: 'motor',
          intencaoDetectada: 'pergunta_conteudo',
          perguntaReescrita: mensagemUsuario,
          rastro,
        };
      }
    } catch (errRoteamento: any) {
      if (dados.abortSignal?.aborted || errRoteamento?.name === 'AbortError') {
        throw errRoteamento;
      }
      console.warn(
        '[RoteadorBusca ⚠️] Erro durante roteamento prioritário, seguindo para fluxo normal:',
        errRoteamento
      );
    }
  }

  // 4. CONTEXTO DA CONVERSA E SAUDAÇÃO
  const ehPrimeiroContatoDoDia = verificarSeEhPrimeiroContatoDoDia(historicoPassado);
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

DIRETRIZ MANDATÓRIA SOBRE O CONTATO:
- O contato acima é a pessoa com quem você está interagindo no WhatsApp.
- NUNCA assuma que o remetente é o titular em pedidos gerais de listagem do acervo (ex.: "liste todos os documentos", "o que tem no cofre?", "quais documentos você tem acesso?", "o que você tem arquivado?"). Para pedidos gerais, use OBRIGATORIAMENTE a ferramenta listar_documentos_cofre.
- Use o nome do contato como titular em listar_documentos_titular SOMENTE se ele disser expressamente "meus documentos", "documentos em meu nome", "o que você tem sobre mim".

<status_saudacao>
${statusSaudacao}
</status_saudacao>${blocoOpcoesAnteriores}${blocoAcaoPendente}`;

  // Últimas mensagens da conversa (janela oficial de 30 mensagens - Regra 15)
  const historicoLimitado = historicoPassado.slice(-JANELA_CONTEXTO_MENSAGENS);
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

  let localizacaoParaEnvio: { latitude: number; longitude: number; nome?: string; endereco?: string } | undefined = undefined;
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
      },
      dados.abortSignal ? { signal: dados.abortSignal } : undefined
    );

    const tempoIa = Date.now() - inicioChamadaIa;
    const uso = respostaIa.usage;
    if (uso) {
      tokensPromptTotal += uso.prompt_tokens || 0;
      tokensCompletionTotal += uso.completion_tokens || 0;
      tokensGeraisTotal += uso.total_tokens || 0;
    }

    const escolha = respostaIa.choices?.[0];
    const msgResposta = escolha?.message;
    if (!msgResposta) break;

    etapasRastro.push({
      ordem: ordemEtapa++,
      nome: `Chamada OpenAI (Volta ${volta})`,
      descricao: `Chamada ao modelo ${chatModel} finalizada em ${tempoIa}ms (Prompt: ${uso?.prompt_tokens || 0}, Completion: ${uso?.completion_tokens || 0}).`,
      tempoMs: tempoIa,
      detalhes: {
        volta,
        modelo: chatModel,
        tokensPrompt: uso?.prompt_tokens,
        tokensCompletion: uso?.completion_tokens,
        totalTokens: uso?.total_tokens,
        teveToolCalls: Boolean(msgResposta.tool_calls && msgResposta.tool_calls.length > 0),
      },
    });

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
          const titularEfetivo = args.titular || args.pessoa_base || ultimoTitularFoco;
          resultadoTool = await toolBuscarDocumentos(
            args.consulta,
            titularEfetivo,
            todosDocs,
            dados.origemMensagem,
            contato,
            args.tipo_referencia,
            args.identificador_referencia,
            args.pessoa_base,
            args.relacao || 'propria',
            dados.bloquearCancelamento
          );
          if (resultadoTool.tipo_correspondencia) {
            etapasRastro.push({
              ordem: ordemEtapa++,
              nome: 'Checagem de Correspondência de Nomes (Consulta de Documentos)',
              descricao: `Verificação de correspondência para "${resultadoTool.nome_entendido || titularEfetivo || args.consulta}": status "${resultadoTool.tipo_correspondencia}" (origem: ${dados.origemMensagem || 'texto'}).`,
              tempoMs: 1,
              detalhes: {
                nomeEntendido: resultadoTool.nome_entendido || titularEfetivo || args.consulta,
                tipoCorrespondencia: resultadoTool.tipo_correspondencia,
                origemMensagem: dados.origemMensagem || 'texto',
                instrucaoObrigatoria: resultadoTool.mensagem || resultadoTool.orientacao_resposta,
              },
            });
          }
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
          const nomeEfetivo = args.pessoa_base || args.nome || ultimoTitularFoco;
          if (nomeEfetivo) {
            ultimoTitularFoco = nomeEfetivo;
          }
          resultadoTool = await toolConsultarFichaTitular(
            nomeEfetivo,
            args.relacao || 'propria',
            todosDocs,
            dados.origemMensagem,
            args.pessoa_base
          );
          if (resultadoTool.tipo_correspondencia) {
            etapasRastro.push({
              ordem: ordemEtapa++,
              nome: 'Checagem de Correspondência de Nomes (Consulta de Ficha)',
              descricao: `Verificação de correspondência para "${resultadoTool.nome_entendido || args.nome}": status "${resultadoTool.tipo_correspondencia}" (origem: ${dados.origemMensagem || 'texto'}).`,
              tempoMs: 1,
              detalhes: {
                nomeEntendido: resultadoTool.nome_entendido || args.nome,
                tipoCorrespondencia: resultadoTool.tipo_correspondencia,
                origemMensagem: dados.origemMensagem || 'texto',
                instrucaoObrigatoria: resultadoTool.mensagem || resultadoTool.instrucao_resposta,
              },
            });
          }
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
            dados.bloquearCancelamento?.('Confirmação de versão de dado do titular');
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
        } else if (nomeTool === 'listar_documentos_cofre') {
          resultadoTool = await toolListarDocumentosCofre(args.filtro_tipo, todosDocs);
          dadosRetornadosTools.push(
            `Resumo Geral do Cofre: ${resultadoTool.total_documentos} documentos em ${resultadoTool.total_titulares} grupos de titulares.`
          );
          if (resultadoTool.grupos) {
            for (const g of resultadoTool.grupos) {
              dadosRetornadosTools.push(`- ${g.titular}: ${g.total} documentos (${g.resumo_tipos})`);
              fontesRetornadasRastro.push({
                id: `titular_${g.titular}`,
                titulo: `${g.titular} (${g.total} documentos)`,
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
          resultadoTool = await toolEnviarDocumento(
            args.doc_id,
            todosDocs,
            anexosAcumulados,
            contato,
            args.tipo_referencia,
            args.identificador_referencia
          );
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

              // Se o item retornado for uma localização salva, capturar para envio nativo no WhatsApp
              if (
                it.tipo === 'local' ||
                it.categoria?.toLowerCase() === 'locais' ||
                (it.dadosEstruturados?.latitude && it.dadosEstruturados?.longitude) ||
                /latitude:\s*(-?\d+(?:\.\d+)?).*longitude:\s*(-?\d+(?:\.\d+)?)/i.test(it.conteudo)
              ) {
                let lat = Number(it.dadosEstruturados?.latitude);
                let lng = Number(it.dadosEstruturados?.longitude);
                const nomeLocal = it.dadosEstruturados?.nomeLocal || it.dadosEstruturados?.nome || it.titulo;
                const endLocal = it.dadosEstruturados?.endereco || it.dadosEstruturados?.linkMaps;

                if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
                  const mCoord = it.conteudo.match(/latitude:\s*(-?\d+(?:\.\d+)?)[,\s]+longitude:\s*(-?\d+(?:\.\d+)?)/i);
                  if (mCoord) {
                    lat = parseFloat(mCoord[1]);
                    lng = parseFloat(mCoord[2]);
                  }
                }

                if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                  localizacaoParaEnvio = {
                    latitude: lat,
                    longitude: lng,
                    nome: nomeLocal,
                    endereco: endLocal,
                  };
                }
              }
            }
          }
        } else if (nomeTool === 'listar_documentos_faltantes') {
          resultadoTool = await toolListarDocumentosFaltantes(
            args.titular,
            args.escopo,
            contato,
            mensagemUsuario
          );
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.documentos) {
            for (const doc of resultadoTool.documentos) {
              fontesRetornadasRastro.push({
                id: doc.id,
                titulo: `${doc.tipo} (${doc.titular}) - Faltante`,
                similaridade: 100,
                usadoNaResposta: true,
              });
            }
          }
        } else if (nomeTool === 'registrar_documento_faltante') {
          resultadoTool = await toolRegistrarDocumentoFaltante(
            args.descricao,
            args.tipo_documento,
            args.titular,
            contato,
            mensagemUsuario,
            args.tipo_referencia,
            args.identificador_referencia
          );
          if (resultadoTool.item_registrado || resultadoTool.sucesso) {
            dados.bloquearCancelamento?.('Registro de documento faltante');
          }
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.item_registrado) {
            fontesRetornadasRastro.push({
              id: resultadoTool.item_registrado.id,
              titulo: `${resultadoTool.item_registrado.tipo} (${resultadoTool.item_registrado.titular}) - Faltante Registrado`,
              similaridade: 100,
              usadoNaResposta: true,
            });
          }
        } else if (nomeTool === 'salvar_conhecimento') {
          resultadoTool = await toolSalvarConhecimento(
            args,
            contato,
            historicoLimitado,
            mensagemUsuario
          );
          if (resultadoTool.sucesso || resultadoTool.item || resultadoTool.acao) {
            dados.bloquearCancelamento?.('Salvar na Base de Conhecimento');
          }
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.instrucao_resposta) {
            dadosRetornadosTools.push(resultadoTool.instrucao_resposta);
          }
        } else if (nomeTool === 'atualizar_conhecimento') {
          resultadoTool = await toolAtualizarConhecimento(
            args,
            contato,
            historicoLimitado,
            mensagemUsuario
          );
          if (resultadoTool.sucesso) {
            dados.bloquearCancelamento?.('Atualizar Base de Conhecimento');
          }
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.instrucao_resposta) {
            dadosRetornadosTools.push(resultadoTool.instrucao_resposta);
          }
        } else if (nomeTool === 'remover_conhecimento') {
          resultadoTool = await toolRemoverConhecimento(
            args,
            contato,
            historicoLimitado,
            mensagemUsuario
          );
          if (resultadoTool.sucesso) {
            dados.bloquearCancelamento?.('Remover da Base de Conhecimento');
          }
          if (resultadoTool.mensagem) {
            dadosRetornadosTools.push(resultadoTool.mensagem);
          }
          if (resultadoTool.instrucao_resposta) {
            dadosRetornadosTools.push(resultadoTool.instrucao_resposta);
          }
        } else if (nomeTool === 'ler_documento_completo') {
          const titularEfetivo = args.titular || ultimoTitularFoco;
          resultadoTool = await toolLerDocumentoCompleto({
            docId: args.doc_id,
            termoDocumento: args.termo_documento,
            titular: titularEfetivo,
            todosDocs,
          });
          if (resultadoTool.conteudo_completo) {
            dadosRetornadosTools.push(resultadoTool.conteudo_completo);
            if (resultadoTool.doc_id) {
              fontesRetornadasRastro.push({
                id: resultadoTool.doc_id,
                titulo: resultadoTool.titulo || 'Documento Completo',
                similaridade: 100,
                usadoNaResposta: true,
              });
            }
          }
        } else {
          resultadoTool = { erro: `Tool "${nomeTool}" desconhecida.` };
        }

        const tempoTool = Date.now() - inicioTool;
        const relacaoUsada = args.relacao || (nomeTool === 'consultar_ficha_titular' || nomeTool === 'buscar_documentos' ? 'propria' : undefined);
        const pessoaBaseUsada = args.pessoa_base || args.nome || args.titular;
        const descComplemento = relacaoUsada ? ` [relação: ${relacaoUsada}${pessoaBaseUsada ? `, pessoa: ${pessoaBaseUsada}` : ''}]` : '';

        etapasRastro.push({
          ordem: ordemEtapa++,
          nome: `Tool: ${nomeTool}`,
          descricao: `Executada ferramenta "${nomeTool}" (${tempoTool}ms)${descComplemento}.`,
          tempoMs: tempoTool,
          detalhes: {
            argumentos: args,
            resultado: resultadoTool,
            relacao: relacaoUsada,
            pessoaBase: pessoaBaseUsada,
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

  return {
    textoResposta: textoLimpoFinal,
    anexos: anexosAcumulados.length > 0 ? anexosAcumulados : undefined,
    opcoes: opcoesGeradasNestaResposta && opcoesGeradasNestaResposta.length > 0 ? opcoesGeradasNestaResposta : undefined,
    localizacao: localizacaoParaEnvio,
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
  origemMensagem?: 'audio' | 'texto';
  idsMensagensLoteAtual?: string[];
  abortSignal?: AbortSignal;
  bloquearCancelamento?: (motivo: string) => void;
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
    // Se a chamada foi cancelada intencionalmente por chegada de nova mensagem, propaga
    if (dados.abortSignal?.aborted || erroFatal?.name === 'AbortError') {
      throw erroFatal;
    }
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
  const checagemCampo = validarCorrespondenciaCampoResposta(dados.mensagemUsuario, resultado.textoResposta, dados.contato);
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


