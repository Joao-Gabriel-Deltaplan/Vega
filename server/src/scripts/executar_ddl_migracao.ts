import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function executarDDL() {
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
  console.log('Conexão estabelecida com sucesso.');

  const queries = [
    {
      nome: '1. Atualizar colunas da tabela documentos',
      sql: `
        ALTER TABLE public.documentos
          ADD COLUMN IF NOT EXISTS titular text,
          ADD COLUMN IF NOT EXISTS descricao text,
          ADD COLUMN IF NOT EXISTS apelidos text[] DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS tamanho text,
          ADD COLUMN IF NOT EXISTS status_indexacao text DEFAULT 'indexado',
          ADD COLUMN IF NOT EXISTS erro_indexacao text,
          ADD COLUMN IF NOT EXISTS data_validade text,
          ADD COLUMN IF NOT EXISTS origem_validade text,
          ADD COLUMN IF NOT EXISTS historico_validade jsonb,
          ADD COLUMN IF NOT EXISTS silenciar_alertas boolean DEFAULT false,
          ADD COLUMN IF NOT EXISTS trecho_validade text,
          ADD COLUMN IF NOT EXISTS storage_path text;
      `
    },
    {
      nome: '2. Criar tabela titulares',
      sql: `
        CREATE TABLE IF NOT EXISTS public.titulares (
          id text PRIMARY KEY,
          nome text NOT NULL,
          campos jsonb NOT NULL DEFAULT '{}'::jsonb,
          atualizado_em text,
          created_at timestamptz DEFAULT now()
        );
      `
    },
    {
      nome: '3. Criar tabela conhecimento',
      sql: `
        CREATE TABLE IF NOT EXISTS public.conhecimento (
          id text PRIMARY KEY,
          titulo text NOT NULL,
          categoria text NOT NULL,
          conteudo text NOT NULL,
          data_atualizacao text,
          created_at timestamptz DEFAULT now()
        );
      `
    },
    {
      nome: '4. Criar tabela usuarios',
      sql: `
        CREATE TABLE IF NOT EXISTS public.usuarios (
          id text PRIMARY KEY,
          numero text NOT NULL UNIQUE,
          nome text NOT NULL,
          perfil text NOT NULL DEFAULT 'comum',
          pessoa_id text,
          ativo boolean DEFAULT true,
          data_cadastro text,
          created_at timestamptz DEFAULT now()
        );
      `
    },
    {
      nome: '5. Criar tabela alertas_vencimento',
      sql: `
        CREATE TABLE IF NOT EXISTS public.alertas_vencimento (
          id text PRIMARY KEY,
          documento_id text NOT NULL,
          documento_titulo text NOT NULL,
          titular text,
          data_validade text NOT NULL,
          dias_restantes integer NOT NULL,
          status text NOT NULL,
          prazo_alerta text NOT NULL,
          data_geracao timestamptz NOT NULL DEFAULT now(),
          lido boolean DEFAULT false,
          notificado_whatsapp boolean DEFAULT false,
          created_at timestamptz DEFAULT now()
        );
      `
    },
    {
      nome: '6. Criar tabela conversas',
      sql: `
        CREATE TABLE IF NOT EXISTS public.conversas (
          id text PRIMARY KEY,
          contato jsonb NOT NULL,
          nao_lidas integer DEFAULT 0,
          ultima_atualizacao timestamptz DEFAULT now(),
          mensagens jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_at timestamptz DEFAULT now()
        );
      `
    },
    {
      nome: '7. Criar tabela uso_ia',
      sql: `
        CREATE TABLE IF NOT EXISTS public.uso_ia (
          id text PRIMARY KEY,
          data timestamptz NOT NULL DEFAULT now(),
          provedor text NOT NULL,
          modelo text NOT NULL,
          contato_id text,
          contato_nome text,
          motivo text NOT NULL,
          tokens_entrada integer NOT NULL DEFAULT 0,
          tokens_saida integer NOT NULL DEFAULT 0,
          custo_estimado numeric NOT NULL DEFAULT 0,
          sucesso boolean DEFAULT true,
          erro text,
          estimado boolean DEFAULT false
        );
      `
    },
    {
      nome: '8. Criar tabela buscas_sem_resultado',
      sql: `
        CREATE TABLE IF NOT EXISTS public.buscas_sem_resultado (
          id text PRIMARY KEY,
          data timestamptz NOT NULL DEFAULT now(),
          contato_id text,
          contato_nome text,
          texto_do_pedido text NOT NULL,
          motivo text NOT NULL,
          ia_acionada boolean DEFAULT false,
          equivalente_oferecido text
        );
      `
    },
    {
      nome: '9. Habilitar RLS apenas nas novas tabelas',
      sql: `
        ALTER TABLE public.titulares ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.conhecimento ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.alertas_vencimento ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.uso_ia ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.buscas_sem_resultado ENABLE ROW LEVEL SECURITY;
      `
    },
    {
      nome: '10. Revogar permissões públicas/anônimas apenas nas novas tabelas',
      sql: `
        REVOKE ALL ON TABLE public.titulares FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.conhecimento FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.usuarios FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.alertas_vencimento FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.conversas FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.uso_ia FROM public, anon, authenticated;
        REVOKE ALL ON TABLE public.buscas_sem_resultado FROM public, anon, authenticated;
      `
    },
    {
      nome: '11. Conceder permissões totais para service_role apenas nas novas tabelas',
      sql: `
        GRANT ALL ON TABLE public.titulares TO service_role;
        GRANT ALL ON TABLE public.conhecimento TO service_role;
        GRANT ALL ON TABLE public.usuarios TO service_role;
        GRANT ALL ON TABLE public.alertas_vencimento TO service_role;
        GRANT ALL ON TABLE public.conversas TO service_role;
        GRANT ALL ON TABLE public.uso_ia TO service_role;
        GRANT ALL ON TABLE public.buscas_sem_resultado TO service_role;
      `
    }
  ];

  for (const q of queries) {
    console.log(`Executando: ${q.nome}...`);
    await client.query(q.sql);
    console.log(`✔ Concluído: ${q.nome}`);
  }

  // Verifica as tabelas existentes no schema public
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);

  console.log('\n=== TABELAS EXISTENTES NO SCHEMA PUBLIC ===');
  for (const row of res.rows) {
    console.log(`- ${row.table_name}`);
  }

  await client.end();
  console.log('\nDDL executado com sucesso no Supabase!');
}

executarDDL().catch((err) => {
  console.error('Erro ao executar DDL:', err);
  process.exit(1);
});
