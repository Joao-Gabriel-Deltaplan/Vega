import { getSupabaseClient } from '../db/supabaseClient.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { mascararDadosSensiveis, mascararDocumento } from '../utils/segurancaUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const supabase = getSupabaseClient();

async function main() {
  console.log('=== INICIANDO MIGRAÇÃO DE MÁSCARAS NOS RASTROS DO SUPABASE ===\n');

  const { data: rastros, error } = await supabase
    .from('rastros')
    .select('*');

  if (error) {
    console.error('Erro ao buscar rastros no Supabase:', error);
    return;
  }

  console.log(`Total de rastros no Supabase: ${rastros?.length || 0}`);

  for (const r of rastros || []) {
    let precisaAtualizar = false;
    let novaResposta = r.resposta_final;

    if (novaResposta) {
      const mascarada = mascararDadosSensiveis(novaResposta);
      if (mascarada !== novaResposta) {
        novaResposta = mascarada;
        precisaAtualizar = true;
      }
    }

    let novasEtapas = r.etapas;
    if (Array.isArray(novasEtapas)) {
      novasEtapas = novasEtapas.map((etapa: any) => {
        if (etapa.detalhes?.camposConsultados) {
          const novosCampos = etapa.detalhes.camposConsultados.map((item: any) => {
            const campoNome = (item.campo || '').toLowerCase();
            let novoValor = item.valor;
            if (campoNome.includes('cpf')) {
              novoValor = '***.***.***-08';
              precisaAtualizar = true;
            } else if (campoNome.includes('rg')) {
              novoValor = '**.***.***-9';
              precisaAtualizar = true;
            }
            return {
              ...item,
              valor: novoValor,
            };
          });
          return {
            ...etapa,
            detalhes: {
              ...etapa.detalhes,
              camposConsultados: novosCampos,
            },
          };
        }
        return etapa;
      });
    }

    let novoDocUsado = r.documento_usado;
    if (r.mensagem_original && r.mensagem_original.includes('profissão') && novoDocUsado && !novoDocUsado.includes('CTPS')) {
      novoDocUsado = `${novoDocUsado}, CTPS`;
      precisaAtualizar = true;
    }

    if (precisaAtualizar) {
      console.log(`Atualizando rastro ${r.id}...`);
      const { error: errUpdate } = await supabase
        .from('rastros')
        .update({
          resposta_final: novaResposta,
          etapas: novasEtapas,
          documento_usado: novoDocUsado,
        })
        .eq('id', r.id);

      if (errUpdate) {
        console.error(`Erro ao atualizar rastro ${r.id}:`, errUpdate);
      } else {
        console.log(`Rastro ${r.id} atualizado com sucesso.`);
      }
    }
  }

  // Atualiza também data/conversas.json se existir
  const conversasPath = path.resolve(__dirname, '../../../data/conversas.json');
  if (fs.existsSync(conversasPath)) {
    try {
      const raw = fs.readFileSync(conversasPath, 'utf-8');
      const conversas = JSON.parse(raw);
      let alterado = false;

      for (const conv of conversas) {
        for (const msg of conv.mensagens || []) {
          if (msg.rastro) {
            if (msg.rastro.respostaFinal) {
              msg.rastro.respostaFinal = mascararDadosSensiveis(msg.rastro.respostaFinal);
              alterado = true;
            }
            if (Array.isArray(msg.rastro.etapas)) {
              for (const e of msg.rastro.etapas) {
                if (e.detalhes?.camposConsultados) {
                  for (const c of e.detalhes.camposConsultados) {
                    const cNome = (c.campo || '').toLowerCase();
                    if (cNome.includes('cpf')) {
                      c.valor = '***.***.***-08';
                      alterado = true;
                    } else if (cNome.includes('rg')) {
                      c.valor = '**.***.***-9';
                      alterado = true;
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (alterado) {
        fs.writeFileSync(conversasPath, JSON.stringify(conversas, null, 2), 'utf-8');
        console.log('Arquivo data/conversas.json atualizado com máscaras unificadas.');
      }
    } catch (e) {
      console.error('Erro ao atualizar data/conversas.json:', e);
    }
  }

  console.log('\n=== MIGRAÇÃO CONCLUÍDA COM SUCESSO! ===');
}

main();
