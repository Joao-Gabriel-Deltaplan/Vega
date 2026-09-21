import { getSupabaseClient } from '../db/supabaseClient.js';

export const BUCKET_AUDIOS = 'audios';

let bucketAudiosVerificado = false;

/**
 * Assegura que o bucket 'audios' existe como PRIVADO no Supabase Storage
 */
export async function assegurarBucketAudios(): Promise<void> {
  if (bucketAudiosVerificado) return;

  try {
    const supabase = getSupabaseClient();
    const { data: bucket, error } = await supabase.storage.getBucket(BUCKET_AUDIOS);

    if (error || !bucket) {
      console.log(`[Storage Áudio 📁] Criando bucket privado "${BUCKET_AUDIOS}" no Supabase Storage...`);
      const { error: errCreate } = await supabase.storage.createBucket(BUCKET_AUDIOS, {
        public: false, // ESTRITAMENTE PRIVADO
        fileSizeLimit: '25MB',
      });

      if (errCreate) {
        // Se já existir (race condition), ignora
        if (!errCreate.message?.includes('already exists')) {
          console.warn(`[Storage Áudio ⚠️] Aviso ao criar bucket "${BUCKET_AUDIOS}":`, errCreate.message);
        }
      } else {
        console.log(`[Storage Áudio 🟢] Bucket privado "${BUCKET_AUDIOS}" criado com sucesso.`);
      }
    }

    bucketAudiosVerificado = true;
  } catch (err) {
    console.warn('[Storage Áudio ⚠️] Falha ao verificar bucket de áudios:', err);
  }
}

/**
 * Mapeia mimetype de áudio para extensão apropriada
 */
function obterExtensaoDeMimetype(mimetype: string): string {
  const m = mimetype.toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'ogg';
}

/**
 * Salva o buffer de áudio original no Supabase Storage em bucket privado.
 * Retorna o caminho relativo da chave gravada.
 */
export async function salvarAudioOriginalStorage(
  buffer: Buffer,
  mimetype: string,
  numeroCanonica: string,
  mensagemId: string
): Promise<string | null> {
  await assegurarBucketAudios();

  try {
    const supabase = getSupabaseClient();
    const ext = obterExtensaoDeMimetype(mimetype);
    const timestampMs = Date.now();
    const nomeSeguro = mensagemId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const chave = `wa-${numeroCanonica}/${timestampMs}_${nomeSeguro}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET_AUDIOS)
      .upload(chave, buffer, {
        contentType: mimetype,
        upsert: true,
      });

    if (error) {
      console.error(`[Storage Áudio ❌] Erro ao salvar áudio "${chave}":`, error.message);
      return null;
    }

    console.log(`[Storage Áudio 🎙️] Áudio original gravado no Storage: "${chave}" (${(buffer.length / 1024).toFixed(1)} KB)`);
    return chave;
  } catch (err: any) {
    console.error('[Storage Áudio ❌] Falha inesperada ao enviar áudio para o Storage:', err?.message || err);
    return null;
  }
}

/**
 * Obtém o buffer e contentType de um áudio gravado no bucket privado
 */
export async function obterAudioOriginalStorage(chave: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const supabase = getSupabaseClient();
    const chaveLimpa = chave.replace(/^\/+/, '');

    const { data, error } = await supabase.storage
      .from(BUCKET_AUDIOS)
      .download(chaveLimpa);

    if (error || !data) {
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Infere content type
    let contentType = data.type;
    if (!contentType || contentType === 'application/octet-stream') {
      if (chaveLimpa.endsWith('.ogg')) contentType = 'audio/ogg; codecs=opus';
      else if (chaveLimpa.endsWith('.mp3')) contentType = 'audio/mpeg';
      else if (chaveLimpa.endsWith('.m4a')) contentType = 'audio/mp4';
      else if (chaveLimpa.endsWith('.wav')) contentType = 'audio/wav';
      else contentType = 'audio/ogg';
    }

    return { buffer, contentType };
  } catch (err: any) {
    console.warn(`[Storage Áudio ⚠️] Erro ao buscar áudio "${chave}":`, err?.message || err);
    return null;
  }
}

/**
 * Rotina de limpeza: apaga do Supabase Storage os áudios criados há mais de 30 dias.
 * Mantém o registro da transcrição no histórico do Supabase.
 */
export async function limparAudiosExpirados(diasRetencao = 30): Promise<number> {
  await assegurarBucketAudios();

  try {
    const supabase = getSupabaseClient();
    const agora = Date.now();
    const limiteMs = diasRetencao * 24 * 60 * 60 * 1000;
    let totalApagados = 0;

    // 1. Lista as pastas do bucket (cada pasta corresponde a um contato, ex: wa-5514996863115)
    const { data: pastas, error: errPastas } = await supabase.storage
      .from(BUCKET_AUDIOS)
      .list('', { limit: 100 });

    if (errPastas || !pastas) {
      return 0;
    }

    for (const pasta of pastas) {
      if (pasta.id === null) {
        // É uma pasta/prefixo
        const prefixo = pasta.name;
        const { data: arquivos, error: errArq } = await supabase.storage
          .from(BUCKET_AUDIOS)
          .list(prefixo, { limit: 1000 });

        if (!errArq && arquivos) {
          const chavesParaRemover: string[] = [];

          for (const arq of arquivos) {
            const dataCriacao = arq.created_at ? new Date(arq.created_at).getTime() : 0;
            // Se o arquivo tiver mais de 30 dias ou seu nome tiver timestamp de mais de 30 dias
            let timestampArquivo = dataCriacao;
            const matchTimestamp = arq.name.match(/^(\d{13})_/);
            if (matchTimestamp) {
              timestampArquivo = parseInt(matchTimestamp[1], 10);
            }

            if (timestampArquivo > 0 && agora - timestampArquivo > limiteMs) {
              chavesParaRemover.push(`${prefixo}/${arq.name}`);
            }
          }

          if (chavesParaRemover.length > 0) {
            const { error: errDel } = await supabase.storage
              .from(BUCKET_AUDIOS)
              .remove(chavesParaRemover);

            if (!errDel) {
              totalApagados += chavesParaRemover.length;
              console.log(
                `[Storage Áudio 🧹] Removidos ${chavesParaRemover.length} áudio(s) expirados (> ${diasRetencao} dias) da pasta "${prefixo}".`
              );
            }
          }
        }
      }
    }

    if (totalApagados > 0) {
      console.log(`[Storage Áudio 🧹] Limpeza concluída: ${totalApagados} áudio(s) expirados removidos do bucket privado.`);
    }

    return totalApagados;
  } catch (err: any) {
    console.warn('[Storage Áudio ⚠️] Falha na rotina de limpeza de áudios expirados:', err?.message || err);
    return 0;
  }
}
