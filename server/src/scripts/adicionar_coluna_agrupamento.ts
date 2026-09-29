import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function executar() {
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

  try {
    console.log('Conectando ao PostgreSQL do Supabase...');
    await client.connect();

    console.log('Adicionando coluna tempo_espera_agrupamento_segundos em configuracoes_vega...');
    await client.query(`
      ALTER TABLE public.configuracoes_vega
        ADD COLUMN IF NOT EXISTS tempo_espera_agrupamento_segundos integer DEFAULT 7;
    `);

    console.log('Adicionando coluna tempo_espera_agrupamento_segundos em configuracoes_vega_historico...');
    await client.query(`
      ALTER TABLE public.configuracoes_vega_historico
        ADD COLUMN IF NOT EXISTS tempo_espera_agrupamento_segundos integer DEFAULT 7;
    `);

    console.log('Atualizando registro ativo padrão com 7 segundos...');
    await client.query(`
      UPDATE public.configuracoes_vega
      SET tempo_espera_agrupamento_segundos = 7
      WHERE tempo_espera_agrupamento_segundos IS NULL;
    `);

    console.log('✔ Migração DDL concluída com sucesso!');
  } catch (err) {
    console.error('Erro ao executar DDL:', err);
  } finally {
    await client.end();
  }
}

executar();
