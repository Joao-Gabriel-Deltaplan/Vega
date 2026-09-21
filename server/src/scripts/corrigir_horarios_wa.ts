import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { formatarHorarioBrasilia } from '../utils/dataHoraUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function corrigirMensagensGravadas() {
  console.log('--- Verificando e corrigindo horários das mensagens existentes ---');
  const supabase = getSupabaseClient();

  const { data: conversas, error } = await supabase
    .from('conversas')
    .select('*');

  if (error || !conversas) {
    console.error('Erro ao buscar conversas:', error);
    return;
  }

  console.log(`Encontrada(s) ${conversas.length} conversa(s).`);

  for (const c of conversas) {
    let alterou = false;
    const mensagens = Array.isArray(c.mensagens) ? c.mensagens : [];
    console.log(`Conversa ${c.id}: ${mensagens.length} mensagens.`);

    const mensagensCorrigidas = mensagens.map((m: any, idx: number) => {
      let horarioCorrigido = m.horario;
      let timestamp = m.timestamp;

      // 1. Se já tem timestamp ISO válido
      if (timestamp && typeof timestamp === 'string' && timestamp.includes('T')) {
        horarioCorrigido = formatarHorarioBrasilia(timestamp);
      } else {
        // 2. Se não tem timestamp, tenta inferir a data
        // Procura timestamp na mensagem seguinte ou anterior
        let dataIsoBase = '2026-09-18';
        for (let i = idx; i < mensagens.length; i++) {
          if (mensagens[i].timestamp?.includes('T')) {
            dataIsoBase = mensagens[i].timestamp.split('T')[0];
            break;
          }
        }

        // Se o horário atual é HH:mm gravado em UTC (ex: "23:46")
        if (horarioCorrigido && /^\d{2}:\d{2}$/.test(horarioCorrigido.trim())) {
          const [hStr, mStr] = horarioCorrigido.trim().split(':');
          // Cria o timestamp UTC correspondente ao que foi gravado
          const isoUtc = `${dataIsoBase}T${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}:00.000Z`;
          timestamp = isoUtc;
          horarioCorrigido = formatarHorarioBrasilia(isoUtc);
        }
      }

      if (horarioCorrigido !== m.horario || timestamp !== m.timestamp) {
        alterou = true;
        return {
          ...m,
          horario: horarioCorrigido,
          timestamp: timestamp || m.timestamp,
        };
      }
      return m;
    });

    if (alterou) {
      console.log(`Atualizando horários de ${mensagensCorrigidas.length} mensagens da conversa ${c.id}...`);
      const { error: errUp } = await supabase
        .from('conversas')
        .update({
          mensagens: mensagensCorrigidas,
        })
        .eq('id', c.id);

      if (errUp) {
        console.error(`Erro ao atualizar conversa ${c.id}:`, errUp);
      } else {
        console.log(`Conversa ${c.id} atualizada com sucesso no Supabase!`);
      }
    } else {
      console.log(`Nenhuma alteração necessária para conversa ${c.id}.`);
    }
  }
}

corrigirMensagensGravadas().catch(console.error);
