import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarEventoEvolution } from '../whatsapp/whatsappWebhookService.js';
import { buscarUsuarioPorNumero } from '../whatsapp/usuarioWhatsAppService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTestesLid() {
  console.log('================================================================');
  console.log('🧪 TESTANDO IDENTIFICAÇÃO E SUPORTE A @lid DA EVOLUTION API');
  console.log('================================================================\n');

  let totalPassou = 0;
  let totalTestes = 0;

  async function testar(descricao: string, fn: () => Promise<boolean>) {
    totalTestes++;
    try {
      const ok = await fn();
      if (ok) {
        console.log(`✔ [${totalTestes}] ${descricao}`);
        totalPassou++;
      } else {
        console.error(`❌ [${totalTestes}] FALHA: ${descricao}`);
      }
    } catch (e: any) {
      console.error(`❌ [${totalTestes}] ERRO: ${descricao} -> ${e.message}`);
    }
  }

  // 1. Teste de busca direta por LID
  await testar('buscarUsuarioPorNumero deve encontrar Joao Gabriel pelo LID "176948374462673"', async () => {
    const usuario = await buscarUsuarioPorNumero('176948374462673@lid');
    return Boolean(usuario && usuario.nome.includes('Joao') && usuario.perfil === 'admin');
  });

  // 2. Teste de evento da Evolution com @lid E senderPn presente
  await testar('Processar evento com @lid e senderPn="5514996863115@s.whatsapp.net"', async () => {
    const evento = {
      event: 'messages.upsert',
      instance: 'DeltaPlan',
      key: {
        remoteJid: '176948374462673@lid',
        fromMe: false,
        id: `test-lid-pn-${Date.now()}`,
        senderPn: '5514996863115@s.whatsapp.net',
      },
      pushName: 'Joao Gabriel',
      message: {
        conversation: 'Olá Vega teste senderPn',
      },
    };

    const res = await processarEventoEvolution(evento);
    return (
      res.sucesso === true &&
      res.destinatario === '176948374462673@lid' &&
      res.usuario?.nome.includes('Joao') === true
    );
  });

  // 3. Teste de evento da Evolution com @lid PURO (sem senderPn, apenas mapeamento por LID)
  await testar('Processar evento com @lid puro (sem senderPn), resolvido via campo "lid"', async () => {
    const evento = {
      event: 'messages.upsert',
      instance: 'DeltaPlan',
      key: {
        remoteJid: '176948374462673@lid',
        fromMe: false,
        id: `test-lid-puro-${Date.now()}`,
      },
      pushName: 'Joao Gabriel',
      message: {
        conversation: 'Olá Vega teste lid puro',
      },
    };

    const res = await processarEventoEvolution(evento);
    return (
      res.sucesso === true &&
      res.destinatario === '176948374462673@lid' &&
      res.usuario?.nome.includes('Joao') === true
    );
  });

  // 4. Teste de evento com @lid desconhecido (não autorizado)
  await testar('Processar evento com @lid desconhecido deve recusar com destinatario = @lid', async () => {
    const evento = {
      event: 'messages.upsert',
      instance: 'DeltaPlan',
      key: {
        remoteJid: '999888777666555@lid',
        fromMe: false,
        id: `test-lid-recusado-${Date.now()}`,
      },
      message: {
        conversation: 'Tentativa invasora',
      },
    };

    const res = await processarEventoEvolution(evento);
    return (
      res.sucesso === false &&
      res.status === 'recusado' &&
      res.destinatario === '999888777666555@lid' &&
      res.resposta === 'Este número não tem acesso à VEGA.'
    );
  });

  // 5. Teste de evento normal (sem LID, formato tradicional @s.whatsapp.net)
  await testar('Processar evento tradicional com remoteJid="5514996863115@s.whatsapp.net"', async () => {
    const evento = {
      event: 'messages.upsert',
      instance: 'DeltaPlan',
      key: {
        remoteJid: '5514996863115@s.whatsapp.net',
        fromMe: false,
        id: `test-tradicional-${Date.now()}`,
      },
      message: {
        conversation: 'Teste formato tradicional',
      },
    };

    const res = await processarEventoEvolution(evento);
    return (
      res.sucesso === true &&
      res.destinatario === '5514996863115@s.whatsapp.net' &&
      res.usuario?.nome.includes('Joao') === true
    );
  });

  console.log('\n================================================================');
  console.log(`Resultado: ${totalPassou} de ${totalTestes} testes passaram.`);
  if (totalPassou === totalTestes) {
    console.log('TODOS OS TESTES DE SUPORTE A @LID PASSARAM COM SUCESSO! 🎉');
  } else {
    process.exit(1);
  }
}

executarTestesLid().catch((e) => {
  console.error('Erro fatal no teste de LID:', e);
  process.exit(1);
});
