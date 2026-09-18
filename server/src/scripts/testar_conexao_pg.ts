import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function testar() {
  const ref = 'qttxkulqegepyjjicfui';
  const password = process.env.SENHA;

  const configs = [
    {
      name: 'Direct connection (db.<ref>.supabase.co:5432)',
      config: {
        host: `db.${ref}.supabase.co`,
        port: 5432,
        user: 'postgres',
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      }
    },
    {
      name: 'Pooler Transaction (aws-0-sa-east-1.pooler.supabase.com:6543)',
      config: {
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 6543,
        user: `postgres.${ref}`,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      }
    },
    {
      name: 'Pooler Session (aws-0-sa-east-1.pooler.supabase.com:5432)',
      config: {
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 5432,
        user: `postgres.${ref}`,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      }
    },
    {
      name: 'Pooler US-East-1 (aws-0-us-east-1.pooler.supabase.com:6543)',
      config: {
        host: 'aws-0-us-east-1.pooler.supabase.com',
        port: 6543,
        user: `postgres.${ref}`,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      }
    }
  ];

  for (const item of configs) {
    console.log(`Tentando ${item.name}...`);
    const client = new Client(item.config);
    try {
      await client.connect();
      const res = await client.query('SELECT NOW() as agora, current_database(), current_user');
      console.log(`Sucesso com ${item.name}!`, res.rows[0]);
      await client.end();
      return item.config;
    } catch (e: any) {
      console.log(`Falha em ${item.name}: ${e.message}`);
      try { await client.end(); } catch {}
    }
  }

  throw new Error('Nenhuma conexão funcionou.');
}

testar().catch(console.error);
