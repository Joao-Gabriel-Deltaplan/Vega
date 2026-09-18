import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  obterTodosUsuariosWhatsApp,
  buscarUsuarioPorTelefone,
  buscarUsuarioPorLid,
  buscarUsuarioPorNumero,
} from '../whatsapp/usuarioWhatsAppService.js';
import { processarEventoEvolution } from '../whatsapp/whatsappWebhookService.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 TESTE 1: Leitura de Usuários diretamente do Supabase');
  console.log('================================================================');

  const usuarios = await obterTodosUsuariosWhatsApp();
  console.log(`Total de usuários carregados do Supabase: ${usuarios.length}`);
  const joao = usuarios.find((u) => u.numero === '5514996863115');
  console.log('Usuário Joao Gabriel carregado do Supabase:', {
    id: joao?.id,
    nome: joao?.nome,
    numero: joao?.numero,
    lid: joao?.lid,
    perfil: joao?.perfil,
    ativo: joao?.ativo,
  });

  if (!joao || joao.lid !== '176948374462673') {
    throw new Error('Falha: Usuário Joao Gabriel com LID 176948374462673 não encontrado no Supabase!');
  }
  console.log('✅ TESTE 1 PASSOU: Usuário e LID carregados com sucesso do Supabase.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 2: Busca por Telefone Real (Variantes BR)');
  console.log('================================================================');

  const variantes = [
    '5514996863115',
    '551496863115',
    '14996863115',
    '1496863115',
    '5514996863115@s.whatsapp.net',
  ];

  for (const v of variantes) {
    const achou = await buscarUsuarioPorTelefone(v);
    if (!achou || achou.nome !== 'Joao Gabriel') {
      throw new Error(`Falha ao buscar por variante de telefone: ${v}`);
    }
    console.log(`  - Telefone "${v}" -> Autorizado: ${achou.nome}`);
  }
  console.log('✅ TESTE 2 PASSOU: Busca por telefone real validada com todas as variantes.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 3: Busca por LID cadastrado no Supabase');
  console.log('================================================================');

  const variantesLid = [
    '176948374462673',
    '176948374462673@lid',
    '176948374462673:0@lid',
    '176948374462673:1@lid',
  ];

  for (const v of variantesLid) {
    const achou = await buscarUsuarioPorLid(v);
    if (!achou || achou.nome !== 'Joao Gabriel') {
      throw new Error(`Falha ao buscar por LID: ${v}`);
    }
    console.log(`  - LID "${v}" -> Autorizado: ${achou.nome}`);
  }
  console.log('✅ TESTE 3 PASSOU: Busca por LID validada com sucesso.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 4: Prioridade do Número Real (senderPn) sobre o LID');
  console.log('================================================================');

  // Cenário: evento com remoteJid @lid e senderPn preenchido
  const eventoComAmbos = {
    event: 'messages.upsert',
    key: {
      remoteJid: '176948374462673@lid',
      fromMe: false,
      id: `test-pn-priority-${Date.now()}`,
      senderPn: '5514996863115',
    },
    message: {
      conversation: 'Oi VEGA, teste de prioridade de número',
    },
  };

  const resultadoAmbos = await processarEventoEvolution(eventoComAmbos);
  console.log('Resultado do evento com @lid e senderPn:', {
    status: resultadoAmbos.status,
    usuario: resultadoAmbos.usuario?.nome,
    destinatario: resultadoAmbos.destinatario,
  });

  if (resultadoAmbos.status !== 'processado' || resultadoAmbos.usuario?.nome !== 'Joao Gabriel') {
    throw new Error('Falha: Evento com senderPn não foi processado com o usuário correto.');
  }

  // Confirma destinatário de resposta: responde de volta para o mesmo @lid que chegou
  if (resultadoAmbos.destinatario !== '176948374462673@lid') {
    throw new Error('Falha: Resposta deve ser enviada para o mesmo remoteJid (@lid) de origem.');
  }
  console.log('✅ TESTE 4 PASSOU: Prioridade do número real e resposta para @lid confirmadas.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 5: Autorização por LID sem senderPn (Apenas @lid)');
  console.log('================================================================');

  const eventoSemPn = {
    event: 'messages.upsert',
    key: {
      remoteJid: '176948374462673@lid',
      fromMe: false,
      id: `test-lid-only-${Date.now()}`,
    },
    message: {
      conversation: 'Oi VEGA, teste de busca exclusivamente por LID no Supabase',
    },
  };

  const resultadoLid = await processarEventoEvolution(eventoSemPn);
  console.log('Resultado do evento apenas com @lid:', {
    status: resultadoLid.status,
    usuario: resultadoLid.usuario?.nome,
    destinatario: resultadoLid.destinatario,
  });

  if (resultadoLid.status !== 'processado' || resultadoLid.usuario?.nome !== 'Joao Gabriel') {
    throw new Error('Falha: Evento apenas com LID cadastrado no Supabase não foi autorizado.');
  }
  console.log('✅ TESTE 5 PASSOU: Busca por LID direto no Supabase validada.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 6: Remetente Desconhecido (Deve recusar)');
  console.log('================================================================');

  const eventoDesconhecido = {
    event: 'messages.upsert',
    key: {
      remoteJid: '9999999999999@lid',
      fromMe: false,
      id: `test-unknown-${Date.now()}`,
      senderPn: '5511999999999',
    },
    message: {
      conversation: 'Tentativa de acesso não autorizado',
    },
  };

  const resultadoDesconhecido = await processarEventoEvolution(eventoDesconhecido);
  console.log('Resultado do remetente desconhecido:', {
    status: resultadoDesconhecido.status,
    motivo: resultadoDesconhecido.motivo,
    resposta: resultadoDesconhecido.resposta,
  });

  if (resultadoDesconhecido.status !== 'recusado') {
    throw new Error('Falha: Remetente desconhecido não foi recusado!');
  }
  console.log('✅ TESTE 6 PASSOU: Remetente não autorizado recusado com resposta padrão.\n');

  console.log('🎉 TODOS OS TESTES DE AUTORIZAÇÃO E SUPABASE PASSARAM COM SUCESSO!');
}

rodarTestes().catch((err) => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
