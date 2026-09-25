import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function criarTabelasAvisos() {
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

  const sqlTabelas = `
    -- 1. Tabela de Avisos de Falha e Consumo do Sistema
    CREATE TABLE IF NOT EXISTS public.avisos_sistema (
      id text PRIMARY KEY,
      tipo text NOT NULL, -- 'openai_erro', 'consumo_limite', 'evolution_falha', 'supabase_falha', 'indexacao_falha', 'transcricao_falha', 'recuperacao'
      severidade text NOT NULL, -- 'critico', 'alerta', 'informativo'
      origem text NOT NULL, -- 'OpenAI Chat', 'OpenAI Embeddings', 'Evolution API', 'Supabase Database', etc.
      titulo text NOT NULL,
      mensagem text NOT NULL,
      detalhe_tecnico text,
      chave_agrupamento text NOT NULL,
      quantidade_ocorrencias integer NOT NULL DEFAULT 1,
      primeira_ocorrencia timestamptz NOT NULL DEFAULT now(),
      ultima_ocorrencia timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'ativo', -- 'ativo', 'resolvido', 'lido'
      enviado_whatsapp boolean NOT NULL DEFAULT false,
      destinatarios_whatsapp jsonb NOT NULL DEFAULT '[]'::jsonb,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_avisos_status_data 
      ON public.avisos_sistema (status, ultima_ocorrencia DESC);

    CREATE INDEX IF NOT EXISTS idx_avisos_chave_status 
      ON public.avisos_sistema (chave_agrupamento, status);

    CREATE INDEX IF NOT EXISTS idx_avisos_tipo 
      ON public.avisos_sistema (tipo);

    ALTER TABLE public.avisos_sistema ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.avisos_sistema FROM public, anon;
    GRANT ALL ON TABLE public.avisos_sistema TO service_role;

    -- 2. Tabela de Configurações de Avisos
    CREATE TABLE IF NOT EXISTS public.configuracoes_avisos (
      id text PRIMARY KEY DEFAULT 'config_padrao',
      destinatarios_whatsapp jsonb NOT NULL DEFAULT '[]'::jsonb,
      limite_mensal_usd numeric NOT NULL DEFAULT 50.0,
      notificar_50_porcento boolean NOT NULL DEFAULT true,
      notificar_80_porcento boolean NOT NULL DEFAULT true,
      notificar_100_porcento boolean NOT NULL DEFAULT true,
      tipos_ativos jsonb NOT NULL DEFAULT '["openai_erro", "consumo_limite", "evolution_falha", "supabase_falha", "indexacao_falha", "transcricao_falha"]'::jsonb,
      faixas_notificadas_mes_atual jsonb NOT NULL DEFAULT '{}'::jsonb,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.configuracoes_avisos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.configuracoes_avisos FROM public, anon;
    GRANT ALL ON TABLE public.configuracoes_avisos TO service_role;

    -- Inserir configuração padrão inicial se não existir
    INSERT INTO public.configuracoes_avisos (id, destinatarios_whatsapp, limite_mensal_usd, tipos_ativos)
    VALUES (
      'config_padrao',
      '[]'::jsonb,
      50.0,
      '["openai_erro", "consumo_limite", "evolution_falha", "supabase_falha", "indexacao_falha", "transcricao_falha"]'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  `;

  console.log('Executando DDL das tabelas de avisos no Supabase...');
  await client.query(sqlTabelas);
  console.log('✅ Tabelas public.avisos_sistema e public.configuracoes_avisos criadas com sucesso!');

  await client.end();
}

criarTabelasAvisos().catch((err) => {
  console.error('❌ Erro ao criar tabelas de avisos:', err);
  process.exit(1);
});
