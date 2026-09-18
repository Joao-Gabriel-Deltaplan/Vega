import { Anexo } from '../types.js';
import { obterBufferArquivo } from '../utils/storageUtils.js';

export interface EvolutionConfig {
  apiUrl: string;
  apiKey: string;
  instance: string;
}

export interface ResultadoEnvioEvolution {
  sucesso: boolean;
  statusHttp?: number;
  resposta?: any;
  motivoFalha?: string;
}

/**
 * Obtém a configuração da Evolution API a partir das variáveis de ambiente.
 * Normaliza a URL removendo barras finais.
 */
export function obterConfigEvolution(): EvolutionConfig | null {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_INSTANCE?.trim();

  if (!apiUrl || !apiKey || !instance) {
    return null;
  }

  return { apiUrl, apiKey, instance };
}

/**
 * Normaliza o identificador do destinatário para o formato esperado pela Evolution API.
 * - Se terminar em @lid, mantém o JID @lid para responder na mesma conversa do WhatsApp.
 * - Se for grupo (@g.us), mantém o JID do grupo.
 * - Se for número de telefone (com @s.whatsapp.net, formatação com traços, etc), extrai apenas os dígitos numéricos com DDI (ex: 5514996863115).
 */
export function normalizarDestinatarioEvolution(destinatarioRaw: string): string {
  if (!destinatarioRaw) return '';

  const limpo = destinatarioRaw.trim();

  // Preserva identificadores especiais (@lid e @g.us)
  if (limpo.endsWith('@lid') || limpo.endsWith('@g.us')) {
    return limpo;
  }

  // Se tiver sufixo @s.whatsapp.net ou prefixo de dispositivo :1, remove
  const semSufixo = limpo.split('@')[0].split(':')[0];
  // Mantém apenas dígitos (DDI + DDD + Número)
  return semSufixo.replace(/\D/g, '');
}

/**
 * Envia uma mensagem de texto simples via Evolution API.
 * Endpoint: POST {EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE}
 */
export async function enviarTextoEvolution(
  destinatario: string,
  texto: string
): Promise<ResultadoEnvioEvolution> {
  const config = obterConfigEvolution();

  const numeroNormalizado = normalizarDestinatarioEvolution(destinatario);

  if (!config) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.warn(
      `[Evolution API ⚠️ (Modo Simulação)] ${dataHora} | Variáveis EVOLUTION_API_URL, EVOLUTION_API_KEY ou EVOLUTION_INSTANCE não configuradas. Texto não enviado para "${numeroNormalizado}": "${texto.slice(0, 80)}..."`
    );
    return {
      sucesso: false,
      motivoFalha: 'Variaveis de ambiente da Evolution API nao configuradas',
    };
  }

  const url = `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`;

  try {
    const body = {
      number: numeroNormalizado,
      text: texto,
      delay: 1200,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: JSON.stringify(body),
    });

    const textoResposta = await response.text();
    let dadosJson: any = null;
    try {
      dadosJson = JSON.parse(textoResposta);
    } catch {
      dadosJson = textoResposta;
    }

    if (response.ok) {
      console.log(
        `[Evolution API 📤] Texto enviado com sucesso para ${numeroNormalizado} | Status: ${response.status}`
      );
      return {
        sucesso: true,
        statusHttp: response.status,
        resposta: dadosJson,
      };
    } else {
      const dataHora = new Date().toLocaleString('pt-BR');
      const motivo = typeof dadosJson === 'object' ? JSON.stringify(dadosJson) : String(dadosJson);
      console.error(
        `\n❌ [Evolution API FALHA NO ENVIO DE TEXTO] ${dataHora}\n` +
          `- Destinatário: ${numeroNormalizado} (Original: ${destinatario})\n` +
          `- Status HTTP: ${response.status} ${response.statusText}\n` +
          `- URL: ${url}\n` +
          `- Motivo retornado pela Evolution: ${motivo}\n`
      );
      return {
        sucesso: false,
        statusHttp: response.status,
        motivoFalha: motivo,
        resposta: dadosJson,
      };
    }
  } catch (erro: any) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.error(
      `\n❌ [Evolution API ERRO DE CONEXÃO/REDE] ${dataHora}\n` +
        `- Destinatário: ${numeroNormalizado}\n` +
        `- Mensagem de erro: ${erro?.message || erro}\n`
    );
    return {
      sucesso: false,
      motivoFalha: erro?.message || String(erro),
    };
  }
}

/**
 * Envia um arquivo (PDF / Documento) via Evolution API com base64 vindo do Supabase Storage.
 * Endpoint: POST {EVOLUTION_API_URL}/message/sendMedia/{EVOLUTION_INSTANCE}
 */
