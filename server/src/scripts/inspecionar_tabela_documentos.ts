import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function inspecionar() {
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
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'documentos' 
    ORDER BY ordinal_position;
  `);

  console.log('Colunas de public.documentos:');
  for (const row of res.rows) {
    console.log(`- ${row.column_name} (${row.data_type})`);
  }

  const resDocs = await client.query('SELECT id, titulo, arquivo, metadata FROM public.documentos;');
  console.log('\nRegistros atuais em public.documentos:');
  for (const d of resDocs.rows) {
    console.log(d);
  }

  await client.end();
}

inspecionar().catch(console.error);
