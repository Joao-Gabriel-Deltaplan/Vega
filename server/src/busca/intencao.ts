import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { CampoTitularId } from '../types.js';
import { obterNomesTitularesCadastrados } from '../storage.js';
import {
  identificarCamposPedidos,
  isPedidoGenericoDeDados,
  identificarDetalheCampoPedido,
} from './motorTitulares.js';

export type TipoIntencao =
  | 'saudacao_social'
  | 'pedido_documento'
  | 'consulta_conhecimento'
  | 'consulta_dados_titular_generica'
  | 'consulta_dados_titular_campos'
  | 'outros';

export interface ResultadoIntencao {
  tipo: TipoIntencao;
  subtipo?: 'cumprimento' | 'agradecimento' | 'despedida';
  respostaTemplate?: string;
  textoLimpo?: string;
  titularIdentificado?: string;
  camposIdentificados?: CampoTitularId[];
  detalheCampoPedido?: string;
}

/**
 * Remove acentos de uma string para facilitar comparações
 */
function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Termos de campos, preposições e palavras comuns que NUNCA devem ser tratadas como nome de titular
 */
const PALAVRAS_IGNORADAS_TITULAR = new Set([
  'delta', 'documento', 'documentos', 'arquivo', 'arquivos', 'empresa', 'minha', 'meu', 'contrato',
  'pai', 'mae', 'mãe', 'pais', 'filiacao', 'filiação',
  'rg', 'cpf', 'cnh', 'endereco', 'endereço', 'residencia', 'residência',
  'profissao', 'profissão', 'cargo', 'funcao', 'função', 'ocupacao', 'ocupação',
  'nascimento', 'data', 'aniversario', 'aniversário', 'idade',
  'estado', 'civil', 'casamento', 'nome', 'sobrenome', 'titular',
  'certidao', 'certidão', 'ctps', 'carteira', 'trabalho',
  'comprovante', 'segunda', 'via', 'copia', 'cópia', 'foto',
  'informacao', 'informação', 'informacoes', 'informações', 'dados', 'ficha',
  'qual', 'quem', 'onde', 'como', 'quando', 'quanto', 'quantos',
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'pra', 'pro',
  'sobre', 'com', 'dele', 'dela', 'deles', 'delas'
]);

/**
 * Extrai nome de titular mencionado na mensagem (ex: "do Thomaz", "da Maria", etc.)
 * Evita rigorosamente capturar termos de campos como "pai", "mãe", "rg", etc.
 */
export function extrairNomeTitularDaMensagem(texto: string): string | null {
  if (!texto) return null;

  // 1. Procura primeiro por correspondência com titulares cadastrados no sistema (carregados dinamicamente)
  const titularesCadastrados = obterNomesTitularesCadastrados();
  for (const titularNome of titularesCadastrados) {
    // Testa o nome completo (ex: "Thomaz Lustri Fabre")
    const regexCompleto = new RegExp(`\\b${titularNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regexCompleto.test(texto)) {
      return titularNome;
    }

    // Testa o primeiro nome (ex: "Thomaz" para "Thomaz Lustri Fabre")
    const primeiroNome = extrairPrimeiroNome(titularNome);
    if (primeiroNome && primeiroNome.length > 2 && !PALAVRAS_IGNORADAS_TITULAR.has(primeiroNome.toLowerCase())) {
      const regexPrimeiro = new RegExp(`\\b${primeiroNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regexPrimeiro.test(texto)) {
        return primeiroNome;
      }
    }
  }

  // 2. Procura por menções com preposição (ex: "do João", "da Maria Silva")
  const regexPreposicoes = /\b(?:do|da|de|sobre o|sobre a|pro|para o|para a)\s+([A-ZÀ-Úa-zà-ú]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regexPreposicoes.exec(texto)) !== null) {
    const palavra1 = match[1];
    const palavra1Norm = palavra1.toLowerCase();

    // Se a primeira palavra for termo de campo ou stopword (ex: "do pai", "do rg", "da certidão"), ignora
    if (PALAVRAS_IGNORADAS_TITULAR.has(palavra1Norm)) {
      continue;
    }

    // Verifica se a palavra seguinte no texto é um sobrenome ou segundo nome (não sendo preposição ou stopword)
    const resto = texto.slice(match.index + match[0].length).trimStart();
    const matchSobrenome = resto.match(/^([A-ZÀ-Úa-zà-ú]+)\b/);
    if (matchSobrenome) {
      const p2 = matchSobrenome[1];
      if (!PALAVRAS_IGNORADAS_TITULAR.has(p2.toLowerCase())) {
        return `${palavra1} ${p2}`;
      }
    }

    return palavra1;
  }

  return null;
}

