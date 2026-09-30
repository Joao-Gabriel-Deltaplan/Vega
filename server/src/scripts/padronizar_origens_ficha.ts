import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { obterTodosDocumentos, obterTodosTitulares, salvarOuAtualizarTitular } from '../storage.js';
import { DocumentoRegistro } from '../types.js';

interface ConversaoOrigem {
  titular: string;
  campo: string;
  valor: string;
  origemAntiga: string;
  origemNova: string;
  origemNomeNovo: string;
}

interface OrigemNaoEncontrada {
  titular: string;
  campo: string;
  valor: string;
  origem: string;
  origemNome?: string;
}

function normalizarTexto(txt: string): string {
  return txt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function encontrarDocumentoCorrespondente(
  origem: string,
  origemNome: string | undefined,
  titularNome: string,
  campo: string,
  todosDocs: DocumentoRegistro[]
): DocumentoRegistro | null {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(origem);

  // 1. Busca direta por UUID exato
  if (isUuid) {
    const docExato = todosDocs.find((d) => d.id === origem);
    if (docExato) return docExato;
  }

  // 2. Busca por id_legado nos metadados
  const docPorIdLegado = todosDocs.find(
    (d) => (d.metadata as any)?.id_legado === origem || d.id === origem
  );
  if (docPorIdLegado) return docPorIdLegado;

  const oNorm = normalizarTexto(origem);
  const onNorm = origemNome ? normalizarTexto(origemNome) : '';
  const titNorm = normalizarTexto(titularNome);

  // Documentos deste titular
  const docsDesteTitular = todosDocs.filter(
    (d) => d.titular && normalizarTexto(d.titular).includes(titNorm.slice(0, 5))
  );

  // 3. Busca por título ou arquivo exato em todos os documentos
  for (const doc of todosDocs) {
    const tDoc = normalizarTexto(doc.titulo);
    const aDoc = normalizarTexto(doc.arquivo);
    if (tDoc === oNorm || aDoc === oNorm) return doc;
    if (onNorm && (tDoc === onNorm || aDoc === onNorm)) return doc;
  }

  // 4. Mapeamento heurístico nos documentos do próprio titular
  for (const doc of docsDesteTitular.length > 0 ? docsDesteTitular : todosDocs) {
    const tDoc = normalizarTexto(doc.titulo);
    const aDoc = normalizarTexto(doc.arquivo);

    // CNH
    if (
      (oNorm.includes('cnh') || onNorm.includes('cnh') || oNorm === 'doc1' || oNorm.includes('1789586064138')) &&
      (tDoc.includes('cnh') || aDoc.includes('cnh'))
    ) {
      return doc;
    }

    // Certidão de casamento
    if (
      (oNorm.includes('certidao') || onNorm.includes('certidao') || oNorm === 'doccertidao') &&
      (tDoc.includes('casamento') || aDoc.includes('casamento') || tDoc.includes('certidao'))
    ) {
      return doc;
    }

    // CTPS / Carteira de trabalho
    if (
      (oNorm.includes('ctps') || onNorm.includes('ctps') || oNorm.includes('trabalho') || onNorm.includes('trabalho') || oNorm.includes('1789662106690')) &&
      (tDoc.includes('ctps') || aDoc.includes('ctps') || tDoc.includes('carteira') || aDoc.includes('trabalho'))
    ) {
      return doc;
    }

    // Imposto de Renda / DIRPF
    if (
      (oNorm.includes('imposto') || onNorm.includes('impostoderenda') || onNorm.includes('dirpf') || origem === '1885c3fd-01b5-4c41-bc7a-0ed9a062e83c') &&
      (tDoc.includes('imposto') || aDoc.includes('dirpf') || aDoc.includes('impostoderenda'))
    ) {
      return doc;
    }

    // Dados Thomaz / Imagem recuperada
    if (
      (oNorm.includes('dados') || onNorm.includes('dados')) &&
      (tDoc.includes('dados') || aDoc.includes('dados'))
    ) {
      return doc;
    }

    // ART
    if (
      (oNorm.includes('art') || onNorm.includes('art')) &&
      (tDoc.includes('art') || aDoc.includes('art'))
    ) {
      return doc;
    }

    // Substring match
    if (onNorm && (tDoc.includes(onNorm) || onNorm.includes(tDoc))) {
      return doc;
    }
    if (oNorm.length > 3 && (tDoc.includes(oNorm) || oNorm.includes(tDoc))) {
      return doc;
    }
  }

  return null;
}

async function main() {
  console.log('================================================================');
  console.log('PADRONIZAÇÃO DO CAMPO ORIGEM NA FICHA CADASTRAL (TABELA TITULARES)');
  console.log('Objetivo: Garantir que todo campo guarde estritamente o ID do documento');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();

  console.log(`Carregados ${todosDocs.length} documentos do Cofre e ${todosTitulares.length} fichas de titulares.\n`);

  const conversoes: ConversaoOrigem[] = [];
  const naoEncontradas: OrigemNaoEncontrada[] = [];

  for (const titular of todosTitulares) {
    let alterouTitular = false;

    for (const [campoKey, regRaw] of Object.entries(titular.campos || {})) {
      const reg = regRaw as any;
      if (!reg || !reg.origem) continue;

      // Se for correção manual do chat, não mexe
      if (reg.manual || reg.origem === 'corrigido pelo chat') {
        continue;
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reg.origem);
      const docJaExisteComEsseId = isUuid && todosDocs.some((d) => d.id === reg.origem);

      // Se já é um UUID válido de um documento existente no Cofre:
      if (docJaExisteComEsseId) {
        // Apenas confere se origemNome está correto
        const docRef = todosDocs.find((d) => d.id === reg.origem)!;
        if (!reg.origemNome || reg.origemNome !== docRef.titulo) {
          reg.origemNome = docRef.titulo;
          alterouTitular = true;
        }
        continue;
      }

      // Se não for UUID existente, tenta resolver o documento
      const docMatch = encontrarDocumentoCorrespondente(
        reg.origem,
        reg.origemNome,
        titular.nome,
        campoKey,
        todosDocs
      );

      if (docMatch) {
        conversoes.push({
          titular: titular.nome,
          campo: campoKey,
          valor: reg.valor,
          origemAntiga: reg.origem,
          origemNova: docMatch.id,
          origemNomeNovo: docMatch.titulo,
        });

        reg.origem = docMatch.id;
        reg.origemNome = docMatch.titulo;
        alterouTitular = true;
      } else {
        naoEncontradas.push({
          titular: titular.nome,
          campo: campoKey,
          valor: reg.valor,
          origem: reg.origem,
          origemNome: reg.origemNome,
        });
      }
    }

    if (alterouTitular) {
      await salvarOuAtualizarTitular(titular);
      console.log(`✅ Ficha do titular "${titular.nome}" atualizada no Supabase.`);
    }
  }

  console.log('\n================================================================');
  console.log(`RELATÓRIO DE CONVERSÕES (${conversoes.length} campos padronizados para ID do documento):`);
  console.log('================================================================');
  if (conversoes.length === 0) {
    console.log('Nenhum campo necessitou conversão.');
  } else {
    for (const c of conversoes) {
      console.log(`- [${c.titular}] Campo "${c.campo}":`);
      console.log(`  Origem antiga: "${c.origemAntiga}"`);
      console.log(`  -> Novo ID:    "${c.origemNova}" (${c.origemNomeNovo})\n`);
    }
  }

  console.log('================================================================');
  console.log(`ORIGENS QUE NÃO ENCONTRARAM DOCUMENTO CORRESPONDENTE NO COFRE (${naoEncontradas.length}):`);
  console.log('================================================================');
  if (naoEncontradas.length === 0) {
    console.log('Todas as origens foram localizadas e associadas a documentos existentes no Cofre!');
  } else {
    for (const n of naoEncontradas) {
      console.log(`- [${n.titular}] Campo "${n.campo}" (valor: "${n.valor}") | Origem: "${n.origem}" | OrigemNome: "${n.origemNome || 'N/A'}"`);
    }
  }
  console.log('================================================================\n');
}

main().catch(console.error);
