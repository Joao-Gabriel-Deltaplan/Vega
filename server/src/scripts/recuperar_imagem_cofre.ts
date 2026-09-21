import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { adicionarDocumento, obterTodosDocumentos } from '../storage.js';
import { indexarDocumentoBackground } from '../indexador/indexadorAutomatico.js';
import { DocumentoRegistro } from '../types.js';

async function main() {
  console.log('--- RECUPERAÇÃO E INDEXAÇÃO DE DADOS THOMAZ.jpeg ---');
  const supabase = getSupabaseClient();

  // Verifica se o arquivo está no Storage
  const { data: listaStorage, error: errStorage } = await supabase.storage.from('documentos').list();
  if (errStorage) {
    console.error('Erro ao listar bucket documentos:', errStorage);
    return;
  }

  const arquivoStorage = listaStorage?.find((f) => f.name === 'DADOS THOMAZ.jpeg');
  if (!arquivoStorage) {
    console.error('Arquivo "DADOS THOMAZ.jpeg" não encontrado no bucket documentos!');
    return;
  }
  const tamanhoKb = arquivoStorage.metadata?.size ? (arquivoStorage.metadata.size / 1024).toFixed(1) : '27.7';
  console.log(`✅ Arquivo encontrado no Storage: "${arquivoStorage.name}" (${tamanhoKb} KB)`);

  // Insere ou obtém registro na tabela documentos
  const docRegistro: DocumentoRegistro = {
    id: `doc-recuperado-${Date.now()}`,
    titulo: 'Dados Thomaz',
    arquivo: 'DADOS THOMAZ.jpeg',
    tipo: 'Documento Pessoal',
    titular: 'Thomaz',
    descricao: 'Documento com dados pessoais de Thomaz recuperado no cofre.',
    visibilidade: 'diretoria',
    tamanho: `${tamanhoKb} KB`,
    statusIndexacao: 'pendente',
    storagePath: 'DADOS THOMAZ.jpeg',
    apelidos: ['dados thomaz', 'thomaz', 'documento pessoal'],
  };

  const docSalvo = await adicionarDocumento(docRegistro);
  console.log(`✅ Documento registrado na tabela com ID: ${docSalvo.id}`);

  // Dispara a indexação
  console.log('⚡ Disparando indexação com visão (gpt-5.4-mini)...');
  await indexarDocumentoBackground(docSalvo);

  // Aguarda 15 segundos para indexação completar
  console.log('⏳ Aguardando conclusão da indexação...');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const todos = await obterTodosDocumentos();
    const docAtualizado = todos.find((d) => d.arquivo === 'DADOS THOMAZ.jpeg');
    if (docAtualizado && docAtualizado.statusIndexacao !== 'pendente') {
      console.log(`\n🎉 Indexação finalizada! Status: "${docAtualizado.statusIndexacao}"`);
      if (docAtualizado.erroIndexacao) {
        console.error(`❌ Erro registrado: ${docAtualizado.erroIndexacao}`);
      } else {
        console.log(`✅ Documento indexado com sucesso!`);
        console.log(`- Título: ${docAtualizado.titulo}`);
        console.log(`- Titular: ${docAtualizado.titular}`);
        console.log(`- Validade: ${docAtualizado.dataValidade || 'N/A'}`);
        
        // Verifica trechos gerados
        const { data: trechos } = await supabase.from('trechos').select('id, pagina, conteudo').eq('documento_id', docAtualizado.id);
        console.log(`- Trechos salvos no Supabase: ${trechos?.length || 0}`);
        if (trechos && trechos.length > 0) {
          console.log(`- Prévia do primeiro trecho:\n"${trechos[0].conteudo.slice(0, 300)}..."`);
        }
      }
      return;
    }
  }

  console.log('⚠️ Tempo de espera expirou, mas o processo pode ainda estar rodando em background.');
}

main().catch(console.error);
