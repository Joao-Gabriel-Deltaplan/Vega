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
 * Extrai nome de titular mencionado na mensagem (ex: "do Thomaz", "da Maria", etc.).
 * REGRA RIGOROSA: Uma palavra só é considerada titular se casar com um titular cadastrado
 * no Supabase (nome completo, primeiro nome ou apelido). NUNCA extrair palavras por posição na frase.
 */
export function extrairNomeTitularDaMensagem(texto: string): string | null {
  if (!texto) return null;

  // 1. Procura estritamente por correspondência com titulares cadastrados no sistema
  const titularesCadastrados = obterNomesTitularesCadastrados();
  const titulares = Array.from(
    new Set([
      ...titularesCadastrados,
      'Thomaz Lustri Fabre',
      'Thomaz',
      'RENG ENGENHARIA',
      'Delta Plan',
      'Delta',
    ])
  ).filter(Boolean);

  const textoNorm = removerAcentos(texto.toLowerCase());

  // Ordena por comprimento decrescente para priorizar nomes completos antes de primeiros nomes
  const ordenados = [...titulares].sort((a, b) => b.length - a.length);

  for (const titularNome of ordenados) {
    const nomeNorm = removerAcentos(titularNome.toLowerCase());
    if (!nomeNorm || nomeNorm.length < 2) continue;
    if (PALAVRAS_IGNORADAS_TITULAR.has(nomeNorm)) continue;

    const regex = new RegExp(`\\b${nomeNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(textoNorm)) {
      return titularNome;
    }
  }

  // NUNCA extrair qualquer palavra após preposição por posição na frase!
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
