import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  validarTokenWebhook,
  processarEventoEvolution,
  RESPOSTA_NAO_AUTORIZADO,
} from '../whatsapp/whatsappWebhookService.js';
import {
  buscarUsuarioPorNumero,
  gerarVariantesNumeroBrasil,
  normalizarNumeroCanonica,
} from '../whatsapp/usuarioWhatsAppService.js';
import { Request } from 'express';

async function executarTestesWebhookWhatsApp() {
  console.log('===============================================================');
  console.log('TESTES DE SEGURANÇA E PROCESSAMENTO DO WEBHOOK WHATSAPP');
  console.log('===============================================================\n');

  const tokenConfigurado = process.env.WEBHOOK_TOKEN?.trim() || 'token_teste_local';
  console.log(`Token configurado no ambiente: ${tokenConfigurado ? '*** DEFINIDO ***' : 'NÃO CONFIGURADO'}`);

  let sucessos = 0;
  let falhas = 0;

  function assert(condicao: boolean, titulo: string) {
    if (condicao) {
      console.log(`  ✓ [PASSOU] ${titulo}`);
      sucessos++;
    } else {
      console.error(`  ✗ [FALHOU] ${titulo}`);
      falhas++;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. TESTE DE NORMALIZAÇÃO DE NÚMEROS BRASILEIROS
  // ---------------------------------------------------------------------------
  console.log('--- 1. TESTE DE NORMALIZAÇÃO DE NÚMEROS E AUTORIZAÇÃO ---');
  const variantes1 = gerarVariantesNumeroBrasil('(14) 99686-3115');
  console.log(`Variantes de "(14) 99686-3115":`, variantes1);
  assert(
    variantes1.includes('5500000000000') && variantes1.includes('5500000000000'),
    'Gera variantes com 9 (13 dígitos) e sem 9 (12 dígitos)'
  );

  const variantesJid = gerarVariantesNumeroBrasil('5500000000000@s.whatsapp.net');
  console.log(`Variantes de JID sem 9 ("5500000000000@s.whatsapp.net"):`, variantesJid);
  assert(
    variantesJid.includes('5500000000000') && variantesJid.includes('5500000000000'),
    'Reconhece número que chega sem o 9 no WhatsApp e gera versão com 9'
  );

  const usuarioAutorizado = await buscarUsuarioPorNumero('5500000000000@s.whatsapp.net');
  console.log(`Busca do número (14) 99686-3115 (enviado sem 9):`, usuarioAutorizado?.nome, `| Perfil:`, usuarioAutorizado?.perfil);
  assert(
    usuarioAutorizado !== null && usuarioAutorizado.perfil === 'admin' && usuarioAutorizado.nome === 'Usuario Teste',
    'Usuário cadastrado identificado com sucesso como "Usuario Teste" (admin)'
  );

  const usuarioDesconhecido = await buscarUsuarioPorNumero('5500000000006@s.whatsapp.net');
  assert(usuarioDesconhecido === null, 'Número não cadastrado (11 98888-7777) retorna null');

  // ---------------------------------------------------------------------------
  // 2. TESTE DE AUTENTICAÇÃO DO TOKEN NO WEBHOOK
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. TESTE DE SEGURANÇA E TOKEN DO WEBHOOK ---');
  
  // 2.1 Sem token
  const reqSemToken = {
    headers: {},
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  const authSemToken = validarTokenWebhook(reqSemToken);
  assert(authSemToken === false, 'Requisição sem token é recusada (retorna 401)');

  // 2.2 Com token incorreto
  const reqTokenIncorreto = {
    headers: { 'x-webhook-token': 'token_falso_atacante' },
    query: {},
    ip: '192.168.1.100',
    socket: { remoteAddress: '192.168.1.100' },
  } as unknown as Request;
  const authTokenInvalido = validarTokenWebhook(reqTokenIncorreto);
  assert(authTokenInvalido === false, 'Requisição com token incorreto é recusada sem vazar token');

  // 2.3 Com token correto via header x-webhook-token
  const reqTokenCorreto = {
    headers: { 'x-webhook-token': tokenConfigurado },
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  const authTokenValido = validarTokenWebhook(reqTokenCorreto);
  assert(authTokenValido === true, 'Requisição com token correto no header x-webhook-token é aceita');

  // 2.4 Com token correto via apikey
  const reqApiKey = {
    headers: { apikey: tokenConfigurado },
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  assert(validarTokenWebhook(reqApiKey) === true, 'Requisição com token correto no header apikey é aceita');

  // 2.5 Com token correto via query parameter ?token=...
  const reqQueryToken = {
    headers: {},
    query: { token: tokenConfigurado },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  assert(validarTokenWebhook(reqQueryToken) === true, 'Requisição com token correto na query string ?token= é aceita');

  // ---------------------------------------------------------------------------
  // 3. TESTE DE NÚMERO NÃO AUTORIZADO (RECUSA SEM CHAMAR A IA)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. TESTE DE MENSAGEM DE NÚMERO NÃO AUTORIZADO ---');
  const eventoNaoAutorizado = {
    key: {
      remoteJid: '5500000000007@s.whatsapp.net',
      fromMe: false,
      id: `TESTE-NAO-AUTORIZADO-${Date.now()}`,
    },
    pushName: 'Estranho',
    message: {
      conversation: 'Olá, qual é o CPF do titular?',
    },
  };

  const resNaoAutorizado = await processarEventoEvolution(eventoNaoAutorizado, '203.0.113.195');
  console.log('Resultado número não autorizado:', resNaoAutorizado);
  assert(resNaoAutorizado.status === 'recusado', 'Status retornado é "recusado"');
  assert(
    resNaoAutorizado.resposta === RESPOSTA_NAO_AUTORIZADO,
    `Resposta enviada é exatamente a frase curta: "${RESPOSTA_NAO_AUTORIZADO}"`
  );
  assert(resNaoAutorizado.tempoMs === undefined, 'IA NÃO foi acionada (tempo de IA inexistente)');

  // ---------------------------------------------------------------------------
  // 4. TESTE DE DEDUPLICAÇÃO E FILTRO DE MENSAGEM PRÓPRIA (fromMe)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. TESTE DE DEDUPLICAÇÃO E FROM_ME ---');
  const idMensagemDuplicada = `TESTE-DUPLICADO-${Date.now()}`;
  const eventoOriginal = {
    key: {
      remoteJid: '5500000000000@s.whatsapp.net',
      fromMe: false,
      id: idMensagemDuplicada,
    },
    pushName: 'Usuario Teste',
    message: {
      conversation: 'Oi VEGA',
    },
  };

  // Primeira chamada: deve processar
  console.log('Enviando evento 1ª vez...');
  const resPrimeiraVez = await processarEventoEvolution(eventoOriginal, '127.0.0.1');
  console.log(`1ª Chamada - Status: ${resPrimeiraVez.status} | Resposta: "${resPrimeiraVez.resposta?.slice(0, 60)}..."`);
  assert(resPrimeiraVez.status === 'processado', 'Primeira mensagem com id novo foi processada com sucesso');

  // Segunda chamada com o mesmo key.id: deve ignorar
  console.log('Enviando evento 2ª vez (mesmo key.id)...');
  const resSegundaVez = await processarEventoEvolution(eventoOriginal, '127.0.0.1');
  console.log(`2ª Chamada - Status: ${resSegundaVez.status} | Motivo: ${resSegundaVez.motivo}`);
  assert(resSegundaVez.status === 'ignorado', 'Segunda mensagem foi ignorada');
  assert(resSegundaVez.motivo === 'mensagem_duplicada', 'Motivo da ignorância foi "mensagem_duplicada"');

  // Mensagem com fromMe = true: deve ignorar imediatamente
  const eventoFromMe = {
    key: {
      remoteJid: '5500000000000@s.whatsapp.net',
      fromMe: true,
      id: `TESTE-FROM-ME-${Date.now()}`,
    },
    message: {
      conversation: 'Mensagem enviada pelo bot',
    },
  };
  const resFromMe = await processarEventoEvolution(eventoFromMe, '127.0.0.1');
  assert(resFromMe.status === 'ignorado' && resFromMe.motivo === 'mensagem_propria_from_me', 'Mensagens com fromMe=true são ignoradas');

  // ---------------------------------------------------------------------------
  // 5. TESTE DE NÚMERO AUTORIZADO (DIRETO E EM GRUPO)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. TESTE DE MENSAGEM DO NÚMERO AUTORIZADO (14) 99686-3115 ---');

  // 5.1 Chat Direto perguntando dados cadastrais
  const eventoAutorizadoDireto = {
    key: {
      remoteJid: '5500000000000@s.whatsapp.net', // Enviado na forma sem 9 pelo WhatsApp
      fromMe: false,
      id: `TESTE-AUTORIZADO-${Date.now()}`,
    },
    pushName: 'Usuario Teste',
    message: {
      conversation: 'Oi VEGA, tudo bem?',
    },
  };
  console.log('Enviando mensagem autorizada direta: "Oi VEGA, tudo bem?"...');
  const resDireto = await processarEventoEvolution(eventoAutorizadoDireto, '127.0.0.1');
  console.log(`Resposta da VEGA: "${resDireto.resposta}"`);
  assert(resDireto.status === 'processado', 'Mensagem direta autorizada processada com sucesso');
  assert(
    Boolean(resDireto.resposta && resDireto.usuario?.nome === 'Usuario Teste'),
    'Usuário associado à conversa é "Usuario Teste"'
  );

  // 5.2 Em Grupo WhatsApp (@g.us) com RESPONDER_EM_GRUPOS=false (deve ignorar)
  process.env.RESPONDER_EM_GRUPOS = 'false';
  const eventoGrupoBloqueado = {
    key: {
      remoteJid: '120363028392819283@g.us', // JID do grupo
      participant: '5500000000000@s.whatsapp.net', // Quem enviou dentro do grupo
      fromMe: false,
      id: `TESTE-GRUPO-BLOQUEADO-${Date.now()}`,
    },
    pushName: 'Usuario Teste',
    message: {
      conversation: 'Tem algum documento vencendo?',
    },
  };
  console.log('Enviando mensagem em grupo do WhatsApp (@g.us) com RESPONDER_EM_GRUPOS=false...');
  const resGrupoBloqueado = await processarEventoEvolution(eventoGrupoBloqueado, '127.0.0.1');
  console.log(`Status retorno grupo bloqueado:`, resGrupoBloqueado.status, `| Motivo:`, resGrupoBloqueado.motivo);
  assert(
    resGrupoBloqueado.status === 'ignorado' && resGrupoBloqueado.motivo === 'mensagens_de_grupo_desativadas',
    'Mensagem de grupo @g.us ignorada com sucesso quando RESPONDER_EM_GRUPOS=false'
  );

  // 5.3 Em Grupo WhatsApp (@g.us) com RESPONDER_EM_GRUPOS=true (para quando o usuário liberar no futuro)
  process.env.RESPONDER_EM_GRUPOS = 'true';
  const eventoGrupoLiberado = {
    key: {
      remoteJid: '120363028392819283@g.us', // JID do grupo
      participant: '5500000000000@s.whatsapp.net', // Quem enviou dentro do grupo
      fromMe: false,
      id: `TESTE-GRUPO-LIBERADO-${Date.now()}`,
    },
    pushName: 'Usuario Teste',
    message: {
      conversation: 'Tem algum documento vencendo?',
    },
  };
  console.log('Enviando mensagem em grupo do WhatsApp (@g.us) com RESPONDER_EM_GRUPOS=true...');
  const resGrupoLiberado = await processarEventoEvolution(eventoGrupoLiberado, '127.0.0.1');
  console.log(`Resposta da VEGA no grupo liberado: "${resGrupoLiberado.resposta?.slice(0, 80)}..."`);
  assert(resGrupoLiberado.status === 'processado', 'Mensagem em grupo processada quando RESPONDER_EM_GRUPOS=true');
  assert(
    resGrupoLiberado.destinatario === '120363028392819283@g.us',
    'Destinatário da resposta no grupo liberado é o próprio grupo'
  );

  // Restaura padrão desativado
  process.env.RESPONDER_EM_GRUPOS = 'false';

  console.log('\n===============================================================');
  console.log(`RESULTADO FINAL: ${sucessos} passou(ram), ${falhas} falhou(ram)`);
  console.log('===============================================================');

  if (falhas > 0) {
    process.exit(1);
  }
}

executarTestesWebhookWhatsApp().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
