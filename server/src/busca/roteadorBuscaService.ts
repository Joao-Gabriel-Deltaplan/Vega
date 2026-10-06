import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { chamarChatComTelemetria } from '../ai/telemetriaIaService.js';
import { gerarEmbedding } from '../ai/openaiProvider.js';
import { DocumentoRegistro, ItemConhecimento, Contato, Mensagem } from '../types.js';
import { obterTodosDocumentos, obterTodosConhecimentos, obterTodosTitulares } from '../storage.js';

export type IntencaoRoteador = 'entregar_arquivo' | 'responder_dado' | 'conversa';

export interface DecisaoRoteador {
  intencao: IntencaoRoteador;
  entidade_alvo: string | null;
  documentos_escolhidos: string[];
  justificativa: string;
}

export interface ItemCatalogoCompacto {
  id: string;
  origem: 'cofre' | 'conhecimento';
  titulo: string;
  tipo: string;
  pertence_a: string;
  apelidos: string[];
  resumo?: string;
}

export interface EntidadeCanonica {
  id: string;
  nomeOficial: string;
  tipo: 'pessoa' | 'empresa';
  apelidos: string[];
}

/**
 * Dicionário padrão de sinônimos e apelidos por tipo documental
 */
export const APELIDOS_TIPOS_PADRAO: Record<string, string[]> = {
  CNH: ['cnh', 'habilitacao', 'habilitação', 'carteira de motorista', 'carteira de habilitacao', 'carteira de habilitação', 'cnh digital'],
  CTPS: ['ctps', 'carteira de trabalho', 'carteira profissional', 'ctps digital', 'trabalho digital', 'ctps carteira digital'],
  RG: ['rg', 'identidade', 'carteira de identidade', 'documento de identidade'],
  DADOS_CADASTRAIS: ['dados pessoais', 'dados cadastrais', 'dados thomaz', 'identificacao pessoal', 'identificação pessoal', 'documento de identificacao pessoal', 'documento de identificação pessoal', 'ficha pessoal'],
  CNPJ: ['cnpj', 'cartao cnpj', 'cartão cnpj', 'comprovante cnpj', 'inscricao cadastral', 'inscrição cadastral'],
  CREA: ['crea', 'registro crea', 'conselho regional de engenharia', 'carteira crea'],
  CRT: ['crt', 'cft', 'registro crt', 'conselho dos tecnicos', 'conselho dos técnicos', 'carteira crt'],
  CRLV: ['crlv', 'crlv digital', 'documento do veiculo', 'documento do veículo', 'doc do carro', 'licenciamento', 'documento da ranger', 'documento da caminhonete', 'esp-2d23'],
  PASSAPORTE: ['passaporte', 'passaporte brasileiro', 'documento de viagem'],
  CERTIDAO_CASAMENTO: ['certidao de casamento', 'certidão de casamento', 'casamento'],
  CERTIDAO_NASCIMENTO: ['certidao de nascimento', 'certidão de nascimento', 'nascimento'],
  VACINA: ['cartao de vacina', 'cartão de vacina', 'cartao de vacinas', 'cartão de vacinas', 'vacina', 'vacinas', 'vacinacao', 'vacinação'],
  IRPF: ['imposto de renda', 'irpf', 'dirpf', 'declaracao de imposto de renda', 'declaração de imposto de renda', 'ir', 'imposto de renda 2024'],
  HABILITACAO_AMADOR: ['carta arrais', 'arrais', 'habilitacao de amador', 'habilitação de amador', 'arrais amador', 'motonauta', 'carteira de arrais'],
  SEGURO: ['apolice de seguro', 'apólice de seguro', 'seguro nivus', 'seguro carro', 'seguro tokyo'],
  DIPLOMA: ['diploma', 'diploma ensino medio', 'diploma ensino médio', 'ensino medio', 'ensino médio'],
};

/**
 * Empresas de primeira classe com seus apelidos oficiais
 */
export const EMPRESAS_CANONICAS: EntidadeCanonica[] = [
  {
    id: 'emp_delta_plan',
    nomeOficial: 'Delta Plan',
    tipo: 'empresa',
    apelidos: ['delta plan', 'delta', 'escritório central', 'escritorio central', 'construtora', 'sede', 'empresa'],
  },
  {
    id: 'tit_t_l_servi_os',
    nomeOficial: 'T.L. Fabre Serviços',
    tipo: 'empresa',
    apelidos: ['tl', 't.l.', 'tl serviços', 'tl servicos', 't.l serviços', 't.l. servicos', 't.l. fabre serviços', 'tl fabre'],
  },
  {
    id: 'tit_engcom_servi_os_ltda',
    nomeOficial: 'ENGCOM & SERVICOS LTDA',
    tipo: 'empresa',
    apelidos: ['engcom', 'engecon', 'engcom serviços', 'engcom servicos', 'engcom & servicos ltda', 'engcom ltda'],
  },
  {
    id: 'tit_servi_os_menegazzo',
    nomeOficial: 'Obra Menegazzo',
    tipo: 'empresa',
    apelidos: ['menegazzo', 'obra menegazzo', 'serviços menegazzo', 'servicos menegazzo'],
  },
];

