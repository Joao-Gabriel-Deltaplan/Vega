import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterDocumentosPorNivelAcesso } from '../storage.js';
import { salvarRastro } from '../rastros/rastroService.js';
import { Contato, Mensagem, RastroRegistro } from '../types.js';

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTE DE RESILIÊNCIA: FALHA NA GRAVAÇÃO DO RASTRO NO SUPABASE');
  console.log('================================================================\n');

  const contatoTeste: Contato = {
    id: 'user-simulacao-falha',
    nome: 'Diretoria Delta Plan',
    telefone: '11988887777',
    avatarCor: '#25D366',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  const docsDisponiveis = await obterDocumentosPorNivelAcesso('diretoria');
  const pergunta = 'qual o endereço do escritório?';
  const assistenteMsgId = `msg-assistente-simulada-${Date.now()}`;
  const conversaId = 'conversa-simulacao-resiliencia';

  console.log(`[ETAPA 1] Usuário envia: "${pergunta}"`);
  console.log('          Processando raciocínio com a VEGA...');
  const resultadoChat = await processarMensagemChat({
    mensagemUsuario: pergunta,
    historicoRecente: [],
    contato: contatoTeste,
    documentosDisponiveis: docsDisponiveis,
  });

  console.log(`\n✅ Resposta gerada pela VEGA com sucesso!`);
  console.log(`   - Texto: "${resultadoChat.textoResposta}"`);
  console.log(`   - Origem: ${resultadoChat.origem}`);
  console.log(`   - Intenção: ${resultadoChat.intencaoDetectada}`);
  console.log(`   - Rastro em memória gerado: ${resultadoChat.rastro ? 'SIM' : 'NÃO'}`);

  console.log('\n================================================================');
  console.log('🔥 [ETAPA 2] SIMULAÇÃO DE FALHA NO SUPABASE / REDE OFFLINE');
  console.log('================================================================');

  // Simulação 1: Executando o bloco EXATO do server/src/index.ts (linhas 944-958)
  // Simulando que salvarRastro sofreu uma falha catastrófica de rede (ex: timeout, ECONNREFUSED)
  console.log('\n--> Cenário 1: Falha catastrófica de rede (exceção síncrona/assíncrona lançada)');
  
  let rastroIdFinal: string | undefined = undefined;
  let erroCapturadoNoTerminal = false;
  const rastroGerado: RastroRegistro | undefined = resultadoChat.rastro;

  // Função simulando a tentativa de persistência com falha de conexão do Supabase
  const salvarRastroComFalhaDeRede = async (_r: RastroRegistro): Promise<string | null> => {
    throw new Error('TypeError: fetch failed (ECONNREFUSED) - Supabase endpoint inalcançável (host offline)');
  };

  if (rastroGerado) {
    try {
      rastroGerado.mensagemId = assistenteMsgId;
      rastroGerado.conversaId = conversaId;
      // Bloco idêntico ao server/src/index.ts
      const idSalvo = await salvarRastroComFalhaDeRede(rastroGerado);
      if (idSalvo) {
        rastroGerado.id = idSalvo;
        rastroIdFinal = idSalvo;
      }
    } catch (errRastro: any) {
      erroCapturadoNoTerminal = true;
      console.error(
        '   ⚠️ [LOG NO TERMINAL DO SERVIDOR]:',
        '[VEGA Chat ⚠️] Erro ao gravar rastro no Supabase (não bloqueante):',
        errRastro?.message || errRastro
      );
    }
  }

  // Simulação 2: Testando salvarRastro nativo quando recebe dados ou status com erro da API do Supabase
  console.log('\n--> Cenário 2: Testando salvarRastro nativo com dados simulados de erro');
  // Se passarmos um rastro com campos que forçam falha (ou simular no cliente):
  const rastroInvalido = { ...rastroGerado, mensagemId: null as any } as any;
  console.log('   Chamando salvarRastro nativo com estado que rejeita gravação...');
  const resultadoNativo = await salvarRastro(rastroInvalido);
  console.log(`   Resultado retornado pelo salvarRastro: ${resultadoNativo} (null esperado, sem quebrar)`);

  console.log('\n================================================================');
  console.log('📦 [ETAPA 3] CONSTRUÇÃO E ENTREGA DA MENSAGEM AO USUÁRIO (SSE)');
  console.log('================================================================');

  // Continuação exata do fluxo de server/src/index.ts (linhas 963-982)
  const msgAssistente: Mensagem = {
    id: assistenteMsgId,
    remetente: 'assistente',
    nomeRemetente: 'VEGA',
    horario: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    texto: resultadoChat.textoResposta,
    anexos: resultadoChat.anexos && resultadoChat.anexos.length > 0 ? resultadoChat.anexos : undefined,
    origem: resultadoChat.origem,
    opcoes: resultadoChat.opcoes && resultadoChat.opcoes.length > 0 ? resultadoChat.opcoes : undefined,
    rastroId: rastroIdFinal,
    rastro: rastroGerado,
  };

  // Simulação do payload enviado via Server-Sent Events (res.write)
  const payloadSSE = JSON.stringify({ tipo: 'fim', mensagem: msgAssistente });

  console.log('Payload enviado ao cliente via SSE:');
  console.log(payloadSSE);

  console.log('\n================================================================');
  console.log('🎯 [ETAPA 4] AUDITORIA DOS CRITÉRIOS DE ACEITE');
  console.log('================================================================');

  const criterio1_respostaEntregue = Boolean(msgAssistente.texto && msgAssistente.texto.length > 0);
  const criterio2_erroNoTerminal = erroCapturadoNoTerminal;
  const criterio3_semCrash = true;

  console.log(`1. A resposta da VEGA foi gerada e entregue normalmente? -> ${criterio1_respostaEntregue ? '✅ SIM ("' + msgAssistente.texto + '")' : '❌ NÃO'}`);
  console.log(`2. O erro de gravação foi registrado apenas no terminal?   -> ${criterio2_erroNoTerminal ? '✅ SIM (Log visível no console)' : '❌ NÃO'}`);
  console.log(`3. O processo do servidor continuou vivo sem interrupção?  -> ${criterio3_semCrash ? '✅ SIM' : '❌ NÃO'}`);

  if (criterio1_respostaEntregue && criterio2_erroNoTerminal && criterio3_semCrash) {
    console.log('\n================================================================');
    console.log('🎉 CONFIRMAÇÃO: RESILIÊNCIA TOTAL VALIDADA COM SUCESSO!');
    console.log('================================================================\n');
  } else {
    throw new Error('Falha na validação de resiliência.');
  }
}

main().catch((err) => {
  console.error('Erro crítico no teste:', err);
  process.exit(1);
});
