import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { processarRespostaPendenciaWhatsApp } from '../whatsapp/pendenciasWhatsAppService.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { adicionarDocumento, obterTodosDocumentos, removerDocumento } from '../storage.js';
import { Contato, DocumentoRegistro } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTestes() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES — CANCELAMENTO E EXCLUSÃO DE DOCUMENTOS');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  let testesPassados = 0;
  let totalTestes = 0;

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: CANCELAMENTO DURANTE A PENDÊNCIA (ADMIN)
  // ----------------------------------------------------------------------------
  totalTestes++;
  console.log(`[TESTE ${totalTestes}] Cancelamento durante pendência via frase livre (Admin)...`);
  
  // Cria documento fictício para o teste de pendência
  const docTestePendencia: DocumentoRegistro = {
    id: `doc-teste-pend-${Date.now()}`,
    titulo: 'Foto Documento Teste Cancelamento',
    arquivo: `teste_cancelar_${Date.now()}.jpg`,
    tipo: 'Outros',
    titular: 'Titular Teste',
    visibilidade: 'diretoria',
    dataCadastro: new Date().toLocaleDateString('pt-BR'),
    statusIndexacao: 'pendente',
  };
  await adicionarDocumento(docTestePendencia);

  const pendenciaTeste = {
    id: `pend-teste-${Date.now()}`,
    conversa_id: 'wa-5514999999999',
    remetente_numero: '5514999999999',
    remetente_jid: '5514999999999@s.whatsapp.net',
    documento_id: docTestePendencia.id,
    tipo_pendencia: 'falta_ambos' as const,
    dados_detectados: {},
    expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    resolvido: false,
  };

  const respCancelAdmin = await processarRespostaPendenciaWhatsApp(
    pendenciaTeste,
    'Nao precisa salvar esse documento, enviei errado',
    'Administrador Teste',
    'admin'
  );

  console.log(`  Resposta obtida: "${respCancelAdmin}"`);
  const esperadoCancel = 'Certo, descartei o documento. Ele não foi salvo no Cofre.';
  
  // Confirma se apagou do banco
  const docsAtuais = await obterTodosDocumentos();
  const docAindaExiste = docsAtuais.some((d) => d.id === docTestePendencia.id);

  if (respCancelAdmin === esperadoCancel && !docAindaExiste) {
    console.log('  ✅ SUCESSO: IA identificou intenção livre de cancelamento e removeu o documento com confirmação oficial!\n');
    testesPassados++;
  } else {
    console.error(`  ❌ FALHA: Resposta incorreta ou documento não foi removido. Existe: ${docAindaExiste}\n`);
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: TENTATIVA DE CANCELAR PENDÊNCIA SENDO USUÁRIO COMUM (BLOQUEIO)
  // ----------------------------------------------------------------------------
  totalTestes++;
  console.log(`[TESTE ${totalTestes}] Tentativa de cancelar pendência sendo usuário comum...`);

  const docTesteComum: DocumentoRegistro = {
    id: `doc-teste-comum-${Date.now()}`,
    titulo: 'Documento Teste Comum',
    arquivo: `teste_comum_${Date.now()}.pdf`,
    tipo: 'Outros',
    titular: 'Titular Teste',
    visibilidade: 'geral',
    dataCadastro: new Date().toLocaleDateString('pt-BR'),
    statusIndexacao: 'pendente',
  };
  await adicionarDocumento(docTesteComum);

  const pendenciaComum = {
    id: `pend-teste-comum-${Date.now()}`,
    conversa_id: 'wa-5514888888888',
    remetente_numero: '5514888888888',
    remetente_jid: '5514888888888@s.whatsapp.net',
    documento_id: docTesteComum.id,
    tipo_pendencia: 'falta_titular' as const,
    dados_detectados: {},
    expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    resolvido: false,
  };

  const respCancelComum = await processarRespostaPendenciaWhatsApp(
    pendenciaComum,
    'cancela, foi sem querer',
    'Usuário Comum Teste',
    'comum'
  );

  console.log(`  Resposta obtida: "${respCancelComum}"`);
  const esperadoBloqueio = 'Você não tem permissão para apagar documentos do Cofre da VEGA. Apenas administradores podem realizar a exclusão.';
  
  if (respCancelComum === esperadoBloqueio) {
    console.log('  ✅ SUCESSO: Usuário comum foi bloqueado e impedido de apagar!\n');
    testesPassados++;
  } else {
    console.error('  ❌ FALHA: Mensagem de bloqueio incorreta ou não bloqueou.\n');
  }
  // Limpeza
  await removerDocumento(docTesteComum.id);

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: PEDIDO DE EXCLUSÃO PÓS-SALVO COM CONFIRMAÇÃO (ADMIN)
  // ----------------------------------------------------------------------------
  totalTestes++;
  console.log(`[TESTE ${totalTestes}] Cancelamento pós-salvo: "apaga a foto que enviei agora" (Admin)...`);

  const docSalvoRecente: DocumentoRegistro = {
    id: `doc-salvo-rec-${Date.now()}`,
    titulo: 'Comprovante Teste Exclusao Pos Salvo',
    arquivo: `comprovante_recente_${Date.now()}.jpeg`,
    tipo: 'Outros',
    titular: 'Titular Teste',
    visibilidade: 'diretoria',
    dataCadastro: new Date().toLocaleDateString('pt-BR'),
    statusIndexacao: 'indexado',
    metadata: {
      remetenteNumero: '5514999999999',
      remetenteNome: 'Admin Teste',
    },
  };
  await adicionarDocumento(docSalvoRecente);

  const contatoAdmin: Contato = {
    id: 'ct-admin-1',
    nome: 'Admin Teste',
    telefone: '5514999999999',
    avatarCor: '#25D366',
    cargo: 'Administrador',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Administrador',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  // Passo A: Solicita apagar
  const resultadoPassoA = await processarMensagemChat({
    mensagemUsuario: 'apaga a foto que enviei agora',
    historicoRecente: [],
    contato: contatoAdmin,
  });

  console.log(`  Passo 1 (Pedido): "${resultadoPassoA.textoResposta}"`);
  const pediuConfirmacao =
    resultadoPassoA.intencaoDetectada === 'apagar_documento' &&
    resultadoPassoA.textoResposta.includes('Você confirma a exclusão definitiva') &&
    resultadoPassoA.textoResposta.includes('Responda *Sim* para confirmar ou *Não* para cancelar');

  // Passo B: Confirmação com "Sim"
  const msgAssistenteA = {
    id: 'msg-assist-a',
    remetente: 'assistente' as const,
    nomeRemetente: 'VEGA',
    horario: '10:00',
    texto: resultadoPassoA.textoResposta,
    correcaoPendente: resultadoPassoA.correcaoPendente,
  };

  const resultadoPassoB = await processarMensagemChat({
    mensagemUsuario: 'Sim, pode apagar',
    historicoRecente: [
      { id: '1', remetente: 'cliente', nomeRemetente: 'Admin Teste', horario: '09:59', texto: 'apaga a foto que enviei agora' },
      msgAssistenteA,
    ],
    contato: contatoAdmin,
  });

  console.log(`  Passo 2 (Confirmação): "${resultadoPassoB.textoResposta}"`);
  const confirmouExclusao = resultadoPassoB.textoResposta.includes('apagado com sucesso do Cofre');

  // Verifica se o documento realmente não existe mais
  const docsAposExclusao = await obterTodosDocumentos();
  const aindaNoBanco = docsAposExclusao.some((d) => d.id === docSalvoRecente.id);

  if (pediuConfirmacao && confirmouExclusao && !aindaNoBanco) {
    console.log('  ✅ SUCESSO: Documento pós-salvo exigiu confirmação prévia e foi excluído definitivamente após "Sim"!\n');
    testesPassados++;
  } else {
    console.error(`  ❌ FALHA: Falha no fluxo pós-salvo. Pediu confirmação: ${pediuConfirmacao}, Confirmou: ${confirmouExclusao}, No banco: ${aindaNoBanco}\n`);
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: PEDIDO DE EXCLUSÃO PÓS-SALVO POR USUÁRIO COMUM NO CHAT (BLOQUEIO)
  // ----------------------------------------------------------------------------
  totalTestes++;
  console.log(`[TESTE ${totalTestes}] Tentativa de apagar documento pós-salvo sendo usuário comum no chat...`);

  const contatoComum: Contato = {
    id: 'ct-comum-1',
    nome: 'Colaborador Comum',
    telefone: '5514777777777',
    avatarCor: '#94a3b8',
    cargo: 'Colaborador',
    nivelAcesso: 'geral',
    ficha: {
      cargo: 'Colaborador',
      setor: 'Administrativo',
      nivelAcesso: 'geral',
      observacoes: '',
    },
  };

  const resultadoComumChat = await processarMensagemChat({
    mensagemUsuario: 'apaga o último documento que mandei',
    historicoRecente: [],
    contato: contatoComum,
  });

  console.log(`  Resposta obtida: "${resultadoComumChat.textoResposta}"`);
  if (resultadoComumChat.textoResposta === esperadoBloqueio) {
    console.log('  ✅ SUCESSO: Usuário comum foi bloqueado no chat de apagar documentos!\n');
    testesPassados++;
  } else {
    console.error('  ❌ FALHA: Bloqueio não retornou a mensagem oficial.\n');
  }

  console.log('================================================================');
  console.log(`📊 RESULTADO FINAL: ${testesPassados}/${totalTestes} TESTES PASSARAM COM SUCESSO!`);
  console.log('================================================================\n');

  if (testesPassados === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

executarTestes().catch((err) => {
  console.error('Erro fatal ao rodar bateria de testes:', err);
  process.exit(1);
});
