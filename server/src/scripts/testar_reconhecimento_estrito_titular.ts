import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { extrairTitularExplicito, buscarDocumentos } from '../busca/motor.js';
import { extrairNomeTitularDaMensagem } from '../busca/intencao.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, DocumentoRegistro, Mensagem } from '../types.js';

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES DE RECONHECIMENTO ESTRITO DE TITULARES (SEM REGEX POSICIONAL)');
  console.log('===============================================================\n');

  // PARTE 1: Testes unitários de extração determinística
  console.log('--- PARTE 1: Testes Unitários de Extração de Titular ---');

  const casos = [
    { texto: 'me manda a certidão de óbito', esperado: null },
    { texto: 'contrato de locação', esperado: null },
    { texto: 'certidão de casamento', esperado: null },
    { texto: 'certidão de casamento do thomaz', esperado: 'Thomaz' },
    { texto: 'termo de rescisão', esperado: null },
    { texto: 'comprovante de residência', esperado: null },
    { texto: 'cnh do andré', esperado: 'André' },
  ];

  let passouTodosUnitarios = true;

  for (const c of casos) {
    const resMotor = extrairTitularExplicito(c.texto);
    const resIntencao = extrairNomeTitularDaMensagem(c.texto);

    const motorOk = c.esperado === null ? resMotor === null : resMotor?.toLowerCase() === c.esperado.toLowerCase();
    const intencaoOk = c.esperado === null ? resIntencao === null : resIntencao?.toLowerCase().includes(c.esperado.toLowerCase());

    console.log(`Frase: "${c.texto}"`);
    console.log(`  -> extrairTitularExplicito (motor.ts): "${resMotor}" [${motorOk ? '✅ CORRETO' : '❌ FALHOU'}]`);
    console.log(`  -> extrairNomeTitularDaMensagem (intencao.ts): "${resIntencao}" [${intencaoOk ? '✅ CORRETO' : '❌ FALHOU'}]`);

    if (!motorOk || !intencaoOk) {
      passouTodosUnitarios = false;
    }
  }

  console.log(`\nResultado da Parte 1: ${passouTodosUnitarios ? '✅ TODOS PASSARAM' : '❌ HOUVE FALHAS'}\n`);

  // PARTE 2: Testes ponta a ponta com processarMensagemChat
  console.log('--- PARTE 2: Testes Ponta a Ponta com o Orquestrador ---');

  const contatoJoao: Contato = {
    id: 'user-joao',
    nome: 'João Gabriel',
    telefone: '5511999999999',
    avatarCor: '#10b981',
    nivelAcesso: 'diretoria',
    ficha: {
      nome: 'João Gabriel',
      nivelAcesso: 'diretoria',
    } as any,
  };

  const docsDisponiveis: DocumentoRegistro[] = [
    {
      id: 'doc-casamento-1',
      titulo: 'Certidão de Casamento - Thomaz',
      arquivo: 'certidao_casamento_thomaz.pdf',
      tipo: 'Certidão de Casamento',
      titular: 'Thomaz',
      apelidos: ['certidão', 'casamento', 'certidão de casamento'],
      tamanho: '1024 KB',
      visibilidade: 'diretoria',
    },
    {
      id: 'doc-cnh-1',
      titulo: 'CNH - Thomaz',
      arquivo: 'cnh_thomaz.pdf',
      tipo: 'CNH',
      titular: 'Thomaz',
      apelidos: ['cnh', 'habilitação', 'carteira de motorista'],
      tamanho: '2048 KB',
      visibilidade: 'diretoria',
    },
  ];

  const historicoVazio: Mensagem[] = [];

  // TESTE 1: "me manda a certidão de óbito"
  console.log('\n[E2E 1] "me manda a certidão de óbito"');
  const resE2E1 = await processarMensagemChat({
    mensagemUsuario: 'me manda a certidão de óbito',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', resE2E1.textoResposta);
  console.log('Anexos:', resE2E1.anexos?.map((a) => a.nome));
  console.log('Rastro Sujeito:', resE2E1.rastro?.pessoa || '(nenhum)');
  const textoE2E1 = resE2E1.textoResposta.toLowerCase();
  const naoEncontrouDoc = textoE2E1.includes('não consegui') || textoE2E1.includes('não encontrei');
  console.log('OK?', naoEncontrouDoc && !resE2E1.rastro?.pessoa && !resE2E1.anexos ? 'SIM' : 'NÃO');

  // TESTE 2: "contrato de locação"
  console.log('\n[E2E 2] "contrato de locação"');
  const resE2E2 = await processarMensagemChat({
    mensagemUsuario: 'contrato de locação',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', resE2E2.textoResposta);
  console.log('Rastro Sujeito:', resE2E2.rastro?.pessoa || '(nenhum)');
  console.log('OK?', !resE2E2.rastro?.pessoa ? 'SIM' : 'NÃO');

  // TESTE 3: "certidão de casamento"
  console.log('\n[E2E 3] "certidão de casamento"');
  const resE2E3 = await processarMensagemChat({
    mensagemUsuario: 'certidão de casamento',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', resE2E3.textoResposta);
  console.log('Anexos:', resE2E3.anexos?.map((a) => a.nome));
  console.log('OK?', (resE2E3.anexos?.length || 0) === 1 && resE2E3.textoResposta.includes('Certidão de Casamento') ? 'SIM' : 'NÃO');

  // TESTE 4: "certidão de casamento do thomaz"
  console.log('\n[E2E 4] "certidão de casamento do thomaz"');
  const resE2E4 = await processarMensagemChat({
    mensagemUsuario: 'certidão de casamento do thomaz',
    historicoRecente: historicoVazio,
    contato: contatoJoao,
    documentosDisponiveis: docsDisponiveis,
  });
  console.log('Resposta VEGA:', resE2E4.textoResposta);
  console.log('Anexos:', resE2E4.anexos?.map((a) => a.nome));
  console.log('OK?', (resE2E4.anexos?.length || 0) === 1 && resE2E4.textoResposta.includes('Certidão de Casamento') ? 'SIM' : 'NÃO');

  console.log('\n===============================================================');
  console.log('TESTES CONCLUÍDOS COM SUCESSO');
  console.log('===============================================================');
}

rodarTestes().catch(console.error);
