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
  salvarConfiguracoesVega,
  restaurarPadraoVega,
  obterHistoricoVersoes,
  restaurarVersaoHistorico,
  obterModelosEmUso,
  obterPromptPadraoSistema,
  ID_VERSAO_PADRAO_SISTEMA,
} from '../config/configuracoesVegaService.js';
import { exigirAdmin } from '../auth/authMiddleware.js';
import { gerarTokenSessao, validarTokenSessao } from '../auth/authService.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

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

  const supabase = getSupabaseClient();
  const timestampTeste = Date.now();
  const idVersaoTemp1 = `teste_temp_${timestampTeste}_1`;
  const idVersaoTemp2 = `teste_temp_${timestampTeste}_2`;
  const autorTeste = 'Sistema (Teste Temporário)';
  const autorIdTeste = 'sistema-teste-temp';

  // 1. Salva o estado original do banco para restauração incondicional no finally
  const { data: configOriginalBanco } = await supabase
    .from('configuracoes_vega')
    .select('*')
    .eq('id', 'config_padrao')
    .maybeSingle();

  try {
    // -------------------------------------------------------------
    // Teste 1: Modelos Homologados em Uso (Apenas Leitura)
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
    // Teste 2: Inicialização no Supabase e Leitura Síncrona
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
    // Teste 3: Alteração Dinâmica com Efeito Imediato (Registro Temporário Marcado)
    // -------------------------------------------------------------
    console.log('\n--- Teste 3: Atualização Dinâmica e Persistência com Registro Marcado ---');
    const promptTeste = 'Você é a VEGA Delta Plan - Prompt de Teste de Comportamento Dinâmico.';
    const tempTeste = 0.45;

    const configAtualizada = await salvarConfiguracoesVega({
      promptPersona: promptTeste,
      temperaturaResposta: tempTeste,
      autorNome: autorTeste,
      autorId: autorIdTeste,
      motivo: 'teste_automatizado_temporario',
      idVersaoCustomizado: idVersaoTemp1,
      gravarHistorico: true,
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
    // Teste 4: Histórico de Versões e Rollback Temporário
    // -------------------------------------------------------------
    console.log('\n--- Teste 4: Auditoria de Versões e Rollback ---');
    const historico = await obterHistoricoVersoes(10);
    asserir(historico.length >= 1, `Histórico de versões contém registros (${historico.length} versões registradas)`);

    const versaoRecente = historico.find((h) => h.id === idVersaoTemp1);
    asserir(
      !!versaoRecente && versaoRecente.autorNome === autorTeste && versaoRecente.temperaturaResposta === tempTeste,
      `Versão de teste (${idVersaoTemp1}) registrada fielmente no histórico com autor "${autorTeste}"`
    );

    // Salva uma segunda versão temporária para testar rollback
    console.log('  -> Gerando segunda versão temporária para validar rollback...');
    await salvarConfiguracoesVega({
      promptPersona: 'Prompt intermediário de teste',
      temperaturaResposta: 0.75,
      autorNome: autorTeste,
      autorId: autorIdTeste,
      motivo: 'teste_automatizado_temporario',
      idVersaoCustomizado: idVersaoTemp2,
      gravarHistorico: true,
    });

    console.log(`  -> Executando rollback para a versão ID: ${idVersaoTemp1}...`);
    const configRevertida = await restaurarVersaoHistorico(idVersaoTemp1, {
      autorNome: autorTeste,
      autorId: autorIdTeste,
      gravarHistorico: false, // não gera versão de lixo no histórico
    });

    asserir(
      configRevertida.temperaturaResposta === tempTeste,
      `Rollback bem-sucedido: temperatura restaurada para ${configRevertida.temperaturaResposta}`
    );
    asserir(
      configRevertida.promptPersona.trim() === promptTeste.trim(),
      'Rollback bem-sucedido: prompt da persona restaurado'
    );

    // -------------------------------------------------------------
    // Teste 5: Restauração do Padrão a partir do Supabase (Zero Disco)
    // -------------------------------------------------------------
    console.log('\n--- Teste 5: Cópia Padrão Permanente no Supabase (Zero Dependência de Disco) ---');
    const { data: registroPadraoSistema, error: erroPadrao } = await supabase
      .from('configuracoes_vega_historico')
      .select('*')
      .eq('id', ID_VERSAO_PADRAO_SISTEMA)
      .single();

    asserir(!erroPadrao && !!registroPadraoSistema, `Registro id='${ID_VERSAO_PADRAO_SISTEMA}' existe no Supabase`);
    asserir(
      registroPadraoSistema?.prompt_persona?.length > 100,
      `Prompt padrão permanente no Supabase contém ${registroPadraoSistema?.prompt_persona?.length} caracteres`
    );
    asserir(
      Number(registroPadraoSistema?.temperatura_resposta) === 0.1,
      'Temperatura da versão padrão permanente no Supabase é exatamente 0.1'
    );

    const padraoSistemaObtido = await obterPromptPadraoSistema();
    asserir(
      padraoSistemaObtido.promptPersona === registroPadraoSistema.prompt_persona,
      'obterPromptPadraoSistema() retorna a semente direta do banco Supabase'
    );

    const configPadraoRestaurada = await restaurarPadraoVega({
      autorNome: autorTeste,
      autorId: autorIdTeste,
      gravarHistorico: false, // não polui o histórico permanente
    });

    asserir(configPadraoRestaurada.temperaturaResposta === 0.1, 'Temperatura restaurada para 0.1');
    asserir(
      configPadraoRestaurada.promptPersona === registroPadraoSistema.prompt_persona,
      'restaurarPadraoVega() restaurou o prompt fielmente a partir do Supabase, sem ler disco local'
    );

    // -------------------------------------------------------------
    // Teste 6: Trava Rígida de Estabilidade para Classificação e Extração
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
    // Teste 7: Validação Criptográfica de Admin na Sessão do Servidor
    // -------------------------------------------------------------
    console.log('\n--- Teste 7: Controle de Acesso e Imunidade a Fraudes do Navegador ---');

    // 7.1 Simula tentativa de envio de role 'admin' no corpo da requisição com sessão de usuário comum
    let bloqueadoFraudeBody = false;
    let statusFraude = 0;
    const reqComRoleFalsificadoNoBody: any = {
      body: {
        role: 'admin',
        usuario: { role: 'admin' },
        isAdmin: true,
        promptPersona: 'Tentativa Invasão',
        temperaturaResposta: 0.9,
      },
      query: { role: 'admin' },
      headers: { 'x-user-role': 'admin' },
      usuario: { userId: 'u-comum-1', nome: 'Colaborador Comum', role: 'usuario' },
    };

    const resBloqueio: any = {
      status: (code: number) => {
        statusFraude = code;
        return {
          json: (dados: any) => {
            if (code === 403 && dados.sucesso === false) {
              bloqueadoFraudeBody = true;
            }
          },
        };
      },
    };
    const nextNaoChamado = () => {
      throw new Error('Next jamais deve ser chamado quando a sessão do servidor for de role "usuario"!');
    };

    exigirAdmin(reqComRoleFalsificadoNoBody, resBloqueio, nextNaoChamado);
    asserir(
      bloqueadoFraudeBody && statusFraude === 403,
      'Tentativa do navegador de enviar { role: "admin" } no body/headers é sumariamente bloqueada com HTTP 403'
    );

    // 7.2 Simula requisição sem sessão (usuário deslogado)
    const reqSemSessao: any = {};
    exigirAdmin(reqSemSessao, resBloqueio, nextNaoChamado);
    asserir(statusFraude === 403, 'Requisição sem sessão autenticada é bloqueada com HTTP 403');

    // 7.3 Valida integridade criptográfica HMAC do token de sessão
    const tokenUsuarioComum = gerarTokenSessao({
      userId: 'u-legitimo-comum',
      nome: 'Colaborador Delta',
      role: 'usuario',
      authType: 'usuario_senha',
    });

    const sessaoDecodificada = validarTokenSessao(tokenUsuarioComum);
    asserir(
      sessaoDecodificada?.role === 'usuario',
      'Token legítimo emitido pelo servidor decodifica fielmente role="usuario"'
    );

    // Tentativa de adulterar o payload do token para tentar virar admin
    const partes = tokenUsuarioComum.split('.');
    const payloadJson = Buffer.from(partes[0], 'base64url').toString('utf-8');
    const payloadAdulterado = JSON.parse(payloadJson);
    payloadAdulterado.role = 'admin';
    const tokenFalsificado = `${Buffer.from(JSON.stringify(payloadAdulterado), 'utf-8').toString('base64url')}.${partes[1]}`;

    const sessaoFalsificada = validarTokenSessao(tokenFalsificado);
    asserir(
      sessaoFalsificada === null,
      'Token com payload adulterado no cliente falha na verificação de assinatura HMAC e é rejeitado (retorna null)'
    );

    // 7.4 Usuário com sessão genuína de admin no servidor
    let autorizadoAdminGenuino = false;
    const reqAdminGenuino: any = {
      usuario: { userId: 'admin-master', nome: 'Administrador Homologado', role: 'admin' },
    };
    const nextChamado = () => {
      autorizadoAdminGenuino = true;
    };

    exigirAdmin(reqAdminGenuino, resBloqueio, nextChamado);
    asserir(
      autorizadoAdminGenuino,
      'Sessão genuína de administrador validada pelo servidor recebe autorização imediata'
    );
  } finally {
    // -------------------------------------------------------------
    // Limpeza Incondicional pós-teste: NUNCA poluir histórico de produção
    // -------------------------------------------------------------
    console.log('\n--- Limpeza de Segurança pós-teste no Supabase ---');
    try {
      // 1. Remove qualquer versão temporária criada pelo teste no histórico
      const { data: deletados } = await supabase
        .from('configuracoes_vega_historico')
        .delete()
        .like('id', 'teste_temp_%')
        .select('id');

      console.log(`  ✔ Registros temporários de teste removidos do histórico: ${deletados?.length || 0}`);

      // 2. Restaura o registro ativo de produção para o estado exato anterior ao teste
      if (configOriginalBanco) {
        await supabase.from('configuracoes_vega').upsert({
          id: 'config_padrao',
          prompt_persona: configOriginalBanco.prompt_persona,
          temperatura_resposta: configOriginalBanco.temperatura_resposta,
          atualizado_por_nome: configOriginalBanco.atualizado_por_nome,
          atualizado_por_id: configOriginalBanco.atualizado_por_id,
          atualizado_em: configOriginalBanco.atualizado_em,
        });
        await inicializarConfiguracoesVega();
        console.log('  ✔ Registro ativo de produção restaurado fielmente para o estado original.');
      }

      // 3. Validação final: histórico sem registros temporários
      const historicoPosLimpeza = await obterHistoricoVersoes(10);
      const resquicios = historicoPosLimpeza.filter((h) => h.id.startsWith('teste_temp_'));
      asserir(resquicios.length === 0, 'Histórico do Supabase 100% limpo: zero registros de teste restantes');
    } catch (errCleanup) {
      console.error('  ❌ Erro durante a limpeza de segurança pós-teste:', errCleanup);
    }
  }

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
