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

async function migrar() {
  console.log('====================================================');
  console.log('INICIANDO MIGRAÇÃO DOS DADOS E ARQUIVOS PARA SUPABASE');
  console.log('====================================================\n');

  const supabase = getSupabaseClient();

  // 1. SUPABASE STORAGE (BUCKET PRIVADO 'documentos')
  console.log('--- 1. CONFIGURANDO STORAGE (BUCKET PRIVADO) ---');
  const { data: buckets, error: errBuckets } = await supabase.storage.listBuckets();
  if (errBuckets) {
    throw new Error(`Erro ao listar buckets: ${errBuckets.message}`);
  }

  const bucketExiste = buckets.some((b) => b.name === 'documentos');
  if (!bucketExiste) {
    console.log('Criando bucket privado "documentos"...');
    const { error: errCreate } = await supabase.storage.createBucket('documentos', {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });
    if (errCreate) {
      throw new Error(`Erro ao criar bucket "documentos": ${errCreate.message}`);
    }
    console.log('✔ Bucket "documentos" criado com sucesso (privado).');
  } else {
    console.log('✔ Bucket "documentos" já existe.');
  }

  // Upload dos PDFs da pasta arquivos/
  console.log('\nFazendo upload dos arquivos PDF...');
  const arquivosFisicos = fs.readdirSync(ARQUIVOS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  let totalUploads = 0;

  for (const arquivo of arquivosFisicos) {
    const caminhoFisico = path.join(ARQUIVOS_DIR, arquivo);
    const buffer = fs.readFileSync(caminhoFisico);
    const { error: errUpload } = await supabase.storage
      .from('documentos')
      .upload(arquivo, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (errUpload) {
      console.error(`Erro ao subir ${arquivo}:`, errUpload.message);
    } else {
      totalUploads++;
      console.log(`✔ Upload concluído: ${arquivo} (${(buffer.length / 1024).toFixed(1)} KB)`);
    }
  }
  console.log(`Total de arquivos enviados ao Storage: ${totalUploads}/${arquivosFisicos.length}`);

  // 2. MIGRAÇÃO DE DOCUMENTOS
  console.log('\n--- 2. MIGRANDO DOCUMENTOS (METADADOS NO BANCO) ---');
  const docsLocaisRaw = fs.readFileSync(path.join(DATA_DIR, 'documentos.json'), 'utf-8');
  const docsLocais = JSON.parse(docsLocaisRaw) as any[];

  // Obter documentos já existentes no Supabase
  const { data: docsBanco, error: errDocsBanco } = await supabase
    .from('documentos')
    .select('id, arquivo, titulo, metadata');
  if (errDocsBanco) throw errDocsBanco;

  const docIdMap = new Map<string, string>(); // mapeia id local -> uuid banco

  for (const doc of docsLocais) {
    const correspondente = docsBanco.find(
      (b) => b.arquivo.trim().toLowerCase() === doc.arquivo.trim().toLowerCase()
    );

    const dadosAtualizacao: any = {
      titular: doc.titular || null,
      descricao: doc.descricao || null,
      apelidos: doc.apelidos || [],
      tamanho: doc.tamanho || null,
      status_indexacao: doc.statusIndexacao || 'indexado',
      erro_indexacao: doc.erroIndexacao || null,
      data_validade: doc.dataValidade || null,
      origem_validade: doc.origemValidade || null,
      historico_validade: doc.historicoValidade || null,
      silenciar_alertas: Boolean(doc.silenciarAlertas),
      trecho_validade: doc.trechoValidade || null,
      storage_path: doc.arquivo,
    };

    if (correspondente) {
      docIdMap.set(doc.id, correspondente.id);
      dadosAtualizacao.metadata = {
        ...(correspondente.metadata || {}),
        id_legado: doc.id,
      };

      const { error: errUp } = await supabase
        .from('documentos')
        .update(dadosAtualizacao)
        .eq('id', correspondente.id);

      if (errUp) {
        console.error(`Erro ao atualizar documento ${doc.titulo}:`, errUp);
      } else {
        console.log(`✔ Documento atualizado no banco: "${doc.titulo}" (${correspondente.id})`);
      }
    } else {
      console.log(`Inserindo novo documento que não estava no banco: "${doc.titulo}"`);
      const { data: novoDoc, error: errIns } = await supabase
        .from('documentos')
        .insert({
          titulo: doc.titulo,
          arquivo: doc.arquivo,
          tipo: doc.tipo || 'Documento Pessoal',
          visibilidade: doc.visibilidade || 'diretoria',
          ...dadosAtualizacao,
          metadata: { id_legado: doc.id },
        })
        .select('id')
        .single();

      if (errIns) {
        console.error(`Erro ao inserir documento ${doc.titulo}:`, errIns);
      } else if (novoDoc) {
        docIdMap.set(doc.id, novoDoc.id);
        console.log(`✔ Novo documento inserido: "${doc.titulo}" (${novoDoc.id})`);
      }
    }
  }

  // 3. MIGRAÇÃO DE TITULARES
  console.log('\n--- 3. MIGRANDO TITULARES ---');
  const titularesLocais = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'titulares.json'), 'utf-8'));
  for (const t of titularesLocais) {
    const { error: errTit } = await supabase
      .from('titulares')
      .upsert({
        id: t.id,
        nome: t.nome,
        campos: t.campos || {},
        atualizado_em: t.atualizadoEm || null,
      }, { onConflict: 'id' });

    if (errTit) console.error(`Erro ao migrar titular ${t.nome}:`, errTit);
    else console.log(`✔ Titular migrado: ${t.nome} (${t.id})`);
  }

  // 4. MIGRAÇÃO DE CONHECIMENTO
  console.log('\n--- 4. MIGRANDO BASE DE CONHECIMENTO ---');
  const conhecimentoLocal = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'conhecimento.json'), 'utf-8'));
  for (const k of conhecimentoLocal) {
    const { error: errK } = await supabase
      .from('conhecimento')
      .upsert({
        id: k.id,
        titulo: k.titulo,
        categoria: k.categoria,
        conteudo: k.conteudo,
        data_atualizacao: k.dataAtualizacao || null,
      }, { onConflict: 'id' });

    if (errK) console.error(`Erro ao migrar item conhecimento ${k.titulo}:`, errK);
    else console.log(`✔ Conhecimento migrado: "${k.titulo}" (${k.categoria})`);
  }

  // 5. MIGRAÇÃO DE USUÁRIOS (WHATSAPP)
  console.log('\n--- 5. MIGRANDO USUÁRIOS ---');
  const usuariosLocais = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'usuarios.json'), 'utf-8'));
  for (const u of usuariosLocais) {
    const { error: errU } = await supabase
      .from('usuarios')
      .upsert({
        id: u.id,
        numero: u.numero,
        nome: u.nome,
        perfil: u.perfil || 'comum',
        pessoa_id: u.pessoa_id || null,
        ativo: u.ativo !== undefined ? u.ativo : true,
        data_cadastro: u.dataCadastro || null,
      }, { onConflict: 'id' });

    if (errU) console.error(`Erro ao migrar usuário ${u.nome}:`, errU);
    else console.log(`✔ Usuário migrado: ${u.nome} (${u.numero} - ${u.perfil})`);
  }

  // 6. MIGRAÇÃO DE ALERTAS DE VENCIMENTO
  console.log('\n--- 6. MIGRANDO ALERTAS DE VENCIMENTO ---');
  const alertasLocais = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'alertas_vencimento.json'), 'utf-8'));
  for (const a of alertasLocais) {
    // Vincula ao UUID correspondente do documento
    const docIdBanco = docIdMap.get(a.documentoId) || a.documentoId;

    const { error: errAlt } = await supabase
      .from('alertas_vencimento')
      .upsert({
        id: a.id,
        documento_id: docIdBanco,
        documento_titulo: a.documentoTitulo,
        titular: a.titular || null,
        data_validade: a.dataValidade,
        dias_restantes: a.diasRestantes,
        status: a.status,
        prazo_alerta: String(a.prazoAlerta),
        data_geracao: a.dataGeracao || new Date().toISOString(),
        lido: Boolean(a.lido),
        notificado_whatsapp: Boolean(a.notificadoWhatsApp),
      }, { onConflict: 'id' });

    if (errAlt) console.error(`Erro ao migrar alerta ${a.id}:`, errAlt);
    else console.log(`✔ Alerta migrado: ${a.documentoTitulo} - ${a.dataValidade} (Lido: ${a.lido})`);
  }

  // 7. MIGRAÇÃO DE USO IA
  console.log('\n--- 7. MIGRANDO REGISTROS DE USO IA ---');
  const usoIaLocal = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'uso_ia.json'), 'utf-8'));
  // Grava em lotes de 50
  for (let i = 0; i < usoIaLocal.length; i += 50) {
    const lote = usoIaLocal.slice(i, i + 50).map((item: any) => ({
      id: item.id,
      data: item.data || new Date().toISOString(),
      provedor: item.provedor,
      modelo: item.modelo,
      contato_id: item.contatoId || null,
      contato_nome: item.contatoNome || null,
      motivo: item.motivo,
      tokens_entrada: item.tokensEntrada || 0,
      tokens_saida: item.tokensSaida || 0,
      custo_estimado: item.custoEstimado || 0,
      sucesso: item.sucesso !== undefined ? item.sucesso : true,
      erro: item.erro || null,
      estimado: Boolean(item.estimado),
    }));

    const { error: errLote } = await supabase
      .from('uso_ia')
      .upsert(lote, { onConflict: 'id' });

    if (errLote) console.error(`Erro no lote ${i} de uso_ia:`, errLote);
    else console.log(`✔ Lote ${i + 1} a ${Math.min(i + 50, usoIaLocal.length)} de uso_ia migrado.`);
  }

  // 8. MIGRAÇÃO DE BUSCAS SEM RESULTADO
  console.log('\n--- 8. MIGRANDO BUSCAS SEM RESULTADO ---');
  const buscasLocal = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'buscas_sem_resultado.json'), 'utf-8'));
  for (let i = 0; i < buscasLocal.length; i += 50) {
    const lote = buscasLocal.slice(i, i + 50).map((item: any) => ({
      id: item.id,
      data: item.data || new Date().toISOString(),
      contato_id: item.contatoId || null,
      contato_nome: item.contatoNome || null,
      texto_do_pedido: item.textoDoPedido,
      motivo: item.motivo,
      ia_acionada: Boolean(item.iaAcionada),
      equivalente_oferecido: item.equivalenteOferecido || null,
    }));

    const { error: errLote } = await supabase
      .from('buscas_sem_resultado')
      .upsert(lote, { onConflict: 'id' });

    if (errLote) console.error(`Erro no lote ${i} de buscas_sem_resultado:`, errLote);
    else console.log(`✔ Lote ${i + 1} a ${Math.min(i + 50, buscasLocal.length)} de buscas migrado.`);
  }

  console.log('\n✔ Etapa 1 a 8 concluídas com sucesso!');
  console.log('(Conversas.json será migrado por último após verificações)');
}

migrar().catch((err) => {
  console.error('Falha geral na migração:', err);
  process.exit(1);
});
