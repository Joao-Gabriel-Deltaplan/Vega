import OpenAI from 'openai';
import { TipoConhecimento, DadosPix, DadosLink, DadosContato } from './types.js';

export interface ItemEstruturadoProposto {
  tipo: TipoConhecimento;
  titulo: string;
  categoria: string;
  conteudo: string;
  dadosEstruturados?: DadosPix | DadosLink | DadosContato | Record<string, any>;
}

export interface ResultadoEstruturacaoConhecimento {
  sucesso: boolean;
  itens: ItemEstruturadoProposto[];
  mensagem?: string;
}

/**
 * Utiliza gpt-5.4-mini para interpretar texto em linguagem natural ou colagem de planilhas/tabelas
 * e transformar em itens estruturados (PIX, Links de sistemas, Contatos ou Regras de negócio).
 */
export async function estruturarConhecimentoComIA(
  textoEntrada: string
): Promise<ResultadoEstruturacaoConhecimento> {
  if (!textoEntrada || !textoEntrada.trim()) {
    return {
      sucesso: false,
      itens: [],
      mensagem: 'Nenhum texto informado para estruturação.',
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      sucesso: false,
      itens: [],
      mensagem: 'Chave OPENAI_API_KEY não configurada no servidor.',
    };
  }

  const openai = new OpenAI({ apiKey });

  const promptSistema = `Você é o orquestrador de conhecimento corporativo da VEGA (Assistente de Inteligência Artificial da Delta Plan).
Sua missão é ler a entrada do usuário (que pode ser uma frase em linguagem natural, uma descrição de procedimento ou dados colados de uma planilha Excel) e transformá-la em um ou mais itens estruturados de conhecimento.

Classifique cada informação em um destes 4 tipos:
1. "pix": Chaves PIX corporativas ou pessoais.
   - dadosEstruturados: { "titular": string, "tipoChave": "CNPJ"|"CPF"|"Celular"|"E-mail"|"Aleatória", "chave": string, "banco"?: string }
   - titulo sugerido: "Chave PIX [Titular] ([Tipo])"
   - categoria: "Financeiro"
   - conteudo: texto legível formatado (ex: "Chave PIX: 12.345.678/0001-90 (CNPJ) | Banco: Santander | Titular: Delta Plan")

2. "link": Links de sistemas, ferramentas, portais ou dashboards corporativos.
   - dadosEstruturados: { "nomeSistema": string, "link": string, "finalidade"?: string }
   - titulo sugerido: "Sistema [Nome]" ou "[Nome do Sistema]"
   - categoria: "Sistemas"
   - conteudo: texto legível formatado

3. "contato": Contatos telefônicos, e-mails de colaboradores, setores, clientes ou parceiros.
   - dadosEstruturados: { "nome": string, "funcao"?: string, "telefone"?: string, "email"?: string }
   - titulo sugerido: "Contato [Nome] ([Função])"
   - categoria: "Contatos"
   - conteudo: texto legível formatado

4. "regra": Procedimentos, políticas internas, regras de negócio, prazos, orçamentos ou textos livres.
   - dadosEstruturados: {}
   - titulo sugerido: Título claro e objetivo do tópico/procedimento
   - categoria: "Geral", "Comercial", "Operações", "Atendimento" ou "Segurança"
   - conteudo: O texto detalhado da instrução ou regra

REGRAS IMPORTANTES:
- Se o usuário colar uma tabela com múltiplas linhas (com separadores de tabulação \\t ou quebras de linha), gere um item para CADA linha/registro da tabela.
- NUNCA invente dados que o usuário não forneceu. Se o banco do PIX não foi informado, deixe em branco.
- Responda OBRIGATORIAMENTE em JSON válido com a estrutura:
{
  "itens": [
    {
      "tipo": "pix" | "link" | "contato" | "regra",
      "titulo": string,
      "categoria": string,
      "conteudo": string,
      "dadosEstruturados": object
    }
  ]
}`;

  try {
    const resposta = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: textoEntrada.trim() },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const conteudoJson = resposta.choices[0]?.message?.content;
    if (!conteudoJson) {
      return {
        sucesso: false,
        itens: [],
        mensagem: 'Não foi possível obter resposta da inteligência artificial.',
      };
    }

    const parsed = JSON.parse(conteudoJson);
    const listaItens: ItemEstruturadoProposto[] = Array.isArray(parsed.itens)
      ? parsed.itens
      : parsed.item
      ? [parsed.item]
      : [];

    // Higienização e validação dos itens
    const itensValidados: ItemEstruturadoProposto[] = listaItens.map((it: any) => {
      const tipo: TipoConhecimento = ['pix', 'link', 'contato', 'regra'].includes(it.tipo)
        ? it.tipo
        : 'regra';

      const titulo = (it.titulo || 'Nova Instrução').trim();
      const categoria = (it.categoria || 'Geral').trim();
      const conteudo = (it.conteudo || '').trim();
      const dadosEstruturados = it.dadosEstruturados || {};

      return {
        tipo,
        titulo,
        categoria,
        conteudo,
        dadosEstruturados,
      };
    });

    if (itensValidados.length === 0) {
      // Fallback caso a IA não tenha gerado itens
      itensValidados.push({
        tipo: 'regra',
        titulo: 'Instrução VEGA',
        categoria: 'Geral',
        conteudo: textoEntrada.trim(),
        dadosEstruturados: {},
      });
    }

    return {
      sucesso: true,
      itens: itensValidados,
    };
  } catch (erro: any) {
    console.error('[Estruturador Conhecimento IA ⚠️] Erro ao estruturar:', erro);
    return {
      sucesso: false,
      itens: [],
      mensagem: erro?.message || 'Erro ao processar texto com a IA.',
    };
  }
}
