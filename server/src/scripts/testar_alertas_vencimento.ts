import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  obterTodosAlertas,
  salvarAlertas,
  executarRotinaVerificacaoVencimentos,
  atualizarValidadeDocumento,
} from '../vencimentos/alertaVencimentoService.js';
import { obterTodosDocumentos } from '../storage.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { DocumentoRegistro, Contato, Mensagem } from '../types.js';

const DOCUMENTOS_FILE = path.resolve(__dirname, '../../../data/documentos.json');

function formatarDataBR(data: Date): string {
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

async function main() {
  console.log('=====================================================');
  console.log('INICIANDO BATERIA DE TESTES: ALERTAS DE VENCIMENTO');
  console.log('=====================================================\n');

  // Primeiro garante limpeza de qualquer resíduo anterior
  const docsIniciais = (await obterTodosDocumentos()).filter(d => !d.id.startsWith('teste-alerta-'));
  fs.writeFileSync(DOCUMENTOS_FILE, JSON.stringify(docsIniciais, null, 2), 'utf-8');
  const alertasIniciais = (await obterTodosAlertas()).filter(a => !a.documentoId.startsWith('teste-alerta-'));
  await salvarAlertas(alertasIniciais);

  // 1. Mostrar validades extraídas dos documentos atuais
  console.log('--- 1. DOCUMENTOS ATUAIS E SUAS VALIDADES ---');
  const docsAtuais = await obterTodosDocumentos();
  for (const doc of docsAtuais) {
    console.log(
      `• [${doc.tipo || 'Outro'}] "${doc.titulo}" (Arquivo: ${doc.arquivo}, Titular: ${doc.titular || 'N/A'}): ` +
      `Validade = ${doc.dataValidade || 'Sem validade (Nula)'} ` +
      `(Origem: ${doc.origemValidade || 'N/A'})`
    );
  }

  try {
    // 2. Criar temporariamente 2 documentos de teste
    console.log('\n--- 2. CRIANDO DOCUMENTOS DE TESTE TEMPORÁRIOS ---');
    const hoje = new Date();
    
    const dataEm5Dias = new Date();
    dataEm5Dias.setDate(hoje.getDate() + 5);
    const data5DiasStr = formatarDataBR(dataEm5Dias);

    const dataVencida10Dias = new Date();
    dataVencida10Dias.setDate(hoje.getDate() - 10);
    const dataVencida10DiasStr = formatarDataBR(dataVencida10Dias);

    const docTeste1: DocumentoRegistro = {
      id: 'teste-alerta-5dias',
      titulo: 'Certidão Negativa de Teste',
      arquivo: 'certidao_teste.pdf',
      tipo: 'Certidão Negativa',
      titular: 'Deltaplan Engenharia',
      visibilidade: 'geral',
      dataValidade: data5DiasStr,
      origemValidade: 'extraído automaticamente',
      dataCadastro: new Date().toISOString(),
      statusIndexacao: 'indexado',
    };

    const docTeste2: DocumentoRegistro = {
      id: 'teste-alerta-vencido',
      titulo: 'Alvará de Funcionamento Teste',
      arquivo: 'alvara_teste.pdf',
      tipo: 'Alvará de Funcionamento',
      titular: 'Deltaplan Engenharia',
      visibilidade: 'geral',
      dataValidade: dataVencida10DiasStr,
      origemValidade: 'extraído automaticamente',
      dataCadastro: new Date().toISOString(),
      statusIndexacao: 'indexado',
    };

    const docsComTeste = [...docsAtuais.filter(d => !d.id.startsWith('teste-alerta-')), docTeste1, docTeste2];
    fs.writeFileSync(DOCUMENTOS_FILE, JSON.stringify(docsComTeste, null, 2), 'utf-8');
    console.log(`✓ Documento Teste 1 criado: "${docTeste1.titulo}" - Vence em 5 dias (${data5DiasStr})`);
    console.log(`✓ Documento Teste 2 criado: "${docTeste2.titulo}" - Vencido há 10 dias (${dataVencida10DiasStr})`);

    // 3. Rodar rotina diária de verificação
    console.log('\n--- 3. EXECUTANDO ROTINA DIÁRIA DE VENCIMENTOS ---');
    const relatorioRotina = await executarRotinaVerificacaoVencimentos();
    console.log(`Novos alertas gerados: ${relatorioRotina.alertasGerados.length}`);
    console.log(`Total de alertas na base: ${relatorioRotina.totalAlertas}`);
    console.log(`Total de alertas não lidos: ${relatorioRotina.totalNaoLidos}`);

    const todosAlertas = await obterTodosAlertas();
    const alertasTeste = todosAlertas.filter(a => a.documentoId.startsWith('teste-alerta-'));
    console.log(`\nAlertas gerados para os documentos de teste (${alertasTeste.length}):`);
    for (const a of alertasTeste) {
      console.log(
        `  • [${a.status.toUpperCase()}] Doc: "${a.documentoTitulo}" | Titular: ${a.titular || 'N/A'} | ` +
        `Validade: ${a.dataValidade} | Prazo: ${a.prazoAlerta} | Dias restantes: ${a.diasRestantes}`
      );
    }

    // 4. Testar perguntas no chat
    console.log('\n--- 4. TESTANDO PERGUNTAS NO CHAT COM A VEGA ---');
    const contatoAdmin: Contato = {
      id: 'user-admin-teste',
      nome: 'João Gabriel Brandini',
      telefone: '11999999999',
      avatarCor: '#10b981',
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      ficha: {
        cargo: 'Diretor',
        setor: 'Diretoria',
        nivelAcesso: 'diretoria',
        observacoes: '',
      },
    };

    const perguntas = [
      'tem algum documento vencendo?',
      'o que vence este mês?',
      'quais documentos estão vencidos?'
    ];

    for (const p of perguntas) {
      console.log(`\n==================================================`);
      console.log(`>>> PERGUNTA: "${p}"`);
      const docsDisponiveis = await obterTodosDocumentos();
      const res = await processarMensagemChat({
        mensagemUsuario: p,
        historicoRecente: [],
        contato: contatoAdmin,
        documentosDisponiveis: docsDisponiveis,
      });
      console.log(`RESPOSTA DA VEGA:\n${res.textoResposta}`);
      console.log(`[Rastro: intenção = ${res.intencaoDetectada}]`);
    }

    // 5. Testar correção de validade pelo chat com confirmação
    console.log('\n==================================================');
    console.log('--- 5. TESTANDO CORREÇÃO DE VALIDADE PELO CHAT ---');
    const msgCorrecao = 'a validade da CNH do Thomaz é 10/05/2030';
    console.log(`>>> MENSAGEM: "${msgCorrecao}"`);

    const historicoCorrecao: Mensagem[] = [];
    const docsAntes = await obterTodosDocumentos();
    const res1 = await processarMensagemChat({
      mensagemUsuario: msgCorrecao,
      historicoRecente: historicoCorrecao,
      contato: contatoAdmin,
      documentosDisponiveis: docsAntes,
    });
    console.log(`\nRESPOSTA (Pedido de confirmação):\n${res1.textoResposta}`);
    console.log(`[Correção pendente gerada: ${JSON.stringify(res1.correcaoPendente)}]`);

    // Adicionar ao histórico simulando conversa real
    historicoCorrecao.push({
      id: 'msg-u1',
      remetente: 'cliente',
      nomeRemetente: contatoAdmin.nome,
      horario: '14:00',
      texto: msgCorrecao,
    });
    historicoCorrecao.push({
      id: 'msg-a1',
      remetente: 'assistente',
      nomeRemetente: 'VEGA',
      horario: '14:00',
      texto: res1.textoResposta,
      correcaoPendente: res1.correcaoPendente,
    });

    console.log('\n>>> MENSAGEM: "sim"');
    const docsAntesConfirmacao = await obterTodosDocumentos();
    const res2 = await processarMensagemChat({
      mensagemUsuario: 'sim',
      historicoRecente: historicoCorrecao,
      contato: contatoAdmin,
      documentosDisponiveis: docsAntesConfirmacao,
    });
    console.log(`\nRESPOSTA APÓS CONFIRMAÇÃO:\n${res2.textoResposta}`);

    // Verificar se atualizou em documentos.json
    const docsAposCorrecao = await obterTodosDocumentos();
    const cnhAposCorrecao = docsAposCorrecao.find(d => d.tipo === 'CNH' && d.titular?.includes('Thomaz'));
    console.log(`\n✓ Verificação pós-correção: CNH Thomaz = ${cnhAposCorrecao?.dataValidade}, Origem = ${cnhAposCorrecao?.origemValidade}`);

    // Restaurar validade original da CNH (26/08/2034)
    console.log('Restaurando validade original da CNH para 26/08/2034...');
    if (cnhAposCorrecao) {
      await atualizarValidadeDocumento(cnhAposCorrecao.id, '26/08/2034', 'corrigido pelo chat', 'Restaurado após teste');
    }
  } finally {
    // 6. Limpar documentos de teste temporários e seus alertas
    console.log('\n--- 6. LIMPANDO DOCUMENTOS DE TESTE E SEUS ALERTAS ---');
    const docsLimpados = (await obterTodosDocumentos()).filter(d => !d.id.startsWith('teste-alerta-'));
    fs.writeFileSync(DOCUMENTOS_FILE, JSON.stringify(docsLimpados, null, 2), 'utf-8');

    const alertasLimpados = (await obterTodosAlertas()).filter(a => !a.documentoId.startsWith('teste-alerta-'));
    await salvarAlertas(alertasLimpados);

    console.log('✓ Documentos de teste removidos com sucesso.');
    console.log('✓ Alertas de teste removidos com sucesso.');
  }

  console.log('\n=====================================================');
  console.log('BATERIA DE TESTES CONCLUÍDA COM SUCESSO!');
  console.log('=====================================================');
}

main().catch(err => {
  console.error('Erro no script de teste:', err);
  process.exit(1);
});
