import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import {
  verificarSeEhDocumentoPessoal,
  verificarSeEhTitularEmpresa,
} from '../processadorSegundoPlanoService.js';
import { titularCorresponde } from '../busca/motor.js';

interface DocumentoSuspeito {
  id: string;
  titulo: string;
  arquivo: string;
  titularAtual: string;
  tipoAtual: string;
  donoProvavel: string;
  motivo: string;
  trechoEvidencia?: string;
}

/**
 * Script de auditoria de documentos no Cofre da Delta Plan (READ-ONLY)
 * Percorre os documentos já indexados e identifica potenciais inconsistências
 * de titularidade ou tipo documental, sem alterar nenhum registro no banco.
 */
async function auditarTitularesETipos(): Promise<void> {
  console.log('\n================================================================');
  console.log('🔍 [Auditoria VEGA] Iniciando varredura de titulares e tipos no Cofre...');
  console.log('Modo: ESTRITAMENTE LEITURA (nenhum dado será modificado)');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();

  // 1. Carrega todos os documentos e titulares do Supabase
  const [{ data: documentos, error: errDocs }, { data: titulares, error: errTits }] = await Promise.all([
    supabase
      .from('documentos')
      .select('id, titulo, arquivo, tipo, titular, pessoa_id, corporativo, descricao, metadata, status_indexacao'),
    supabase.from('titulares').select('id, nome, apelidos'),
  ]);

  if (errDocs) {
    console.error('❌ Erro ao consultar documentos no Supabase:', errDocs.message);
    return;
  }

  const listaDocs = documentos || [];
  const listaTitulares = titulares || [];
  console.log(`📊 Total de documentos no Cofre: ${listaDocs.length}`);
  console.log(`👤 Total de titulares cadastrados: ${listaTitulares.length}\n`);

  // Carrega trechos de todos os documentos para identificar menções a nomes nos documentos
  const docIds = listaDocs.map((d) => d.id);
  const { data: todosTrechos } = await supabase
    .from('trechos')
    .select('documento_id, conteudo, pagina')
    .in('documento_id', docIds)
    .order('pagina', { ascending: true });

  const trechosPorDoc = new Map<string, string[]>();
  for (const t of todosTrechos || []) {
    if (!trechosPorDoc.has(t.documento_id)) {
      trechosPorDoc.set(t.documento_id, []);
    }
    trechosPorDoc.get(t.documento_id)!.push(t.conteudo);
  }

  const suspeitos: DocumentoSuspeito[] = [];

  for (const doc of listaDocs) {
    const titularAtual = (doc.titular || '').trim();
    const tipoAtual = (doc.tipo || '').trim();
    const titulo = doc.titulo || '';
    const arquivo = doc.arquivo || '';

    const ehPessoal = verificarSeEhDocumentoPessoal(tipoAtual, titulo, arquivo);
    const titularEhEmpresa = verificarSeEhTitularEmpresa(titularAtual);
    const trechosDoDoc = trechosPorDoc.get(doc.id) || [];
    const textoDoc = [doc.descricao || '', ...trechosDoDoc].join('\n');

    // Tenta encontrar o dono provável nos metadados ou no texto do documento
    let donoProvavel =
      (doc.metadata?.donoProvavel as string) ||
      (doc.metadata?.nomeNoDocumento as string) ||
      (doc.metadata?.donoDocumento as string) ||
      '';

    let trechoEvidencia = '';

    if (!donoProvavel) {
      // Regex para extrair nomes de CNH, RG, CTPS, Certidão
      const matchNomeTexto =
        /(?:nome(?:\s+completo)?|titular|identifica[cç][aã]o|requerente|portador|trabalhador)[\s:]+([A-ZÀ-ÖØ-öø-ÿ\s]{5,40})(?=\n|,|\.|\s{2,}|cpf|rg)/i.exec(
          textoDoc
        );
      if (matchNomeTexto && matchNomeTexto[1]) {
        const candidato = matchNomeTexto[1].trim().replace(/\s+/g, ' ');
        if (candidato.length >= 4 && !/^(delta|plan|empresa|engenharia|construtora)/i.test(candidato)) {
          donoProvavel = candidato;
          trechoEvidencia = matchNomeTexto[0].trim();
        }
      }
    }

    // Se no título ou nome de arquivo houver nome específico
    if (!donoProvavel) {
      if (/nil/i.test(arquivo) || /nilceia/i.test(titulo)) {
        donoProvavel = 'Nilceia Batista Ramos Fabre';
      }
    }

    // REGRA 1: Documento pessoal arquivado sob empresa (Delta Plan, RENG, etc.) ou sem titular
    if (ehPessoal && (titularEhEmpresa || !titularAtual || doc.corporativo === true)) {
      suspeitos.push({
        id: doc.id,
        titulo,
        arquivo,
        titularAtual: titularAtual || '(Sem titular)',
        tipoAtual: tipoAtual || '(Sem tipo)',
        donoProvavel: donoProvavel || 'Pessoa física a identificar no texto',
        motivo: `Documento de identificação pessoal (${tipoAtual || titulo}) arquivado sob empresa (${titularAtual || 'Corporativo'})`,
        trechoEvidencia,
      });
      continue;
    }

    // REGRA 2: CTPS classificada com tipo incorreto (ex: tipo "CNPJ" ou "Outros")
    if (/\b(ctps|carteira\s+de\s+trabalho|carteira\s+digital)\b/i.test(`${titulo} ${arquivo}`)) {
      if (tipoAtual.toLowerCase() === 'cnpj' || tipoAtual.toLowerCase() === 'outros' || !tipoAtual) {
        suspeitos.push({
          id: doc.id,
          titulo,
          arquivo,
          titularAtual,
          tipoAtual: tipoAtual || '(Sem tipo)',
          donoProvavel: donoProvavel || titularAtual,
          motivo: `Carteira de Trabalho (CTPS) com tipo incorretamente classificado como "${tipoAtual}"`,
          trechoEvidencia,
        });
        continue;
      }
    }

    // REGRA 3: Dono extraído claramente diferente do titular vinculado
    if (donoProvavel && titularAtual && !titularEhEmpresa) {
      const corresponde = titularCorresponde(titularAtual, donoProvavel);
      if (!corresponde) {
        suspeitos.push({
          id: doc.id,
          titulo,
          arquivo,
          titularAtual,
          tipoAtual,
          donoProvavel,
          motivo: `Dono extraído do texto ("${donoProvavel}") diverge do titular oficial cadastrado ("${titularAtual}")`,
          trechoEvidencia,
        });
        continue;
      }
    }

    // REGRA 4: Documento marcado com alerta 'titular_a_revisar' nos metadados
    if (doc.metadata?.alertaTitular === 'titular_a_revisar') {
      suspeitos.push({
        id: doc.id,
        titulo,
        arquivo,
        titularAtual,
        tipoAtual,
        donoProvavel: donoProvavel || (doc.metadata?.donoProvavel as string) || 'Não identificado',
        motivo: 'Marcado explicitamente com alerta "titular a revisar"',
        trechoEvidencia,
      });
    }
  }

  // Relatório Final
  console.log('================================================================');
  console.log(`📋 RESULTADO DA AUDITORIA: ${suspeitos.length} DOCUMENTO(S) SUSPEITO(S) ENCONTRADO(S)`);
  console.log('================================================================\n');

  if (suspeitos.length === 0) {
    console.log('✅ Nenhum documento com inconsistência de titular ou tipo foi identificado.');
    return;
  }

  suspeitos.forEach((s, idx) => {
    console.log(`--- [Suspeito #${idx + 1}] ---`);
    console.log(`📌 ID: ${s.id}`);
    console.log(`📄 Título: "${s.titulo}"`);
    console.log(`📁 Arquivo: "${s.arquivo}"`);
    console.log(`🏷️  Tipo atual: "${s.tipoAtual}"`);
    console.log(`👤 Titular gravado: "${s.titularAtual}"`);
    console.log(`🎯 Dono provável (texto/metadados): "${s.donoProvavel}"`);
    console.log(`⚠️  Motivo da suspeita: ${s.motivo}`);
    if (s.trechoEvidencia) {
      console.log(`🔎 Trecho de evidência: "${s.trechoEvidencia.slice(0, 150)}..."`);
    }
    console.log('');
  });

  console.log('================================================================');
  console.log('Fim da auditoria. Lembrete: este script é apenas de inspeção e não modificou dados.');
  console.log('================================================================\n');
}

auditarTitularesETipos().catch((err) => {
  console.error('Falha na auditoria:', err);
  process.exit(1);
});
