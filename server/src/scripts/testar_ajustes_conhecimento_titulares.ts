import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import {
  obterTodosConhecimentos,
  obterTodosDocumentos,
  obterTodosTitulares,
} from '../storage.js';

function normalizarTituloConhecimento(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function run() {
  console.log('================================================================');
  console.log('🔍 RELATÓRIO DE VALIDAÇÃO: CONHECIMENTO & TITULARES NO COFRE');
  console.log('================================================================\n');

  // 1. Conhecimento
  const conhecimentos = await obterTodosConhecimentos();
  console.log(`📘 Total de instruções em Conhecimento: ${conhecimentos.length}`);
  conhecimentos.forEach((c) => {
    console.log(`  - [${c.categoria}] "${c.titulo}" (ID: ${c.id})`);
  });

  // Teste da regra de normalização de títulos duplicados
  const testeTitulos = ['testes jg', 'TESTES JG', '  Testes   Jg  ', 'Outro Tópico Inédito'];
  console.log('\n🧪 Teste de detecção de duplicata de títulos:');
  for (const t of testeTitulos) {
    const tNorm = normalizarTituloConhecimento(t);
    const dup = conhecimentos.find((c) => normalizarTituloConhecimento(c.titulo) === tNorm);
    if (dup) {
      console.log(`  ❌ Título "${t}" bloqueado com sucesso! Casou com: "${dup.titulo}"`);
    } else {
      console.log(`  ✅ Título "${t}" liberado para cadastro (inédito).`);
    }
  }

  // 2. Titulares e Documentos no Cofre
  console.log('\n================================================================');
  console.log('👤 LEVANTAMENTO DE TITULARES & VÍNCULO COM DOCUMENTOS NO COFRE');
  console.log('================================================================\n');

  const titulares = await obterTodosTitulares();
  const documentos = await obterTodosDocumentos();

  console.log(`Total de Titulares cadastrados em data/titulares.json: ${titulares.length}`);
  console.log(`Total de Documentos no Cofre (data/documentos.json): ${documentos.length}\n`);

  // Análise de duplicidade de titulares
  const nomesContados = new Map<string, number>();
  titulares.forEach((t) => {
    const nomeNorm = t.nome.toLowerCase().trim();
    nomesContados.set(nomeNorm, (nomesContados.get(nomeNorm) || 0) + 1);
  });

  let temDuplicados = false;
  nomesContados.forEach((qtd, nome) => {
    if (qtd > 1) {
      console.log(`⚠️ ALERTA: Titular duplicado encontrado: "${nome}" (${qtd} ocorrências)`);
      temDuplicados = true;
    }
  });

  if (!temDuplicados) {
    console.log('✅ Nenhum titular duplicado encontrado!');
  }

  // Análise de documentos por titular
  console.log('\n📋 Detalhamento dos Titulares e seus documentos associados:');
  for (const tit of titulares) {
    const dTit = tit.nome.toLowerCase().trim();
    const primeiroNome = dTit.split(' ')[0];

    const docsDoTit = documentos.filter((d) => {
      if (!d.titular) return false;
      const tDoc = d.titular.toLowerCase().trim();
      return tDoc === dTit || d.titular === tit.id || (primeiroNome.length >= 3 && tDoc.includes(primeiroNome));
    });

    const camposEntries = Object.entries(tit.campos || {});
    const conferidos = camposEntries.filter(([_, c]) => c?.conferido).length;
    const sugeridos = camposEntries.filter(([_, c]) => !c?.conferido).length;

    console.log(`\n• Titular: "${tit.nome}" (ID: ${tit.id})`);
    console.log(`  - Ficha: ${conferidos} campos conferidos, ${sugeridos} campos sugeridos (Total: ${camposEntries.length})`);
    console.log(`  - Documentos vinculados: ${docsDoTit.length}`);
    if (docsDoTit.length === 0) {
      console.log(`  ⚠️ AVISO: Este titular NÃO possui nenhum documento no cofre.`);
    } else {
      docsDoTit.forEach((d) => {
        console.log(`    📄 [${d.tipo || 'Doc'}] "${d.titulo}" (${d.arquivo}) - Visibilidade: ${d.visibilidade}`);
      });
    }
  }

  // Documentos que não pertencem a nenhum titular cadastrado
  const docsSemTitular = documentos.filter((d) => {
    return !titulares.some((tit) => {
      if (!d.titular) return false;
      const tDoc = d.titular.toLowerCase().trim();
      const dTit = tit.nome.toLowerCase().trim();
      const primeiroNome = dTit.split(' ')[0];
      return tDoc === dTit || d.titular === tit.id || (primeiroNome.length >= 3 && tDoc.includes(primeiroNome));
    });
  });

  console.log(`\n🏢 Documentos Corporativos / Sem Titular Individual: ${docsSemTitular.length}`);
  docsSemTitular.forEach((d) => {
    console.log(`  📄 [${d.tipo || 'Doc'}] "${d.titulo}" (${d.arquivo})`);
  });

  console.log('\n================================================================');
  console.log('✅ VALIDAÇÃO CONCLUÍDA!');
  console.log('================================================================');
}

run().catch(console.error);
