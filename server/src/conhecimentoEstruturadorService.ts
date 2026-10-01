import OpenAI from 'openai';
import { chamarChatComTelemetria } from './ai/telemetriaIaService.js';
import { TipoConhecimento, DadosPix, DadosLink, DadosContato, DadosLocal } from './types.js';
import { gerarLinksNavegacao } from './utils/geoLinks.js';

export interface ItemEstruturadoProposto {
  tipo: TipoConhecimento;
  titulo: string;
  categoria: string;
  conteudo: string;
  dadosEstruturados?: DadosPix | DadosLink | DadosContato | DadosLocal | Record<string, any>;
}

export interface ResultadoEstruturacaoConhecimento {
  sucesso: boolean;
  itens: ItemEstruturadoProposto[];
  mensagem?: string;
}

/**
 * Utiliza gpt-5.4-mini para interpretar texto em linguagem natural ou colagem de planilhas/tabelas
 * e transformar em itens estruturados (PIX, Links de sistemas, Contatos, Localização ou Regras de negócio).
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

Classifique cada informação em um destes 5 tipos:
1. "pix": Chaves PIX corporativas ou pessoais.
   - dadosEstruturados: { "titular": string, "tipoChave": "CNPJ"|"CPF"|"Celular"|"E-mail"|"Aleatória", "chave": string, "banco"?: string }
   - titulo sugerido: "Chave PIX [Titular] ([Tipo])"
   - categoria: "Financeiro"
   - conteudo: texto legível formatado (ex: "Chave PIX: 12.345.678/0001-90 (CNPJ) | Banco: Santander | Titular: Delta Plan")

2. "link": Links de sistemas, ferramentas, portais, dashboards ou sites corporativos.
   - dadosEstruturados: { "nomeSistema": string, "link": string, "finalidade"?: string }
   - titulo sugerido: Apenas o nome limpo do sistema, portal ou site (ex: "Sienge", "Portal Delta", "Jira", "Receita Federal", "DocuSign"). NUNCA prefixe com a palavra "Sistema" ou "Link".
   - categoria: "Sistemas"
   - conteudo: texto legível formatado

3. "contato": Contatos telefônicos, e-mails de colaboradores, setores, clientes ou parceiros.
   - dadosEstruturados: { "nome": string, "funcao"?: string, "telefone"?: string, "email"?: string }
   - titulo sugerido: "Contato [Nome] ([Função])"
   - categoria: "Contatos"
   - conteudo: texto legível formatado

4. "local": Localizações, endereços de obras, escritórios, sedes, filiais, almoxarifados, depósitos ou pontos de apoio.
   - dadosEstruturados: { "nomeLocal": string, "endereco": string, "pontoReferencia"?: string, "cidade"?: string, "linkMaps"?: string, "linkWaze"?: string }
   - titulo sugerido: "[Nome do Local]" (ex: "Escritório Deltaplan", "Obra Residencial Solar", "Depósito de Materiais")
   - categoria: "Localização" ou "Obras"
   - conteudo: texto legível formatado (ex: "Local: Escritório Deltaplan | Endereço: Rua Ricardo Rios, 610 | Cidade: Pirajuí - SP")
   - DIRETRIZES CRÍTICAS PARA "local":
     * 'nomeLocal': apenas o nome do lugar, empresa ou obra (ex: "Escritório Deltaplan").
     * 'endereco': estritamente o logradouro/rua, número e bairro (ex: "Rua Ricardo Rios, 610"). NUNCA coloque o nome da empresa ou local dentro do campo 'endereco'.
     * 'cidade': cidade e UF (ex: "Pirajuí - SP").
     * 'linkMaps' e 'linkWaze': NUNCA invente links de mapas. Deixe vazio caso o usuário não tenha colado um link explícito.

5. "regra": Procedimentos, políticas internas, regras de negócio, prazos, orçamentos ou textos livres.
   - dadosEstruturados: {}
   - titulo sugerido: Título claro e objetivo do tópico/procedimento
   - categoria: "Geral", "Comercial", "Operações", "Atendimento" ou "Segurança"
   - conteudo: O texto detalhado da instrução ou regra

REGRAS IMPORTANTES:
- Se o usuário colar uma tabela com múltiplas linhas (com separadores de tabulação \\t ou quebras de linha), gere um item para CADA linha/registro da tabela.
- NUNCA invente dados que o usuário não forneceu. Se o link do maps não foi informado, deixe em branco.
- Responda OBRIGATORIAMENTE em JSON válido com a estrutura:
{
  "itens": [
    {
      "tipo": "pix" | "link" | "contato" | "local" | "regra",
      "titulo": string,
      "categoria": string,
      "conteudo": string,
      "dadosEstruturados": object
    }
  ]
}`;

  try {
    const resposta = await chamarChatComTelemetria(
      openai,
      {
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: textoEntrada.trim() },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      },
      { motivo: 'conhecimento_estruturacao' }
    );

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
      const tipo: TipoConhecimento = ['pix', 'link', 'contato', 'local', 'regra'].includes(it.tipo)
        ? it.tipo
        : 'regra';

      const titulo = (it.titulo || 'Nova Instrução').trim();
      const categoria = (it.categoria || (tipo === 'local' ? 'Localização' : 'Geral')).trim();
      let conteudo = (it.conteudo || '').trim();
      const dadosEstruturados = it.dadosEstruturados || {};

      if (tipo === 'local') {
        const dLocal = dadosEstruturados as DadosLocal;
        const nomeLocal = (dLocal.nomeLocal || titulo).trim();
        const endereco = (dLocal.endereco || '').trim();
        const cidade = (dLocal.cidade || '').trim();

        // Geração limpa e padronizada de links de navegação baseada ESTRITAMENTE na rua/cidade
        if (endereco) {
          const linksNav = gerarLinksNavegacao(endereco, cidade);
          // Se não havia link explicitamente colado pelo usuário (ou se era busca antiga com nome do local), usa o link estrito da rua
          if (!dLocal.linkMaps || dLocal.linkMaps.includes('google.com/maps/search/')) {
            dLocal.linkMaps = linksNav.linkMaps;
          }
          if (!dLocal.linkWaze || dLocal.linkWaze.includes('waze.com/ul')) {
            dLocal.linkWaze = linksNav.linkWaze;
          }
        }

        const partes = [`Local: ${nomeLocal}`];
        if (endereco) partes.push(`Endereço: ${endereco}`);
        if (cidade) partes.push(`Cidade: ${cidade}`);
        if (dLocal.pontoReferencia) partes.push(`Como Chegar / Ponto de Referência: ${dLocal.pontoReferencia}`);
        if (dLocal.linkMaps) partes.push(`Google Maps: ${dLocal.linkMaps}`);
        if (dLocal.linkWaze) partes.push(`Waze: ${dLocal.linkWaze}`);
        conteudo = partes.join(' | ');
      }

      if (tipo === 'link') {
        const dLink = dadosEstruturados as DadosLink;
        let nomeLimpo = (dLink.nomeSistema || titulo || '').trim();
        // Remove prefixos redundantes como "Sistema ", "Sistema: ", "Link ", "Link: "
        nomeLimpo = nomeLimpo.replace(/^(sistema|link)(\s*:\s*|\s+)/i, '').trim();
        dLink.nomeSistema = nomeLimpo || 'Sistema';

        let tituloLimpo = titulo.replace(/^(sistema|link)(\s*:\s*|\s+)/i, '').trim();
        if (!tituloLimpo || tituloLimpo.toLowerCase() === 'sistema') {
          tituloLimpo = dLink.nomeSistema;
        }

        const partes: string[] = [];
        if (dLink.nomeSistema) partes.push(`Sistema: ${dLink.nomeSistema}`);
        if (dLink.link) partes.push(`Link: ${dLink.link}`);
        if (dLink.finalidade) partes.push(`Finalidade: ${dLink.finalidade}`);
        conteudo = partes.join(' | ');

        return {
          tipo,
          titulo: tituloLimpo,
          categoria: categoria || 'Sistemas',
          conteudo,
          dadosEstruturados: dLink,
        };
      }

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
