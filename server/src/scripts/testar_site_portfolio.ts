import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 TESTE: PEDIDOS DE ANÁLISE/LEITURA DE SITES E LINKS DA WEB');
  console.log('================================================================\n');

  const contatoAdmin: Contato = {
    id: 'ct-admin-teste',
    nome: 'João Gabriel Brandini',
    telefone: '5514996863115',
    avatarCor: '#25D366',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
  };

  let totalTestes = 0;
  let testesPassados = 0;

  // CENÁRIO 1: Link CADASTRADO ("portfólio das máquinas")
  totalTestes++;
  console.log(`--- Teste ${totalTestes}: "já que você tem acesso ao portfólio das máquinas, o que tem de importante nesse site?" ---`);
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'já que você tem acesso ao portfólio das máquinas, o que tem de importante nesse site?',
    historicoRecente: [],
    contato: contatoAdmin,
    origemMensagem: 'audio',
  });

  console.log('   Resposta VEGA:', res1.textoResposta);
  const naoDisseForaEscopo1 = !res1.textoResposta.toLowerCase().includes('fora do meu escopo') && !res1.textoResposta.toLowerCase().includes('fora de escopo');
  const temPadraoSalvo = /Tenho o link do (Portfólio das Máquinas|portfólio das máquinas).*salvo.*não consigo abrir sites.*Quer o link\?/i.test(res1.textoResposta);

  if (naoDisseForaEscopo1 && temPadraoSalvo) {
    console.log('✅ [PASSOU] VEGA informou com honestidade que tem o link salvo mas não consegue abrir sites, e ofereceu o link!');
    testesPassados++;
  } else {
    console.log(`❌ [FALHOU] Resposta não seguiu o padrão esperado. naoDisseForaEscopo: ${naoDisseForaEscopo1}, temPadraoSalvo: ${temPadraoSalvo}`);
  }

  // CENÁRIO 1.1: Continuação com "Sim" para receber o link
  totalTestes++;
  console.log(`\n--- Teste ${totalTestes}: Usuário responde "Sim" para a oferta do link ---`);
  const msgAssistente1 = {
    id: 'msg-assist-link',
    remetente: 'assistente' as const,
    nomeRemetente: 'VEGA',
    horario: '10:00',
    texto: res1.textoResposta,
  };
  const res1_1 = await processarMensagemChat({
    mensagemUsuario: 'Sim',
    historicoRecente: [
      { id: '1', remetente: 'cliente', nomeRemetente: 'João Gabriel', horario: '09:59', texto: 'já que você tem acesso ao portfólio das máquinas, o que tem de importante nesse site?' },
      msgAssistente1,
    ],
    contato: contatoAdmin,
  });

  console.log('   Resposta VEGA:', res1_1.textoResposta);
  const entregouLink = res1_1.textoResposta.includes('portfolio.deltaplanobras.com.br');
  if (entregouLink) {
    console.log('✅ [PASSOU] VEGA entregou o link cadastrado após o aceite do usuário!');
    testesPassados++;
  } else {
    console.log('❌ [FALHOU] VEGA não entregou a URL após o "Sim".');
  }

  // CENÁRIO 2: Link NÃO CADASTRADO
  totalTestes++;
  console.log(`\n--- Teste ${totalTestes}: Pergunta sobre site que NÃO está na Base de Conhecimento ---`);
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'O que tem de importante no site das ferramentas xyz? Me resuma o conteúdo dessa página.',
    historicoRecente: [],
    contato: contatoAdmin,
    origemMensagem: 'audio',
  });

  console.log('   Resposta VEGA:', res2.textoResposta);
  const naoDisseForaEscopo2 = !res2.textoResposta.toLowerCase().includes('fora do meu escopo');
  const padraoNaoCadastrado = /Não consigo abrir sites para ler o conteúdo, e não tenho esse link salvo na Base de Conhecimento\./i.test(res2.textoResposta);

  if (naoDisseForaEscopo2 && padraoNaoCadastrado) {
    console.log('✅ [PASSOU] VEGA respondeu exatamente o padrão de link não cadastrado!');
    testesPassados++;
  } else {
    console.log(`❌ [FALHOU] Resposta não seguiu o padrão esperado. naoDisseForaEscopo: ${naoDisseForaEscopo2}, padraoNaoCadastrado: ${padraoNaoCadastrado}`);
  }

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO: ${testesPassados}/${totalTestes} TESTES APROVADOS`);
  console.log('================================================================');
  process.exit(testesPassados === totalTestes ? 0 : 1);
}

rodarTestes().catch((err) => {
  console.error(err);
  process.exit(1);
});
