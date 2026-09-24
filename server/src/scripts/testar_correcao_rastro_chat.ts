import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterDocumentosPorNivelAcesso, obterTodosTitulares } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { Contato } from '../types.js';

async function main() {
  console.log('====================================================================================');
  console.log('🧪 TESTE COMPARATIVO: TEXTO DO CHAT VS RESPOSTA FINAL DO RASTRO');
  console.log('====================================================================================\n');

  const todosTitulares = await obterTodosTitulares();
  const titularAlvo = todosTitulares.find(t => t.tipo !== 'PJ') || todosTitulares[0] || { id: 'tit_teste', nome: 'Titular Teste' };
  const primeiroNome = extrairPrimeiroNome(titularAlvo.nome) || titularAlvo.nome;

  const contatoTeste: Contato = {
    id: 'user-teste-rastro-chat',
    nome: 'Titular Teste',
    telefone: '5500000000003',
    avatarCor: '#06b6d4',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: 'Teste de sincronia rastro e chat',
    },
  };

  const docsDisponiveis = await obterDocumentosPorNivelAcesso('diretoria');

  const casosTeste = [
    `QUAL A CNH DE ${primeiroNome.toUpperCase()}?`,
    `qual a cnh de ${primeiroNome.toLowerCase()}?`,
    'qual a CNH do escritório?',
  ];

  for (let i = 0; i < casosTeste.length; i++) {
    const pergunta = casosTeste[i];
    console.log(`\n====================================================================================`);
    console.log(`[TESTE ${i + 1}/3] Pergunta: "${pergunta}"`);
    console.log(`====================================================================================`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: pergunta,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    const textoChat = resultado.textoResposta;
    const rastro = resultado.rastro;

    if (!rastro) {
      console.error('❌ Rastro não foi gerado!');
      continue;
    }

    const respostaRastro = rastro.respostaFinal;

    console.log('\n📊 COMPARAÇÃO LADO A LADO:');
    console.log(`🔹 Texto exibido no Chat:       "${textoChat}"`);
    console.log(`🔹 Resposta Final no Rastro:   "${respostaRastro}"`);
    console.log(`🔹 Textos são idênticos?       ${textoChat === respostaRastro ? '✅ SIM (100% Sincronizado)' : '❌ NÃO'}`);

    console.log('\n🔍 METADADOS DO RASTRO:');
    console.log(`- Intenção detectada:          ${rastro.intencaoDetectada}`);
    console.log(`- Pergunta reescrita:          "${rastro.perguntaReescrita}"`);
    console.log(`- Tipo de busca:               ${rastro.tipoBusca}`);
    console.log(`- Documento usado:             ${rastro.documentoUsado || 'Nenhum'}`);
    console.log(`- Enviou anexo:                ${rastro.enviouAnexo ? 'SIM (' + rastro.anexosDetalhes?.map((a) => a.nome).join(', ') + ')' : 'NÃO'}`);
    console.log(`- Modelo exibido no rastro:    ${rastro.modeloUsado} ${rastro.modeloUsado === 'gpt-5.4-mini' ? '✅' : '⚠️'}`);
    console.log(`- Tokens totais consumidos:    ${rastro.tokensTotal}`);
    console.log(`- Custo estimado:              US$ ${rastro.custoEstimadoUsd.toFixed(6)}`);
    console.log(`- Tempo total:                 ${rastro.tempoTotalMs} ms`);

    const etapaClassificacao = rastro.etapas.find((e) => e.ordem === 1);
    if (etapaClassificacao?.detalhes?.tokensPrompt !== undefined) {
      const tokensClassif = (etapaClassificacao.detalhes.tokensPrompt as number) + ((etapaClassificacao.detalhes.tokensCompletion as number) || 0);
      console.log(`- Tokens na classificação:     ${tokensClassif} (Meta < 1.500: ${tokensClassif < 1500 ? '✅ APROVADO' : '❌ EXCEDEU'})`);
    }
  }

  console.log('\n====================================================================================');
  console.log('🎉 TESTES CONCLUÍDOS COM SUCESSO!');
  console.log('====================================================================================\n');
}

main().catch((err) => {
  console.error('Erro no script de teste:', err);
  process.exit(1);
});
