import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ROOT_DIR = path.resolve(__dirname, '../../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const { Client } = pg;

async function sanearTudo() {
  console.log('=== SANEAMENTO DE ESPAÇOS EM NOMES, LINKS E REGISTROS ===\n');

  // 1. SANEAMENTO VIA SQL NO SUPABASE
  const ref = 'qttxkulqegepyjjicfui';
  const password = process.env.SENHA;

  const client = new Client({
    host: 'aws-0-sa-east-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.${ref}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Conectado ao PostgreSQL para update de TRIM...');

  await client.query(`
    UPDATE public.documentos 
    SET 
      arquivo = TRIM(arquivo),
      titulo = TRIM(titulo),
      storage_path = TRIM(storage_path)
    WHERE 
      arquivo != TRIM(arquivo) OR 
      titulo != TRIM(titulo) OR 
      storage_path != TRIM(storage_path);
  `);
  console.log('✔ Tabela public.documentos saneada (TRIM em arquivo, titulo, storage_path).');

  await client.query(`
    UPDATE public.alertas_vencimento 
    SET 
      documento_titulo = TRIM(documento_titulo),
      data_validade = TRIM(data_validade)
    WHERE 
      documento_titulo != TRIM(documento_titulo) OR 
      data_validade != TRIM(data_validade);
  `);
  console.log('✔ Tabela public.alertas_vencimento saneada.');

  await client.query(`
    UPDATE public.conhecimento 
    SET 
      titulo = TRIM(titulo),
      categoria = TRIM(categoria)
    WHERE 
      titulo != TRIM(titulo) OR 
      categoria != TRIM(categoria);
  `);
  console.log('✔ Tabela public.conhecimento saneada.');

  await client.query(`
    UPDATE public.usuarios 
    SET 
      nome = TRIM(nome),
      numero = TRIM(numero)
    WHERE 
      nome != TRIM(nome) OR 
      numero != TRIM(numero);
  `);
  console.log('✔ Tabela public.usuarios saneada.');

  await client.query(`
    UPDATE public.titulares 
    SET nome = TRIM(nome) 
    WHERE nome != TRIM(nome);
  `);
  console.log('✔ Tabela public.titulares saneada.');

  await client.end();

  // 2. SANEAMENTO NA TABELA CONVERSAS DO SUPABASE E LOCAL
  const supabase = getSupabaseClient();
  const { data: conversas, error: errConv } = await supabase
    .from('conversas')
    .select('id, contato, nao_lidas, ultima_atualizacao, mensagens');

  if (errConv) {
    console.error('Erro ao ler conversas:', errConv);
  } else {
    let totalAnexosCorrigidos = 0;
    let totalMsgsCorrigidas = 0;

    for (const c of conversas || []) {
      let conversaModificada = false;

      for (const m of c.mensagens || []) {
        if (m.anexos && Array.isArray(m.anexos)) {
          for (const a of m.anexos) {
            if (a.nome && a.nome !== a.nome.trim()) {
              console.log(`Corrigindo anexo.nome em conversa ${c.id}: "${a.nome}" -> "${a.nome.trim()}"`);
              a.nome = a.nome.trim();
              conversaModificada = true;
              totalAnexosCorrigidos++;
            }
            if (a.url && a.url !== a.url.trim()) {
              console.log(`Corrigindo anexo.url em conversa ${c.id}: "${a.url}" -> "${a.url.trim()}"`);
              a.url = a.url.trim();
              conversaModificada = true;
              totalAnexosCorrigidos++;
            }
            if (a.titulo && a.titulo !== a.titulo.trim()) {
              a.titulo = a.titulo.trim();
              conversaModificada = true;
            }
          }
        }

        if (m.texto && typeof m.texto === 'string') {
          // Substitui links do tipo [Nome.pdf ] por [Nome.pdf]
          const textoAjustado = m.texto
            .replace(/\[([^\]]+?)\s+\]/g, '[$1]')
            .replace(/\/arquivos\/([^\s\)]+?)\s+/g, '/arquivos/$1');

          if (textoAjustado !== m.texto) {
            m.texto = textoAjustado;
            conversaModificada = true;
            totalMsgsCorrigidas++;
          }
        }
      }

      if (conversaModificada) {
        await supabase
          .from('conversas')
          .update({ mensagens: c.mensagens })
          .eq('id', c.id);
        console.log(`✔ Conversa ${c.id} atualizada com links/anexos sem espaços nas pontas.`);
      }
    }

    console.log(`\nTotal de anexos corrigidos nas conversas: ${totalAnexosCorrigidos}`);
    console.log(`Total de mensagens com links ajustados: ${totalMsgsCorrigidas}`);
  }

  // 3. SANEAMENTO NOS ARQUIVOS LOCAIS EM data/ (para manter espelhos limpos)
  const docsJsonPath = path.join(DATA_DIR, 'documentos.json');
  if (fs.existsSync(docsJsonPath)) {
    const docs = JSON.parse(fs.readFileSync(docsJsonPath, 'utf-8'));
    for (const d of docs) {
      if (d.arquivo) d.arquivo = d.arquivo.trim();
      if (d.titulo) d.titulo = d.titulo.trim();
      if (d.titular) d.titular = d.titular.trim();
    }
    fs.writeFileSync(docsJsonPath, JSON.stringify(docs, null, 2), 'utf-8');
    console.log('✔ data/documentos.json local saneado.');
  }

  console.log('\n=== SANEAMENTO CONCLUÍDO COM SUCESSO! ===');
}

sanearTudo().catch(console.error);