/**
 * Classifica a intenção de uma mensagem antes de acionar a busca ou a IA
 */
export function classificarIntencao(textoUsuario: string, nomeContato?: string): ResultadoIntencao {
  const texto = (textoUsuario || '').trim();
  const primeiroNome = extrairPrimeiroNome(nomeContato);
  const vocativo = primeiroNome ? `, ${primeiroNome}` : '';

  const normalizado = removerAcentos(texto.toLowerCase())
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. VERIFICAÇÃO DE CONSULTA A DADOS DO TITULAR (Ficha de dados estruturados)
  const titularAlvo = extrairNomeTitularDaMensagem(texto);
  const camposPedidos = identificarCamposPedidos(normalizado);
  const ehPedidoGenerico = isPedidoGenericoDeDados(normalizado);
  const detalheCampo = identificarDetalheCampoPedido(normalizado);

  if (titularAlvo) {
    if (ehPedidoGenerico) {
      return {
        tipo: 'consulta_dados_titular_generica',
        titularIdentificado: titularAlvo,
        textoLimpo: texto,
      };
    }

    // Se pediu documento sem campo específico (ex: "qual é a CNH do Thomaz", "a CNH do Thomaz", "CNH do Thomaz")
    const ehDocSemCampoEspecifico =
      /\b(cnh|crea|crt|certidao|certidão|cartao vacinas|cartão vacinas)\b/i.test(normalizado) &&
      !/\b(numero|número|validade|vencimento|categoria|data|emissao|emissão|expedicao|expedição)\b/i.test(normalizado);

    if (ehDocSemCampoEspecifico) {
      return {
        tipo: 'pedido_documento',
        textoLimpo: texto,
      };
    }

    if (camposPedidos.length > 0) {
      // Se não pediu expressamente "arquivo", "anexo" ou "pdf"
      const pedeArquivoFisico = /\b(pdf|arquivo|anexo|foto|scanner|copia|2 via|segunda via|via original)\b/i.test(normalizado);
      if (!pedeArquivoFisico) {
        return {
          tipo: 'consulta_dados_titular_campos',
          titularIdentificado: titularAlvo,
          camposIdentificados: camposPedidos,
          detalheCampoPedido: detalheCampo,
          textoLimpo: texto,
        };
      }
    }
  }

  // 2. Sinais explícitos de consulta a CONHECIMENTO / REGRAS / POLÍTICAS
  const regexSinaisConhecimento =
    /\b(o que temos sobre|o que voce tem de|o que voce sabe sobre|o que voce sabe de|qual a politica|como funciona|qual o prazo|pode me explicar|quais as regras|qual a regra|regras de|politica de|seguranca de dados|duvidas frequentes|duvida sobre|saber sobre|sabe sobre|fala sobre|fale sobre|explica|me explica|sobre a delta|sobre a empresa|informacoes sobre|informacao sobre)\b/i;

  const regexTermosExclusivosConhecimento =
    /\b(lgpd|compliance|proposta comercial|orcamentos|politica de agendamento|reunioes de diagnostico)\b/i;

  // 3. Sinais de pedido de DOCUMENTO (cofre de arquivos)
  const regexVerbosDocumento =
    /\b(manda|mandar|mande|envia|enviar|envie|preciso|quero|cade|localiza|localizar|busca|buscar|pegar|obter|passa|passar|compartilha|compartilhar|anexo|arquivo fisico)\b/i;

  const regexTermosDocumento =
    /\b(cnh|cpf|rg|ctps|crt|art|dre|balanco|alvara|certidao|cnd|comprovante|holerite|contracheque|contrato|estatuto|procuracao|regimento|codigo de conduta|documento|documentos|arquivo|arquivos|pdf)\b/i;

  const temSinalConhecimento =
    regexSinaisConhecimento.test(normalizado) || regexTermosExclusivosConhecimento.test(normalizado);
  const temVerboDoc = regexVerbosDocumento.test(normalizado);
  const temTermoDoc = regexTermosDocumento.test(normalizado);

  // Se o usuário pedir expressamente envio de documento de algo (ex: "me manda o PDF da LGPD")
  const pedeArquivoExplicito =
    /\b(manda|envia|baixa|pdf|arquivo|copia|segunda via)\b/i.test(normalizado) &&
    (temTermoDoc || /\b(lgpd|politica|termo)\b/i.test(normalizado));

  if (pedeArquivoExplicito && temTermoDoc) {
    const textoLimpo = texto
      .replace(/^(bom dia|boa tarde|boa noite|olá|ola|oi|e aí|e ai|opa|fala)[,!\.\s-]*/i, '')
      .trim();
    return {
      tipo: 'pedido_documento',
      textoLimpo: textoLimpo.length > 0 ? textoLimpo : texto,
    };
  }

  // Se tem sinal claro de conhecimento ou termos da base institucional
  if (temSinalConhecimento) {
    const textoLimpo = texto
      .replace(/^(bom dia|boa tarde|boa noite|olá|ola|oi|e aí|e ai|opa|fala)[,!\.\s-]*/i, '')
      .trim();
    return {
      tipo: 'consulta_conhecimento',
      textoLimpo: textoLimpo.length > 0 ? textoLimpo : texto,
    };
  }

  // Se tem sinal de pedido de documento
  if (temVerboDoc || temTermoDoc) {
    const textoLimpo = texto
      .replace(/^(bom dia|boa tarde|boa noite|olá|ola|oi|e aí|e ai|opa|fala)[,!\.\s-]*/i, '')
      .trim();
    return {
      tipo: 'pedido_documento',
      textoLimpo: textoLimpo.length > 0 ? textoLimpo : texto,
    };
  }

  // 3. Agradecimentos
  const regexAgradecimento =
    /\b(obrigado|obrigada|valeu|agradeco|grato|grata|muito obrigado|muito obrigada|valeu demais)\b/i;

  if (regexAgradecimento.test(normalizado)) {
    return {
      tipo: 'saudacao_social',
      subtipo: 'agradecimento',
      respostaTemplate: `À disposição${vocativo}! Se precisar de mais algum documento ou informação interna, é só avisar.`,
    };
  }

  // 4. Despedidas
  const regexDespedida =
    /\b(tchau|ate mais|ate logo|ate breve|falou|abracos|abraco|boa noite descanso|ate amanha)\b/i;

  if (regexDespedida.test(normalizado)) {
    return {
      tipo: 'saudacao_social',
      subtipo: 'despedida',
      respostaTemplate: `Até mais${vocativo}! Qualquer coisa, estou por aqui.`,
    };
  }

  // 5. Cumprimentos e Saudações Sociais puras
  const saudacoesPuras = [
    'bom dia',
    'boa tarde',
    'boa noite',
    'ola',
    'oi',
    'e ai',
    'tudo bem',
    'como vai',
    'opa',
    'fala',
    'salve',
    'tudo bom',
    'tudo certo',
    'como estao as coisas',
    'como voce esta',
  ];

  const palavras = normalizado.split(' ').filter(Boolean);
  const ehSaudacao =
    saudacoesPuras.some((s) => normalizado === s) ||
    saudacoesPuras.some((s) => normalizado.startsWith(s + ' ') && palavras.length <= 6) ||
    (palavras.length <= 4 &&
      palavras.every((p) =>
        ['bom', 'dia', 'boa', 'tarde', 'noite', 'oi', 'ola', 'tudo', 'bem', 'como', 'vai', 'e', 'ai', 'opa', 'blz', 'beleza'].includes(p)
      ));

  if (ehSaudacao) {
    const hora = new Date().getHours();
    let saudacaoHora = 'Olá';
    if (hora >= 5 && hora < 12) {
      saudacaoHora = 'Bom dia';
    } else if (hora >= 12 && hora < 18) {
      saudacaoHora = 'Boa tarde';
    } else {
      saudacaoHora = 'Boa noite';
    }

    return {
      tipo: 'saudacao_social',
      subtipo: 'cumprimento',
      respostaTemplate: `${saudacaoHora}${vocativo}. Precisa de algum documento ou informação interna?`,
    };
  }

  // 6. Outros (perguntas gerais, recusas fora de escopo, etc.)
  return {
    tipo: 'outros',
    textoLimpo: texto,
  };
}
