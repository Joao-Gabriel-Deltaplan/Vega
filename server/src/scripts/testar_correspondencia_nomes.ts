import 'dotenv/config';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';

interface CasoTeste {
  id: number;
  descricao: string;
  mensagem: string;
  validar: (resposta: string) => { passou: boolean; motivo?: string };
}

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTE OFICIAL DE CORRESPONDÊNCIA DE NOMES DE PESSOAS');
  console.log('1. Correspondência Exata: responde direto');
  console.log('2. Correspondência Aproximada: NÃO revela nomes, NÃO entrega dados, pede confirmação');
  console.log('3. Mais de uma pessoa aproximada: não lista opções, pede confirmação');
  console.log('4. Nenhuma correspondência: responde que não encontrou repetindo o nome');
  console.log('================================================================\n');

  const casos: CasoTeste[] = [
    // 1. CORRESPONDÊNCIA APROXIMADA: "Danil Ceia" (erro de transcrição)
    {
      id: 1,
      descricao: 'Correspondência Aproximada ("Danil Ceia" para Nilceia): deve pedir confirmação SEM vazar Nilceia e SEM entregar CPF',
      mensagem: 'me entrega o CPF da Danil Ceia',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // NÃO pode conter o CPF da Nilceia
        if (resp.includes('329.397.158-07') || /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou CPF em correspondência aproximada!' };
        }
        // NÃO pode revelar o nome real "Nilceia"
        if (respLower.includes('nilceia')) {
          return { passou: false, motivo: 'Revelou o nome existente no Cofre ("Nilceia")!' };
        }
        // DEVE conter a frase exata de confirmação do nome entendido sugerindo digitar
        const pedeConfirmacao = resp.includes("Não encontrei 'Danil Ceia'") || resp.includes('Danil Ceia');
        const sugereDigitar = respLower.includes('digite') || respLower.includes('confirmar o nome');
        if (!pedeConfirmacao || !sugereDigitar) {
          return { passou: false, motivo: `Não continha a solicitação correta de confirmação. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // 2. CORRESPONDÊNCIA EXATA: "Nilceia" (usuário confirmou digitando)
    {
      id: 2,
      descricao: 'Correspondência Exata ("Nilceia"): responde direto com os dados e citando a CNH',
      mensagem: 'me entrega o CPF da Nilceia',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // DEVE entregar o CPF da Nilceia
        if (!resp.includes('329.397.158-07')) {
          return { passou: false, motivo: 'Não entregou o CPF correto de Nilceia!' };
        }
        // DEVE citar a CNH
        if (!respLower.includes('cnh')) {
          return { passou: false, motivo: 'Não citou o documento fonte (CNH)!' };
        }
        // NÃO deve pedir confirmação do nome
        if (respLower.includes('confirmar o nome') && respLower.includes('digite')) {
          return { passou: false, motivo: 'Pediu confirmação indevida para correspondência exata!' };
        }
        return { passou: true };
      },
    },

    // 3. CORRESPONDÊNCIA APROXIMADA: "Thomas" (com S) quando só há "Thomaz" cadastrado
    {
      id: 3,
      descricao: 'Correspondência Aproximada ("Thomas" com S): deve pedir confirmação SEM vazar dados',
      mensagem: 'qual o CPF do Thomas?',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // NÃO pode entregar o CPF do Thomaz
        if (resp.includes('333.599.518-08')) {
          return { passou: false, motivo: 'Entregou CPF em correspondência aproximada ("Thomas")!' };
        }
        // DEVE pedir confirmação
        const pedeConfirmacao = resp.includes("Não encontrei 'Thomas'") || resp.includes('Thomas');
        const sugereDigitar = respLower.includes('confirmar o nome') || respLower.includes('digite');
        if (!pedeConfirmacao || !sugereDigitar) {
          return { passou: false, motivo: `Não pediu confirmação de "Thomas". Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },

    // 4. CORRESPONDÊNCIA EXATA: "Thomaz" (com Z)
    {
      id: 4,
      descricao: 'Correspondência Exata ("Thomaz" com Z): responde direto',
      mensagem: 'qual o CPF do Thomaz?',
      validar: (resp) => {
        // DEVE entregar o CPF correto
        if (!resp.includes('333.599.518-08')) {
          return { passou: false, motivo: 'Não entregou o CPF de Thomaz!' };
        }
        // NÃO deve pedir confirmação do nome
        const respLower = resp.toLowerCase();
        if (respLower.includes('confirmar o nome') && respLower.includes('digite para')) {
          return { passou: false, motivo: 'Pediu confirmação indevida para correspondência exata!' };
        }
        return { passou: true };
      },
    },

    // 5. NENHUMA CORRESPONDÊNCIA: "Roberto da Silva" (inexistente)
    {
      id: 5,
      descricao: 'Nenhuma Correspondência ("Roberto da Silva"): responde que não encontrou repetindo o nome',
      mensagem: 'me entrega o CPF do Roberto da Silva',
      validar: (resp) => {
        const respLower = resp.toLowerCase();
        // Não pode entregar nenhum CPF
        if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(resp)) {
          return { passou: false, motivo: 'Entregou dados para pessoa inexistente!' };
        }
        // Deve repetir o nome e dizer que não encontrou
        if (!respLower.includes('roberto') || (!respLower.includes('não encontrei') && !respLower.includes('não localizei'))) {
          return { passou: false, motivo: `Resposta não informou que não encontrou Roberto. Resposta: "${resp}"` };
        }
        return { passou: true };
      },
    },
  ];

  let totalPassou = 0;

  for (const c of casos) {
    console.log(`------------------------------------------------------------`);
    console.log(`[CASO ${c.id}] ${c.descricao}`);
    console.log(`Mensagem: "${c.mensagem}"`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: c.mensagem,
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
  console.log(`RESULTADO FINAL: ${totalPassou}/${casos.length} casos passaram.`);
  console.log(`================================================================`);

  if (totalPassou !== casos.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
