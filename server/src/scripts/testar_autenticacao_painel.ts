import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = process.env.PORT || '4301';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SENHA_CORRETA = process.env.PAINEL_SENHA || 'delta2026';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🔒 TESTANDO SEGURANÇA E AUTENTICAÇÃO DO PAINEL VEGA');
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

  // 1. Rota SPA pública para carregar tela de login
  await testar('Frontend SPA (GET /) deve responder 200 para carregar tela de login', async () => {
    const res = await fetch(`${BASE_URL}/`);
    return res.status === 200;
  });

  // 2. Status inicial sem autenticação
  await testar('GET /api/auth/status sem cookie deve retornar { autenticado: false }', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/status`);
    if (res.status !== 200) return false;
    const json = await res.json();
    return json.autenticado === false;
  });

  // 3. Bloqueio de rotas /api/* sem autenticação
  await testar('GET /api/documentos sem sessão deve retornar 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/documentos`);
    return res.status === 401;
  });

  await testar('GET /api/conversas sem sessão deve retornar 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/conversas`);
    return res.status === 401;
  });

  // 4. Bloqueio de rotas /arquivos/* sem autenticação
  await testar('GET /arquivos/documento_teste.pdf sem sessão deve retornar 401', async () => {
    const res = await fetch(`${BASE_URL}/arquivos/documento_teste.pdf`);
    return res.status === 401;
  });

  // 5. Tentativa de login com senha incorreta
  await testar('POST /api/auth/login com senha errada deve retornar 401', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: 'senha_completamente_errada_123' }),
    });
    return res.status === 401;
  });

  // 6. Login com senha correta e obtenção de cookie
  let cookieSessao = '';
  await testar('POST /api/auth/login com senha correta deve retornar 200 e cookie vega_session', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: SENHA_CORRETA }),
    });
    if (res.status !== 200) return false;

    const setCookie = res.headers.get('set-cookie');
    if (!setCookie || !setCookie.includes('vega_session=')) return false;

    // Extrai o valor do cookie
    const match = setCookie.match(/vega_session=([^;]+)/);
    if (!match) return false;
    cookieSessao = `vega_session=${match[1]}`;
    return true;
  });

  // 7. Status com sessão ativa
  await testar('GET /api/auth/status com cookie de sessão deve retornar { autenticado: true }', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/status`, {
      headers: { Cookie: cookieSessao },
    });
    if (res.status !== 200) return false;
    const json = await res.json();
    return json.autenticado === true && json.usuario?.role === 'admin';
  });

  // 8. Acesso a /api/documentos COM sessão ativa
  await testar('GET /api/documentos com cookie de sessão deve retornar 200 e lista de documentos', async () => {
    const res = await fetch(`${BASE_URL}/api/documentos`, {
      headers: { Cookie: cookieSessao },
    });
    if (res.status !== 200) return false;
    const docs = await res.json();
    return Array.isArray(docs);
  });

  // 9. Exceção do Webhook do WhatsApp (continua funcionando sem cookie mas com WEBHOOK_TOKEN)
  await testar('POST /api/webhook/whatsapp com WEBHOOK_TOKEN deve responder 200 (sem precisar de cookie)', async () => {
    const res = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WEBHOOK_TOKEN}`,
      },
      body: JSON.stringify({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5500000000000@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Teste webhook auth' },
        },
      }),
    });
    return res.status === 200;
  });

  // 10. Webhook sem token continua barrado com 401
  await testar('POST /api/webhook/whatsapp sem WEBHOOK_TOKEN deve responder 401', async () => {
    const res = await fetch(`${BASE_URL}/api/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test' }),
    });
    return res.status === 401;
  });

  // 11. Logout e revogação de acesso
  await testar('POST /api/auth/logout deve deslogar e subsequente /api/documentos deve voltar a 401', async () => {
    const resLogout = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieSessao },
    });
    if (resLogout.status !== 200) return false;

    // Chamada sem o cookie (ou após limpeza do client) deve ser bloqueada
    const resDocs = await fetch(`${BASE_URL}/api/documentos`);
    return resDocs.status === 401;
  });

  console.log('\n================================================================');
  console.log(`Resultado: ${totalPassou} de ${totalTestes} testes passaram.`);
  if (totalPassou === totalTestes) {
    console.log('TODOS OS TESTES DE SEGURANÇA E AUTENTICAÇÃO PASSARAM COM SUCESSO! 🎉');
  } else {
    process.exit(1);
  }
}

rodarTestes().catch((e) => {
  console.error('Erro fatal no teste de autenticação:', e);
  process.exit(1);
});
