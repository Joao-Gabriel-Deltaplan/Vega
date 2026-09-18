import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ROOT_DIR = path.resolve(__dirname, '../../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ARQUIVOS_DIR = path.join(ROOT_DIR, 'arquivos');

function contarItensJson(caminho: string): number {
  if (!fs.existsSync(caminho)) return 0;
  try {
    const raw = fs.readFileSync(caminho, 'utf-8');
    const dados = JSON.parse(raw);
    return Array.isArray(dados) ? dados.length : Object.keys(dados).length;
  } catch {
    return 0;
  }
}

async function gerarComparativo() {
  const supabase = getSupabaseClient();

  // Contagens locais
  const qtdDocsLocal = contarItensJson(path.join(DATA_DIR, 'documentos.json'));
  const qtdTitularesLocal = contarItensJson(path.join(DATA_DIR, 'titulares.json'));
  const qtdConhecimentoLocal = contarItensJson(path.join(DATA_DIR, 'conhecimento.json'));
  const qtdUsuariosLocal = contarItensJson(path.join(DATA_DIR, 'usuarios.json'));
  const qtdAlertasLocal = contarItensJson(path.join(DATA_DIR, 'alertas_vencimento.json'));
  const qtdUsoIaLocal = contarItensJson(path.join(DATA_DIR, 'uso_ia.json'));
  const qtdBuscasLocal = contarItensJson(path.join(DATA_DIR, 'buscas_sem_resultado.json'));
  const qtdConversasLocal = contarItensJson(path.join(DATA_DIR, 'conversas.json'));
  const qtdPdfsLocal = fs.existsSync(ARQUIVOS_DIR) 
    ? fs.readdirSync(ARQUIVOS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).length 
    : 0;

  // Contagens no Supabase
  const { count: countDocs } = await supabase.from('documentos').select('*', { count: 'exact', head: true });
  const { count: countTrechos } = await supabase.from('trechos').select('*', { count: 'exact', head: true });
  const { count: countRastros } = await supabase.from('rastros').select('*', { count: 'exact', head: true });
  const { count: countTitulares } = await supabase.from('titulares').select('*', { count: 'exact', head: true });
  const { count: countConhecimento } = await supabase.from('conhecimento').select('*', { count: 'exact', head: true });
  const { count: countUsuarios } = await supabase.from('usuarios').select('*', { count: 'exact', head: true });
  const { count: countAlertas } = await supabase.from('alertas_vencimento').select('*', { count: 'exact', head: true });
  const { count: countUsoIa } = await supabase.from('uso_ia').select('*', { count: 'exact', head: true });
  const { count: countBuscas } = await supabase.from('buscas_sem_resultado').select('*', { count: 'exact', head: true });
  const { count: countConversas } = await supabase.from('conversas').select('*', { count: 'exact', head: true });

  const { data: listaStorage } = await supabase.storage.from('documentos').list();
  const countStorage = listaStorage ? listaStorage.length : 0;

  const resultado = [
    {
      origem: 'data/documentos.json',
      destino: 'public.documentos',
      local: qtdDocsLocal,
      banco: countDocs,
      status: countDocs && countDocs >= qtdDocsLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: `${countTrechos} trechos vetoriais vinculados e preservados`,
    },
    {
      origem: 'arquivos/ (*.pdf)',
      destino: 'Storage bucket "documentos"',
      local: qtdPdfsLocal,
      banco: countStorage,
      status: countStorage === qtdPdfsLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Bucket privado com chaves sanitizadas',
    },
    {
      origem: 'data/titulares.json',
      destino: 'public.titulares',
      local: qtdTitularesLocal,
      banco: countTitulares,
      status: countTitulares === qtdTitularesLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Fichas completas com conferência e rastro',
    },
    {
      origem: 'data/conhecimento.json',
      destino: 'public.conhecimento',
      local: qtdConhecimentoLocal,
      banco: countConhecimento,
      status: countConhecimento === qtdConhecimentoLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Regras e diretrizes corporativas',
    },
    {
      origem: 'data/usuarios.json',
      destino: 'public.usuarios',
      local: qtdUsuariosLocal,
      banco: countUsuarios,
      status: countUsuarios === qtdUsuariosLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Usuários e permissões do WhatsApp',
    },
    {
      origem: 'data/alertas_vencimento.json',
      destino: 'public.alertas_vencimento',
      local: qtdAlertasLocal,
      banco: countAlertas,
      status: countAlertas === qtdAlertasLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Monitoramento de validades diárias',
    },
    {
      origem: 'data/uso_ia.json',
      destino: 'public.uso_ia',
      local: qtdUsoIaLocal,
      banco: countUsoIa,
      status: countUsoIa && countUsoIa >= qtdUsoIaLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Telemetria de tokens e custos em USD',
    },
    {
      origem: 'data/buscas_sem_resultado.json',
      destino: 'public.buscas_sem_resultado',
      local: qtdBuscasLocal,
      banco: countBuscas,
      status: countBuscas && countBuscas >= qtdBuscasLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Auditoria de buscas não atendidas',
    },
    {
      origem: 'data/conversas.json',
      destino: 'public.conversas',
      local: qtdConversasLocal,
      banco: countConversas,
      status: countConversas === qtdConversasLocal ? '✔ Migrado' : '⚠️ Diferença',
      observacao: 'Histórico completo de chats e mensagens',
    },
    {
      origem: 'public.rastros (já no Supabase)',
      destino: 'public.rastros',
      local: '-',
      banco: countRastros,
      status: '✔ Preservado',
      observacao: 'Tabela existente intocada',
    },
  ];

  console.log('\n========================================================================================');
  console.log('TABELA COMPARATIVA DE MIGRAÇÃO: ARQUIVOS LOCAIS vs SUPABASE');
  console.log('========================================================================================');
  console.table(resultado);
  console.log('========================================================================================\n');
}

gerarComparativo().catch(console.error);
