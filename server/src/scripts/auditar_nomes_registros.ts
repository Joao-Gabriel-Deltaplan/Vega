import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function auditarRegistros() {
  const supabase = getSupabaseClient();
  console.log('===============================================================');
  console.log('RELATÓRIO COMPLETO DE AUDITORIA: IDENTIFICAÇÃO DE NOMES NO SUPABASE');
  console.log('===============================================================\n');

  // 1. Tabela: rastros
  console.log('--- 1. AUDITORIA: Tabela "rastros" ---');
  const { data: rastros, error: erroRastros } = await supabase
    .from('rastros')
    .select('id, usuario_nome, usuario_id, mensagem_original, documento_usado, criado_em')
    .order('criado_em', { ascending: false })
    .limit(50);

  if (erroRastros) {
    console.error('Erro ao ler rastros:', erroRastros.message);
  } else {
    console.log(`Total de rastros recentes analisados: ${rastros?.length || 0}`);
    const usuariosUnicosRastros = new Set<string>();
    rastros?.forEach((r) => {
      usuariosUnicosRastros.add(`Nome: "${r.usuario_nome}" | ID: "${r.usuario_id}"`);
    });
    console.log('Usuários registrados nos rastros:');
    usuariosUnicosRastros.forEach((u) => console.log(`  - ${u}`));
  }

  // 2. Tabela: documentos_faltantes
  console.log('\n--- 2. AUDITORIA: Tabela "documentos_faltantes" ---');
  const { data: faltantes, error: erroFaltantes } = await supabase
    .from('documentos_faltantes')
    .select('id, tipo_documento, titular, solicitante_nome, solicitante_contato, status, quantidade_pedidos');

  if (erroFaltantes) {
    console.error('Erro ao ler documentos_faltantes:', erroFaltantes.message);
  } else {
    console.log(`Total de documentos faltantes no Supabase: ${faltantes?.length || 0}`);
    faltantes?.forEach((f) => {
      console.log(`  - ID: ${f.id} | Doc: "${f.tipo_documento}" | Titular: "${f.titular}" | Solicitante: "${f.solicitante_nome}" (${f.solicitante_contato})`);
    });
  }

  // 3. Tabela: titulares (fichas e campos)
  console.log('\n--- 3. AUDITORIA: Tabela "titulares" (Fichas Cadastrais) ---');
  const { data: titulares, error: erroTitulares } = await supabase
    .from('titulares')
    .select('id, nome, campos');

  if (erroTitulares) {
    console.error('Erro ao ler titulares:', erroTitulares.message);
  } else {
    console.log(`Total de titulares cadastrados: ${titulares?.length || 0}`);
    titulares?.forEach((t) => {
      console.log(`  - Titular Oficial: "${t.nome}" (ID: ${t.id})`);
      const campos = t.campos || {};
      for (const [k, v] of Object.entries(campos)) {
        const item: any = v;
        if (item) {
          const orig = String(item.origem || item.origemNome || '');
          const val = String(item.valor || '');
          if (
            orig.toLowerCase().includes('teste') ||
            orig.toLowerCase().includes('carlos') ||
            val.toLowerCase().includes('carlos')
          ) {
            console.log(`    ⚠️ Suspeito Campo "${k}": valor="${item.valor}" | origem="${orig}"`);
          }
        }
      }
    });
  }

  // 4. Tabela: documentos (validades e silenciamento de alertas)
  console.log('\n--- 4. AUDITORIA: Tabela "documentos" (Alertas e Validades) ---');
  const { data: docs, error: erroDocs } = await supabase
    .from('documentos')
    .select('id, titulo, titular, silenciar_alertas, historico_validade');

  if (erroDocs) {
    console.error('Erro ao ler documentos:', erroDocs.message);
  } else {
    console.log(`Total de documentos no cofre: ${docs?.length || 0}`);
    docs?.forEach((d) => {
      if (d.silenciar_alertas) {
        console.log(`  - Documento com alertas silenciados: "${d.titulo}" (${d.titular})`);
      }
      if (d.historico_validade && Array.isArray(d.historico_validade)) {
        d.historico_validade.forEach((hv: any) => {
          const aut = String(hv.autor || hv.alteradoPor || '');
          if (aut.toLowerCase().includes('carlos') || aut.toLowerCase().includes('teste')) {
            console.log(`    ⚠️ Histórico de validade com autor de teste: "${d.titulo}" | Autor: "${aut}"`);
          }
        });
      }
    });
  }

  // 5. Tabela: buscas_sem_resultado
  console.log('\n--- 5. AUDITORIA: Tabela "buscas_sem_resultado" ---');
  const { data: buscas, error: erroBuscas } = await supabase
    .from('buscas_sem_resultado')
    .select('id, texto_do_pedido, contato_nome, contato_id, data')
    .order('data', { ascending: false })
    .limit(30);

  if (erroBuscas) {
    console.error('Erro ao ler buscas_sem_resultado:', erroBuscas.message);
  } else {
    console.log(`Total de buscas recentes: ${buscas?.length || 0}`);
    const contatosBuscas = new Set<string>();
    buscas?.forEach((b) => contatosBuscas.add(`Nome: "${b.contato_nome}" | ID: "${b.contato_id}"`));
    contatosBuscas.forEach((c) => console.log(`  - ${c}`));
  }

  // 6. Tabela: uso_ia
  console.log('\n--- 6. AUDITORIA: Tabela "uso_ia" ---');
  const { data: uso, error: erroUso } = await supabase
    .from('uso_ia')
    .select('id, contato_nome, contato_id, modelo, motivo, data')
    .order('data', { ascending: false })
    .limit(30);

  if (erroUso) {
    console.error('Erro ao ler uso_ia:', erroUso.message);
  } else {
    console.log(`Total de registros uso_ia recentes: ${uso?.length || 0}`);
    const contatosUso = new Set<string>();
    uso?.forEach((u) => contatosUso.add(`Nome: "${u.contato_nome}" | ID: "${u.contato_id}"`));
    contatosUso.forEach((c) => console.log(`  - ${c}`));
  }
}

auditarRegistros().catch(console.error);
