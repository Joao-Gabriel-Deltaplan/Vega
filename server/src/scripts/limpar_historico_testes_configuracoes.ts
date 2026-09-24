import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';

async function diagnosticarELimparHistorico() {
  const supabase = getSupabaseClient();

  console.log('=== REGISTROS ATUAIS EM configuracoes_vega_historico ===');
  const { data: historico, error: erroHist } = await supabase
    .from('configuracoes_vega_historico')
    .select('id, autor_nome, autor_id, temperatura_resposta, motivo, criado_em')
    .order('criado_em', { ascending: false });

  if (erroHist || !historico) {
    console.error('Erro ao ler histórico:', erroHist);
    return;
  }

  console.log(`Total de registros no histórico: ${historico.length}`);
  historico.forEach((h, i) => {
    console.log(`[${i + 1}] ID: ${h.id} | Autor: "${h.autor_nome}" | Temp: ${h.temperatura_resposta} | Motivo: "${h.motivo}" | Criado em: ${h.criado_em}`);
  });

  console.log('\n=== REGISTRO ATIVO ATUAL EM configuracoes_vega ===');
  const { data: ativo, error: erroAtivo } = await supabase
    .from('configuracoes_vega')
    .select('*');
  console.log(JSON.stringify(ativo, null, 2));

  // Identifica versões de teste a serem removidas:
  // Nomes de teste: Carlos Eduardo, Admin Rollback Teste, motivo teste_automatizado, etc.
  // Preservar: versao_padrao_sistema e qualquer alteração legítima feita por humanos no painel.
  const idsParaRemover: string[] = [];

  for (const h of historico) {
    if (h.id === 'versao_padrao_sistema') {
      console.log(`\n-> PRESERVANDO versão padrão oficial do sistema: ${h.id}`);
      continue;
    }

    const autorNorm = (h.autor_nome || '').toLowerCase();
    const motivoNorm = (h.motivo || '').toLowerCase();
    const idNorm = (h.id || '').toLowerCase();

    const ehTeste =
      autorNorm.includes('carlos eduardo') ||
      autorNorm.includes('teste') ||
      autorNorm.includes('rollback') ||
      motivoNorm.includes('teste') ||
      motivoNorm.includes('rollback') ||
      motivoNorm.includes('restauracao_versao_ver-') ||
      idNorm.includes('teste');

    if (ehTeste) {
      idsParaRemover.push(h.id);
    } else {
      console.log(`-> MANTENDO versão não classificada como teste: ID ${h.id} (${h.autor_nome})`);
    }
  }

  console.log(`\nTotal de registros de teste identificados para exclusão: ${idsParaRemover.length}`);
  if (idsParaRemover.length > 0) {
    console.log('Removendo registros de teste do Supabase...');
    const { error: erroDel } = await supabase
      .from('configuracoes_vega_historico')
      .delete()
      .in('id', idsParaRemover);

    if (erroDel) {
      console.error('Erro ao deletar registros de teste:', erroDel);
    } else {
      console.log('✔ Registros de teste removidos com sucesso do Supabase!');
    }
  }

  // Ajusta o registro ativo se ele estiver com autor de teste
  if (ativo && ativo.length > 0) {
    const reg = ativo[0];
    const autorAtivo = (reg.atualizado_por_nome || '').toLowerCase();
    if (autorAtivo.includes('carlos eduardo') || autorAtivo.includes('teste') || autorAtivo.includes('rollback')) {
      console.log('\n-> Ajustando autor do registro ativo para "Painel (senha única)"...');
      await supabase.from('configuracoes_vega').update({
        atualizado_por_nome: 'Painel (senha única)',
        atualizado_por_id: 'admin',
      }).eq('id', reg.id);
      console.log('✔ Registro ativo ajustado.');
    }
  }

  console.log('\n=== HISTÓRICO APÓS LIMPEZA ===');
  const { data: historicoFinal } = await supabase
    .from('configuracoes_vega_historico')
    .select('id, autor_nome, autor_id, temperatura_resposta, motivo, criado_em')
    .order('criado_em', { ascending: false });

  console.log(JSON.stringify(historicoFinal, null, 2));
}

diagnosticarELimparHistorico().catch(console.error);
