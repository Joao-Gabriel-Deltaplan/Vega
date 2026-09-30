import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { obterConfigEvolution } from '../whatsapp/evolutionSenderService.js';

async function testar() {
  const config = obterConfigEvolution();
  console.log('Configuração da Evolution API:', {
    apiUrl: config?.apiUrl,
    instance: config?.instance,
    hasApiKey: !!config?.apiKey,
  });

  if (!config) {
    console.log('Evolution API não configurada no .env');
    return;
  }

  // 1. Consultar webhook atual da instância na Evolution API
  try {
    const urlFind = `${config.apiUrl}/webhook/find/${encodeURIComponent(config.instance)}`;
    console.log('\nConsultando webhook atual em:', urlFind);
    const respFind = await fetch(urlFind, {
      method: 'GET',
      headers: { apikey: config.apiKey },
    });
    console.log('Status GET webhook/find:', respFind.status);
    const dataFind = await respFind.json().catch(() => null);
    console.log('Dados do webhook da instância:', JSON.stringify(dataFind, null, 2));
  } catch (err: any) {
    console.error('Erro ao buscar webhook na Evolution:', err?.message || err);
  }

  // 2. Testar endpoint de presença sendPresence
  try {
    const urlPresence = `${config.apiUrl}/chat/sendPresence/${encodeURIComponent(config.instance)}`;
    console.log('\nTestando sendPresence em:', urlPresence);
    // Testa com um número qualquer ou formato neutro
    const body = {
      number: '5514999999999',
      presence: 'paused',
      delay: 1000,
    };
    const respPres = await fetch(urlPresence, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: JSON.stringify(body),
    });
    console.log('Status POST chat/sendPresence:', respPres.status);
    const dataPres = await respPres.json().catch(() => null);
    console.log('Resposta sendPresence:', dataPres);
  } catch (err: any) {
    console.error('Erro ao testar sendPresence:', err?.message || err);
  }
}

testar().catch(console.error);
