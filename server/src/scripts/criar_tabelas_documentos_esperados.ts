import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { Client } = pg;

async function criarTabelasDocumentosEsperados() {
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
    -- 1. Tabela de Documentos Esperados (Checklist do Cofre)
    CREATE TABLE IF NOT EXISTS public.documentos_esperados (
      id text PRIMARY KEY,
      nome text NOT NULL,
      categoria text NOT NULL, -- 'PF' ou 'PJ'
      obrigatorio boolean NOT NULL DEFAULT true,
      campos_fornecidos jsonb NOT NULL DEFAULT '[]'::jsonb,
      ativo boolean NOT NULL DEFAULT true,
      ordem integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_doc_esperados_cat_ordem 
      ON public.documentos_esperados (categoria, ordem ASC);

    CREATE INDEX IF NOT EXISTS idx_doc_esperados_ativo 
      ON public.documentos_esperados (ativo);

    ALTER TABLE public.documentos_esperados ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.documentos_esperados FROM public, anon;
    GRANT ALL ON TABLE public.documentos_esperados TO service_role;

    -- 2. Tabela de Dispensas ("Não se aplica") por Titular
    CREATE TABLE IF NOT EXISTS public.documentos_esperados_dispensas (
      id text PRIMARY KEY,
      titular_id text NOT NULL,
      documento_esperado_id text NOT NULL REFERENCES public.documentos_esperados(id) ON DELETE CASCADE,
      motivo text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE(titular_id, documento_esperado_id)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_esperados_disp_titular 
      ON public.documentos_esperados_dispensas (titular_id);

    ALTER TABLE public.documentos_esperados_dispensas ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.documentos_esperados_dispensas FROM public, anon;
    GRANT ALL ON TABLE public.documentos_esperados_dispensas TO service_role;
  `;

  console.log('Criando tabelas public.documentos_esperados e public.documentos_esperados_dispensas...');
  await client.query(sqlTabelas);
  console.log('✅ Tabelas criadas/verificadas com sucesso!');

  // Itens iniciais solicitados pelo usuário
  const itensIniciais = [
    // PESSOA FÍSICA — Obrigatórios
    { id: 'pf-obr-rg', nome: 'RG', categoria: 'PF', obrigatorio: true, campos: ['rg', 'orgaoEmissor', 'filiacao', 'dataNascimento'], ordem: 1 },
    { id: 'pf-obr-cpf', nome: 'CPF', categoria: 'PF', obrigatorio: true, campos: ['cpf'], ordem: 2 },
    { id: 'pf-obr-cnh', nome: 'CNH', categoria: 'PF', obrigatorio: true, campos: ['cnh', 'categoriaCnh', 'validadeCnh', 'rg', 'cpf', 'dataNascimento', 'filiacao'], ordem: 3 },
    { id: 'pf-obr-comp-residencia', nome: 'Comprovante de Residência', categoria: 'PF', obrigatorio: true, campos: ['endereco'], ordem: 4 },
    { id: 'pf-obr-certidao', nome: 'Certidão (Nascimento ou Casamento)', categoria: 'PF', obrigatorio: true, campos: ['estadoCivil', 'dataNascimento', 'filiacao'], ordem: 5 },
    { id: 'pf-obr-titulo', nome: 'Título de Eleitor', categoria: 'PF', obrigatorio: true, campos: ['tituloEleitor'], ordem: 6 },
    { id: 'pf-obr-ctps', nome: 'CTPS', categoria: 'PF', obrigatorio: true, campos: ['ctps'], ordem: 7 },
    { id: 'pf-obr-pis', nome: 'PIS/PASEP', categoria: 'PF', obrigatorio: true, campos: ['pis'], ordem: 8 },

    // PESSOA FÍSICA — Complementares
    { id: 'pf-comp-passaporte', nome: 'Passaporte', categoria: 'PF', obrigatorio: false, campos: ['passaporte'], ordem: 9 },
    { id: 'pf-comp-reservista', nome: 'Certificado de Reservista', categoria: 'PF', obrigatorio: false, campos: ['reservista'], ordem: 10 },
    { id: 'pf-comp-diploma', nome: 'Diploma ou Certificado de Formação', categoria: 'PF', obrigatorio: false, campos: ['formacao', 'profissao'], ordem: 11 },
    { id: 'pf-comp-reg-prof', nome: 'Registro Profissional (CREA, CRT, CRM etc.)', categoria: 'PF', obrigatorio: false, campos: ['registroProfissional', 'profissao'], ordem: 12 },
    { id: 'pf-comp-irpf', nome: 'Declaração de Imposto de Renda', categoria: 'PF', obrigatorio: false, campos: ['irpf'], ordem: 13 },
    { id: 'pf-comp-vacinas', nome: 'Cartão de Vacinas', categoria: 'PF', obrigatorio: false, campos: ['vacinas'], ordem: 14 },
    { id: 'pf-comp-cnd', nome: 'Certidão Negativa de Débitos', categoria: 'PF', obrigatorio: false, campos: ['cnd'], ordem: 15 },
    { id: 'pf-comp-banco', nome: 'Comprovante de Conta Bancária', categoria: 'PF', obrigatorio: false, campos: ['contaBancaria'], ordem: 16 },

    // PESSOA JURÍDICA — Obrigatórios
    { id: 'pj-obr-contrato', nome: 'Contrato Social e alterações', categoria: 'PJ', obrigatorio: true, campos: ['razaoSocial', 'socios', 'objetoSocial'], ordem: 1 },
    { id: 'pj-obr-cnpj', nome: 'Cartão CNPJ', categoria: 'PJ', obrigatorio: true, campos: ['cnpj', 'razaoSocial', 'nomeFantasia', 'dataAbertura'], ordem: 2 },
    { id: 'pj-obr-inscricao', nome: 'Inscrição Estadual ou Municipal', categoria: 'PJ', obrigatorio: true, campos: ['inscricaoEstadual', 'inscricaoMunicipal'], ordem: 3 },
    { id: 'pj-obr-alvara', nome: 'Alvará de Funcionamento', categoria: 'PJ', obrigatorio: true, campos: ['alvara'], ordem: 4 },
    { id: 'pj-obr-cnd-fed', nome: 'Certidão Negativa Federal', categoria: 'PJ', obrigatorio: true, campos: ['cndFederal'], ordem: 5 },
    { id: 'pj-obr-cnd-est', nome: 'Certidão Negativa Estadual', categoria: 'PJ', obrigatorio: true, campos: ['cndEstadual'], ordem: 6 },
    { id: 'pj-obr-cnd-mun', nome: 'Certidão Negativa Municipal', categoria: 'PJ', obrigatorio: true, campos: ['cndMunicipal'], ordem: 7 },
    { id: 'pj-obr-cndt', nome: 'Certidão Negativa Trabalhista (CNDT)', categoria: 'PJ', obrigatorio: true, campos: ['cndt'], ordem: 8 },
    { id: 'pj-obr-crf-fgts', nome: 'Certificado de Regularidade do FGTS', categoria: 'PJ', obrigatorio: true, campos: ['crfFgts'], ordem: 9 },

    // PESSOA JURÍDICA — Complementares
    { id: 'pj-comp-crea-empresa', nome: 'Certidão do CREA da empresa', categoria: 'PJ', obrigatorio: false, campos: ['creaEmpresa'], ordem: 10 },
    { id: 'pj-comp-seguro', nome: 'Apólices de Seguro', categoria: 'PJ', obrigatorio: false, campos: ['seguro'], ordem: 11 },
    { id: 'pj-comp-procuracao', nome: 'Procurações', categoria: 'PJ', obrigatorio: false, campos: ['procuracao'], ordem: 12 },
    { id: 'pj-comp-capacidade', nome: 'Atestados de Capacidade Técnica', categoria: 'PJ', obrigatorio: false, campos: ['capacidadeTecnica'], ordem: 13 },
    { id: 'pj-comp-balanco', nome: 'Balanço Patrimonial', categoria: 'PJ', obrigatorio: false, campos: ['balanco'], ordem: 14 },
    { id: 'pj-comp-ambiental', nome: 'Licenças Ambientais', categoria: 'PJ', obrigatorio: false, campos: ['licencaAmbiental'], ordem: 15 },
  ];

  console.log(`Inserindo/atualizando ${itensIniciais.length} documentos esperados padrão...`);
  for (const item of itensIniciais) {
    const query = `
      INSERT INTO public.documentos_esperados (id, nome, categoria, obrigatorio, campos_fornecidos, ativo, ordem, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, $6, now())
      ON CONFLICT (id) DO UPDATE SET
        nome = EXCLUDED.nome,
        categoria = EXCLUDED.categoria,
        obrigatorio = EXCLUDED.obrigatorio,
        campos_fornecidos = EXCLUDED.campos_fornecidos,
        ordem = EXCLUDED.ordem,
        updated_at = now();
    `;
    await client.query(query, [
      item.id,
      item.nome,
      item.categoria,
      item.obrigatorio,
      JSON.stringify(item.campos),
      item.ordem,
    ]);
  }

  console.log('✅ Itens iniciais inseridos com sucesso!');
  await client.end();
}

criarTabelasDocumentosEsperados().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
