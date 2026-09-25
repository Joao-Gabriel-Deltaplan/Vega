import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { transcreverAudioOpenAI } from '../whatsapp/audioTranscriptionService.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { Contato } from '../types.js';
import { corrigirTranscricaoFonetica } from '../whatsapp/correcaoTranscricaoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTesteAudioReal() {
  console.log('========================================================================');
  console.log('🎙️ TESTE COM ÁUDIO REAL E FLUXO COMPLETO: TÍTULO DE ELEITOR E PIS');
  console.log('========================================================================\n');

  const supabase = getSupabaseClient();
  const docsDisponiveis = await obterTodosDocumentos();
  const titulares = await obterTodosTitulares();

  console.log(`[Cofre] Total de documentos carregados: ${docsDisponiveis.length}`);
  console.log(
    `[Cofre] Titulares cadastrados: ${titulares
      .map((t) => `${t.nome} (apelidos: ${JSON.stringify(t.apelidos || [])})`)
      .join(', ')}\n`
  );

  const contatoMock: Contato = {
    id: 'ct-teste-real',
    nome: 'João Brandini',
    telefone: '5516999999999',
    perfil: 'admin',
    nivelAcesso: 'diretoria',
    cadastradoEm: new Date().toISOString(),
  };

  let totalTestes = 0;
  let testesPassados = 0;

  function assert(condicao: boolean, descricao: string) {
    totalTestes++;
    if (condicao) {
      console.log(`✅ [PASSOU] ${descricao}`);
      testesPassados++;
    } else {
      console.error(`❌ [FALHOU] ${descricao}`);
    }
  }

  // ==========================================================================
  // CENÁRIO 1: ÁUDIO REAL DO WHATSAPP TRANSMITIDO ("Me mande o título de eleitor do Thomaz")
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('🔊 BAIXANDO ÁUDIO REAL DO WHATSAPP DO SUPABASE STORAGE...');
  const caminhoAudioReal = 'wa-5514996863115/1790335188351_AC7F8D727147A60FC706F3046555110F.ogg';
  const downloadAudio = await supabase.storage.from('audios').download(caminhoAudioReal);

  if (!downloadAudio.data) {
    throw new Error(`Falha ao baixar áudio real de teste: ${downloadAudio.error?.message}`);
  }

  const audioBuffer = Buffer.from(await downloadAudio.data.arrayBuffer());
  console.log(`[Áudio Real Baixado]: ${audioBuffer.length} bytes.`);

  console.log('🎙️ Transcrevendo áudio com gpt-transcribe + Prompt Contextual Dinâmico...');
  const transcricaoReal = await transcreverAudioOpenAI(
    audioBuffer,
    'audio/ogg',
    3,
    contatoMock.id,
    contatoMock.nome
  );
  console.log(`[Transcrição Bruta gpt-transcribe]: "${transcricaoReal.texto}"`);

  console.log('✨ Aplicando etapa de correção fonética de transcrição...');
  const correcao1 = await corrigirTranscricaoFonetica(transcricaoReal.texto);
  console.log(`[Texto Corrigido]: "${correcao1.textoCorrigido}"`);
  if (correcao1.correcoes.length > 0) {
    console.log(`[Correções Registradas no Rastro]: ${JSON.stringify(correcao1.correcoes)}`);
  }

  console.log('🤖 Processando com o Motor VEGA (processarMensagemChat)...');
  const resultado1 = await processarMensagemChat({
    mensagemUsuario: correcao1.textoCorrigido,
    historicoRecente: [],
    contato: contatoMock,
    documentosDisponiveis: docsDisponiveis,
  });

  console.log('\n📄 RESPOSTA DA VEGA (ÁUDIO REAL 1):');
  console.log('------------------------------------------------------------------------');
  console.log(resultado1.textoResposta);
  console.log('------------------------------------------------------------------------');
  console.log(`Intenção Detectada: "${resultado1.intencaoDetectada}"`);
  console.log(`Tipo de Busca: "${resultado1.buscaUsada}"`);
  console.log(`Pessoa no Rastro: "${resultado1.rastro?.pessoa}"`);
  console.log(`Campos no Rastro: ${JSON.stringify(resultado1.rastro?.campos)}`);
  console.log(`Documento Usado: "${resultado1.rastro?.documentoUsado || 'N/A'}"`);
  console.log(`Enviou Anexo como Arquivo Físico: ${resultado1.rastro?.enviouAnexo}`);

  assert(
    resultado1.intencaoDetectada === 'dado_pessoal',
    'Intenção deve ser dado_pessoal (não pedir_arquivo) mesmo com "Me mande"'
  );
  assert(
    resultado1.textoResposta.includes('308476780167'),
    'Resposta deve conter o número exato do título eleitoral: 308476780167'
  );
  assert(
    resultado1.textoResposta.toLowerCase().includes('imposto de renda'),
    'Resposta deve citar o documento oficial de origem (Declaração de Imposto de Renda)'
  );
  assert(
    resultado1.rastro?.enviouAnexo === false,
    'Não deve disparar anexo de arquivo para consulta de dado'
  );

  // ==========================================================================
  // CENÁRIO 2: CORREÇÃO FONÉTICA DE "título de leitor" -> "título de eleitor"
  // ==========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 CENÁRIO 2: Simulação de áudio com erro fonético clássico: "Me mande o título de leitor do Thomas."');
  const correcao2 = await corrigirTranscricaoFonetica('Me mande o título de leitor do Thomas.');
  console.log(`[Texto Original Transcrito]: "Me mande o título de leitor do Thomas."`);
  console.log(`[Texto Corrigido]: "${correcao2.textoCorrigido}"`);
  console.log(`[Correções]: ${JSON.stringify(correcao2.correcoes)}`);

  assert(
    correcao2.textoCorrigido === 'Me mande o título de eleitor do Thomas.',
    'Correção fonética deve substituir "título de leitor" por "título de eleitor"'
  );
  assert(
    correcao2.correcoes.length > 0 && correcao2.correcoes[0].de.includes('título de leitor'),
    'Rastro deve conter a correção registrada'
  );

  const resultado2 = await processarMensagemChat({
    mensagemUsuario: correcao2.textoCorrigido,
    historicoRecente: [],
    contato: contatoMock,
    documentosDisponiveis: docsDisponiveis,
  });

  console.log('\n📄 RESPOSTA DA VEGA (CENÁRIO 2):');
  console.log(resultado2.textoResposta);
  assert(
    resultado2.intencaoDetectada === 'dado_pessoal',
    'Após correção fonética, intenção deve ser dado_pessoal'
  );
  assert(
    resultado2.textoResposta.includes('308476780167'),
    'Após correção fonética, número 308476780167 deve ser entregue'
  );

  // ==========================================================================
  // CENÁRIO 3: PERGUNTA DO PIS DO THOMAZ ("qual o PIS do Thomaz")
  // ==========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 CENÁRIO 3: Pergunta "qual o PIS do Thomaz" (com tolerância "piz" -> "PIS")');
  const correcao3 = await corrigirTranscricaoFonetica('qual o piz do Thomaz?');
  console.log(`[Original]: "qual o piz do Thomaz?" -> [Corrigido]: "${correcao3.textoCorrigido}"`);

  assert(
    correcao3.textoCorrigido.toLowerCase().includes('pis'),
    'Correção fonética deve transformar "piz" em "PIS"'
  );

  const resultado3 = await processarMensagemChat({
    mensagemUsuario: correcao3.textoCorrigido,
    historicoRecente: [],
    contato: contatoMock,
    documentosDisponiveis: docsDisponiveis,
  });

  console.log('\n📄 RESPOSTA DA VEGA (CENÁRIO 3 - PIS):');
  console.log('------------------------------------------------------------------------');
  console.log(resultado3.textoResposta);
  console.log('------------------------------------------------------------------------');

  assert(
    resultado3.intencaoDetectada === 'dado_pessoal',
    'Intenção deve ser dado_pessoal'
  );
  assert(
    resultado3.textoResposta.toLowerCase().includes('não encontrei') &&
    resultado3.textoResposta.toLowerCase().includes('pis') &&
    resultado3.textoResposta.toLowerCase().includes('thomaz'),
    'Conforme Regra 17 e 19, deve responder que não encontrou o PIS do Thomaz nos documentos'
  );
  assert(
    !resultado3.textoResposta.includes('308476780167') &&
    !resultado3.textoResposta.toLowerCase().includes('filiação'),
    'Conforme Regra 17, NUNCA entregar outro campo divergente quando o PIS não for encontrado'
  );

  // ==========================================================================
  // CENÁRIO 4: PERGUNTA COM VERBO DE ENVIO PARA PIS: "me manda o PIS do Thomaz"
  // ==========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 CENÁRIO 4: "me manda o PIS do Thomaz" com verbo de envio');
  const resultado4 = await processarMensagemChat({
    mensagemUsuario: 'me manda o PIS do Thomaz',
    historicoRecente: [],
    contato: contatoMock,
    documentosDisponiveis: docsDisponiveis,
  });

  console.log('\n📄 RESPOSTA DA VEGA (CENÁRIO 4):');
  console.log(resultado4.textoResposta);

  assert(
    resultado4.intencaoDetectada === 'dado_pessoal',
    '"me manda o PIS" deve ser dado_pessoal (e não pedir_arquivo)'
  );
  assert(
    resultado4.textoResposta.toLowerCase().includes('não encontrei') &&
    resultado4.textoResposta.toLowerCase().includes('pis'),
    'Não deve registrar faltante nem procurar documento inexistente no Cofre'
  );

  console.log('\n========================================================================');
  console.log(`📊 TOTAL DE TESTES: ${testesPassados}/${totalTestes} passaram.`);
  console.log('========================================================================\n');

  if (testesPassados === totalTestes) {
    console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
    process.exit(0);
  } else {
    console.error('❌ ALGUNS TESTES FALHARAM.');
    process.exit(1);
  }
}

executarTesteAudioReal().catch((err) => {
  console.error('Erro fatal nos testes de áudio real:', err);
  process.exit(1);
});
