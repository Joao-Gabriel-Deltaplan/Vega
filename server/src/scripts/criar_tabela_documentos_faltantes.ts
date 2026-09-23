import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function criarTabelaDocumentosFaltantes() {
  const ref = 'qttxkulqegepyjjicfui';
  const password = process.env.SENHA;

  if (!password) {
    throw new Error('Variável SENHA não encontrada no .env');
  }

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
  console.log('Conexão estabelecida com sucesso.');

  const sql = `
    CREATE TABLE IF NOT EXISTS public.documentos_faltantes (
      id text PRIMARY KEY,
      tipo_documento text NOT NULL,
      titular text NOT NULL,
      pessoa_id text,
      solicitante_nome text NOT NULL,
      solicitante_contato text,
      quantidade_pedidos integer NOT NULL DEFAULT 1,
      data_primeiro_pedido timestamptz NOT NULL DEFAULT now(),
      data_ultimo_pedido timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'pendente',
      observacao text,
      dados_equivalentes_oferecidos text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_doc_faltantes_status_pedidos 
      ON public.documentos_faltantes (status, quantidade_pedidos DESC);

    CREATE INDEX IF NOT EXISTS idx_doc_faltantes_busca 
      ON public.documentos_faltantes (pessoa_id, tipo_documento, status);

    ALTER TABLE public.documentos_faltantes ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.documentos_faltantes FROM public, anon;
    GRANT ALL ON TABLE public.documentos_faltantes TO service_role;
  `;

  console.log('Criando tabela public.documentos_faltantes no Supabase...');
  await client.query(sql);
  console.log('✅ Tabela public.documentos_faltantes criada com sucesso!');

  await client.end();
}

criarTabelaDocumentosFaltantes().catch((err) => {
  console.error('❌ Erro ao criar tabela documentos_faltantes:', err);
  process.exit(1);
});