export async function enviarMediaEvolution(
  destinatario: string,
  buffer: Buffer,
  nomeArquivo: string,
  legenda?: string,
  mimeType: string = 'application/pdf'
): Promise<ResultadoEnvioEvolution> {
  const config = obterConfigEvolution();
  const numeroNormalizado = normalizarDestinatarioEvolution(destinatario);

  if (!config) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.warn(
      `[Evolution API ⚠️ (Modo Simulação)] ${dataHora} | Variáveis EVOLUTION_API_* não configuradas. Documento "${nomeArquivo}" não enviado para "${numeroNormalizado}".`
    );
    return {
      sucesso: false,
      motivoFalha: 'Variaveis de ambiente da Evolution API nao configuradas',
    };
  }

  const url = `${config.apiUrl}/message/sendMedia/${encodeURIComponent(config.instance)}`;

  try {
    const base64Limpo = buffer.toString('base64');
    const nomeLimpo = nomeArquivo.trim();

    const body = {
      number: numeroNormalizado,
      mediatype: 'document',
      mimetype: mimeType,
      caption: legenda || nomeLimpo,
      media: base64Limpo,
      fileName: nomeLimpo,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: JSON.stringify(body),
    });

    const textoResposta = await response.text();
    let dadosJson: any = null;
    try {
      dadosJson = JSON.parse(textoResposta);
    } catch {
      dadosJson = textoResposta;
    }

    if (response.ok) {
      console.log(
        `[Evolution API 📎] Documento "${nomeLimpo}" enviado com sucesso para ${numeroNormalizado} | Status: ${response.status}`
      );
      return {
        sucesso: true,
        statusHttp: response.status,
        resposta: dadosJson,
      };
    } else {
      const dataHora = new Date().toLocaleString('pt-BR');
      const motivo = typeof dadosJson === 'object' ? JSON.stringify(dadosJson) : String(dadosJson);
      console.error(
        `\n❌ [Evolution API FALHA NO ENVIO DE ARQUIVO] ${dataHora}\n` +
          `- Documento: ${nomeLimpo}\n` +
          `- Destinatário: ${numeroNormalizado} (Original: ${destinatario})\n` +
          `- Status HTTP: ${response.status} ${response.statusText}\n` +
          `- URL: ${url}\n` +
          `- Motivo retornado pela Evolution: ${motivo}\n`
      );
      return {
        sucesso: false,
        statusHttp: response.status,
        motivoFalha: motivo,
        resposta: dadosJson,
      };
    }
  } catch (erro: any) {
    const dataHora = new Date().toLocaleString('pt-BR');
    console.error(
      `\n❌ [Evolution API ERRO DE CONEXÃO/REDE AO ENVIAR MÍDIA] ${dataHora}\n` +
        `- Documento: ${nomeArquivo}\n` +
        `- Destinatário: ${numeroNormalizado}\n` +
        `- Mensagem de erro: ${erro?.message || erro}\n`
    );
    return {
      sucesso: false,
      motivoFalha: erro?.message || String(erro),
    };
  }
}

/**
 * Orquestra o envio completo da resposta gerada pela VEGA para o WhatsApp via Evolution API.
 * 
 * Regra de entrega:
 * 1. Envia a resposta de texto primeiro.
 * 2. Se houver anexos (ex: PDFs gerados ou do Cofre), busca os buffers no Supabase Storage
 *    e envia cada documento em seguida, com um pequeno delay ordenado.
 */
export async function enviarRespostaCompletaWhatsApp(
  destinatario: string,
  textoResposta: string,
  anexos?: Anexo[]
): Promise<void> {
  if (!destinatario) {
    console.warn('[Evolution API ⚠️] Destinatário não informado para envio.');
    return;
  }

  // 1. Envio do texto da mensagem
  if (textoResposta && textoResposta.trim().length > 0) {
    await enviarTextoEvolution(destinatario, textoResposta.trim());
  }

  // 2. Envio de anexos (documentos PDF)
  if (anexos && Array.isArray(anexos) && anexos.length > 0) {
    for (const anexo of anexos) {
      const nomeDoc = anexo.nome || 'documento.pdf';
      try {
        // Pausa de 800ms entre texto e anexo para garantir a ordem visual no WhatsApp
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Busca o buffer do PDF no Supabase Storage
        const arquivo = await obterBufferArquivo(nomeDoc);

        if (arquivo && arquivo.buffer) {
          const legenda = anexo.titulo || anexo.nome;
          await enviarMediaEvolution(
            destinatario,
            arquivo.buffer,
            nomeDoc,
            legenda,
            arquivo.contentType || 'application/pdf'
          );
        } else {
          console.error(
            `[Evolution API ⚠️] Não foi possível obter o arquivo "${nomeDoc}" no Supabase Storage para envio.`
          );
        }
      } catch (errAnexo: any) {
        console.error(
          `[Evolution API ❌] Falha no fluxo de envio do anexo "${nomeDoc}":`,
          errAnexo?.message || errAnexo
        );
      }
    }
  }
}
