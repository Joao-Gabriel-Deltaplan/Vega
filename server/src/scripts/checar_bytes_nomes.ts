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

async function checarBytes() {
  const docsJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'documentos.json'), 'utf-8'));
  console.log('=== VERIFICANDO BYTES EM data/documentos.json ===');
  for (const d of docsJson) {
    const arq = d.arquivo;
    const ultimosChars = arq.slice(-5).split('').map((c: string) => `${c} (U+${c.charCodeAt(0).toString(16).padStart(4, '0')})`).join(' ');
    console.log(`- "${arq}" -> Fim: ${ultimosChars}`);
  }

  const supabase = getSupabaseClient();
  const { data: docsDb } = await supabase.from('documentos').select('id, titulo, arquivo, storage_path');
  console.log('\n=== VERIFICANDO BYTES NO SUPABASE public.documentos ===');
  for (const d of docsDb || []) {
    const arq = d.arquivo;
    const ultimosChars = arq.slice(-5).split('').map((c: string) => `${c} (U+${c.charCodeAt(0).toString(16).padStart(4, '0')})`).join(' ');
    console.log(`- [${d.id}] "${arq}" -> Fim: ${ultimosChars}`);
  }

  const { data: conversas } = await supabase.from('conversas').select('id, mensagens');
  console.log('\n=== VERIFICANDO ANEXOS E TEXTOS DE CONVERSAS NO SUPABASE ===');
  for (const c of conversas || []) {
    for (const m of c.mensagens || []) {
      for (const a of m.anexos || []) {
        if (a.url && (a.url.endsWith(' ') || a.url.includes('%20 '))) {
          console.log(`❌ URL com espaço no final: "${a.url}" na conversa ${c.id}`);
        }
        if (a.nome && a.nome.endsWith(' ')) {
          console.log(`❌ Nome com espaço no final: "${a.nome}" na conversa ${c.id}`);
        }
      }
    }
  }
}

checarBytes().catch(console.error);
