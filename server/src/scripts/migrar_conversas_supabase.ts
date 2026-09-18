import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ROOT_DIR = path.resolve(__dirname, '../../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');

async function migrarConversas() {
  console.log('--- MIGRANDO CONVERSAS.JSON PARA SUPABASE (ETAPA FINAL) ---');
  const arquivoConversas = path.join(DATA_DIR, 'conversas.json');

  if (!fs.existsSync(arquivoConversas)) {
    console.log('Arquivo conversas.json não encontrado. Nada a migrar.');
    return;
  }

  const conversasRaw = fs.readFileSync(arquivoConversas, 'utf-8');
  const conversas = JSON.parse(conversasRaw) as any[];
  console.log(`Total de conversas no arquivo: ${conversas.length}`);

  const supabase = getSupabaseClient();
  let migradas = 0;

  for (const c of conversas) {
    const registro = {
      id: c.id,
      contato: c.contato || {},
      nao_lidas: c.naoLidas || 0,
      ultima_atualizacao: c.ultimaAtualizacao || new Date().toISOString(),
      mensagens: c.mensagens || [],
    };

    const { error } = await supabase
      .from('conversas')
      .upsert(registro, { onConflict: 'id' });

    if (error) {
      console.error(`Erro ao migrar conversa ${c.id}:`, error.message);
    } else {
      migradas++;
      console.log(`✔ Conversa migrada: ${c.id} (${c.contato?.nome || 'Sem nome'}) - ${c.mensagens?.length || 0} mensagens`);
    }
  }

  console.log(`\n✔ Total de conversas migradas com sucesso: ${migradas}/${conversas.length}`);
}

migrarConversas().catch(console.error);
