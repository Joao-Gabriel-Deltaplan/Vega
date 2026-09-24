import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { marcarDocumentoFaltanteComoProvidenciado } from '../documentosFaltantesService.js';
import { Contato } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function rodarTestesDocumentosFaltantes() {
  console.log('================================================================');
  console.log(' TESTES: DOCUMENTOS FALTANTES, RESPOSTAS E CONTAGEM SOMANDO     ');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  const todosDocs = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();
  const titularAlvo = todosTitulares[0] || { id: 'tit_teste', nome: 'Titular Teste' };
  const primeiroNomeAlvo = extrairPrimeiroNome(titularAlvo.nome) || titularAlvo.nome;
  const primeiroNomeNorm = primeiroNomeAlvo.toLowerCase();

  const contatoTeste: Contato = {
    id: 'user_teste_diretoria',
    nome: 'Usuario Teste',
    telefone: '5500000000000',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    avatarCor: '#10b981',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  // Limpeza de testes anteriores para teste limpo
  await supabase
    .from('documentos_faltantes')
    .delete()
    .eq('pessoa_id', titularAlvo.id);

  // --------------------------------------------------------------------------
  // TESTE 1: Documento Inexistente com Dado Disponível em Outro Documento
  // --------------------------------------------------------------------------
  console.log('--- TESTE 1: Pedido de documento inexistente com dado disponível em outro documento ---');
  console.log(`Pergunta: "certidão de nascimento do ${primeiroNomeAlvo}"`);

  const res1 = await processarMensagemChat({
    mensagemUsuario: `certidão de nascimento do ${primeiroNomeAlvo}`,
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log('\nResposta VEGA:');
  console.log(res1.textoResposta);

  const texto1 = res1.textoResposta;
  const texto1Norm = texto1.toLowerCase();

  const t1_disseNaoEncontrou =
    texto1Norm.includes('não encontrei') &&
    texto1Norm.includes('certidão de nascimento') &&
    texto1Norm.includes(primeiroNomeNorm);

  const t1_anotouPendentes = texto1Norm.includes('anotei na lista de documentos pendentes');
  const t1_ofereceuCNH =
    texto1Norm.includes('data de nascimento') &&
    texto1Norm.includes('cnh') &&
    texto1Norm.includes('quer que eu informe?');
  const t1_semAnexo = !res1.anexos || res1.anexos.length === 0;
  const t1_semDespejoLista = !texto1Norm.includes(`estes são os documentos disponíveis de *${primeiroNomeNorm}*`);

  const passou1 =
    t1_disseNaoEncontrou &&
    t1_anotouPendentes &&
    t1_ofereceuCNH &&
    t1_semAnexo &&
    t1_semDespejoLista;

  console.log('\nCritérios Teste 1:');
  console.log(`- Disse não encontrou certidão: ${t1_disseNaoEncontrou}`);
  console.log(`- Anotou na lista de pendentes: ${t1_anotouPendentes}`);
  console.log(`- Ofereceu data de nascimento que consta na CNH: ${t1_ofereceuCNH}`);
  console.log(`- Sem anexo: ${t1_semAnexo}`);
  console.log(`- Sem despejo da lista inteira: ${t1_semDespejoLista}`);
  console.log(`=> Resultado Teste 1: ${passou1 ? 'APROVADO ✅' : 'REPROVADO ❌'}\n`);

  if (!passou1) process.exit(1);

  // --------------------------------------------------------------------------
  // TESTE 2: Documento Inexistente SEM Dado Equivalente
  // --------------------------------------------------------------------------
  console.log('--- TESTE 2: Pedido de documento inexistente sem dado equivalente ---');
  const perguntaAlvara = `alvará de reforma de ${primeiroNomeAlvo}`;
  console.log(`Pergunta: "${perguntaAlvara}"`);

  const res2 = await processarMensagemChat({
    mensagemUsuario: perguntaAlvara,
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  console.log('\nResposta VEGA:');
  console.log(res2.textoResposta);

  const texto2Norm = res2.textoResposta.toLowerCase();
  const t2_disseNaoEncontrou =
    texto2Norm.includes('não encontrei') &&
    texto2Norm.includes('alvará') &&
    texto2Norm.includes(primeiroNomeNorm);

  const t2_anotouPendentes = texto2Norm.includes('anotei na lista de documentos pendentes');
  const t2_naoOfereceuDadoFalso =
    !texto2Norm.includes('data de nascimento') &&
    !texto2Norm.includes('consta na cnh');
  const t2_semAnexo = !res2.anexos || res2.anexos.length === 0;

  const passou2 =
    t2_disseNaoEncontrou &&
    t2_anotouPendentes &&
    t2_naoOfereceuDadoFalso &&
    t2_semAnexo;

  console.log('\nCritérios Teste 2:');
  console.log(`- Disse não encontrou alvará: ${t2_disseNaoEncontrou}`);
  console.log(`- Anotou na lista de pendentes: ${t2_anotouPendentes}`);
  console.log(`- NÃO prometeu dados falsos/inexistentes: ${t2_naoOfereceuDadoFalso}`);
  console.log(`- Sem anexo: ${t2_semAnexo}`);
  console.log(`=> Resultado Teste 2: ${passou2 ? 'APROVADO ✅' : 'REPROVADO ❌'}\n`);

  if (!passou2) process.exit(1);

  // --------------------------------------------------------------------------
  // TESTE 3: Pedido Repetido (Contagem Somando no Supabase sem Duplicar)
  // --------------------------------------------------------------------------
  console.log('--- TESTE 3: Pedido repetido somando na contagem ---');
  console.log(`Repetindo pedido de "certidão de nascimento de ${primeiroNomeAlvo}"...`);

  const res3 = await processarMensagemChat({
    mensagemUsuario: `certidão de nascimento de ${primeiroNomeAlvo}`,
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: todosDocs,
  });

  // Consulta o registro no Supabase
  const { data: registros, error } = await supabase
    .from('documentos_faltantes')
    .select('*')
    .eq('pessoa_id', titularAlvo.id)
    .ilike('tipo_documento', '%certid%nascimento%');

  console.log('Registros retornados do Supabase:', registros);

  const t3_registroUnico = registros && registros.length === 1;
  const t3_contagemSomada = registros && registros[0]?.quantidade_pedidos === 2;

  const passou3 = Boolean(t3_registroUnico && t3_contagemSomada);

  console.log('\nCritérios Teste 3:');
  console.log(`- Sem duplicação de linha (total de registros = 1): ${t3_registroUnico}`);
  console.log(`- Contagem incrementada para 2 (quantidade_pedidos = 2): ${t3_contagemSomada}`);
  console.log(`=> Resultado Teste 3: ${passou3 ? 'APROVADO ✅' : 'REPROVADO ❌'}\n`);

  if (!passou3) process.exit(1);

  // --------------------------------------------------------------------------
  // TESTE 4: Baixa Automática ao Adicionar Documento no Cofre
  // --------------------------------------------------------------------------
  console.log('--- TESTE 4: Baixa automática de documento faltante providenciado ---');
  console.log(`Simulando upload de "Certidão de Nascimento" de ${primeiroNomeAlvo}...`);

  const baixados = await marcarDocumentoFaltanteComoProvidenciado(
    'Certidão de Nascimento',
    titularAlvo.id,
    titularAlvo.nome
  );

  const { data: registroAtualizado } = await supabase
    .from('documentos_faltantes')
    .select('*')
    .eq('id', registros![0].id)
    .single();

  const t4_marcouProvidenciado = registroAtualizado?.status === 'providenciado';
  const passou4 = baixados > 0 && t4_marcouProvidenciado;

  console.log('\nCritérios Teste 4:');
  console.log(`- Itens baixados: ${baixados}`);
  console.log(`- Status atualizado para providenciado: ${t4_marcouProvidenciado}`);
  console.log(`- Observação gravada: "${registroAtualizado?.observacao}"`);
  console.log(`=> Resultado Teste 4: ${passou4 ? 'APROVADO ✅' : 'REPROVADO ❌'}\n`);

  if (!passou4) process.exit(1);

  console.log('================================================================');
  console.log(' ✅ TODOS OS 4 TESTES FORAM APROVADOS COM SUCESSO ABSOLUTO!     ');
  console.log('================================================================');
}

rodarTestesDocumentosFaltantes().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
