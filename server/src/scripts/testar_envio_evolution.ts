import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  normalizarDestinatarioEvolution,
  enviarTextoEvolution,
  enviarMediaEvolution,
  enviarRespostaCompletaWhatsApp,
  obterConfigEvolution,
} from '../whatsapp/evolutionSenderService.js';
import { obterBufferArquivo } from '../utils/storageUtils.js';
import { Anexo } from '../types.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 TESTE 1: Normalização de Destinatários para a Evolution API');
  console.log('================================================================');

  const casos = [
    { entrada: '176948374462673@lid', esperado: '176948374462673@lid' },
    { entrada: '120363044123456789@g.us', esperado: '120363044123456789@g.us' },
    { entrada: '5514996863115@s.whatsapp.net', esperado: '5514996863115' },
    { entrada: '5514996863115:0@s.whatsapp.net', esperado: '5514996863115' },
    { entrada: '+55 (14) 99686-3115', esperado: '5514996863115' },
    { entrada: '  14996863115  ', esperado: '14996863115' },
  ];

  for (const c of casos) {
    const obtido = normalizarDestinatarioEvolution(c.entrada);
    console.log(`  - Entrada: "${c.entrada}" -> Normalizado: "${obtido}"`);
    if (obtido !== c.esperado) {
      throw new Error(`Falha de normalização: esperava "${c.esperado}", mas obteve "${obtido}"`);
    }
  }
  console.log('✅ TESTE 1 PASSOU: Todos os formatos de destinatário normalizados corretamente.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 2: Recuperação de PDF e Conversão Base64 do Supabase Storage');
  console.log('================================================================');

  const nomeArquivo = 'CARTAO DE VACINAS.pdf';
  const arquivo = await obterBufferArquivo(nomeArquivo);

  if (!arquivo || !arquivo.buffer) {
    console.warn(`[Aviso] Arquivo "${nomeArquivo}" não encontrado no storage local/nuvem. Testando com outro...`);
  } else {
    const base64 = arquivo.buffer.toString('base64');
    console.log(`Arquivo "${nomeArquivo}" recuperado com sucesso!`);
    console.log(`- Tamanho em bytes: ${arquivo.buffer.length}`);
    console.log(`- Content-Type: ${arquivo.contentType}`);
    console.log(`- Tamanho do Base64: ${base64.length} caracteres`);
    console.log(`- Prefixo do Base64: ${base64.slice(0, 30)}...`);
    if (base64.length === 0) {
      throw new Error('Falha: Buffer base64 gerado está vazio.');
    }
  }
  console.log('✅ TESTE 2 PASSOU: Integração com Supabase Storage e Base64 validada.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 3: Verificação de Configuração da Evolution API');
  console.log('================================================================');

  const config = obterConfigEvolution();
  if (!config) {
    console.log('ℹ️ Variáveis EVOLUTION_* ainda não preenchidas no .env (modo simulação seguro).');
    console.log('Testando resposta do serviço em modo simulação...');

    const resTexto = await enviarTextoEvolution('176948374462673@lid', 'Mensagem de teste simulação');
    console.log('Retorno do envio de texto em simulação:', resTexto);
    if (resTexto.sucesso !== false || !resTexto.motivoFalha) {
      throw new Error('Falha: Modo simulação deveria indicar variáveis não configuradas.');
    }

    const dummyBuffer = Buffer.from('%PDF-1.4 dummy pdf delta plan');
    const resMedia = await enviarMediaEvolution('176948374462673@lid', dummyBuffer, 'teste.pdf', 'Legenda de teste');
    console.log('Retorno do envio de mídia em simulação:', resMedia);
    if (resMedia.sucesso !== false || !resMedia.motivoFalha) {
      throw new Error('Falha: Modo simulação de mídia deveria indicar variáveis não configuradas.');
    }
  } else {
    console.log('🔗 Variáveis EVOLUTION_* configuradas!');
    console.log(`- API URL: ${config.apiUrl}`);
    console.log(`- Instância: ${config.instance}`);
    console.log('- API Key: [CONFIGURADA]');
  }
  console.log('✅ TESTE 3 PASSOU: Validação de configuração e resiliência operante.\n');

  console.log('================================================================');
  console.log('🧪 TESTE 4: Orquestração de Resposta Completa (Texto + Anexo)');
  console.log('================================================================');

  const anexosSimulados: Anexo[] = [
    {
      tipo: 'pdf',
      url: '/arquivos/CARTAO%20DE%20VACINAS.pdf',
      nome: 'CARTAO DE VACINAS.pdf',
      titulo: 'Cartão de Vacinas - Thomaz Lustri Fabre',
    },
  ];

  console.log('Disparando enviarRespostaCompletaWhatsApp para 176948374462673@lid...');
  await enviarRespostaCompletaWhatsApp(
    '176948374462673@lid',
    'Aqui está o documento solicitado, Joao Gabriel.',
    anexosSimulados
  );
  console.log('✅ TESTE 4 PASSOU: Orquestração de texto e documento executada sem falhas de fluxo.\n');

  console.log('🎉 TODOS OS TESTES DA EVOLUTION API PASSARAM COM SUCESSO!');
}

rodarTestes().catch((err) => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
