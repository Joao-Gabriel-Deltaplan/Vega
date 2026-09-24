import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato } from '../types.js';

const contatoDiretoria: Contato = {
  id: 'contato_teste_campos',
  telefone: '5514999999999',
  nome: 'Diretoria',
  pushname: 'Diretoria',
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
  conversaAtiva: true,
  nivelAcesso: 'diretoria',
  ficha: {
    nivelAcesso: 'diretoria',
    cargo: 'Diretor',
    setor: 'Diretoria',
    observacoes: '',
  },
};

async function rodarTestes() {
  console.log('\n================================================================');
  console.log('🧪 BATERIA DE TESTES: CORRESPONDÊNCIA ESTRITA E PASSAPORTE REAL');
  console.log('================================================================\n');

  const casos = [
    {
      id: 1,
      titulo: 'Título de Eleitor do Thomaz (encontrado no Imposto de Renda via Fallback - Regra 19)',
      pergunta: 'qual número do título eleitoral do thomaz',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const temNumero = resp.includes('308476780167');
        const citaFonte = rLower.includes('imposto de renda');
        const naoTemFiliacao = !rLower.includes('moises') && !rLower.includes('lidia') && !rLower.includes('filiação');
        return temNumero && citaFonte && naoTemFiliacao;
      },
      esperado: 'Número 308476780167 citando Imposto de Renda e SEM filiação ou CPF indevidos',
    },
    {
      id: 2,
      titulo: 'PIS do Thomaz (campo inexistente)',
      pergunta: 'qual o PIS do thomaz?',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const naoEncontrou = rLower.includes('não encontrei') && rLower.includes('pis');
        const naoTemFiliacao = !rLower.includes('moises') && !rLower.includes('lidia');
        const naoTemCpf = !rLower.includes('333.599');
        return naoEncontrou && naoTemFiliacao && naoTemCpf;
      },
      esperado: 'Não encontrou PIS e NÃO citou filiação nem outro campo',
    },
    {
      id: 3,
      titulo: 'Carteira de Reservista do Thomaz (inexistente; tem apenas Dispensa)',
      pergunta: 'qual a carteira de reservista do thomaz?',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const naoEncontrou = rLower.includes('não encontrei');
        const naoTemNascimento = !rLower.includes('06/10/1984') && !rLower.includes('nascimento');
        const naoTemFiliacao = !rLower.includes('moises') && !rLower.includes('lidia');
        return naoEncontrou && naoTemNascimento && naoTemFiliacao;
      },
      esperado: 'Não encontrou reservista e NÃO respondeu data de nascimento nem filiação',
    },
    {
      id: 4,
      titulo: 'Certidão de Nascimento do Thomaz (inexistente; tem apenas Casamento)',
      pergunta: 'qual a certidão de nascimento do thomaz?',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const naoEncontrou = rLower.includes('não encontrei');
        const naoConfundiuComCasamento = !rLower.includes('casamento') || rLower.includes('anotei na lista');
        return naoEncontrou && naoConfundiuComCasamento;
      },
      esperado: 'Não encontrou certidão de nascimento e NÃO entregou certidão de casamento',
    },
    {
      id: 5,
      titulo: 'Passaporte de outra pessoa (Nilceia - inexistente no cofre)',
      pergunta: 'qual o número do passaporte da Nilceia?',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const naoEncontrou = rLower.includes('não encontrei');
        const naoFalouThomaz = !rLower.includes('thomaz') && !rLower.includes('333.599');
        return naoEncontrou && naoFalouThomaz;
      },
      esperado: 'Não encontrou passaporte da Nilceia e NUNCA falou sobre Thomaz',
    },
    {
      id: 6,
      titulo: 'Passaporte do Thomaz (DOCUMENTO EXISTENTE no Cofre)',
      pergunta: 'qual o passaporte do thomaz?',
      verificacao: (resp: string, anexos?: any[]) => {
        const rLower = resp.toLowerCase();
        const entregouPassaporte = (anexos && anexos.length > 0 && anexos[0].nome === 'PASSAPORTE.pdf') ||
                                   rLower.includes('passaporte');
        const naoTemErro = !rLower.includes('não encontrei');
        return entregouPassaporte && naoTemErro;
      },
      esperado: 'Localizou e entregou o Passaporte Thomaz Lustri Fabre (PASSAPORTE.pdf)',
    },
  ];

  let aprovados = 0;

  for (const caso of casos) {
    console.log(`--- Teste ${caso.id}: ${caso.titulo} ---`);
    console.log(`Pergunta: "${caso.pergunta}"`);
    try {
      const res = await processarMensagemChat({
        mensagemUsuario: caso.pergunta,
        historicoRecente: [],
        contato: contatoDiretoria,
      });

      console.log(`Resposta VEGA: "${res.textoResposta}"`);
      if (res.anexos && res.anexos.length > 0) {
        console.log(`Anexos entregues:`, res.anexos.map((a: any) => a.nome));
      }
      console.log(`Intenção detectada: ${res.intencaoDetectada}`);
      if (res.buscaUsada) console.log(`Busca usada: ${res.buscaUsada}`);

      const passou = caso.verificacao(res.textoResposta, res.anexos);
      if (passou) {
        console.log(`✅ APROVADO: Comportamento rigorosamente correto.`);
        aprovados++;
      } else {
        console.error(`❌ FALHOU! Esperado: ${caso.esperado}`);
      }
    } catch (err) {
      console.error(`❌ ERRO na execução:`, err);
    }
    console.log('');
  }

  console.log('================================================================');
  console.log(`Resultado Final: ${aprovados}/${casos.length} aprovados.`);
  console.log('================================================================\n');

  if (aprovados === casos.length) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

rodarTestes();
