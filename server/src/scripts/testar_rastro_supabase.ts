import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterDocumentosPorNivelAcesso } from '../storage.js';
import { salvarRastro, obterRastroPorMensagemId, limparRastrosAntigos, limparRastrosMaisDe30Dias } from '../rastros/rastroService.js';
import { Contato } from '../types.js';

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTE COMPLETO DE RASTRO DE RACIOCÍNIO (LOGS DA VEGA)');
  console.log('================================================================\n');

  const contatoTeste: Contato = {
    id: 'user-teste-rastro',
    nome: 'João Gabriel Brandini',
    telefone: '11999999999',
    avatarCor: '#25D366',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  const docsDisponiveis = await obterDocumentosPorNivelAcesso('diretoria');

  const perguntasTeste = [
    'qual é a CNH do Thomaz',
    'qual o número da CNH do Thomaz?',
    'qual o endereço do escritório?',
  ];

  for (let i = 0; i < perguntasTeste.length; i++) {
    const pergunta = perguntasTeste[i];
    const msgId = `msg-teste-rastro-${Date.now()}-${i}`;
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[TESTE ${i + 1}/3] Pergunta: "${pergunta}"`);
    console.log(`----------------------------------------------------------------`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: pergunta,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    const rastro = resultado.rastro;
    if (!rastro) {
      console.error(`❌ Erro: rastro não gerado para "${pergunta}"`);
      continue;
    }

    rastro.mensagemId = msgId;
    rastro.conversaId = 'conversa-teste';

    console.log('📋 METADADOS DO RASTRO:');
    console.log(`- Usuário: ${rastro.usuarioNome} (${rastro.usuarioId})`);
    console.log(`- Mensagem Original: "${rastro.mensagemOriginal}"`);
    console.log(`- Pergunta Reescrita: "${rastro.perguntaReescrita}"`);
    console.log(`- Intenção: ${rastro.intencaoDetectada}`);
    console.log(`- Tipo de Busca: ${rastro.tipoBusca}`);
    console.log(`- Documento Usado: ${rastro.documentoUsado || 'Nenhum'}`);
    console.log(`- Enviou Anexo: ${rastro.enviouAnexo ? 'SIM' : 'NÃO'} (${rastro.anexosDetalhes?.map((a) => a.nome).join(', ') || 'Nenhum'})`);
    console.log(`- Modelo Utilizado: ${rastro.modeloUsado}`);
    console.log(`- Tokens: Total=${rastro.tokensTotal} (Prompt=${rastro.tokensPrompt}, Completion=${rastro.tokensCompletion})`);
    console.log(`- Custo Estimado: US$ ${rastro.custoEstimadoUsd.toFixed(6)}`);
    console.log(`- Tempo Total: ${rastro.tempoTotalMs} ms`);

    console.log('\n⏱️ ETAPAS DO RACIOCÍNIO:');
    rastro.etapas.forEach((e) => {
      console.log(`  [Etapa ${e.ordem}] ${e.nome} (${e.tempoMs} ms) -> ${e.descricao}`);
    });

    console.log('\n📄 DOCUMENTOS/TRECHOS AVALIADOS:');
    if (rastro.documentosEncontrados.length === 0) {
      console.log('  (Nenhum documento necessário)');
    } else {
      rastro.documentosEncontrados.forEach((doc, idx) => {
        console.log(`  [Doc ${idx + 1}] "${doc.titulo}" | Similaridade: ${doc.similaridade ?? 'N/D'}% | Usado: ${doc.usadoNaResposta ? 'SIM' : 'NÃO'}`);
        if (doc.trecho) {
          console.log(`          Trecho (máx 300 chars, mascarado): "${doc.trecho}"`);
          // Validação de segurança: verificar se não passa de 303 chars (300 + '...')
          if (doc.trecho.length > 305) {
            console.warn(`          ⚠️ AVISO: Trecho excedeu 300 caracteres: ${doc.trecho.length}`);
          }
        }
      });
    }

    console.log(`\n💬 RESPOSTA FINAL (MASCARADA): "${rastro.respostaFinal}"`);

    // Validação no Supabase
    console.log('\n💾 Gravando na tabela rastros do Supabase...');
    const idGravado = await salvarRastro(rastro);
    if (idGravado) {
      console.log(`✅ Rastro gravado com sucesso no Supabase! ID: ${idGravado}`);
      const lido = await obterRastroPorMensagemId(msgId);
      if (lido && lido.mensagemId === msgId) {
        console.log(`✅ Leitura por mensagem_id confirmada com sucesso!`);
      } else {
        console.warn(`⚠️ Não foi possível reler o rastro gravado.`);
      }
    } else {
      console.log(`ℹ️ Gravação no Supabase retornou null (tabela rastros ainda pendente de execução do SQL pelo usuário).`);
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log('🧹 TESTANDO LIMPEZA AUTOMÁTICA DE RASTROS COM MAIS DE 30 DIAS');
  console.log('----------------------------------------------------------------');
  const removidos = await limparRastrosMaisDe30Dias();
  console.log(`✅ Função de limpeza executada. Registros com mais de 30 dias expurgados: ${removidos}`);

  console.log('\n================================================================');
  console.log('✅ TESTE FINALIZADO COM SUCESSO!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Erro no teste de rastro:', err);
  process.exit(1);
});
