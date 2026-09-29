import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { obterTodosTitulares, obterTodosConhecimentos, obterTodosDocumentos } from '../storage.js';

async function rodarDiagnostico() {
  console.log('================================================================');
  console.log('📊 DIAGNÓSTICO DETALHADO DE TOKENS DO CLASSIFICADOR DA VEGA');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error('OPENAI_API_KEY não configurada.');
    return;
  }
  const openai = new OpenAI({ apiKey });

  // 1. Consulta registros reais de telemetria no Supabase
  const { data: ultimosRegistros } = await supabase
    .from('uso_ia')
    .select('*')
    .eq('motivo', 'chat_classificador')
    .order('criado_em', { ascending: false })
    .limit(10);

  console.log('--- 1. TELEMETRIA REAL RECENTE NO SUPABASE (chat_classificador) ---');
  if (ultimosRegistros && ultimosRegistros.length > 0) {
    for (const r of ultimosRegistros.slice(0, 5)) {
      console.log(`- Data: ${r.criado_em} | Tokens Entrada: ${r.tokens_entrada} | Saída: ${r.tokens_saida} | Custo: $${r.custo_estimado}`);
    }
  } else {
    console.log('Nenhum registro de uso_ia encontrado para chat_classificador.');
  }
  console.log('\n');

  // 2. Coleta dados do banco para reconstruir o prompt
  const [titulares, conhecimentos, docs] = await Promise.all([
    obterTodosTitulares(),
    obterTodosConhecimentos(),
    obterTodosDocumentos(),
  ]);

  const nomesTitularesConhecidos = titulares.map((t) => t.nome).join(', ');
  const titulosConhecimento = conhecimentos.map((c) => `"${c.titulo}"`).join(', ');
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

  // Seções do Prompt
  const cabecalhoEContextoCofre = `Você é o classificador de intenções da VEGA, assistente corporativa da Delta Plan.
Titulares cadastrados: ${nomesTitularesConhecidos || 'Nenhum titular cadastrado'}.
Base de Conhecimento: ${titulosConhecimento || 'Nenhum item cadastrado'}.
Tipos de documentos no cofre: ${listaTiposDocs}.`;

  const schemaJson = `Retorne ESTRITAMENTE um objeto JSON com a seguinte estrutura:
{
  "intencao": "saudacao_ou_vago" | "pedir_arquivo" | "listar_documentos" | "dado_pessoal" | "pergunta_conteudo" | "corrigir_dado" | "consultar_vencimentos" | "silenciar_alerta" | "consultar_checklist_faltantes" | "apagar_documento" | "fora_de_escopo",
  "pessoa": "nome do titular ou pessoa citada na mensagem (ex: Fulano, Nilceia) ou vazio",
  "campos": ["lista de campos ou dados específicos solicitados (ex.: cpf, rg, filiacao, mae, pai, dataNascimento, endereco, estadoCivil, profissao, cnh, validadeCnh, categoriaCnh, orgaoEmissor, titulo_eleitor, pis, carteira_reservista, certidao_nascimento, passaporte ou qualquer outro campo/dado perguntado) ou vazio"],
  "campo_corrigir": "nome do campo a ser corrigido (ex: profissao, cpf, rg, etc.) ou vazio",
  "valor_novo": "novo valor correto informado pelo usuário ou vazio",
  "documento_citado": "nome do documento físico específico citado (NUNCA termos de repositório como 'cofre', 'arquivo', 'documento') ou vazio",
  "documentos_citados": ["lista de documentos físicos citados na mensagem atual (ex: ['CREA', 'Certidão de Casamento']) ou vazio"],
  "pergunta_completa": "versão clara e completa da pergunta sem perder nenhuma informação",
  "termo_busca": "versão curta para busca por nome de arquivo ou tópico"
}`;

  const regrasIntencoes = `REGRAS RÍGIDAS DE INTENÇÃO E ESCOPO:
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
   - Distinção PIS vs PIX: "PIS" é campo cadastral de pessoa ("dado_pessoal", campos: ["pis"]). "PIX" é corporativo ("pergunta_conteudo").
   - Sem titular citado: intencao: "dado_pessoal", pessoa: "", campos: [campo solicitado].
4. "pergunta_conteudo": Perguntas sobre texto de documento arquivado ou instruções/itens da Base de Conhecimento:
   - Base de Conhecimento: links de sistemas ("link do app"), contatos corporativos ("contato financeiro"), localização/rotas de obras e sedes ("como chegar na obra", "onde fica o escritório"), regras de negócio e chaves PIX ("qual o pix do Fulano/empresa").
   - Fatos jurídicos vs Nascimento: datas de eventos registrados em documentos (dispensa militar, registro de casamento, vacinas) são ESTRITAMENTE "pergunta_conteudo", NUNCA "dado_pessoal" e JAMAIS respondidas com nascimento.
   - Resumos (Regra 20): pedidos de resumo são SEMPRE "pergunta_conteudo". Se citar documento ("resuma a ART"), preencha "documento_citado" e "termo_busca". Se for anafórico ("resuma esse documento"), deixe-os vazios ("").
   - Vacinas/Covid: perguntas sobre vacinas do cofre são SEMPRE "pergunta_conteudo", NUNCA "fora_de_escopo".
5. "corrigir_dado": Informação cadastral de titular incorreta ou correção ("profissão do Fulano é X", "está errado, é 10/05/2030"). Preencha "campo_corrigir", "valor_novo" e "pessoa".
6. "consultar_vencimentos": Prazos de validade ou vencimento de documentos ("o que vence este mês?", "documentos vencidos"). Preencha "pessoa" se citada.
7. "silenciar_alerta": Desativar avisos de vencimento ("pare de alertar o CRT", "desative alertas da CNH"). Preencha "documento_citado" e "pessoa".
8. "consultar_checklist_faltantes": Documentos pendentes ou checklist ("o que falta do Fulano?", "quais faltam da empresa X?", "o que está faltando?"). Preencha "pessoa" se citada.
9. "apagar_documento": Excluir, descartar ou cancelar documento físico/foto salvo ou recente ("apaga o último documento", "apaga a foto", "cancela esse documento"). Preencha "documento_citado" e "pessoa" se citados.
10. "fora_de_escopo": Apenas assuntos totalmente alheios à empresa (culinária, futebol, piadas). Vacinas, documentos e dados corporativos NUNCA são fora de escopo.`;

  const regrasSujeitoContexto = `REGRAS CRÍTICAS DE SUJEITO E CONTEXTO:
- Nome citado prevalece: qualquer pessoa citada (cadastrada ou não, ex.: cônjuge como "Nilceia") prevalece sobre o histórico e define "pessoa".
- Reconhecimento da Empresa Delta Plan: "Delta", "Delta Plan", "empresa", "escritório", "sede", "obra", "almoxarifado" referem-se à organização corporativa -> intencao: "pergunta_conteudo", pessoa: "".
- O termo "Cofre" é repositório geral, NUNCA documento individual. Consultas sobre o cofre são SEMPRE "listar_documentos", documento_citado: "".
- Uso do contexto: herdar titular do histórico APENAS quando a mensagem atual não contiver sujeito e usar pronomes ("ele", "dele") ou perguntas elípticas ("e a validade?", "e o CPF dele?").`;

  const listaExemplos = [
    `- "o que tem no cofre?" -> {"intencao": "listar_documentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Listar documentos disponíveis no cofre", "termo_busca": ""}`,
    `- "quais documentos do fulano você tem?" -> {"intencao": "listar_documentos", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Listar documentos do Fulano", "termo_busca": "Fulano"}`,
    `- "me mande o endereço do escritório da Delta Plan" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o endereço do escritório da Delta Plan?", "termo_busca": "Escritorio Deltaplan"}`,
    `- "resuma a art de serviços menegazzo" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "ART de serviços menegazzo", "documentos_citados": ["ART de serviços menegazzo"], "pergunta_completa": "Resumir a ART de serviços menegazzo", "termo_busca": "ART de serviços menegazzo"}`,
    `- "resuma esse documento" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Resumir o documento do contexto", "termo_busca": ""}`,
    `- "quando fui dispensado do serviço militar?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "dispensa militar", "documentos_citados": [], "pergunta_completa": "Quando ocorreu a dispensa do serviço militar?", "termo_busca": "dispensa servico militar"}`,
    `- "qual a data de registro de casamento do Thomaz?" -> {"intencao": "pergunta_conteudo", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "certidão de casamento", "documentos_citados": [], "pergunta_completa": "Qual é a data de registro de casamento do Thomaz?", "termo_busca": "registro casamento Thomaz"}`,
    `- "qual o pix do João Gabriel" -> {"intencao": "pergunta_conteudo", "pessoa": "João Gabriel", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é a chave PIX do João Gabriel?", "termo_busca": "pix João Gabriel"}`,
    `- "me manda a chave pix" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é a chave PIX?", "termo_busca": "chave pix"}`,
    `- "qual o link do sistema de máquinas?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o link do App de Portfólio das Máquinas?", "termo_busca": "App de Portfólio das Máquinas"}`,
    `- "qual o contato do financeiro?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o contato do departamento financeiro?", "termo_busca": "financeiro"}`,
    `- "como chegar na obra residencial solar?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Como chegar na obra residencial solar?", "termo_busca": "obra residencial solar"}`,
    `- "o que tem em Regra de Negócio: Proposta Comercial" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o conteúdo do documento ou instrução Regra de Negócio: Proposta Comercial?", "termo_busca": "Proposta Comercial"}`,
    `- "quais dias eu tomei as vacinas da covid?" -> {"intencao": "pergunta_conteudo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quais dias foram tomadas as vacinas da covid?", "termo_busca": "vacina covid"}`,
    `- "me mande o título de eleitor do thomaz" -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["titulo_eleitor"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o título de eleitor do Thomaz?", "termo_busca": "titulo eleitor Thomaz"}`,
    `- "me passa o PIS do thomaz" -> {"intencao": "dado_pessoal", "pessoa": "Thomaz", "campos": ["pis"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o PIS do Thomaz?", "termo_busca": "pis Thomaz"}`,
    `- "qual cpf?" -> {"intencao": "dado_pessoal", "pessoa": "", "campos": ["cpf"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o CPF?", "termo_busca": "cpf"}`,
    `- "qual o nome da mãe da Nilceia?" -> {"intencao": "dado_pessoal", "pessoa": "Nilceia", "campos": ["filiacao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quem é a mãe da Nilceia?", "termo_busca": "filiacao Nilceia"}`,
    `- "e o RG dele?" (após falar de um titular) -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["rg"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Qual é o RG do Fulano?", "termo_busca": "Fulano"}`,
    `- "me envie esses documentos do fulano: endereço, estado civil e profissão" -> {"intencao": "dado_pessoal", "pessoa": "Fulano", "campos": ["endereco", "estadoCivil", "profissao"], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Quais são o endereço, estado civil e profissão do Fulano?", "termo_busca": "Fulano"}`,
    `- "show, agora me envie o pdf" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Enviar documento do contexto", "termo_busca": ""}`,
    `- "contrato de locação" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "contrato de locação", "documentos_citados": ["contrato de locação"], "pergunta_completa": "Enviar documento contrato de locação", "termo_busca": "contrato de locação"}`,
    `- "me envia o crea e a certidão de casamento do fulano" -> {"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CREA, Certidão de Casamento", "documentos_citados": ["CREA", "Certidão de Casamento"], "pergunta_completa": "Enviar documentos CREA e Certidão de Casamento do Fulano", "termo_busca": "CREA, Certidão de Casamento"}`,
    `- "sim" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Confirmar envio do documento oferecido", "termo_busca": ""}`,
    `- "o primeiro" -> {"intencao": "pedir_arquivo", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Escolher primeira opção de documento oferecido", "termo_busca": ""}`,
    `- "qual é a CNH do fulano" -> {"intencao": "pedir_arquivo", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH", "documentos_citados": ["CNH"], "pergunta_completa": "Enviar documento CNH do Fulano", "termo_busca": "CNH Fulano"}`,
    `- "desative os alertas da CNH do Thomaz" -> {"intencao": "silenciar_alerta", "pessoa": "Thomaz", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "CNH", "documentos_citados": ["CNH"], "pergunta_completa": "Desativar alertas de vencimento da CNH do Thomaz", "termo_busca": "CNH"}`,
    `- "o que vence este mês?" -> {"intencao": "consultar_vencimentos", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos que vencem este mês", "termo_busca": ""}`,
    `- "a profissão do fulano está errada, é Técnico em Eletrotécnica" -> {"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "profissao", "valor_novo": "Técnico em Eletrotécnica", "campos": ["profissao"], "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Corrigir profissão do Fulano para Técnico em Eletrotécnica", "termo_busca": ""}`,
    `- "está errado, é 10/05/2030" (após VEGA responder validade) -> {"intencao": "corrigir_dado", "pessoa": "Fulano", "campo_corrigir": "validadeCnh", "valor_novo": "10/05/2030", "campos": ["validadeCnh"], "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Corrigir validade da CNH do Fulano para 10/05/2030", "termo_busca": ""}`,
    `- "o que falta do fulano?" -> {"intencao": "consultar_checklist_faltantes", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes do Fulano", "termo_busca": ""}`,
    `- "quais documentos faltam da empresa X?" -> {"intencao": "consultar_checklist_faltantes", "pessoa": "Empresa X", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes da Empresa X", "termo_busca": ""}`,
    `- "o que está faltando?" -> {"intencao": "consultar_checklist_faltantes", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Consultar documentos faltantes", "termo_busca": ""}`,
    `- "apaga o último documento que mandei" -> {"intencao": "apagar_documento", "pessoa": "", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "", "documentos_citados": [], "pergunta_completa": "Apagar o último documento enviado", "termo_busca": ""}`,
    `- "apaga a certidão de casamento do fulano" -> {"intencao": "apagar_documento", "pessoa": "Fulano", "campos": [], "campo_corrigir": "", "valor_novo": "", "documento_citado": "certidão de casamento", "documentos_citados": ["certidão de casamento"], "pergunta_completa": "Apagar certidão de casamento do Fulano", "termo_busca": "certidão de casamento Fulano"}`,
  ];

  const todosExemplosTexto = `EXEMPLOS OBRIGATÓRIOS:\n` + listaExemplos.join('\n');

  // Função para medir tokens chamando a API OpenAI com max_tokens 1 e lendo usage.prompt_tokens
  // Para medir seções isoladas, enviamos uma mensagem dummy e medimos exatamente
  async function medirTokensTexto(texto: string, label: string): Promise<number> {
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'system', content: texto }],
        max_completion_tokens: 50,
      });
      return resp.usage?.prompt_tokens || 0;
    } catch (err: any) {
      console.warn(`Falha ao medir tokens para ${label}:`, err?.message);
      return Math.round(texto.length / 3.8);
    }
  }

  console.log('Medindo tokens de cada seção com a API oficial do gpt-5.4-mini...');

  const tokensCabecalho = await medirTokensTexto(cabecalhoEContextoCofre, 'Cabecalho e Cofre');
  const tokensSchema = await medirTokensTexto(schemaJson, 'Schema JSON');
  const tokensRegras = await medirTokensTexto(regrasIntencoes, 'Regras das 10 Intenções');
  const tokensSujeito = await medirTokensTexto(regrasSujeitoContexto, 'Regras Sujeito e Contexto');
  const tokensExemplos = await medirTokensTexto(todosExemplosTexto, 'Exemplos');

  const systemPromptCompleto = `${cabecalhoEContextoCofre}\n\n${schemaJson}\n\n${regrasIntencoes}\n\n${regrasSujeitoContexto}\n\n${todosExemplosTexto}`;
  const tokensSystemTotal = await medirTokensTexto(systemPromptCompleto, 'System Prompt Completo');

  console.log('--- 2. DETALHAMENTO DE TOKENS POR SEÇÃO ---');
  console.log(`- Seção 1: Contexto do Cofre (Titulares, Conhecimento, Tipos): ${tokensCabecalho} tokens (${((tokensCabecalho / tokensSystemTotal) * 100).toFixed(1)}%)`);
  console.log(`- Seção 2: Schema JSON (Estrutura de saída): ${tokensSchema} tokens (${((tokensSchema / tokensSystemTotal) * 100).toFixed(1)}%)`);
  console.log(`- Seção 3: Regras das 10 Intenções e Escopo: ${tokensRegras} tokens (${((tokensRegras / tokensSystemTotal) * 100).toFixed(1)}%)`);
  console.log(`- Seção 4: Regras Críticas de Sujeito e Contexto: ${tokensSujeito} tokens (${((tokensSujeito / tokensSystemTotal) * 100).toFixed(1)}%)`);
  console.log(`- Seção 5: Os 47 Exemplos Obrigatórios: ${tokensExemplos} tokens (${((tokensExemplos / tokensSystemTotal) * 100).toFixed(1)}%)`);
  console.log(`TOTAL DO SYSTEM PROMPT: ${tokensSystemTotal} tokens (100%)\n`);

  console.log(`Total de exemplos na lista: ${listaExemplos.length}`);
  console.log(`Média de tokens por exemplo: ${(tokensExemplos / listaExemplos.length).toFixed(1)} tokens/exemplo\n`);
}

rodarDiagnostico().catch(console.error);
