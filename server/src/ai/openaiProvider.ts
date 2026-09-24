import OpenAI from 'openai';
import {
  Contato,
  DocumentoRegistro,
  Mensagem,
  MotivoUsoIA,
  ItemConhecimento,
} from '../types.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import {
  obterRegistrosUsoIA,
  adicionarRegistroUsoIA,
  obterTabelaPrecos,
  obterTodosConhecimentos,
  obterTodosTitulares,
} from '../storage.js';
import { chamarEmbeddingsComTelemetria } from './telemetriaIaService.js';

export type AcaoIA =
  | { acao: 'entregar'; id: string }
  | { acao: 'ambiguo'; ids: string[] }
  | { acao: 'nao_encontrado'; termo: string }
  | { acao: 'conversa'; resposta: string }
  | { acao: 'bloqueado_cota'; mensagem: string };

/**
 * Modo simulador SÓ PODE ser ativado com variável explícita AI_SIMULADOR=true.
 * Se não estiver configurado como 'true', opera obrigatoriamente no modo real.
 */
export function isModoSimuladorAtivo(): boolean {
  return process.env.AI_SIMULADOR === 'true';
}

/**
 * Aguarda um determinado número de milissegundos
 */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retorna a data no fuso do Pacífico (America/Los_Angeles) no formato YYYY-MM-DD
 */
export function obterDataPacifico(data: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(data);
}

/**
 * Converte data ISO para data no fuso do Pacífico no formato YYYY-MM-DD
 */
export function obterDataPacificoDeIso(dataIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(
      new Date(dataIso)
    );
  } catch {
    return dataIso.slice(0, 10);
  }
}

/**
 * Calcula o custo estimado em reais para uma quantidade de tokens
 */
export async function calcularCustoEstimado(
  modelo: string,
  tokensEntrada: number,
  tokensSaida: number
): Promise<number> {
  const tabela = await obterTabelaPrecos();
  const config = tabela[modelo] || tabela['gpt-5.4-mini'] || tabela['gpt-4o-mini'] || {
    precoEntradaPorMilhao: 0.9,
    precoSaidaPorMilhao: 3.6,
  };
  const custoEntrada = (tokensEntrada / 1_000_000) * (config.precoEntradaPorMilhao || 0);
  const custoSaida = (tokensSaida / 1_000_000) * (config.precoSaidaPorMilhao || 0);
  return Number((custoEntrada + custoSaida).toFixed(6));
}

export interface ResultadoChecagemCota {
  permitido: boolean;
  motivoBloqueio?: 'rpd' | 'teto';
  mensagem?: string;
}

/**
 * Verifica limites de cota:
 * - RPM (10 req/min): Se estourar, aguarda com backoff
 * - RPD (250 req/dia): Reset meia-noite Pacífico. Se estourar, bloqueia chamada
 * - Teto de custo mensal: Se > 0 e exceder, bloqueia chamada
 */
