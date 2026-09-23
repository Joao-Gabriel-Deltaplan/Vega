import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function criarTabelasConfiguracoesVega() {
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

  try {
    // 1. Tabela configuracoes_vega (registro ativo)
    console.log('1. Criando tabela configuracoes_vega...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.configuracoes_vega (
        id text PRIMARY KEY DEFAULT 'config_padrao',
        prompt_persona text NOT NULL,
        temperatura_resposta numeric NOT NULL DEFAULT 0.1,
        atualizado_por_nome text,
        atualizado_por_id text,
        atualizado_em timestamptz DEFAULT now()
      );
    `);
    console.log('✔ Tabela configuracoes_vega pronta.');

    // 2. Tabela configuracoes_vega_historico (versões anteriores e rollback)
    console.log('2. Criando tabela configuracoes_vega_historico...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.configuracoes_vega_historico (
        id text PRIMARY KEY,
        prompt_persona text NOT NULL,
        temperatura_resposta numeric NOT NULL,
        autor_nome text,
        autor_id text,
        motivo text,
        criado_em timestamptz DEFAULT now()
      );
    `);
    console.log('✔ Tabela configuracoes_vega_historico pronta.');

    // 3. Conceder permissões para service_role
    console.log('3. Concedendo permissões para service_role...');
    await client.query(`
      GRANT ALL ON TABLE public.configuracoes_vega TO service_role;
      GRANT ALL ON TABLE public.configuracoes_vega_historico TO service_role;
    `);
    console.log('✔ Permissões concedidas.');

    // 4. Semear registro inicial caso a tabela esteja vazia
    const checagem = await client.query(`SELECT id FROM public.configuracoes_vega WHERE id = 'config_padrao'`);
    if (checagem.rows.length === 0) {
      console.log('4. Semeando registro padrão a partir de prompts/assistente.md...');
      const caminhoPrompt = path.resolve(__dirname, '../../../prompts/assistente.md');
      let promptPadrao = '';
      if (fs.existsSync(caminhoPrompt)) {
        promptPadrao = fs.readFileSync(caminhoPrompt, 'utf-8');
      } else {
        promptPadrao = 'Você é a assistente corporativa VEGA da Delta Plan.';
      }

      await client.query(
        `INSERT INTO public.configuracoes_vega (id, prompt_persona, temperatura_resposta, atualizado_por_nome, atualizado_por_id)
         VALUES ($1, $2, $3, $4, $5)`,
        ['config_padrao', promptPadrao, 0.1, 'Sistema (Instalação)', 'sistema']
      );

      const histId = `ver-${Date.now()}-padrao`;
      await client.query(
        `INSERT INTO public.configuracoes_vega_historico (id, prompt_persona, temperatura_resposta, autor_nome, autor_id, motivo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [histId, promptPadrao, 0.1, 'Sistema (Instalação)', 'sistema', 'versao_inicial_padrao']
      );
      console.log('✔ Registro inicial semeado com sucesso.');
    } else {
      console.log('✔ Registro de configuração já existente.');
    }

    console.log('Migração de Configurações da VEGA concluída com sucesso!');
  } finally {
    await client.end();
  }
}

criarTabelasConfiguracoesVega().catch((err) => {
  console.error('Erro ao criar tabelas no Supabase:', err);
  process.exit(1);
});
