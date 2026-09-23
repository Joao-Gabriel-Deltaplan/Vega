import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  inicializarConfiguracoesVega,
  obterConfiguracoesVegaSync,
  obterConfiguracoesVega,
  salvarConfiguracoesVega,
  restaurarPadraoVega,
  obterHistoricoVersoes,
  restaurarVersaoHistorico,
  obterModelosEmUso,
} from '../config/configuracoesVegaService.js';
import { exigirAdmin } from '../auth/authMiddleware.js';

let totalPassos = 0;
let sucessos = 0;
let falhas = 0;

function asserir(condicao: boolean, mensagem: string) {
  totalPassos++;
  if (condicao) {
    console.log(`  ✔ [PASSOU] ${mensagem}`);
    sucessos++;
  } else {
    console.error(`  ❌ [FALHOU] ${mensagem}`);
    falhas++;
  }
}

async function rodarTestes() {
  console.log('===============================================================');
  console.log('TESTES AUTOMATIZADOS: CONFIGURAÇÕES DA VEGA (SUPABASE + CACHE)');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Inicialização e Leitura dos Modelos Homologados
  // -------------------------------------------------------------
  console.log('--- Teste 1: Modelos Homologados em Uso (Apenas Leitura) ---');
  const modelos = obterModelosEmUso();
  asserir(modelos.chat === 'gpt-5.4-mini', `Modelo de Chat é estritamente gpt-5.4-mini (Atual: ${modelos.chat})`);
  asserir(
    modelos.embeddings === 'text-embedding-3-small',
    `Modelo de Embeddings é estritamente text-embedding-3-small (Atual: ${modelos.embeddings})`
  );
  asserir(
    modelos.transcricao === 'gpt-transcribe',
    `Modelo de Transcrição é estritamente gpt-transcribe (Atual: ${modelos.transcricao})`
  );

  // -------------------------------------------------------------
  // Teste 2: Inicialização e Leitura da Configuração no Supabase
  // -------------------------------------------------------------
  console.log('\n--- Teste 2: Inicialização no Supabase e Leitura Síncrona ---');
  const configCarregada = await inicializarConfiguracoesVega();
  asserir(!!configCarregada.id, `ID da configuração carregado: ${configCarregada.id}`);
  asserir(
    configCarregada.promptPersona.length > 50,
    `Prompt da persona contém texto válido (${configCarregada.promptPersona.length} caracteres)`
  );
  asserir(
    typeof configCarregada.temperaturaResposta === 'number',
    `Temperatura de resposta é numérica (${configCarregada.temperaturaResposta})`
  );

  const configSync = obterConfiguracoesVegaSync();
  asserir(
    configSync.promptPersona === configCarregada.promptPersona,
    'Cache síncrono obterConfiguracoesVegaSync() coincide perfeitamente com o Supabase'
  );

  // -------------------------------------------------------------
  // Teste 3: Alteração Dinâmica com Efeito Imediato (Sem Restart)
  // -------------------------------------------------------------
  console.log('\n--- Teste 3: Atualização Dinâmica e Persistência no Supabase ---');
  const promptTeste = 'Você é a VEGA Delta Plan - Prompt de Teste de Comportamento Dinâmico.';
  const tempTeste = 0.45;
  const autorTeste = 'Carlos Eduardo (Admin Teste)';
  const autorIdTeste = 'usr-admin-teste';

  const configAtualizada = await salvarConfiguracoesVega({
    promptPersona: promptTeste,
    temperaturaResposta: tempTeste,
    autorNome: autorTeste,
    autorId: autorIdTeste,
    motivo: 'teste_automatizado',
  });

  asserir(configAtualizada.temperaturaResposta === tempTeste, `Temperatura salva como ${tempTeste}`);
  asserir(configAtualizada.promptPersona === promptTeste, 'Prompt da persona atualizado corretamente');
  asserir(configAtualizada.atualizadoPorNome === autorTeste, `Autor registrado: ${configAtualizada.atualizadoPorNome}`);

  // Verifica efeito imediato no cache síncrono (sem restart do servidor)
  const syncAposUpdate = obterConfiguracoesVegaSync();
  asserir(
    syncAposUpdate.temperaturaResposta === tempTeste && syncAposUpdate.promptPersona === promptTeste,
    'Reflexo em tempo real no cache em memória: WhatsApp e Web usam nova configuração imediatamente'
  );

  // -------------------------------------------------------------
  // Teste 4: Histórico de Versões e Rollback
  // -------------------------------------------------------------
  console.log('\n--- Teste 4: Auditoria de Versões e Rollback ---');
  const historico = await obterHistoricoVersoes(10);
  asserir(historico.length >= 2, `Histórico de versões contém registros (${historico.length} versões registradas)`);

  const ultimaVersao = historico[0];
  asserir(
    ultimaVersao.autorNome === autorTeste && ultimaVersao.temperaturaResposta === tempTeste,
    `Última versão no histórico confere com a alteração feita por ${ultimaVersao.autorNome}`
  );

  // Se houver versão anterior (segunda do histórico), testa o rollback
  if (historico.length >= 2) {
    const versaoAnterior = historico[1];
    console.log(`  -> Testando restauração da versão ID: ${versaoAnterior.id}...`);
    const configRevertida = await restaurarVersaoHistorico(versaoAnterior.id, {
      autorNome: 'Admin Rollback Teste',
      autorId: 'admin-rollback',
    });

    asserir(
      configRevertida.temperaturaResposta === versaoAnterior.temperaturaResposta,
      `Rollback bem-sucedido: temperatura restaurada para ${configRevertida.temperaturaResposta}`
    );
    asserir(
      configRevertida.promptPersona.trim() === versaoAnterior.promptPersona.trim(),
      'Rollback bem-sucedido: prompt da persona restaurado'
    );
  }

  // -------------------------------------------------------------
  // Teste 5: Restauração do Padrão Oficial (prompts/assistente.md)
  // -------------------------------------------------------------
  console.log('\n--- Teste 5: Restauração do Padrão Oficial (prompts/assistente.md) ---');
  const configPadrao = await restaurarPadraoVega({
    autorNome: 'Carlos Eduardo (Admin)',
    autorId: 'admin-carlos',
  });

  const caminhoArquivoPadrao = path.resolve(__dirname, '../../../prompts/assistente.md');
  const conteudoArquivoPadrao = fs.readFileSync(caminhoArquivoPadrao, 'utf-8').trim();

  asserir(configPadrao.temperaturaResposta === 0.1, 'Temperatura restaurada para o padrão oficial 0.1');
  asserir(
    configPadrao.promptPersona.trim() === conteudoArquivoPadrao,
    'Prompt da persona restaurado fielmente para o arquivo físico prompts/assistente.md'
  );

  // -------------------------------------------------------------
  // Teste 6: Trava de Estabilidade no Código do ChatOrquestrador
  // -------------------------------------------------------------
  console.log('\n--- Teste 6: Trava Rígida de Estabilidade para Classificação e Extração ---');
  const caminhoOrquestrador = path.resolve(__dirname, '../chat/chatOrquestrador.ts');
  const conteudoOrquestrador = fs.readFileSync(caminhoOrquestrador, 'utf-8');

  // Verifica que classificarEReescreverMensagem usa temperatura 0.1 fixa
  const inicioFunc = conteudoOrquestrador.indexOf('function classificarEReescreverMensagem');
  const fimFunc = conteudoOrquestrador.indexOf('function responderComTrechos');
  const corpoClassificacao = conteudoOrquestrador.slice(inicioFunc, fimFunc);
  const temClassificacaoFixa = corpoClassificacao.includes('temperature: 0.1');
  asserir(
    temClassificacaoFixa,
    'Trava de estabilidade: classificarEReescreverMensagem continua com temperatura 0.1 baixa e fixa'
  );

  // Verifica que a extração cadastral vetorial usa temperatura 0.0 fixa
  const temExtracaoFixa = conteudoOrquestrador.includes('temperature: 0.0');
  asserir(
    temExtracaoFixa,
    'Trava de estabilidade: extração vetorial cadastral continua com temperatura 0.0 fixa'
  );

  // -------------------------------------------------------------
  // Teste 7: Controle de Acesso Restrito a Administradores
  // -------------------------------------------------------------
  console.log('\n--- Teste 7: Controle de Acesso do Middleware exigirAdmin ---');

  // Simula usuário comum
  let bloqueadoUsuarioComum = false;
  let statusResposta = 0;
  const reqUsuarioComum: any = {
    usuario: { userId: 'u1', nome: 'Colaborador Comum', role: 'usuario' },
  };
  const resBloqueio: any = {
    status: (code: number) => {
      statusResposta = code;
      return {
        json: (dados: any) => {
          if (code === 403 && dados.sucesso === false) {
            bloqueadoUsuarioComum = true;
          }
        },
      };
    },
  };
  const nextNaoChamado = () => {
    throw new Error('Next não deveria ser chamado para usuário comum!');
  };

  exigirAdmin(reqUsuarioComum, resBloqueio, nextNaoChamado);
  asserir(
    bloqueadoUsuarioComum && statusResposta === 403,
    'Middleware exigirAdmin bloqueia usuário comum com HTTP 403 Forbidden'
  );

  // Simula administrador
  let autorizadoAdmin = false;
  const reqAdmin: any = {
    usuario: { userId: 'admin-1', nome: 'Administrador', role: 'admin' },
  };
  const nextChamado = () => {
    autorizadoAdmin = true;
  };

  exigirAdmin(reqAdmin, resBloqueio, nextChamado);
  asserir(autorizadoAdmin, 'Middleware exigirAdmin autoriza usuário com role "admin" com sucesso');

  // -------------------------------------------------------------
  // Resultado Final
  // -------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`TOTAL DE CHECAGENS: ${totalPassos} | APROVADOS: ${sucessos} | FALHAS: ${falhas}`);
  console.log('===============================================================');

  if (falhas > 0) {
    process.exit(1);
  }
}

rodarTestes().catch((err) => {
  console.error('Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