export async function verificarLimitesCota(): Promise<ResultadoChecagemCota> {
  const limiteRPM = parseInt(process.env.LIMITE_RPM || '10', 10);
  const limiteRPD = parseInt(process.env.LIMITE_RPD || '250', 10);
  const tetoMensal = parseFloat(process.env.TETO_CUSTO_MENSAL || '0');

  const agora = Date.now();
  const registros = await obterRegistrosUsoIA();

  // 1. Verificação de RPD (Fuso do Pacífico)
  const dataHojePac = obterDataPacifico(new Date(agora));
  const chamadasHoje = registros.filter(
    (r) => obterDataPacificoDeIso(r.data) === dataHojePac
  );

  if (chamadasHoje.length >= limiteRPD) {
    console.warn(
      `[VEGA/Cota] Limite diário (RPD) atingido: ${chamadasHoje.length}/${limiteRPD} em ${dataHojePac} (Horário do Pacífico).`
    );
    return {
      permitido: false,
      motivoBloqueio: 'rpd',
      mensagem:
        'Limite diário de consultas inteligentes atingido. A busca direta continua funcionando normalmente.',
    };
  }

  // 2. Verificação de Teto de Custo Mensal
  if (tetoMensal > 0) {
    const mesAtual = new Date(agora).toISOString().slice(0, 7);
    const custoMes = registros
      .filter((r) => r.data.slice(0, 7) === mesAtual)
      .reduce((acc, r) => acc + (r.custoEstimado || 0), 0);

    if (custoMes >= tetoMensal) {
      console.warn(
        `[VEGA/Cota] Teto mensal de custo atingido: R$ ${custoMes.toFixed(2)} / R$ ${tetoMensal.toFixed(2)}`
      );
      return {
        permitido: false,
        motivoBloqueio: 'teto',
        mensagem:
          'Teto de custo mensal da IA atingido. A busca direta continua funcionando normalmente.',
      };
    }
  }

  // 3. Verificação de RPM com espera e backoff (até 5 tentativas)
  let tentativasRPM = 0;
  while (tentativasRPM < 5) {
    const timestampAtual = Date.now();
    const registrosRecentes = await obterRegistrosUsoIA();
    const noUltimoMinuto = registrosRecentes.filter(
      (r) => timestampAtual - new Date(r.data).getTime() < 60000
    );

    if (noUltimoMinuto.length < limiteRPM) {
      break;
    }

    tentativasRPM++;
    // Ordena do mais antigo para calcular quando o slot vai liberar
    noUltimoMinuto.sort(
      (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime()
    );
    const maisAntiga = new Date(noUltimoMinuto[0].data).getTime();
    const tempoAteLiberar = 60000 - (timestampAtual - maisAntiga) + 500;
    const tempoEspera = Math.max(1000, Math.min(tempoAteLiberar, 5000));

    console.warn(
      `[VEGA/RPM] Limite de RPM atingido (${noUltimoMinuto.length}/${limiteRPM}). Aguardando ${tempoEspera}ms (tentativa ${tentativasRPM}/5)...`
    );
    await esperar(tempoEspera);
  }

  return { permitido: true };
}

/**
 * Interpreta a intenção do usuário utilizando OpenAI (modelo configurado em OPENAI_CHAT_MODEL),
 * com controle de cota (RPM, RPD, teto mensal), backoff e registro na tabela uso_ia do Supabase.
 */
export async function interpretarComIA(dados: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  catalogoFiltrado: DocumentoRegistro[];
  baseConhecimento?: ItemConhecimento[];
  contato?: Contato;
  motivo?: MotivoUsoIA;
}): Promise<AcaoIA> {
  const { mensagemUsuario, historicoRecente, catalogoFiltrado, contato } = dados;
  const primeiroNome = extrairPrimeiroNome(contato?.nome);

  // 1. Controle de Cota (RPD, Teto Mensal, RPM com backoff)
  const checagemCota = await verificarLimitesCota();
  if (!checagemCota.permitido) {
    return {
      acao: 'bloqueado_cota',
      mensagem:
        checagemCota.mensagem ||
        'Limite diário de consultas inteligentes atingido. A busca direta continua funcionando normalmente.',
    };
  }

  // Modelo configurado no .env, sem nomes de modelos fixos no código
  const modelName = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  // 2. Prepara dados para o prompt
  const catalogoEnxuto = catalogoFiltrado.map((d) => ({
    id: d.id,
    titulo: d.titulo,
    apelidos: d.apelidos || [],
  }));

  const ultimas6 = historicoRecente.slice(-6).map((m) => ({
    remetente: m.remetente,
    texto: m.texto,
  }));

  const listaConhecimento = dados.baseConhecimento || (await obterTodosConhecimentos());
  let blocoConhecimento = '<base_conhecimento>\n';
  for (const item of listaConhecimento) {
    blocoConhecimento += `[${item.categoria}] ${item.titulo}\n${item.conteudo}\n\n`;
  }
  blocoConhecimento += '</base_conhecimento>';

  const todosTitulares = await obterTodosTitulares();
  const nivelUsuario = contato?.nivelAcesso || contato?.ficha?.nivelAcesso || 'geral';

  let blocoTitulares = '<fichas_titulares>\n';
  for (const tit of todosTitulares) {
    blocoTitulares += `[Titular: ${tit.nome}]\n`;
    for (const [cKey, reg] of Object.entries(tit.campos)) {
      if (!reg || !reg.conferido) continue;
      if (nivelUsuario !== 'diretoria' && reg.origemVisibilidade === 'diretoria') continue;
      blocoTitulares += `- ${cKey}: ${reg.valor} (Origem: ${reg.origemNome || reg.origem})\n`;
    }
    const docsDeste = catalogoFiltrado.filter(
      (d) => d.titular && d.titular.toLowerCase().includes(tit.nome.toLowerCase().split(' ')[0])
    );
    if (docsDeste.length > 0) {
      blocoTitulares += `Documentos disponíveis no cofre deste titular: ${docsDeste.map((d) => d.titulo).join(', ')}\n`;
    }
    blocoTitulares += '\n';
  }
  blocoTitulares += '</fichas_titulares>';

  const systemInstruction = `Você é a VEGA, assistente corporativa interna da construtora e incorporadora Delta Plan.
Sua responsabilidade nesta etapa é INTERPRETAR a intenção do usuário e responder ESTRITAMENTE em JSON puro, sem blocos markdown adicionais.

O catálogo de documentos disponíveis e autorizados no cofre para este usuário é:
${JSON.stringify(catalogoEnxuto, null, 2)}

A base de conhecimento interna da empresa cadastrada é:
${blocoConhecimento}

As fichas de dados estruturados dos titulares cadastrados (dados conferidos por humano) são:
${blocoTitulares}

Você deve responder com um dos formatos JSON abaixo:
1) Se o usuário solicitou um documento e ele existe no catálogo do cofre acima:
   {"acao":"entregar","id":"id_do_documento"}

2) Se o pedido de documento for ambíguo e corresponder a mais de um documento do cofre:
   {"acao":"ambiguo","ids":["id_1","id_2"]}

3) Se o usuário nomeou ou solicitou um documento que NÃO existe no catálogo:
   {"acao":"nao_encontrado","termo":"nome_ou_sigla_do_documento_pedido"}

4) Se o usuário fez uma pergunta sobre a empresa/procedimentos/políticas/prazos/regras:
   - Responda EXCLUSIVAMENTE com base nas informações do bloco <base_conhecimento>.
   - NUNCA invente prazos, políticas, valores ou regras que não estejam escritos nesse bloco.
   - NUNCA complemente com conhecimento externo/geral. Se a base não contiver a informação pedida, retorne:
     {"acao":"conversa","resposta":"Não há nada cadastrado sobre isso na minha base${primeiroNome ? `, ${primeiroNome}` : ''}. Você pode cadastrar essa instrução em Base da VEGA > Conhecimento."}
   - Se a informação estiver na base de conhecimento, responda objetivamente e educadamente:
     {"acao":"conversa","resposta":"texto da resposta com base estrita no conhecimento"}

5) Se o usuário consultar dados de algum titular (RG, CPF, profissão, estado civil, endereço, etc.):
   - Responda usando EXCLUSIVAMENTE os dados do bloco <fichas_titulares>.
   - É PROIBIDO alterar, completar ou formatar números (ex: RG, CPF devem sair exatamente como gravados).
   - Se o usuário fizer um pedido genérico ("dados do fulano", "me passa as informações dele"), pergunte educadamente o que ele precisa (dados cadastrais ou documentos em anexo).
   - Se algum campo for pedido e não constar na ficha conferida, informe como "não cadastrado".
   - Ao final, cite quais documentos em anexo estão disponíveis para envio se solicitado.
   - Retorne: {"acao":"conversa","resposta":"sua resposta formatada com as origens"}

6) SE FOR QUALQUER PEDIDO FORA DO ESCOPO DA DELTA PLAN (cálculos matemáticos como "847 vezes 23", programação, receitas de culinária como bolo de cenoura, piadas, notícias gerais): RECUSE cordialmente sem citar cofre nem base:
   {"acao":"conversa","resposta":"Isso está fora do meu escopo${primeiroNome ? `, ${primeiroNome}` : ''}. Posso ajudar com documentos e informações internas da Delta Plan."}

REGRAS RÍGIDAS:
- Retorne APENAS o JSON válido.
- Nunca invente IDs que não estejam na lista autorizada.
- Nunca responda que vai "procurar" ou "consultar depois": as listas fornecidas contêm tudo que existe.`;

  const userPrompt = `Histórico recente da conversa:
${JSON.stringify(ultimas6, null, 2)}

Mensagem do usuário:
"${mensagemUsuario}"`;

  // 3. REGRA ESTRITA DO MODO SIMULADOR:
  // Ele SÓ PODE ser ativado com a variável explícita AI_SIMULADOR=true no .env
  if (isModoSimuladorAtivo()) {
    console.warn('====================================================');
    console.warn('[VEGA] ⚠️ MODO SIMULADOR ATIVO via AI_SIMULADOR=true.');
    console.warn('====================================================');

    const acaoSimulada = simularInterpretacaoLocal(
      mensagemUsuario,
      catalogoFiltrado,
      listaConhecimento,
      primeiroNome
    );

    const motivoFinal: MotivoUsoIA =
      dados.motivo || (acaoSimulada.acao === 'conversa' ? 'conversa' : 'interpretacao');

    const charsEntrada = (systemInstruction.length || 0) + (userPrompt.length || 0);
    const charsSaida =
      acaoSimulada.acao === 'conversa'
        ? acaoSimulada.resposta.length
        : JSON.stringify(acaoSimulada).length;

    const tokensEntrada = Math.ceil(charsEntrada / 4);
    const tokensSaida = Math.ceil(charsSaida / 4);
    const custoEstimado = await calcularCustoEstimado(modelName, tokensEntrada, tokensSaida);

    await adicionarRegistroUsoIA({
      id: `ia-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      data: new Date().toISOString(),
      provedor: 'openai',
      modelo: modelName,
      contatoId: contato?.id || 'anonimo',
      contatoNome: contato?.nome,
      motivo: motivoFinal,
      tokensEntrada,
      tokensSaida,
      custoEstimado,
      sucesso: true,
      erro: null,
      estimado: true,
    });

    return acaoSimulada;
  }

  // 4. Se o simulador NÃO estiver ativo, exige chave válida
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === 'sua_chave_aqui' || apiKey.length < 10) {
    console.error('====================================================');
    console.error('[VEGA] ❌ ERRO CRÍTICO: OPENAI_API_KEY ausente ou inválida e AI_SIMULADOR não está ativo.');
    console.error('====================================================');

    return {
      acao: 'conversa',
      resposta: 'Estou indisponível no momento, tente mais tarde.',
    };
  }

  // 5. Modo Real com chamada à API da OpenAI via SDK Oficial
  const backoffs = [1000, 2000, 4000];
  let ultimaExcecao: any = null;

  for (let tentativa = 0; tentativa <= backoffs.length; tentativa++) {
    try {
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const textoResposta = completion.choices[0]?.message?.content?.trim() || '';
      const parsed = extrairJsonAcao(textoResposta);

      // Leitura de tokens reais do usage retornado pela OpenAI
      const usage = completion.usage;
      let tokensEntrada = 0;
      let tokensSaida = 0;
      let estimado = false;

      if (usage && typeof usage.prompt_tokens === 'number') {
        tokensEntrada = usage.prompt_tokens;
        tokensSaida = usage.completion_tokens || 0;
        estimado = false;
      } else {
        const charsEntrada = systemInstruction.length + userPrompt.length;
        tokensEntrada = Math.ceil(charsEntrada / 4);
        tokensSaida = Math.ceil((textoResposta.length || 50) / 4);
        estimado = true;
      }

      const motivoFinal: MotivoUsoIA =
        dados.motivo || (parsed?.acao === 'conversa' ? 'conversa' : 'interpretacao');

      const custoEstimado = await calcularCustoEstimado(
        modelName,
        tokensEntrada,
        tokensSaida
      );

      await adicionarRegistroUsoIA({
        id: `ia-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        data: new Date().toISOString(),
        provedor: 'openai',
        modelo: modelName,
        contatoId: contato?.id || 'anonimo',
        contatoNome: contato?.nome,
        motivo: motivoFinal,
        tokensEntrada,
        tokensSaida,
        custoEstimado,
        sucesso: true,
        erro: null,
        estimado,
      });

      if (parsed) {
        return parsed;
      }
      throw new Error(`Resposta da OpenAI não continha JSON válido: ${textoResposta}`);
    } catch (erro: any) {
      ultimaExcecao = erro;
      const statusErro = erro?.status || erro?.statusCode || erro?.response?.status;
      const eh429 =
        statusErro === 429 ||
        String(erro?.message).includes('429') ||
        String(erro?.message).includes('rate_limit');

      if (eh429 && tentativa < backoffs.length) {
        const tempoEspera = backoffs[tentativa];
        console.warn(
          `[OpenAI] Erro 429 (Rate Limit). Tentativa ${tentativa + 1}/${backoffs.length}. Aguardando ${tempoEspera}ms...`
        );
        await esperar(tempoEspera);
        continue;
      } else {
        console.error('[OpenAI] Erro na chamada ao modelo:', erro?.message || erro);
        break;
      }
    }
  }

  // Grava tentativa falhada no log
  const charsEntradaFallback = systemInstruction.length + userPrompt.length;
  await adicionarRegistroUsoIA({
    id: `ia-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    data: new Date().toISOString(),
    provedor: 'openai',
    modelo: modelName,
    contatoId: contato?.id || 'anonimo',
    contatoNome: contato?.nome,
    motivo: dados.motivo || 'interpretacao',
    tokensEntrada: Math.ceil(charsEntradaFallback / 4),
    tokensSaida: 0,
    custoEstimado: 0,
    sucesso: false,
    erro: ultimaExcecao?.message || 'Falha na chamada ao modelo OpenAI',
    estimado: true,
  });

  // NUNCA responder com dados simulados se AI_SIMULADOR não estiver ativo
  console.error(
    '[OpenAI] ❌ Falha na API e modo simulador desativado. Retornando mensagem de indisponibilidade.'
  );
  return {
    acao: 'conversa',
    resposta: 'Estou indisponível no momento, tente mais tarde.',
  };
}

/**
 * Gera embedding vetorial para um texto usando o modelo configurado em OPENAI_EMBEDDING_MODEL.
 */
export async function gerarEmbedding(texto: string): Promise<number[]> {
  if (isModoSimuladorAtivo()) {
    // Retorna vetor simulado de 1536 dimensões se em modo simulador
    return new Array(1536).fill(0).map(() => (Math.random() - 0.5) * 0.1);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === 'sua_chave_aqui' || apiKey.length < 10) {
    console.error('[VEGA] ❌ ERRO CRÍTICO: OPENAI_API_KEY ausente para gerar embedding e AI_SIMULADOR não está ativo.');
    throw new Error('OPENAI_API_KEY ausente e AI_SIMULADOR desativado');
  }

  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const openai = new OpenAI({ apiKey });

  const resposta = await chamarEmbeddingsComTelemetria(
    openai,
    {
      model: embeddingModel,
      input: texto,
    },
    { motivo: 'busca_embedding' }
  );

  return resposta.data[0].embedding;
}

/**
 * Extrai e valida o JSON de ação retornado pela IA
 */
function extrairJsonAcao(texto: string): AcaoIA | null {
  try {
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const json = JSON.parse(match[0]);

    if (json.acao === 'entregar' && typeof json.id === 'string') {
      return { acao: 'entregar', id: json.id };
    }
    if (json.acao === 'ambiguo' && Array.isArray(json.ids)) {
      return { acao: 'ambiguo', ids: json.ids };
    }
    if (json.acao === 'nao_encontrado' && typeof json.termo === 'string') {
      return { acao: 'nao_encontrado', termo: json.termo };
    }
    if (json.acao === 'conversa' && typeof json.resposta === 'string') {
      return { acao: 'conversa', resposta: json.resposta };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Interpretador determinístico local para modo simulador
 */
export function simularInterpretacaoLocal(
  mensagemUsuario: string,
  catalogoFiltrado: DocumentoRegistro[],
  baseConhecimento?: ItemConhecimento[],
  primeiroNome?: string
): AcaoIA {
  const msgLower = (mensagemUsuario || '').toLowerCase().trim();
  const vocativo = primeiroNome ? `, ${primeiroNome}` : '';

  // 1. Verificação de Pedidos Fora de Escopo (contas matemáticas, culinária/bolo, etc.)
  const ehForaDeEscopo =
    /\b(\d+\s*(vezes|x|\*|\+|\-|\/)\s*\d+|quanto (é|e|vale)|calcule|raiz de|por cento)\b/i.test(msgLower) ||
    /\b(programa|programar|codigo|script|traduz|traduza|redija|redacao|piada|previsao do tempo|bolo|receita|pizza|culinaria|cozinhar|historia|noticia)\b/i.test(msgLower);

  if (ehForaDeEscopo) {
    return {
      acao: 'conversa',
      resposta: `Isso está fora do meu escopo${vocativo}. Posso ajudar com documentos e informações internas da Delta Plan.`,
    };
  }

  // 2. Consulta à Base de Conhecimento
  if (baseConhecimento && baseConhecimento.length > 0) {
    const itemMatch = baseConhecimento.find((item) => {
      const tit = item.titulo.toLowerCase();
      const cat = item.categoria.toLowerCase();
      return (
        msgLower.includes(tit) ||
        tit.split(/\s+/).some((p) => p.length >= 4 && msgLower.includes(p)) ||
        msgLower.includes(cat)
      );
    });

    if (itemMatch) {
      return {
        acao: 'conversa',
        resposta: `Sobre ${itemMatch.titulo}${vocativo}:\n${itemMatch.conteudo}`,
      };
    }
  }

  // 3. Busca de Documentos no Catálogo
  const docsEncontrados = catalogoFiltrado.filter((d) => {
    const tit = d.titulo.toLowerCase();
    const apelidos = (d.apelidos || []).map((a) => a.toLowerCase());
    return msgLower.includes(tit) || apelidos.some((ap) => msgLower.includes(ap));
  });

  if (docsEncontrados.length === 1) {
    return { acao: 'entregar', id: docsEncontrados[0].id };
  }

  if (docsEncontrados.length > 1) {
    return { acao: 'ambiguo', ids: docsEncontrados.map((d) => d.id) };
  }

  // 4. Verificação de siglas/nomes de documentos não cadastrados
  const termosDoc = msgLower.match(
    /\b(dre|balanco|alvara|certidao|cnd|comprovante|holerite|contracheque|contrato|procuracao|estatuto)\b/i
  );
  if (termosDoc) {
    return { acao: 'nao_encontrado', termo: termosDoc[0] };
  }

  // 5. Fallback conversacional
  return {
    acao: 'conversa',
    resposta: `Não há nada cadastrado sobre isso na minha base${vocativo}. Você pode cadastrar essa instrução em Base da VEGA > Conhecimento.`,
  };
}
