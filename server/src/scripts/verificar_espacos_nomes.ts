import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function verificarEspacos() {
  const supabase = getSupabaseClient();

  // 1. Tabela documentos
  const { data: docs } = await supabase.from('documentos').select('id, titulo, arquivo, storage_path');
  console.log('--- VERIFICANDO TABELA DOCUMENTOS ---');
  for (const d of docs || []) {
    if (d.arquivo.endsWith(' ') || d.arquivo.startsWith(' ')) {
      console.log(`❌ Espaço encontrado em documento ${d.id}: arquivo = "${d.arquivo}"`);
    }
    if (d.storage_path && (d.storage_path.endsWith(' ') || d.storage_path.startsWith(' '))) {
      console.log(`❌ Espaço encontrado em documento ${d.id}: storage_path = "${d.storage_path}"`);
    }
  }

  // 2. Tabela conversas (mensagens e anexos)
  const { data: conversas } = await supabase.from('conversas').select('id, mensagens');
  console.log('\n--- VERIFICANDO TABELA CONVERSAS (ANEXOS E LINKS) ---');
  let totalAnexosComEspaco = 0;
  for (const c of conversas || []) {
    for (const msg of c.mensagens || []) {
      if (msg.anexos && Array.isArray(msg.anexos)) {
        for (const anexo of msg.anexos) {
          if (anexo.nome && anexo.nome !== anexo.nome.trim()) {
            console.log(`❌ Espaço no anexo.nome: "${anexo.nome}" (Conversa ${c.id}, Msg ${msg.id})`);
            totalAnexosComEspaco++;
          }
          if (anexo.url && anexo.url !== anexo.url.trim()) {
            console.log(`❌ Espaço no anexo.url: "${anexo.url}" (Conversa ${c.id}, Msg ${msg.id})`);
            totalAnexosComEspaco++;
          }
        }
      }
      // Verifica no texto da mensagem se tem [link](...) com espaço
      if (msg.texto && msg.texto.includes('.pdf ')) {
        console.log(`⚠️ Texto com ".pdf ": "${msg.texto}" (Conversa ${c.id})`);
      }
    }
  }
  console.log(`Total de anexos com espaço encontrados nas conversas: ${totalAnexosComEspaco}`);
}

verificarEspacos().catch(console.error);
