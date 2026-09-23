import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function criarTabelaPendencias() {
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

  console.log('Conectando ao PostgreSQL do Supabase...');
  await client.connect();
  console.log('Conexão estabelecida.');

  const sql = `
    CREATE TABLE IF NOT EXISTS public.pendencias_documento_whatsapp (
      id text PRIMARY KEY,
      conversa_id text NOT NULL,
      remetente_numero text NOT NULL,
      remetente_jid text NOT NULL,
      documento_id text NOT NULL,
      tipo_pendencia text NOT NULL,
      dados_detectados jsonb NOT NULL DEFAULT '{}'::jsonb,
      criado_em timestamptz NOT NULL DEFAULT now(),
      expira_em timestamptz NOT NULL,
      resolvido boolean NOT NULL DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_pendencias_conversa_resolvido 
      ON public.pendencias_documento_whatsapp (conversa_id, resolvido, expira_em);

    ALTER TABLE public.pendencias_documento_whatsapp ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.pendencias_documento_whatsapp FROM public, anon, authenticated;
    GRANT ALL ON TABLE public.pendencias_documento_whatsapp TO service_role;
  `;

  console.log('Criando tabela public.pendencias_documento_whatsapp...');
  await client.query(sql);
  console.log('Tabela pendencias_documento_whatsapp criada com sucesso!');

  await client.end();
}

criarTabelaPendencias().catch((err) => {
  console.error('Erro ao executar DDL da tabela pendencias:', err);
  process.exit(1);
});
