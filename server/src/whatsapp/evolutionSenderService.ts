import { Anexo } from '../types.js';
import { obterBufferArquivo, gerarSignedUrlArquivo } from '../utils/storageUtils.js';

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
  metodoEnvio?: 'base64' | 'signed_url';
}

/**
 * Limite seguro de tamanho para envio direto em Base64 no corpo JSON (1.5 MB).
 * Acima de 1.5 MB, o Base64 atinge >2 MB de texto JSON, causando estouro de pilha
 * ("Maximum call stack size exceeded") na Evolution API / Baileys.
 * Arquivos acima deste limite são enviados automaticamente via Signed URL temporária do Supabase.
 */
export const LIMITE_BASE64_BYTES = 1.5 * 1024 * 1024; // 1.5 MB

/**
 * Obtém a configuração da Evolution API a partir das variáveis de ambiente.
 * Aceita EVOLUTION_API_KEY ou AUTHENTICATION_API_KEY como fallback.
 * Normaliza a URL removendo barras finais.
 */
export function obterConfigEvolution(): EvolutionConfig | null {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = (process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY)?.trim();
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
 * Envia um arquivo (PDF / Documento) via Evolution API.
 * Suporta tanto Buffer (convertido de forma segura para base64) quanto Signed URL (string iniciada em http/https).
 * Endpoint: POST {EVOLUTION_API_URL}/message/sendMedia/{EVOLUTION_INSTANCE}
 */
export async function enviarMediaEvolution(
  destinatario: string,
  mediaConteudo: Buffer | string,
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
    const nomeLimpo = nomeArquivo.trim();
    let mediaParam: string;
    let metodo: 'base64' | 'signed_url';

    if (typeof mediaConteudo === 'string' && (mediaConteudo.startsWith('http://') || mediaConteudo.startsWith('https://'))) {
      mediaParam = mediaConteudo.trim();
      metodo = 'signed_url';
    } else {
      // Uso seguro de Buffer.from(buffer).toString('base64') sem spreads ou loops manuais
      const buffer = Buffer.isBuffer(mediaConteudo) ? mediaConteudo : Buffer.from(mediaConteudo);
      mediaParam = buffer.toString('base64');
      metodo = 'base64';
    }

    const body = {
      number: numeroNormalizado,
      mediatype: 'document',
      mimetype: mimeType,
      caption: legenda || nomeLimpo,
      media: mediaParam,
      fileName: nomeLimpo,
    };

    console.log(
      `[Evolution API 📎] Iniciando envio do documento "${nomeLimpo}" para ${numeroNormalizado} via [${metodo}]...`
    );

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
        `[Evolution API 📎] Documento "${nomeLimpo}" enviado com sucesso para ${numeroNormalizado} via [${metodo}] | Status: ${response.status}`
      );
      return {
        sucesso: true,
        statusHttp: response.status,
        resposta: dadosJson,
        metodoEnvio: metodo,
      };
    } else {
      const dataHora = new Date().toLocaleString('pt-BR');
      const motivo = typeof dadosJson === 'object' ? JSON.stringify(dadosJson) : String(dadosJson);
      console.error(
        `\n❌ [Evolution API FALHA NO ENVIO DE ARQUIVO] ${dataHora}\n` +
          `- Documento: ${nomeLimpo}\n` +
          `- Destinatário: ${numeroNormalizado} (Original: ${destinatario})\n` +
          `- Método utilizado: ${metodo}\n` +
          `- Status HTTP: ${response.status} ${response.statusText}\n` +
          `- URL: ${url}\n` +
          `- Motivo retornado pela Evolution: ${motivo}\n`
      );
      return {
        sucesso: false,
        statusHttp: response.status,
        motivoFalha: motivo,
        resposta: dadosJson,
        metodoEnvio: metodo,
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
 * 2. Se houver anexos (documentos PDF):
 *    - Se tamanho <= 1.5 MB: tenta via Base64; com fallback para Signed URL caso a Evolution falhe.
 *    - Se tamanho > 1.5 MB: envia diretamente via Signed URL do Supabase Storage (evita estouro de pilha).
 * 3. Se o envio de qualquer documento falhar após todas as tentativas:
 *    - A VEGA avisa imediatamente no WhatsApp qual documento não foi enviado, não ficando em silêncio.
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
      const legenda = anexo.titulo || anexo.nome || nomeDoc;
      let envioSucesso = false;

      try {
        // Pausa de 800ms entre texto e anexo para garantir a ordem visual no WhatsApp
        await new Promise((resolve) => setTimeout(resolve, 800));

        // 1. Obtém buffer do arquivo para checar tamanho real
        const arquivo = await obterBufferArquivo(nomeDoc);
        const tamanhoBytes = arquivo?.buffer ? arquivo.buffer.length : 0;
        const contentType = arquivo?.contentType || 'application/pdf';

        console.log(
          `[Evolution API 📄] Processando anexo "${nomeDoc}" | Tamanho: ${(tamanhoBytes / 1024).toFixed(1)} KB`
        );

        // DECISÃO DE ESTRATÉGIA BASEADA NO TAMANHO:
        if (tamanhoBytes > LIMITE_BASE64_BYTES) {
          // Arquivo GRANDE (> 1.5 MB): usa prioritariamente Signed URL para evitar "Maximum call stack size exceeded"
          console.log(
            `[Evolution API 🚀] Arquivo "${nomeDoc}" tem ${(tamanhoBytes / (1024 * 1024)).toFixed(2)} MB (> 1.5 MB). Gerando Signed URL...`
          );
          const signedUrl = await gerarSignedUrlArquivo(nomeDoc, 3600);

          if (signedUrl) {
            const resUrl = await enviarMediaEvolution(destinatario, signedUrl, nomeDoc, legenda, contentType);
            if (resUrl.sucesso) {
              envioSucesso = true;
            } else {
              console.warn(
                `[Evolution API ⚠️] Envio por Signed URL falhou para "${nomeDoc}". Tentando fallback por buffer...`
              );
              if (arquivo?.buffer) {
                const resFallback = await enviarMediaEvolution(destinatario, arquivo.buffer, nomeDoc, legenda, contentType);
                envioSucesso = resFallback.sucesso;
              }
            }
          } else if (arquivo?.buffer) {
            // Se não gerou Signed URL (ex: fallback local), tenta o buffer
            const resBuffer = await enviarMediaEvolution(destinatario, arquivo.buffer, nomeDoc, legenda, contentType);
            envioSucesso = resBuffer.sucesso;
          }
        } else if (arquivo?.buffer) {
          // Arquivo PEQUENO (<= 1.5 MB): envia por Base64 diretamente
          const resBase64 = await enviarMediaEvolution(destinatario, arquivo.buffer, nomeDoc, legenda, contentType);
          if (resBase64.sucesso) {
            envioSucesso = true;
          } else {
            console.warn(
              `[Evolution API ⚠️] Envio por Base64 falhou para "${nomeDoc}". Tentando fallback por Signed URL...`
            );
            const signedUrl = await gerarSignedUrlArquivo(nomeDoc, 3600);
            if (signedUrl) {
              const resFallbackUrl = await enviarMediaEvolution(destinatario, signedUrl, nomeDoc, legenda, contentType);
              envioSucesso = resFallbackUrl.sucesso;
            }
          }
        } else {
          // Arquivo sem buffer local: tenta gerar Signed URL direto do Supabase
          const signedUrl = await gerarSignedUrlArquivo(nomeDoc, 3600);
          if (signedUrl) {
            const resUrl = await enviarMediaEvolution(destinatario, signedUrl, nomeDoc, legenda, contentType);
            envioSucesso = resUrl.sucesso;
          }
        }
      } catch (errAnexo: any) {
        console.error(
          `[Evolution API ❌] Exceção no fluxo de envio do anexo "${nomeDoc}":`,
          errAnexo?.message || errAnexo
        );
      }

      // EXIGÊNCIA 4: Se o envio do documento falhar, avisa no WhatsApp em vez de ficar em silêncio
      if (!envioSucesso) {
        const config = obterConfigEvolution();
        // Só avisa no WhatsApp se a Evolution API estiver configurada (não poluir em simulação pura local)
        if (config) {
          console.warn(
            `[Evolution API 📢] Documento "${nomeDoc}" falhou no envio. Notificando remetente no WhatsApp...`
          );
          const avisoFalha = `⚠️ Não foi possível entregar o documento "${legenda}" pelo WhatsApp devido a uma limitação no envio de arquivos da operadora. Você também pode visualizá-lo diretamente pelo painel da VEGA.`;
          await enviarTextoEvolution(destinatario, avisoFalha);
        }
      }
    }
  }
}
