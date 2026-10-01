import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '..');

interface Ocorrencia {
  arquivo: string;
  linha: number;
  tipo: string;
  conteudo: string;
  contexto: string;
}

const ocorrencias: Ocorrencia[] = [];

function percorrerDir(dir: string) {
  const arquivos = fs.readdirSync(dir);
  for (const arq of arquivos) {
    const fullPath = path.join(dir, arq);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (arq === 'scripts' || arq === 'node_modules' || arq === 'dist') continue;
      percorrerDir(fullPath);
    } else if (arq.endsWith('.ts')) {
      analisarArquivo(fullPath);
    }
  }
}

function analisarArquivo(filePath: string) {
  const relPath = path.relative(SRC_DIR, filePath);
  const conteudo = fs.readFileSync(filePath, 'utf-8');
  const linhas = conteudo.split('\n');

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const numLinha = i + 1;

    // Padrões suspeitos:
    // 1. Array index [0] ou [length - 1] ou pop() ou slice(-1) em variáveis de documentos, titulares, conhecimentos, fichas
    // 2. Fallbacks com || para [0] ou último
    // 3. Fallbacks de titular ("Delta Plan", "Outros", primeiro titular)
    // 4. Ações de delete, update, insert, enviar, anexo, remover
    
    // Verificações específicas:
    const ehAcaoEscritaEnvio = /toolAtualizar|toolRemover|toolCadastrar|toolEnviar|apagar|remover|excluir|update|delete|insert|enviar_documento|anexo|confirmar_versao/i.test(l) ||
      linhas.slice(Math.max(0, i - 15), i + 5).some(ctx => /function\s+tool|async\s+function\s+tool|router\.(post|put|delete)|case\s+['"](enviar|apagar|remover|cadastrar|atualizar|corrigir)/i.test(ctx));

    // Padrão A: Pegar primeiro ou último elemento de lista em contexto de seleção/decisão
    const matchArrayCego = l.match(/(\w+)\[\s*0\s*\]|\.slice\(-1\)\[0\]|\.pop\(\)|\[\s*(\w+)\.length\s*-\s*1\s*\]/);
    if (matchArrayCego) {
      const varName = matchArrayCego[1] || matchArrayCego[2] || '';
      // Ignorar matches inofensivos conhecidos (ex: regex match[0], split('@')[0], choices[0] de resposta OpenAI)
      const ehInofensivo = /split|match|exec|choices|matrix|matriz|partes|palavras|linhas|tokens|headers|req\.params/i.test(varName) ||
        /split\([^)]+\)\[0\]|match\[0\]|choices\[0\]|req\.params\[0\]|headers\[.*\]/i.test(l);

      if (!ehInofensivo) {
        ocorrencias.push({
          arquivo: relPath,
          linha: numLinha,
          tipo: ehAcaoEscritaEnvio ? 'CRÍTICO_ESCRITA_ENVIO_ARRAY' : 'ARRAY_INDEX_CEGO',
          conteudo: l.trim(),
          contexto: linhas.slice(Math.max(0, i - 2), Math.min(linhas.length, i + 3)).join('\n')
        });
      }
    }

    // Padrão B: Fallbacks com || assumindo primeiro ou último registro
    if (/\|\|\s*\w+\[0\]|\|\|\s*\w+\[\w+\.length\s*-\s*1\]/i.test(l)) {
      ocorrencias.push({
        arquivo: relPath,
        linha: numLinha,
        tipo: 'FALLBACK_OR_ARRAY_CEGO',
        conteudo: l.trim(),
        contexto: linhas.slice(Math.max(0, i - 2), Math.min(linhas.length, i + 3)).join('\n')
      });
    }

    // Padrão C: Fallback para titular ou documento padrão
    if (/(titular|documento|tipo)\s*(?:=|:)\s*.*\|\|\s*['"](Delta Plan|Outros|Geral|Padrao|Padrão)['"]/i.test(l)) {
      ocorrencias.push({
        arquivo: relPath,
        linha: numLinha,
        tipo: 'FALLBACK_TITULAR_OU_TIPO_PADRAO',
        conteudo: l.trim(),
        contexto: linhas.slice(Math.max(0, i - 2), Math.min(linhas.length, i + 3)).join('\n')
      });
    }

    // Padrão D: Substring solta em busca de conhecimento ou documento para alterar/apagar
    if (ehAcaoEscritaEnvio && /(\.includes\(|\.indexOf\()/.test(l)) {
      // Checar se é filtro de item para alteração/remoção
      if (/titulo|nome|termo|busca|chave/i.test(l) && !/tipo|status|admin|role/i.test(l)) {
        ocorrencias.push({
          arquivo: relPath,
          linha: numLinha,
          tipo: 'SUBSTRING_SOLTA_EM_ESCRITA',
          conteudo: l.trim(),
          contexto: linhas.slice(Math.max(0, i - 2), Math.min(linhas.length, i + 3)).join('\n')
        });
      }
    }
  }
}

percorrerDir(SRC_DIR);

console.log(`\n======================================================`);
console.log(`🔍 VARREDURA DE FALLBACKS CEGOS EM SERVER/SRC`);
console.log(`Total de ocorrências encontradas: ${ocorrencias.length}`);
console.log(`======================================================\n`);

const criticos = ocorrencias.filter(o => o.tipo.startsWith('CRÍTICO') || o.tipo.startsWith('FALLBACK') || o.tipo.startsWith('SUBSTRING'));
console.log(`--- OCORRÊNCIAS EM AÇÕES DE ESCRITA, ENVIO OU FALLBACK DIRETO (${criticos.length}) ---`);
for (const c of criticos) {
  console.log(`\n📍 [${c.tipo}] ${c.arquivo}:${c.linha}`);
  console.log(`   Código: ${c.conteudo}`);
}

console.log(`\n--- OUTRAS OCORRÊNCIAS DE ARRAY INDEX ([0], [length - 1], pop) (${ocorrencias.length - criticos.length}) ---`);
for (const o of ocorrencias.filter(o => !criticos.includes(o))) {
  console.log(`📍 [${o.tipo}] ${o.arquivo}:${o.linha} -> ${o.conteudo}`);
}
