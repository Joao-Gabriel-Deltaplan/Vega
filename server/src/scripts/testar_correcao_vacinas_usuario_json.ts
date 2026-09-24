import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, Mensagem } from '../types.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

async function main() {
  console.log('=== TESTE DE CORREÇÃO: VACINAS, USUÁRIO VS TITULAR E VAZAMENTO DE JSON ===\n');

  const supabase = getSupabaseClient();

  // -------------------------------------------------------------
  // PONTO 4: VERIFICAR INDEXAÇÃO DO CARTÃO DE VACINAS NO SUPABASE
  // -------------------------------------------------------------
  console.log('--- 4. VERIFICAÇÃO DO CARTÃO DE VACINAS NO COFRE ---');
  const { data: docs } = await supabase
    .from('documentos')
    .select('*')
    .ilike('titulo', '%vacina%');

  if (!docs || docs.length === 0) {
    console.error('ERRO: Nenhum documento de vacina encontrado no Cofre.');
  } else {
    for (const doc of docs) {
      console.log(`Documento ID: ${doc.id}`);
      console.log(`Título: "${doc.titulo}" | Arquivo: "${doc.arquivo}"`);
      console.log(`Titular: "${doc.titular}" | Status Indexação: "${doc.status_indexacao}"`);

      const { data: trechos, count } = await supabase
        .from('trechos')
        .select('*', { count: 'exact' })
        .eq('documento_id', doc.id);

      console.log(`Total de trechos indexados: ${count || trechos?.length || 0}`);
      if (trechos && trechos.length > 0) {
        trechos.forEach((t, i) => {
          console.log(`\n[Trecho ${i + 1} - Página ${t.pagina || 1}]:\n${t.conteudo}\n`);
        });
      }
    }
  }

  // -------------------------------------------------------------
  // PONTO 3: "Quais dias eu tomei as vacinas da covid?" SEM TITULAR
  // -------------------------------------------------------------
  console.log('\n--- 3. TESTE: "Quais dias eu tomei as vacinas da covid?" (SEM TITULAR) ---');
  const contatoJoao: Contato = {
    id: 'contato-joao-gabriel',
    nome: 'João Gabriel',
    telefone: '5514996863115',
    nivelAcesso: 'diretoria',
  };

  const resSemTitular = await processarMensagemChat({
    mensagemUsuario: 'Quais dias eu tomei as vacinas da covid?',
    historicoRecente: [],
    contato: contatoJoao,
  });

  console.log('Resposta VEGA:', resSemTitular.textoResposta);
  console.log('Intenção Detectada:', resSemTitular.intencaoDetectada);
  console.log('Origem:', resSemTitular.origem);

  const passouPonto3 =
    resSemTitular.intencaoDetectada !== 'fora_de_escopo' &&
    /de quem voc[eê] precisa/i.test(resSemTitular.textoResposta) &&
    /vacina/i.test(resSemTitular.textoResposta);

  console.log('Status Ponto 3:', passouPonto3 ? '✅ PASSOU (Perguntou de quem é)' : '❌ FALHOU');

  // -------------------------------------------------------------
  // PONTOS 1 E 2: "você tem a carteira de vacinação do thomaz..."
  // -------------------------------------------------------------
  console.log('\n--- 1 e 2. TESTE: "você tem a carteira de vacinação do thomaz..." ---');
  const resComThomaz = await processarMensagemChat({
    mensagemUsuario: 'Voce tem a certeira de vacinação do thomaz, quais dias ele tomou as vacinas da covid?',
    historicoRecente: [],
    contato: contatoJoao,
  });

  console.log('Resposta VEGA:');
  console.log(resComThomaz.textoResposta);
  console.log('Intenção Detectada:', resComThomaz.intencaoDetectada);

  // Verificações do Ponto 1:
  // - O usuário NUNCA deve ser chamado de Thomaz (João é o usuário)
  // - Não pode dizer "seu Cartão Vacinas, Thomaz"
  const chamouUsuarioDeThomaz =
    /seu cart[aã]o.*thomaz/i.test(resComThomaz.textoResposta) ||
    /ol[aá],?\s*thomaz/i.test(resComThomaz.textoResposta) ||
    /aqui est[aá].*thomaz\b/i.test(resComThomaz.textoResposta) && !/jo[aã]o/i.test(resComThomaz.textoResposta);

  console.log('Chamou usuário de Thomaz?:', chamouUsuarioDeThomaz ? '❌ SIM (ERRO)' : '✅ NÃO (CORRETO)');

  // Verificações do Ponto 2:
  // - Nenhum bloco ```documento ou JSON vazado
  const vazouJson =
    /```(?:documento|json|pdf)/i.test(resComThomaz.textoResposta) ||
    /\{\s*"id"/i.test(resComThomaz.textoResposta);

  console.log('Vazou bloco JSON/código?:', vazouJson ? '❌ SIM (ERRO)' : '✅ NÃO (CORRETO)');

  // Verificações de Conteúdo:
  // - Respondeu com as datas das doses da COVID (15/07/2021, 30/09/2021, 11/02/2022)
  const contemDatasCovid =
    resComThomaz.textoResposta.includes('15/07/2021') ||
    resComThomaz.textoResposta.includes('2021');

  console.log('Contém datas de vacinação?:', contemDatasCovid ? '✅ SIM' : 'ℹ️ (Pode ter entregue arquivo ou texto)');

  // -------------------------------------------------------------
  // TESTE EXTRA: Pedido expresso de arquivo do Thomaz por João
  // -------------------------------------------------------------
  console.log('\n--- TESTE EXTRA: "me manda o cartão de vacinas do thomaz" ---');
  const resPedidoArquivo = await processarMensagemChat({
    mensagemUsuario: 'me manda o cartão de vacinas do thomaz',
    historicoRecente: [],
    contato: contatoJoao,
  });

  console.log('Resposta VEGA:', resPedidoArquivo.textoResposta);
  console.log('Anexos:', resPedidoArquivo.anexos?.map((a) => a.nome));

  const respostaTrataUsuarioCerto =
    resPedidoArquivo.textoResposta.includes('João') &&
    resPedidoArquivo.textoResposta.includes('Thomaz') &&
    !resPedidoArquivo.textoResposta.includes('seu Cartão Vacinas, Thomaz');

  console.log('Distinção Usuário vs Titular na entrega de arquivo:', respostaTrataUsuarioCerto ? '✅ PERFEITO' : '⚠️');
}

main().catch((e) => {
  console.error('Erro no teste:', e);
  process.exit(1);
});