/**
 * Gera automaticamente apelidos padronizados a partir do tipo e título do documento
 */
export function gerarApelidosParaDocumento(doc: {
  titulo: string;
  tipo?: string;
  titular?: string;
  arquivo?: string;
}): string[] {
  const normTitulo = (doc.titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normTipo = (doc.tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normArq = (doc.arquivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const textoCombinado = `${normTitulo} ${normTipo} ${normArq}`;

  const setApelidos = new Set<string>();

  if (normTitulo) setApelidos.add(normTitulo);

  if (/\b(cnh|habilitacao)\b/i.test(textoCombinado) && !/\bamador|arrais\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CNH.forEach((a) => setApelidos.add(a));
  }
  if (/\b(ctps|carteira de trabalho|trabalho digital)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CTPS.forEach((a) => setApelidos.add(a));
  }
  if (/\b(rg|identidade)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.RG.forEach((a) => setApelidos.add(a));
  }
  if (/\b(dados|identificacao pessoal|dados cadastrais|dados thomaz)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.DADOS_CADASTRAIS.forEach((a) => setApelidos.add(a));
  }
  if (/\b(cnpj|cartao cnpj)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CNPJ.forEach((a) => setApelidos.add(a));
  }
  if (/\b(crea)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CREA.forEach((a) => setApelidos.add(a));
  }
  if (/\b(crt|cft)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CRT.forEach((a) => setApelidos.add(a));
  }
  if (/\b(crlv|licenciamento|ranger|veiculo)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CRLV.forEach((a) => setApelidos.add(a));
  }
  if (/\b(passaporte)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.PASSAPORTE.forEach((a) => setApelidos.add(a));
  }
  if (/\b(casamento)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CERTIDAO_CASAMENTO.forEach((a) => setApelidos.add(a));
  }
  if (/\b(nascimento)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.CERTIDAO_NASCIMENTO.forEach((a) => setApelidos.add(a));
  }
  if (/\b(vacina|vacinacao|cartao vacinas)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.VACINA.forEach((a) => setApelidos.add(a));
  }
  if (/\b(imposto de renda|irpf|dirpf)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.IRPF.forEach((a) => setApelidos.add(a));
  }
  if (/\b(arrais|amador|carta arrais)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.HABILITACAO_AMADOR.forEach((a) => setApelidos.add(a));
  }
  if (/\b(seguro|apolice|nivus|tokyo)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.SEGURO.forEach((a) => setApelidos.add(a));
  }
  if (/\b(diploma|ensino medio)\b/i.test(textoCombinado)) {
    APELIDOS_TIPOS_PADRAO.DIPLOMA.forEach((a) => setApelidos.add(a));
  }

  return Array.from(setApelidos);
}

/**
 * Preenche apelidos de documentos existentes no Supabase que estejam vazios ou incompletos
 */
export async function preencherApelidosDocumentosExistentes(): Promise<number> {
  try {
    const supabase = getSupabaseClient();
    const { data: docs, error } = await supabase
      .from('documentos')
      .select('id, titulo, tipo, titular, arquivo, apelidos');

    if (error || !docs) {
      console.warn('[RoteadorBusca ⚠️] Falha ao consultar documentos para preenchimento de apelidos:', error);
      return 0;
    }

    let atualizados = 0;
    for (const d of docs) {
      const apelidosAtuais = Array.isArray(d.apelidos) ? d.apelidos : [];
      const sugeridos = gerarApelidosParaDocumento(d);
      const novos = Array.from(new Set([...apelidosAtuais, ...sugeridos]));

      if (novos.length > apelidosAtuais.length) {
        const { error: errUp } = await supabase
          .from('documentos')
          .update({ apelidos: novos })
          .eq('id', d.id);
        if (!errUp) {
          atualizados++;
        }
      }
    }

    if (atualizados > 0) {
      console.log(`[RoteadorBusca ✅] ${atualizados} documentos enriquecidos com apelidos padronizados.`);
    }
    return atualizados;
  } catch (err) {
    console.warn('[RoteadorBusca ⚠️] Erro ao sincronizar apelidos de documentos:', err);
    return 0;
  }
}

/**
 * Monta o catálogo compacto unificado (Cofre + Conhecimento + Entidades)
 */
export async function obterCatalogoCompacto(
  todosDocs?: DocumentoRegistro[],
  todosConhecimentos?: ItemConhecimento[],
  contato?: Contato
): Promise<{
  catalogo: ItemCatalogoCompacto[];
  entidades: EntidadeCanonica[];
}> {
  const docs = todosDocs && todosDocs.length > 0 ? todosDocs : await obterTodosDocumentos();
  const conhecimentos = todosConhecimentos && todosConhecimentos.length > 0 ? todosConhecimentos : await obterTodosConhecimentos();
  const titulares = await obterTodosTitulares();

  // 1. Mapeia entidades canônicas
  const entidadesMap = new Map<string, EntidadeCanonica>();

  // Adiciona empresas canônicas
  for (const emp of EMPRESAS_CANONICAS) {
    entidadesMap.set(emp.nomeOficial.toLowerCase(), emp);
  }

  // Adiciona titulares cadastrados do Supabase
  for (const t of titulares) {
    const nomeNorm = t.nome.toLowerCase();
    const ehEmpresa = EMPRESAS_CANONICAS.some((e) => e.nomeOficial.toLowerCase() === nomeNorm || e.id === t.id);
    const apelidosTit = Array.isArray(t.apelidos) ? t.apelidos : [];
    const primeiroNome = t.nome.split(/\s+/)[0]?.toLowerCase();

    const apelidosFinais = new Set<string>([nomeNorm, ...apelidosTit.map((a) => a.toLowerCase())]);
    if (primeiroNome && primeiroNome.length >= 3) {
      apelidosFinais.add(primeiroNome);
    }

    // Se for o contato falando, mapeia pronomes de posse
    if (contato?.nome && (contato.nome.toLowerCase().includes(primeiroNome) || t.nome.toLowerCase() === contato.nome.toLowerCase())) {
      apelidosFinais.add('meu');
      apelidosFinais.add('minha');
      apelidosFinais.add('meus');
      apelidosFinais.add('minhas');
    }

    if (!entidadesMap.has(nomeNorm)) {
      entidadesMap.set(nomeNorm, {
        id: t.id,
        nomeOficial: t.nome,
        tipo: ehEmpresa ? 'empresa' : 'pessoa',
        apelidos: Array.from(apelidosFinais),
      });
    } else {
      // Mescla apelidos
      const existente = entidadesMap.get(nomeNorm)!;
      existente.apelidos = Array.from(new Set([...existente.apelidos, ...apelidosFinais]));
    }
  }

  // 2. Mapeia itens do Cofre (Documentos) com ref compacta (d1, d2...)
  const itensCatalogo: (ItemCatalogoCompacto & { ref: string })[] = [];
  let contadorDoc = 1;

  for (const d of docs) {
    let pertenceA = d.titular ? d.titular.trim() : 'Delta Plan';
    if (pertenceA === 'null' || !pertenceA) pertenceA = 'Delta Plan';

    const apelidosDoc = gerarApelidosParaDocumento(d);
    if (Array.isArray(d.apelidos)) {
      d.apelidos.forEach((a) => {
        if (a) apelidosDoc.push(a.toLowerCase());
      });
    }

    itensCatalogo.push({
      ref: `d${contadorDoc++}`,
      id: d.id,
      origem: 'cofre',
      titulo: d.titulo,
      tipo: d.tipo || 'Documento',
      pertence_a: pertenceA,
      apelidos: Array.from(new Set(apelidosDoc)),
      resumo: d.descricao ? d.descricao.slice(0, 150) : undefined,
    });
  }

  // 3. Mapeia itens de Conhecimento com ref compacta (k1, k2...)
  let contadorK = 1;
  for (const k of conhecimentos) {
    let pertenceA = 'Delta Plan';
    const titLower = k.titulo.toLowerCase();

    if (titLower.includes('thomaz') || titLower.includes('thomas')) {
      pertenceA = 'Thomaz Lustri Fabre';
    } else if (titLower.includes('joão gabriel') || titLower.includes('joao gabriel')) {
      pertenceA = 'João Gabriel Brandini';
    } else if (titLower.includes('tl') || titLower.includes('t.l')) {
      pertenceA = 'T.L. Fabre Serviços';
    } else if (titLower.includes('engcom')) {
      pertenceA = 'ENGCOM & SERVICOS LTDA';
    }

    const apelidosK = [k.titulo.toLowerCase()];
    if (k.categoria) apelidosK.push(k.categoria.toLowerCase());
    if (k.tipo) apelidosK.push(k.tipo.toLowerCase());
    if (titLower.includes('escritório central') || titLower.includes('escritorio central')) {
      apelidosK.push('escritorio central', 'endereço delta', 'endereco delta plan', 'sede delta');
    }

    let resumoConteudo = k.conteudo;
    const dEst = k.dadosEstruturados as any;
    if (dEst?.endereco) {
      resumoConteudo = `Endereço: ${dEst.endereco} | Local: ${dEst.nomeLocal || k.titulo}`;
    }

    itensCatalogo.push({
      ref: `k${contadorK++}`,
      id: k.id,
      origem: 'conhecimento',
      titulo: k.titulo,
      tipo: k.tipo || k.categoria || 'Conhecimento',
      pertence_a: pertenceA,
      apelidos: Array.from(new Set(apelidosK)),
      resumo: resumoConteudo.slice(0, 200),
    });
  }

  return {
    catalogo: itensCatalogo,
    entidades: Array.from(entidadesMap.values()),
  };
}

/**
 * Chamada à IA (gpt-5.4-mini) para roteamento estrito e sem alucinação
 */
export async function executarRoteadorIa(params: {
  mensagemUsuario: string;
  historicoRecente: Mensagem[];
  contato: Contato;
  todosDocs?: DocumentoRegistro[];
  todosConhecimentos?: ItemConhecimento[];
  abortSignal?: AbortSignal;
}): Promise<DecisaoRoteador> {
  const { mensagemUsuario, historicoRecente, contato } = params;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente no .env');
  }

  const openai = new OpenAI({ apiKey });
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  const { catalogo, entidades } = await obterCatalogoCompacto(
    params.todosDocs,
    params.todosConhecimentos,
    contato
  );

  // Mapa para resolver ref (ex: "d1", "k2") para o ID real
  const mapaRefs = new Map<string, string>();
  for (const c of catalogo as (ItemCatalogoCompacto & { ref?: string })[]) {
    if (c.ref) mapaRefs.set(c.ref.toLowerCase(), c.id);
    mapaRefs.set(c.id.toLowerCase(), c.id);
  }

  // Formatação compacta do catálogo para o prompt
  const textoCatalogo = (catalogo as (ItemCatalogoCompacto & { ref?: string })[])
    .map(
      (c) =>
        `- [ref: ${c.ref || c.id}] Titulo: "${c.titulo}" | Tipo: "${c.tipo}" | Pertence a: "${c.pertence_a}" | Apelidos: [${c.apelidos.slice(0, 6).join(', ')}]${c.resumo ? ` | Resumo: ${c.resumo}` : ''}`
    )
    .join('\n');

  // Formatação das entidades
  const textoEntidades = entidades
    .map(
      (e) =>
        `- ${e.nomeOficial} (Tipo: ${e.tipo}) | Apelidos/Variações: [${e.apelidos.join(', ')}]`
    )
    .join('\n');

  // Histórico resumido das últimas 6 mensagens
  const ultimasMsgs = (historicoRecente || [])
    .slice(-6)
    .map((m) => `${m.remetente === 'cliente' ? 'Usuário' : 'VEGA'}: "${m.texto}"`)
    .join('\n');

  const promptSistema = `Você é o ROTEADOR CENTRAL DA VEGA (Delta Plan).
Sua missão é classificar a intenção da mensagem do usuário e escolher com máxima precisão os documentos ou itens de conhecimento que devem ser usados.

QUEM ESTÁ FALANDO (CONTATO ATUAL):
- Nome: "${contato.nome}"
- Quando o usuário disser "minha", "meu", "pra mim", "minhas", "meus", refira-se a esta pessoa: "${contato.nome}".

ENTIDADES CONHECIDAS (PESSOAS E EMPRESAS):
Empresas são entidades de primeira classe, iguais às pessoas!
${textoEntidades}

CATÁLOGO COMPACTO DISPONÍVEL (COFRE E CONHECIMENTO):
${textoCatalogo}

DIRETRIZES OBRIGATÓRIAS DE ROTEAMENTO:

1. INTENÇÃO:
   - "entregar_arquivo": quando o usuário pede explicitamente para enviar, mandar, baixar, ver, soltar ou solicita um arquivo/documento físico (ex.: "preciso da minha CNH", "manda minha carteira de motorista", "me manda a certidão", "manda o pdf", "solta esse arquivo").
   - "responder_dado": quando o usuário pergunta por uma informação específica, dado cadastral, endereço, CNPJ, telefone, chave PIX, localização ou resumo contido em documento ou conhecimento (ex.: "qual o endereço da TL?", "endereço da ENGCOM", "endereço do escritório central da Delta", "preciso dos dados pessoais do Thomaz para um cadastro", "qual o CPF dele?").
   - "conversa": quando for apenas cumprimento ("olá", "bom dia"), agradecimento, comentário ("ok", "valeu"), pergunta geral de catálogo ("o que tem no cofre?"), contagens ("quantos docs tem?") ou assuntos gerais.

2. ENTIDADE ALVO E TRAVA DE ENTIDADE (REGRA CRÍTICA):
   - Identifique rigorosamente a entidade alvo (ex.: "Thomaz Lustri Fabre", "T.L. Fabre Serviços", "ENGCOM & SERVICOS LTDA", "Delta Plan").
   - "TL" ou "T.L" = "T.L. Fabre Serviços".
   - "ENGCOM" ou "Engecon" = "ENGCOM & SERVICOS LTDA".
   - "Delta Plan" ou "Delta" ou "Escritório Central" = "Delta Plan".
   - TRAVA DE ENTIDADE: Se o usuário pedir dado da "TL", a entidade alvo É "T.L. Fabre Serviços". É TERMINANTEMENTE PROIBIDO escolher documentos ou dados da Delta Plan para a TL! Se não houver documento da TL, retorne documentos_escolhidos: [].

3. ESCOLHA DE DOCUMENTOS (USE A REF DO ITEM, ex: "d1", "k2"):
   - CNH: escolha o documento CNH (ref do CNH do titular). NUNCA escolha CTPS para CNH!
   - CTPS: escolha CTPS Carteira Digital.
   - DADOS PESSOAIS / DADOS DO TITULAR: Se o usuário pedir "dados pessoais do X" ou "dados do X para cadastro", escolha PRIORITARIAMENTE o documento de dados cadastrais/identificação pessoal (ex: "Documento de Identificação Pessoal"), NÃO escolha múltiplos documentos avulsos nem certidões.
   - ENDEREÇO DA EMPRESA:
     * Para Escritório Central da Delta Plan -> escolha o item de conhecimento correspondente ("Escritório Central Delta Plan").
     * Para ENGCOM -> escolha o documento do CNPJ da ENGCOM ("CNPJ ENGCOM").
     * Para TL -> escolha o documento do CNPJ da TL ("CNPJ T.L").

4. RESPOSTA ESTRITAMENTE EM JSON:
{
  "intencao": "entregar_arquivo" | "responder_dado" | "conversa",
  "entidade_alvo": string | null,
  "documentos_escolhidos": string[], // Use as REFs dos itens escolhidos (ex: ["d5"] ou ["k1"]) ou [] se não houver
  "justificativa": string // Frase curta explicando a decisão
}`;

  const promptUsuario = `HISTÓRICO RECENTE:
${ultimasMsgs || '(Início da conversa)'}

MENSAGEM ATUAL DO USUÁRIO:
"${mensagemUsuario}"`;

  try {
    const resposta = await chamarChatComTelemetria(
      openai,
      {
        model: chatModel,
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: promptUsuario },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        motivo: 'roteador_busca_central',
        contatoId: contato.id,
        contatoNome: contato.nome,
      },
      params.abortSignal ? { signal: params.abortSignal } : undefined
    );

    const conteudo = resposta.choices[0]?.message?.content?.trim();
    if (!conteudo) {
      return {
        intencao: 'conversa',
        entidade_alvo: null,
        documentos_escolhidos: [],
        justificativa: 'Resposta vazia da IA no roteamento.',
      };
    }

    const parsed = JSON.parse(conteudo);
    const intencao: IntencaoRoteador = ['entregar_arquivo', 'responder_dado', 'conversa'].includes(parsed.intencao)
      ? parsed.intencao
      : 'conversa';

    const docsEscolhidos: string[] = Array.isArray(parsed.documentos_escolhidos)
      ? parsed.documentos_escolhidos
          .map((refOuId: any) => {
            if (typeof refOuId !== 'string') return '';
            const limpo = refOuId.trim().toLowerCase();
            return mapaRefs.get(limpo) || refOuId.trim();
          })
          .filter((id: string) => id.length > 0)
      : [];

    return {
      intencao,
      entidade_alvo: parsed.entidade_alvo || null,
      documentos_escolhidos: docsEscolhidos,
      justificativa: parsed.justificativa || 'Classificação via Roteador IA.',
    };
  } catch (err: any) {
    if (params.abortSignal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.warn('[RoteadorBusca ⚠️] Falha ao executar roteador IA:', err);
    return {
      intencao: 'conversa',
      entidade_alvo: null,
      documentos_escolhidos: [],
      justificativa: `Fallback por erro técnico: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Busca Restrita (Etapa B):
 * Executa busca vetorial e textual EXCLUSIVAMENTE dentro dos documentos e da entidade escolhidos pelo Roteador.
 */
export async function executarBuscaRestrita(params: {
  consulta: string;
  documentosIds: string[];
  entidadeAlvo?: string | null;
  todosDocs: DocumentoRegistro[];
  todosConhecimentos?: ItemConhecimento[];
  matchCount?: number;
}): Promise<Array<{
  documento_id: string;
  titulo_documento: string;
  conteudo: string;
  similaridade: number;
  origem: 'vetorial' | 'palavra_chave' | 'conhecimento' | 'dados_cadastrais';
}>> {
  const { consulta, documentosIds, entidadeAlvo, todosDocs, matchCount = 5 } = params;
  const resultados: Array<{
    documento_id: string;
    titulo_documento: string;
    conteudo: string;
    similaridade: number;
    origem: 'vetorial' | 'palavra_chave' | 'conhecimento' | 'dados_cadastrais';
  }> = [];

  const supabase = getSupabaseClient();
  const idsValidos = new Set(documentosIds);

  // 1. Verifica itens da Base de Conhecimento selecionados
  if (params.todosConhecimentos && params.todosConhecimentos.length > 0) {
    for (const kId of documentosIds) {
      const itemK = params.todosConhecimentos.find((k) => k.id === kId);
      if (itemK) {
        resultados.push({
          documento_id: itemK.id,
          titulo_documento: itemK.titulo,
          conteudo: itemK.conteudo,
          similaridade: 1.0,
          origem: 'conhecimento',
        });
      }
    }
  }

  // 2. Busca nos documentos do Cofre selecionados
  if (idsValidos.size > 0) {
    // 2.1 Busca vetorial nos trechos desses documentos
    try {
      const embeddingPergunta = await gerarEmbedding(consulta);
      const { data: trechosData, error } = await supabase.rpc('buscar_trechos', {
        query_embedding: embeddingPergunta,
        p_pessoa_id: null,
        match_threshold: 0.25,
        match_count: matchCount * 2,
      });

      if (!error && Array.isArray(trechosData)) {
        for (const t of trechosData) {
          if (idsValidos.has(t.documento_id)) {
            resultados.push({
              documento_id: t.documento_id,
              titulo_documento: t.titulo_documento || 'Documento Oficial',
              conteudo: t.conteudo,
              similaridade: Number((t.similaridade || 0.8).toFixed(2)),
              origem: 'vetorial',
            });
          }
        }
      }
    } catch (errVet) {
      console.warn('[BuscaRestrita ⚠️] Falha na busca vetorial restrita:', errVet);
    }

    // 2.2 Se busca vetorial não trouxe nada, fallback para busca por palavra-chave nos trechos dos documentos escolhidos
    if (resultados.length === 0) {
      const { data: trechosTexto, error: errTexto } = await supabase
        .from('trechos')
        .select('id, documento_id, conteudo, pagina')
        .in('documento_id', Array.from(idsValidos));

      if (!errTexto && trechosTexto && trechosTexto.length > 0) {
        for (const tr of trechosTexto) {
          const docRef = todosDocs.find((d) => d.id === tr.documento_id);
          resultados.push({
            documento_id: tr.documento_id,
            titulo_documento: docRef?.titulo || 'Documento Oficial',
            conteudo: tr.conteudo,
            similaridade: 0.9,
            origem: 'palavra_chave',
          });
        }
      } else {
        // Fallback para título e descrição cadastrados no documento
        for (const idDoc of idsValidos) {
          const docRef = todosDocs.find((d) => d.id === idDoc);
          if (docRef && (docRef.descricao || docRef.titulo)) {
            resultados.push({
              documento_id: docRef.id,
              titulo_documento: docRef.titulo,
              conteudo: `${docRef.titulo}. ${docRef.descricao || ''}`,
              similaridade: 0.85,
              origem: 'palavra_chave',
            });
          }
        }
      }
    }
  }

  // 3. Fallback de entidade: se nenhum documento foi explicitado mas temos uma entidade alvo
  if (resultados.length === 0 && entidadeAlvo) {
    const docsDaEntidade = todosDocs.filter((d) => {
      const tit = (d.titular || '').toLowerCase();
      const entNorm = entidadeAlvo.toLowerCase();
      return tit === entNorm || tit.includes(entNorm) || entNorm.includes(tit);
    });

    if (docsDaEntidade.length > 0) {
      const idsEntidade = docsDaEntidade.map((d) => d.id);
      const { data: trechosEntidade } = await supabase
        .from('trechos')
        .select('id, documento_id, conteudo, pagina')
        .in('documento_id', idsEntidade);

      if (trechosEntidade && trechosEntidade.length > 0) {
        for (const tr of trechosEntidade.slice(0, 5)) {
          const docRef = docsDaEntidade.find((d) => d.id === tr.documento_id);
          resultados.push({
            documento_id: tr.documento_id,
            titulo_documento: docRef?.titulo || 'Documento da Entidade',
            conteudo: tr.conteudo,
            similaridade: 0.85,
            origem: 'palavra_chave',
          });
        }
      }
    }
  }

  return resultados;
}

/**
 * Sintetiza a resposta final a partir dos trechos restritos obtidos na Etapa B.
 * Garante:
 * - Citação obrigatória da fonte (nome do documento ou item).
 * - Trava de entidade estrita: jamais introduzir ou citar dados de outra entidade.
 * - Resposta em Português do Brasil, direta, clara e sem enrolação.
 * - Tratamento para dados pessoais (ficha completa) e endereços (legíveis e completos).
 */
export async function responderComTrechosRestritos(params: {
  perguntaUsuario: string;
  trechos: Array<{
    documento_id: string;
    titulo_documento: string;
    conteudo: string;
    similaridade: number;
    origem: string;
  }>;
  entidadeAlvo?: string | null;
  contato: Contato;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { perguntaUsuario, trechos, entidadeAlvo, contato } = params;
  if (!trechos || trechos.length === 0) {
    if (entidadeAlvo) {
      return `Não encontrei essa informação nos documentos de ${entidadeAlvo}.`;
    }
    return 'Não encontrei essa informação nos documentos do Cofre.';
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente no .env');
  }

  const openai = new OpenAI({ apiKey });
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-5.4-mini';

  // Monta o contexto apenas dos trechos restritos
  const contextoTrechos = trechos
    .map(
      (t, idx) =>
        `[Fonte ${idx + 1}: ${t.titulo_documento} (similaridade: ${t.similaridade}, origem: ${t.origem})]\n${t.conteudo}`
    )
    .join('\n\n---\n\n');

  const promptSistema = `Você é a VEGA, assistente de inteligência artificial da Delta Plan.
Sua missão é responder à pergunta do usuário utilizando ESTRITAMENTE as fontes fornecidas abaixo.

DIRETRIZES FUNDAMENTAIS:
1. IDIOMA: Português do Brasil.
2. TRAVA DE ENTIDADE (REGRA CRÍTICA):
   - A pergunta refere-se à entidade: "${entidadeAlvo || 'Entidade indicada'}".
   - É TERMINANTEMENTE PROIBIDO inventar dados, trazer dados de outras empresas ou pessoas, ou misturar informações de entidades diferentes.
3. CITAÇÃO DA FONTE:
   - Cite sempre o nome oficial do documento de origem de onde extraiu o dado (ex.: "Conforme o Cartão CNPJ da ENGCOM...", "De acordo com o Documento de Identificação Pessoal de Thomaz...").
4. RESPOSTA DIRETA E COMPLETA:
   - Se pedirem dados pessoais para cadastro de uma pessoa, estruture os dados cadastrais encontrados na fonte (Nome completo, CPF, RG, Órgão Emissor, Data de Nascimento, Filiação, Endereço, etc.) de forma clara e organizada.
   - Se pedirem endereço, informe o logradouro completo com número, complemento, bairro, cidade, estado e CEP exatamente como constam na fonte.
5. CONFLITO ENTRE FONTES:
   - Se houver fontes da MESMA entidade com dados divergentes (ex.: dois endereços em datas diferentes), informe o mais recente e mencione a existência da divergência.
6. DADO NÃO ENCONTRADO:
   - Se o dado específico solicitado NÃO constar nos trechos fornecidos, responda estritamente: "Não encontrei essa informação nos documentos de ${entidadeAlvo || 'entidade'}." Nunca tente adivinhar.`;

  const promptUsuario = `TRECHOS OBTIDOS EXCLUSIVAMENTE DOS DOCUMENTOS DA ENTIDADE:
${contextoTrechos}

PERGUNTA DO USUÁRIO (${contato.nome}):
"${perguntaUsuario}"`;

  try {
    const resposta = await chamarChatComTelemetria(
      openai,
      {
        model: chatModel,
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: promptUsuario },
        ],
        temperature: 0.1,
      },
      {
        motivo: 'resposta_trechos_restritos',
        contatoId: contato.id,
        contatoNome: contato.nome,
      },
      params.abortSignal ? { signal: params.abortSignal } : undefined
    );

    return (
      resposta.choices[0]?.message?.content?.trim() ||
      'Não consegui formular uma resposta a partir dos documentos.'
    );
  } catch (err: any) {
    if (params.abortSignal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.error('[RoteadorBusca ❌] Erro ao responder com trechos restritos:', err);
    return 'Ocorreu uma falha ao processar os trechos dos documentos.';
  }
}

/**
 * Rede Anti-Invenção para a Etapa B (Roteador - responder_dado):
 * Confere estritamente se todo CPF, CNPJ, RG, telefone, e-mail e CEP citado na resposta
 * existe nos trechos retornados na Etapa B (ou na pergunta do usuário).
 */
export function verificarSegurancaTrechosRestritos(params: {
  textoResposta: string;
  trechos: Array<{ conteudo: string; titulo_documento?: string }>;
  mensagemUsuario?: string;
}): { aprovado: boolean; motivo?: string; dadoSuspeito?: string } {
  const { textoResposta, trechos, mensagemUsuario } = params;

  const normalizar = (txt: string) =>
    (txt || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const corpusPartes: string[] = trechos.map((t) => t.conteudo);
  if (mensagemUsuario) {
    corpusPartes.push(mensagemUsuario);
  }
  const corpus = normalizar(corpusPartes.join(' '));
  const corpusDigitos = corpus.replace(/\D/g, '');

  // 1. CPF (11 dígitos formatados ou puros)
  const padraoCpf = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g;
  let matchCpf;
  while ((matchCpf = padraoCpf.exec(textoResposta)) !== null) {
    const cpf = matchCpf[1];
    const apenasDigitos = cpf.replace(/\D/g, '');
    if (apenasDigitos.length === 11) {
      if (!corpusDigitos.includes(apenasDigitos) && !corpus.includes(normalizar(cpf))) {
        return {
          aprovado: false,
          motivo: `CPF ${cpf} citado na resposta não constava nos trechos dos documentos da entidade.`,
          dadoSuspeito: cpf,
        };
      }
    }
  }

  // 2. CNPJ (14 dígitos formatados ou puros)
  const padraoCnpj = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/g;
  let matchCnpj;
  while ((matchCnpj = padraoCnpj.exec(textoResposta)) !== null) {
    const cnpj = matchCnpj[1];
    const apenasDigitos = cnpj.replace(/\D/g, '');
    if (apenasDigitos.length === 14) {
      if (!corpusDigitos.includes(apenasDigitos) && !corpus.includes(normalizar(cnpj))) {
        return {
          aprovado: false,
          motivo: `CNPJ ${cnpj} citado na resposta não constava nos trechos dos documentos da entidade.`,
          dadoSuspeito: cnpj,
        };
      }
    }
  }

  // 3. RG / Identidade (7 a 9 dígitos numéricos com pontuação padrão)
  const padraoRg = /\b(\d{1,2}\.?\d{3}\.?\d{3}-?[0-9xX])\b/g;
  let matchRg;
  while ((matchRg = padraoRg.exec(textoResposta)) !== null) {
    const rg = matchRg[1];
    const digitos = rg.replace(/\D/g, '');
    if (digitos.length >= 7 && digitos.length <= 9) {
      if (!corpusDigitos.includes(digitos) && !corpus.includes(normalizar(rg))) {
        return {
          aprovado: false,
          motivo: `RG ${rg} citado na resposta não constava nos trechos dos documentos da entidade.`,
          dadoSuspeito: rg,
        };
      }
    }
  }

  // 4. Telefone (10 ou 11 dígitos com DDD)
  const padraoTel = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*\d{4}|\d{4})[-.\s]?\d{4}\b/g;
  let matchTel;
  while ((matchTel = padraoTel.exec(textoResposta)) !== null) {
    const tel = matchTel[0].trim();
    const digitosTel = tel.replace(/\D/g, '');
    if (digitosTel.length >= 10 && digitosTel.length <= 13) {
      const digitosFinais = digitosTel.startsWith('55') ? digitosTel.slice(2) : digitosTel;
      if (!corpusDigitos.includes(digitosFinais) && !corpus.includes(normalizar(tel))) {
        return {
          aprovado: false,
          motivo: `Telefone ${tel} citado na resposta não constava nos trechos dos documentos da entidade.`,
          dadoSuspeito: tel,
        };
      }
    }
  }

  // 5. E-mail
  const padraoEmail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  let matchEmail;
  while ((matchEmail = padraoEmail.exec(textoResposta)) !== null) {
    const email = matchEmail[0].trim();
    if (!corpus.includes(normalizar(email))) {
      return {
        aprovado: false,
        motivo: `E-mail ${email} citado na resposta não constava nos trechos dos documentos da entidade.`,
        dadoSuspeito: email,
      };
    }
  }

  // 6. CEP (8 dígitos formatados: 12345-678 ou 12345678)
  const padraoCep = /\b\d{5}-?\d{3}\b/g;
  let matchCep;
  while ((matchCep = padraoCep.exec(textoResposta)) !== null) {
    const cep = matchCep[0];
    const digitosCep = cep.replace(/\D/g, '');
    if (digitosCep.length === 8) {
      if (!corpusDigitos.includes(digitosCep) && !corpus.includes(normalizar(cep))) {
        return {
          aprovado: false,
          motivo: `CEP ${cep} citado na resposta não constava nos trechos dos documentos da entidade.`,
          dadoSuspeito: cep,
        };
      }
    }
  }

  return { aprovado: true };
}

