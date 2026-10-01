import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { verificarCorrespondenciaNomePessoa, PessoaConhecida } from '../utils/correspondenciaPessoaService.js';

interface CasoTesteChat {
  id: number;
  descricao: string;
  mensagem: string;
  origemMensagem: 'audio' | 'texto';
  validar: (resposta: string) => { passou: boolean; motivo?: string };
}

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTE: CORRESPONDÊNCIA DE NOMES (ÁUDIO VS TEXTO)');
  console.log('1. Áudio sem correspondência exata: SEMPRE pede confirmação para digitar');
  console.log('2. Texto sem correspondência (inexistente): responde apenas que não encontrou');
  console.log('3. Texto com correspondência aproximada: pede confirmação para digitar');
  console.log('4. Áudio com correspondência exata: responde direto');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // PARTE 1: TESTE UNITÁRIO DIRETO DE verificarCorrespondenciaNomePessoa
  // --------------------------------------------------------------------------
  console.log('--- [PARTE 1] Teste Unitário da Função verificarCorrespondenciaNomePessoa ---');
  const pessoasExemplo: PessoaConhecida[] = [
    {
      nomeOficial: 'Nilceia Batista Ramos Fabre',
      nomeNorm: 'nilceia batista ramos fabre',
      primeiroNomeNorm: 'nilceia',
      apelidosNorm: [],
      ehTitularCadastrado: true,
    },
    {
      nomeOficial: 'Thomaz Brandini',
      nomeNorm: 'thomaz brandini',
      primeiroNomeNorm: 'thomaz',
      apelidosNorm: ['thomas'],
      ehTitularCadastrado: true,
    },
  ];

  // Teste 1.1: Nome inexistente vindo de ÁUDIO -> DEVE pedir confirmação para digitar
  const resUnitAudioInexistente = verificarCorrespondenciaNomePessoa('Danilo', pessoasExemplo, 'audio');
  const esperadoAudioInexistente = "Não encontrei 'Danilo'. Pode confirmar o nome? Se possível, digite para eu não entender errado.";
  if (
    resUnitAudioInexistente.tipo === 'inexistente' &&
    resUnitAudioInexistente.mensagemRespostaObrigatoria === esperadoAudioInexistente
  ) {
    console.log('✅ Unitário Áudio Inexistente: Retornou pedido de confirmação para digitar.');
  } else {
    console.error('❌ Falha Unitário Áudio Inexistente:', resUnitAudioInexistente);
    process.exit(1);
  }

  // Teste 1.2: Nome inexistente vindo de TEXTO -> DEVE responder que não encontrou informações no Cofre
  const resUnitTextoInexistente = verificarCorrespondenciaNomePessoa('Danilo', pessoasExemplo, 'texto');
  const esperadoTextoInexistente = "Não encontrei informações sobre 'Danilo' no Cofre.";
  if (
    resUnitTextoInexistente.tipo === 'inexistente' &&
    resUnitTextoInexistente.mensagemRespostaObrigatoria === esperadoTextoInexistente
  ) {
    console.log('✅ Unitário Texto Inexistente: Retornou mensagem simples de não encontrado no Cofre.');
  } else {
    console.error('❌ Falha Unitário Texto Inexistente:', resUnitTextoInexistente);
    process.exit(1);
  }

  // Teste 1.3: Nome aproximado vindo de TEXTO -> DEVE pedir confirmação para digitar
  const resUnitTextoAprox = verificarCorrespondenciaNomePessoa('Danil Ceia', pessoasExemplo, 'texto');
  if (
    resUnitTextoAprox.tipo === 'aproximada' &&
    resUnitTextoAprox.mensagemRespostaObrigatoria.includes('Pode confirmar o nome? Se possível, digite')
  ) {
    console.log('✅ Unitário Texto Aproximado: Retornou pedido de confirmação para digitar.');
  } else {
    console.error('❌ Falha Unitário Texto Aproximado:', resUnitTextoAprox);
    process.exit(1);
  }

  // Teste 1.4: Nome exato vindo de ÁUDIO -> tipo exata
  const resUnitAudioExato = verificarCorrespondenciaNomePessoa('Nilceia', pessoasExemplo, 'audio');
  if (resUnitAudioExato.tipo === 'exata') {
    console.log('✅ Unitário Áudio Exato: Retornou correspondência exata.');
  } else {
    console.error('❌ Falha Unitário Áudio Exato:', resUnitAudioExato);
    process.exit(1);
  }

  console.log('\n--- [PARTE 2] Teste Ponta a Ponta com processarMensagemChat ---\n');

  const casosChat: CasoTesteChat[] = [
    // CASO 1: ÁUDIO com nome sem correspondência (Danilo) -> DEVE pedir confirmação sugerindo digitar
    {
      id: 1,
      descricao: 'Áudio com nome sem correspondência ("Danilo"): deve pedir confirmação sugerindo digitar',
      mensagem: 'qual o CPF do Danilo?',
      origemMensagem: 'audio',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // Não pode conter nenhum CPF
        if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou CPF indevido!' };
        }
        // DEVE pedir confirmação do nome Danilo sugerindo digitar
        const temDanilo = resp.includes("Não encontrei 'Danilo'") || resp.includes('Danilo');
        const pedeDigitar = respLower.includes('digite') && respLower.includes('confirmar o nome');
        if (!temDanilo || !pedeDigitar) {
          return { passou: false, motivo: `Não pediu confirmação com sugestão de digitação. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // CASO 2: TEXTO com o mesmo nome sem correspondência (Danilo) -> DEVE apenas dizer que não encontrou informações no Cofre
    {
      id: 2,
      descricao: 'Texto com o mesmo nome ("Danilo"): deve responder só que não encontrou informações no Cofre',
      mensagem: 'qual o CPF do Danilo?',
      origemMensagem: 'texto',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // Não pode conter nenhum CPF
        if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou CPF indevido!' };
        }
        // NÃO deve pedir para digitar
        if (respLower.includes('digite para eu não entender errado')) {
          return { passou: false, motivo: 'Mensagem de texto não deve pedir para digitar quando inexistente!' };
        }
        // DEVE dizer que não encontrou informações sobre Danilo no Cofre
        const informouNaoEncontrou = respLower.includes('não encontrei') || respLower.includes('não localizei');
        const citouDanilo = respLower.includes('danilo');
        if (!informouNaoEncontrou || !citouDanilo) {
          return { passou: false, motivo: `Não informou claramente que não encontrou Danilo. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // CASO 3: ÁUDIO com correspondência aproximada ("Danil Ceia" para Nilceia) -> DEVE pedir confirmação sem vazar Nilceia
    {
      id: 3,
      descricao: 'Áudio com correspondência aproximada ("Danil Ceia"): deve pedir confirmação sugerindo digitar sem revelar Nilceia',
      mensagem: 'me entrega o CPF da Danil Ceia',
      origemMensagem: 'audio',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // NÃO pode conter o CPF da Nilceia
        if (resp.includes('329.397.158-07') || /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou CPF em correspondência aproximada!' };
        }
        // NÃO pode revelar o nome real "Nilceia"
        if (respLower.includes('nilceia')) {
          return { passou: false, motivo: 'Revelou o nome real oculto "Nilceia"!' };
        }
        // DEVE pedir confirmação sugerindo digitar
        const temDanilCeia = resp.includes('Danil Ceia');
        const pedeDigitar = respLower.includes('digite') && respLower.includes('confirmar o nome');
        if (!temDanilCeia || !pedeDigitar) {
          return { passou: false, motivo: `Não pediu confirmação com sugestão de digitação. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // CASO 4: TEXTO com correspondência aproximada ("Danil Ceia") -> DEVE pedir confirmação sugerindo digitar
    {
      id: 4,
      descricao: 'Texto com correspondência aproximada ("Danil Ceia"): deve pedir confirmação sugerindo digitar',
      mensagem: 'me entrega o CPF da Danil Ceia',
      origemMensagem: 'texto',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        if (resp.includes('329.397.158-07') || /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou CPF em correspondência aproximada!' };
        }
        if (respLower.includes('nilceia')) {
          return { passou: false, motivo: 'Revelou o nome real oculto "Nilceia"!' };
        }
        const temDanilCeia = resp.includes('Danil Ceia');
        const pedeDigitar = respLower.includes('digite') && respLower.includes('confirmar o nome');
        if (!temDanilCeia || !pedeDigitar) {
          return { passou: false, motivo: `Não pediu confirmação com sugestão de digitação. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // CASO 5: ÁUDIO com correspondência exata ("Nilceia") -> DEVE responder direto com o CPF
    {
      id: 5,
      descricao: 'Áudio com correspondência exata ("Nilceia"): responde direto sem pedir confirmação',
      mensagem: 'me entrega o CPF da Nilceia',
      origemMensagem: 'audio',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // DEVE conter o CPF de Nilceia
        if (!resp.includes('329.397.158-07')) {
          return { passou: false, motivo: 'Não entregou o CPF de Nilceia em correspondência exata!' };
        }
        // NÃO deve pedir confirmação
        if (respLower.includes('confirmar o nome') && respLower.includes('digite')) {
          return { passou: false, motivo: 'Pediu confirmação indevida para correspondência exata!' };
        }
        return { passou: true };
      },
    },
  ];

  let totalPassou = 0;

  for (const c of casosChat) {
    console.log(`------------------------------------------------------------`);
    console.log(`[CASO ${c.id}] ${c.descricao}`);
    console.log(`Origem: ${c.origemMensagem.toUpperCase()} | Mensagem: "${c.mensagem}"`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: c.mensagem,
      origemMensagem: c.origemMensagem,
      contato: {
        id: 'contato_teste_diretor',
        nome: 'Mauro Cesar Paiva',
        telefone: '5511999999999',
        cargo: 'Diretor',
        setor: 'Diretoria',
        nivelAcesso: 'admin',
        permiteExclusao: true,
        permiteCadastroConhecimento: true,
      },
      historicoRecente: [],
    });

    console.log(`[Resposta da VEGA]:\n${resultado.textoResposta}\n`);

    const validacao = c.validar(resultado.textoResposta);
    if (validacao.passou) {
      console.log(`✅ CASO ${c.id} PASSOU COM SUCESSO!`);
      totalPassou++;
    } else {
      console.log(`❌ CASO ${c.id} FALHOU: ${validacao.motivo}`);
    }
    console.log(`\n`);
  }

  console.log(`================================================================`);
  console.log(`RESULTADO FINAL: ${totalPassou}/${casosChat.length} casos passaram.`);
  console.log(`================================================================`);

  if (totalPassou !== casosChat.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
