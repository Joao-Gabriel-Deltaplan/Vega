import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function adicionarLidSupabase() {
  const ref = 'qttxkulqegepyjjicfui';
  const password = process.env.SENHA;

  if (!password) {
    console.error('SENHA do banco não encontrada no .env');
    return;
  }

  const client = new Client({
    host: 'aws-0-sa-east-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.${ref}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Conectado ao PostgreSQL do Supabase.');

    console.log('1. Executando ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS lid text...');
    await client.query(`ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS lid text;`);
    console.log('Coluna lid adicionada ou já existente com sucesso.');

    console.log('2. Atualizando o usuário Joao Gabriel com lid 176948374462673...');
    const res = await client.query(
      `UPDATE public.usuarios SET lid = '176948374462673' WHERE id = 'usr-1' OR numero = '5514996863115';`
    );
    console.log(`Usuário atualizado! Linhas afetadas: ${res.rowCount}`);

    const resCheck = await client.query(`SELECT * FROM public.usuarios;`);
    console.log('Dados atuais da tabela usuarios:', JSON.stringify(resCheck.rows, null, 2));

    await client.end();
  } catch (err) {
    console.error('Erro na execução DDL/Update:', err);
  }
}

adicionarLidSupabase();
