import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const BASE_URL = 'http://localhost:4301';
const TOKEN = process.env.WEBHOOK_TOKEN?.trim() || 'token_teste_local';

async function testar() {
  console.log('--- TESTANDO INTEGRAÇÃO PRONTA PARA O RAILWAY ---\n');
  let falhas = 0;

  // 1. Frontend servido na raiz
  try {
    const res = await fetch(`${BASE_URL}/`);
    const texto = await res.text();
    if (res.status === 200 && texto.includes('<!DOCTYPE html>')) {
      console.log('✔ [1. Frontend SPA] Rota / entregando index.html com sucesso (Status: 200)');
    } else {
      console.error(`❌ [1. Frontend SPA] Falha: status ${res.status}`);
      falhas++;
    }
  } catch (err: any) {
    console.error(`❌ [1. Frontend SPA] Erro de conexão:`, err.message);
    falhas++;
  }

  // 2. Status da IA (Sem Gemini)
  try {
    const res = await fetch(`${BASE_URL}/api/status-ia`);
    const dados = await res.json();
    if (res.status === 200 && dados.provedor === 'openai' && !JSON.stringify(dados).includes('gemini')) {
      console.log(`✔ [2. Status IA] Provedor: ${dados.provedor} | Modelo: ${dados.modelo} (Status: 200, Sem Gemini)`);
    } else {
      console.error(`❌ [2. Status IA] Resposta inesperada:`, dados);
      falhas++;
    }
  } catch (err: any) {
    console.error(`❌ [2. Status IA] Erro:`, err.message);
    falhas++;
  }

  // 3. Documentos do cofre no Supabase
  try {
    const res = await fetch(`${BASE_URL}/api/documentos`);
    const dados = await res.json();
    if (res.status === 200 && Array.isArray(dados) && dados.length === 8) {
      console.log(`✔ [3. Cofre Supabase] ${dados.length} documentos retornados com sucesso (Status: 200)`);
    } else {
      console.error(`❌ [3. Cofre Supabase] Resposta inesperada:`, dados?.length);
      falhas++;
    }
  } catch (err: any) {
    console.error(`❌ [3. Cofre Supabase] Erro:`, err.message);
    falhas++;
  }

  // 4. Testar Endpoint Oficial do Webhook e todos os aliases
  const rotasWebhook = [
    '/api/webhook/whatsapp',
    '/api/webhook/evolution',
    '/webhook/whatsapp',
    '/webhook/evolution',
  ];

  for (const rota of rotasWebhook) {
    try {
      // Teste sem token (esperado 401)
      const resSemToken = await fetch(`${BASE_URL}${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (resSemToken.status === 401) {
        // Teste com token correto (esperado 200)
        const resComToken = await fetch(`${BASE_URL}${rota}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: TOKEN,
          },
          body: JSON.stringify({
            event: 'messages.upsert',
            data: {
              key: {
                remoteJid: '5514996863115@s.whatsapp.net',
                fromMe: false,
                id: `TESTE_RAILWAY_${Date.now()}_${Math.random()}`,
              },
              message: { conversation: 'Olá Vega teste railway' },
            },
          }),
        });

        if (resComToken.status === 200) {
          console.log(`✔ [4. Webhook Route] Rota ${rota} -> 401 (sem token) e 200 (com token) OK`);
        } else {
          console.error(`❌ [4. Webhook Route] Rota ${rota} retornou ${resComToken.status} com token`);
          falhas++;
        }
      } else {
        console.error(`❌ [4. Webhook Route] Rota ${rota} retornou ${resSemToken.status} sem token (esperado 401)`);
        falhas++;
      }
    } catch (err: any) {
      console.error(`❌ [4. Webhook Route] Erro em ${rota}:`, err.message);
      falhas++;
    }
  }

  console.log(`\nResultado dos Testes: ${falhas === 0 ? 'TODOS OS TESTES PASSARAM COM SUCESSO! 🎉' : `${falhas} FALHAS`}`);
}

testar().catch(console.error);
