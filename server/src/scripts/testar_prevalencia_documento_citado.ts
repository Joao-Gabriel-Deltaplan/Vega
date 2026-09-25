import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSupabaseClient } from '../db/supabaseClient.js';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, DocumentoRegistro, Mensagem } from '../types.js';

async function rodarTestesPrevalencia() {
  console.log('================================================================');
  console.log('🧪 BATERIA DE TESTES: REGRA 20 - PREVALÊNCIA DE DOCUMENTO CITADO');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  const timestamp = Date.now();

  const contatoTeste: Contato = {
    id: 'ct-teste-regra20',
    nome: 'Operador Teste',
    telefone: '5514999999999',
    avatarCor: '#25D366',
    cargo: 'Diretor',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
  };

  // IDs e dados dos documentos de teste (UUID válido exigido pelo Supabase)
  const idDocVacina = crypto.randomUUID();
  const idDocArt = crypto.randomUUID();

  const docVacina: DocumentoRegistro = {
    id: idDocVacina,
    titulo: 'Cartão de Vacinas',
    arquivo: 'cartao_vacinas_teste.pdf',
    tipo: 'Cartão de Vacinas',
    titular: 'Thomaz',
    visibilidade: 'publico',
    statusIndexacao: 'indexado',
    dataCadastro: new Date().toISOString(),
  };

  const docArt: DocumentoRegistro = {
    id: idDocArt,
    titulo: 'ART de Serviços Menegazzo',
    arquivo: 'art_servicos_menegazzo_teste.pdf',
    tipo: 'ART',
    titular: 'Thomaz',
    visibilidade: 'publico',
    statusIndexacao: 'indexado',
    dataCadastro: new Date().toISOString(),
  };

  let totalTestes = 0;
  let sucessos = 0;

  try {
    // 1. Criar documentos e trechos de teste no Supabase
    console.log('Preparando documentos e trechos de teste no Supabase...');

    const { error: errDocs } = await supabase.from('documentos').insert([
      {
        id: docVacina.id,
        titulo: docVacina.titulo,
        arquivo: docVacina.arquivo,
        tipo: docVacina.tipo,
        titular: docVacina.titular,
        visibilidade: docVacina.visibilidade,
        status_indexacao: 'indexado',
      },
      {
        id: docArt.id,
        titulo: docArt.titulo,
        arquivo: docArt.arquivo,
        tipo: docArt.tipo,
        titular: docArt.titular,
        visibilidade: docArt.visibilidade,
        status_indexacao: 'indexado',
      },
    ]);
    if (errDocs) console.error('ERRO AO INSERIR DOCS:', errDocs);

    const dummyEmbedding = new Array(1536).fill(0);
    const { error: errTrechos } = await supabase.from('trechos').insert([
      {
        documento_id: docVacina.id,
        pagina: 1,
        conteudo:
          'MINISTÉRIO DA SAÚDE - CARTÃO DE VACINAÇÃO DIGITAL\nTitular: Thomaz Lustri Fabre\nVacina: COVID-19 Comirnaty (Pfizer)\n1ª Dose: 15/07/2021 Lote: FF5112\n2ª Dose: 10/10/2021 Lote: FF8890\n3ª Dose (Reforço): 15/03/2022 Lote: FL1002\nFebre Amarela: Válida para a vida toda aplicada em 2018.',
        embedding: dummyEmbedding,
      },
      {
        documento_id: docArt.id,
        pagina: 1,
        conteudo:
          'CREA-SP - ANOTAÇÃO DE RESPONSABILIDADE TÉCNICA (ART)\nNúmero da ART: 2802723019823\nContratante: Construtora Menegazzo Ltda\nObjeto do Contrato: Prestação de serviços de engenharia civil, supervisão técnica e gerenciamento de obras residenciais de alto padrão em Bauru/SP.\nResponsável Técnico: Thomaz Lustri Fabre - Engenheiro Civil\nValor do Contrato: R$ 120.000,00\nPrazo de Execução: 12 meses a contar da emissão.',
        embedding: dummyEmbedding,
      },
    ]);
    if (errTrechos) console.error('ERRO AO INSERIR TRECHOS:', errTrechos);

    console.log('Documentos e trechos prontos.\n');

    // Histórico de conversa prévio: a VEGA acabou de entregar o Cartão de Vacinas
    const historicoComVacinaEntregue: Mensagem[] = [
      {
        id: `msg-hist-1-${timestamp}`,
        remetente: 'cliente',
        nomeRemetente: 'Operador Teste',
        horario: '10:00',
        texto: 'Me envia o cartão de vacinas por favor',
      },
      {
        id: `msg-hist-2-${timestamp}`,
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: 'Aqui está o documento solicitado: Cartão de Vacinas.',
        anexos: [
          {
            tipo: 'pdf',
            nome: docVacina.arquivo,
            titulo: docVacina.titulo,
            url: 'https://storage.supabase.com/arquivos/cartao_vacinas_teste.pdf',
          },
        ],
        rastro: {
          documentoUsado: docVacina.titulo,
          enviouAnexo: true,
          docsEncontrados: [{ id: docVacina.id, titulo: docVacina.titulo, similaridade: 100 }],
        } as any,
      },
    ];

    // -------------------------------------------------------------------------
    // TESTE 1: Falar de um documento e depois pedir resumo de outro pelo nome
    // Deve resumir o documento citado (ART), NUNCA o do contexto (Cartão de Vacinas).
    // -------------------------------------------------------------------------
    totalTestes++;
    console.log('--- TESTE 1: PREVALÊNCIA DE DOCUMENTO CITADO (ART) APÓS CONVERSA SOBRE VACINAS ---');
    console.log('Mensagem: "Resuma a art de serviços menegazzo" (Contexto recente possui Cartão de Vacinas)');

    const res1 = await processarMensagemChat({
      mensagemUsuario: 'Resuma a art de serviços menegazzo',
      historicoRecente: historicoComVacinaEntregue,
      contato: contatoTeste,
      documentosDisponiveis: [docVacina, docArt],
    });

    console.log(`Doc usado no rastro: "${res1.rastro?.documentoUsado}"`);
    console.log(`Resposta da VEGA:\n"${res1.textoResposta}"\n`);

    const t1UsouDocCorreto = res1.rastro?.documentoUsado?.toLowerCase().includes('art') ||
                             res1.rastro?.documentoUsado?.toLowerCase().includes('menegazzo');
    const t1ConteudoArt = res1.textoResposta.toLowerCase().includes('menegazzo') ||
                          res1.textoResposta.toLowerCase().includes('engenharia') ||
                          res1.textoResposta.toLowerCase().includes('responsabilidade técnica') ||
                          res1.textoResposta.toLowerCase().includes('art');
    const t1NaoResumiuVacina = !res1.textoResposta.toLowerCase().includes('comirnaty') &&
                               !res1.textoResposta.toLowerCase().includes('pfizer') &&
                               !res1.textoResposta.toLowerCase().includes('febre amarela');

    if (t1UsouDocCorreto && t1ConteudoArt && t1NaoResumiuVacina) {
      console.log('✅ TESTE 1 PASSOU: A VEGA resumiu a ART de Serviços Menegazzo, ignorando o Cartão de Vacinas do contexto!\n');
      sucessos++;
    } else {
      console.error('❌ TESTE 1 FALHOU:', { t1UsouDocCorreto, t1ConteudoArt, t1NaoResumiuVacina });
    }

    // -------------------------------------------------------------------------
    // TESTE 2: Pedir "resuma esse documento" sem citar nome (deve usar o contexto)
    // Deve resumir o documento do contexto (Cartão de Vacinas).
    // -------------------------------------------------------------------------
    totalTestes++;
    console.log('--- TESTE 2: PEDIDO ANAFÓRICO ("resuma esse documento em 5 linhas") ---');
    console.log('Mensagem: "resuma esse documento em 5 linhas" (Sem nome de documento -> deve usar o contexto)');

    const res2 = await processarMensagemChat({
      mensagemUsuario: 'resuma esse documento em 5 linhas',
      historicoRecente: historicoComVacinaEntregue,
      contato: contatoTeste,
      documentosDisponiveis: [docVacina, docArt],
    });

    console.log(`Doc usado no rastro: "${res2.rastro?.documentoUsado}"`);
    console.log(`Resposta da VEGA:\n"${res2.textoResposta}"\n`);

    const t2UsouContexto = res2.rastro?.documentoUsado?.toLowerCase().includes('vacina');
    const t2ConteudoVacina = res2.textoResposta.toLowerCase().includes('vacina') ||
                             res2.textoResposta.toLowerCase().includes('covid') ||
                             res2.textoResposta.toLowerCase().includes('dose');

    if (t2UsouContexto && t2ConteudoVacina) {
      console.log('✅ TESTE 2 PASSOU: A VEGA usou com sucesso o Cartão de Vacinas do contexto para pedido anafórico!\n');
      sucessos++;
    } else {
      console.error('❌ TESTE 2 FALHOU:', { t2UsouContexto, t2ConteudoVacina });
    }

    // -------------------------------------------------------------------------
    // TESTE 3: Pedir resumo de documento inexistente
    // Deve responder que não encontrou no Cofre e NUNCA resumir o documento do contexto.
    // -------------------------------------------------------------------------
    totalTestes++;
    console.log('--- TESTE 3: PEDIDO DE RESUMO DE DOCUMENTO INEXISTENTE NO COFRE ---');
    console.log('Mensagem: "Resuma o contrato de confidencialidade xyz" (Não existe no Cofre, contexto tem Cartão de Vacinas)');

    const res3 = await processarMensagemChat({
      mensagemUsuario: 'Resuma o contrato de confidencialidade xyz',
      historicoRecente: historicoComVacinaEntregue,
      contato: contatoTeste,
      documentosDisponiveis: [docVacina, docArt],
    });

    console.log(`Doc usado no rastro: "${res3.rastro?.documentoUsado}"`);
    console.log(`Resposta da VEGA:\n"${res3.textoResposta}"\n`);

    const t3NaoEncontrou = res3.textoResposta.toLowerCase().includes('não encontrei') ||
                           res3.textoResposta.toLowerCase().includes('nao encontrei');
    const t3NaoUsouVacina = res3.rastro?.documentoUsado !== docVacina.titulo &&
                            !res3.textoResposta.toLowerCase().includes('vacina') &&
                            !res3.textoResposta.toLowerCase().includes('covid');

    if (t3NaoEncontrou && t3NaoUsouVacina) {
      console.log('✅ TESTE 3 PASSOU: A VEGA respondeu que não encontrou o documento inexistente e NÃO resumiu o Cartão de Vacinas do contexto!\n');
      sucessos++;
    } else {
      console.error('❌ TESTE 3 FALHOU:', { t3NaoEncontrou, t3NaoUsouVacina });
    }

  } finally {
    // Limpeza dos dados de teste no Supabase
    console.log('Limpando documentos e trechos de teste no Supabase...');
    try {
      await supabase.from('trechos').delete().in('documento_id', [idDocVacina, idDocArt]);
      await supabase.from('documentos').delete().in('id', [idDocVacina, idDocArt]);
      await supabase.from('documentos_faltantes').delete().ilike('tipo_documento', '%confidencialidade%');
      console.log('Limpeza concluída com sucesso.\n');
    } catch (e) {
      console.warn('Aviso ao limpar dados de teste:', e);
    }
  }

  console.log('================================================================');
  console.log(`🏁 RESULTADO FINAL: ${sucessos}/${totalTestes} TESTES APROVADOS (${Math.round((sucessos / totalTestes) * 100)}%)`);
  console.log('================================================================');

  if (sucessos === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

rodarTestesPrevalencia().catch((e) => {
  console.error('Erro fatal nos testes:', e);
  process.exit(1);
});
