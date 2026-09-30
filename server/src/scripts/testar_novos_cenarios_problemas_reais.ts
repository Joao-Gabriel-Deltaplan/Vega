import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { DocumentoRegistro, Contato } from '../types.js';

async function testarCenariosReais() {
  console.log('\n================================================================');
  console.log('🧪 INICIANDO TESTE DOS DOIS NOVOS CENÁRIOS BASEADOS EM TESTES REAIS');
  console.log('1. Listas Incompletas (IR com 8 contas bancárias via ler_documento_completo)');
  console.log('2. Pessoa sem Titular no Cadastro (CNH sob Delta Plan com erro de áudio Danil Ceia)');
  console.log('================================================================\n');

  const supabase = getSupabaseClient();
  const timestamp = Date.now();

  const contato: Contato = {
    id: `contato-teste-${timestamp}`,
    nome: 'João Gabriel Brandini',
    perfil: 'admin',
    telefone: '5511999990001',
    ativo: true,
  };

  const docsParaLimpar: string[] = [];
  const trechosParaLimpar: string[] = [];

  try {
    // =========================================================================
    // CENÁRIO 1: LISTAS INCOMPLETAS (IR com 8 contas espalhadas em 4 trechos)
    // =========================================================================
    console.log('------------------------------------------------------------');
    console.log('CENÁRIO 1: Testando recuperação completa de itens em IR...');
    console.log('------------------------------------------------------------');

    const titularThomaz = `Thomaz Teste ${timestamp}`;
    const docIrId = crypto.randomUUID();
    docsParaLimpar.push(docIrId);

    const docIr: DocumentoRegistro = {
      id: docIrId,
      titulo: `Declaração de IR 2024 ${titularThomaz}`,
      arquivo: `declaracao_ir_${timestamp}.pdf`,
      tipo: 'Declaração de IR',
      titular: titularThomaz,
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `Declaração de IR 2024 de ${titularThomaz} com lista completa de contas bancárias e aplicações.`,
      dataCadastro: '30/04/2024',
      dataEmissao: '30/04/2024',
    };

    // Insere documento no Supabase com UUID válido
    await supabase.from('documentos').insert({
      id: docIr.id,
      titulo: docIr.titulo,
      arquivo: docIr.arquivo,
      tipo: docIr.tipo,
      titular: docIr.titular,
      descricao: docIr.descricao,
      status_indexacao: 'indexado',
      corporativo: false,
      visibilidade: 'diretoria',
    });

    // 8 contas distribuídas em 4 trechos sequenciais
    const contasEsperadas = [
      'Banco do Brasil',
      'Caixa Econômica',
      'Bradesco',
      'Itaú Unibanco',
      'Santander',
      'Nubank',
      'Banco Inter',
      'BTG Pactual',
    ];

    const chunks = [
      {
        pagina: 1,
        conteudo: `Declaração de Ajuste Anual IRPF 2024 - ${titularThomaz}\nRelação de Bens e Direitos - Contas Bancárias:\n1) Banco do Brasil - Agência 1234, Conta 11111-1, Saldo R$ 5.400,00\n2) Caixa Econômica - Agência 2345, Conta 22222-2, Saldo R$ 12.350,00`,
      },
      {
        pagina: 2,
        conteudo: `Continuação Bens e Direitos - Contas Bancárias:\n3) Bradesco - Agência 3456, Conta 33333-3, Saldo R$ 8.900,00\n4) Itaú Unibanco - Agência 4567, Conta 44444-4, Saldo R$ 45.000,00`,
      },
      {
        pagina: 3,
        conteudo: `Continuação Bens e Direitos - Contas Bancárias:\n5) Santander - Agência 5678, Conta 55555-5, Saldo R$ 3.100,00\n6) Nubank - Agência 0001, Conta 66666-6, Saldo R$ 18.200,00`,
      },
      {
        pagina: 4,
        conteudo: `Continuação Bens e Direitos - Contas Bancárias:\n7) Banco Inter - Agência 0001, Conta 77777-7, Saldo R$ 9.500,00\n8) BTG Pactual - Agência 0001, Conta 88888-8, Saldo R$ 125.000,00`,
      },
    ];

    for (const ch of chunks) {
      const { data: trSalvo, error: errTr } = await supabase
        .from('trechos')
        .insert({
          documento_id: docIrId,
          pagina: ch.pagina,
          conteudo: ch.conteudo,
          corporativo: false,
          embedding: Array(1536).fill(0),
        })
        .select('id')
        .single();
      if (errTr) console.error('Erro ao inserir trecho de teste:', errTr.message);
      if (trSalvo?.id) trechosParaLimpar.push(trSalvo.id);
    }

    const perguntaCenario1 = `quais contas bancárias aparecem no IR do ${titularThomaz}?`;
    console.log(`[Pergunta C1]: "${perguntaCenario1}"`);

    const respCenario1 = await processarMensagemChat({
      mensagemUsuario: perguntaCenario1,
      historicoRecente: [],
      contato,
      documentosDisponiveis: [docIr],
    });

    console.log(`[Resposta C1]:\n${respCenario1.textoResposta}\n`);

    const toolsUsadasC1 = (respCenario1.rastro?.etapas || [])
      .filter((e) => e.nome.startsWith('Tool:'))
      .map((e) => e.nome.replace('Tool: ', ''));

    console.log(`[Tools acionadas C1]: ${toolsUsadasC1.join(', ') || '(nenhuma)'}`);

    const textoResp1 = respCenario1.textoResposta || '';
    const contasEncontradas = contasEsperadas.filter((c) =>
      textoResp1.toLowerCase().includes(c.toLowerCase())
    );

    console.log(`[Contas listadas]: ${contasEncontradas.length}/8 (${contasEncontradas.join(', ')})`);

    const usouLerDocumentoCompleto = toolsUsadasC1.includes('ler_documento_completo');
    const acertouTodasAsContas = contasEncontradas.length === 8;

    if (usouLerDocumentoCompleto && acertouTodasAsContas) {
      console.log('✅ CENÁRIO 1 PASSOU: Acionou ler_documento_completo e listou com exatidão as 8 contas bancárias!');
    } else {
      console.error(
        `❌ CENÁRIO 1 FALHOU: Tool ler_documento_completo: ${usouLerDocumentoCompleto}. Total contas: ${contasEncontradas.length}/8`
      );
    }

    // =========================================================================
    // CENÁRIO 2: PESSOA SEM TITULAR NO CADASTRO + CNH EM EMPRESA + ERRO ÁUDIO
    // =========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('CENÁRIO 2: Testando busca de pessoa sem cadastro (CNH sob Delta Plan)...');
    console.log('------------------------------------------------------------');

    const nomePessoaSemCadastro = 'Nilceia Ramos Teste';
    const cpfPessoa = '987.654.321-00';
    const docCnhId = crypto.randomUUID();
    docsParaLimpar.push(docCnhId);

    const docCnh: DocumentoRegistro = {
      id: docCnhId,
      titulo: 'CNH online',
      arquivo: `CNH ONLINE NIL TESTE_${timestamp}.pdf`,
      tipo: 'Carteira Nacional de Habilitação (CNH)',
      titular: 'Delta Plan', // Vinculado à Delta Plan (sem titular pessoa física!)
      visibilidade: 'diretoria',
      statusIndexacao: 'indexado',
      descricao: `CNH arquivada no Cofre.`,
      metadata: {
        nomeNoDocumento: nomePessoaSemCadastro,
        donoProvavel: nomePessoaSemCadastro,
        alertaTitular: 'titular_a_revisar',
      },
      dataCadastro: '15/05/2024',
      dataEmissao: '15/05/2024',
    };

    await supabase.from('documentos').insert({
      id: docCnh.id,
      titulo: docCnh.titulo,
      arquivo: docCnh.arquivo,
      tipo: docCnh.tipo,
      titular: docCnh.titular,
      descricao: docCnh.descricao,
      metadata: docCnh.metadata,
      status_indexacao: 'indexado',
      corporativo: false,
      visibilidade: 'diretoria',
    });

    const { data: trCnhSalvo, error: errCnhTr } = await supabase
      .from('trechos')
      .insert({
        documento_id: docCnhId,
        pagina: 1,
        conteudo: `REPÚBLICA FEDERATIVA DO BRASIL - CARTEIRA NACIONAL DE HABILITAÇÃO.\nNOME: ${nomePessoaSemCadastro.toUpperCase()}\nCPF: ${cpfPessoa}\nDATA NASCIMENTO: 15/08/1982\nREGISTRO: 12345678900\nCATEGORIA: B\nVALIDADE: 20/10/2030`,
        corporativo: false,
        embedding: Array(1536).fill(0),
      })
      .select('id')
      .single();

    if (errCnhTr) console.error('Erro ao inserir trecho CNH teste:', errCnhTr.message);
    if (trCnhSalvo?.id) trechosParaLimpar.push(trCnhSalvo.id);

    // Pergunta simulando erro clássico de transcrição de áudio: "Danil Ceia"
    const perguntaCenario2 = 'me entrega o CPF da Danil Ceia';
    console.log(`[Pergunta C2]: "${perguntaCenario2}"`);

    const respCenario2 = await processarMensagemChat({
      mensagemUsuario: perguntaCenario2,
      historicoRecente: [],
      contato,
      documentosDisponiveis: [docIr, docCnh],
    });

    console.log(`[Resposta C2]:\n${respCenario2.textoResposta}\n`);

    const toolsUsadasC2 = (respCenario2.rastro?.etapas || [])
      .filter((e) => e.nome.startsWith('Tool:'))
      .map((e) => e.nome.replace('Tool: ', ''));

    console.log(`[Tools acionadas C2]: ${toolsUsadasC2.join(', ') || '(nenhuma)'}`);

    const textoResp2 = respCenario2.textoResposta || '';
    const entregouCpf = textoResp2.includes('987.654.321-00') || textoResp2.includes('329.397.158-07');
    const citouCnhOuDocumento = /cnh|carteira|habilita[cç][aã]o/i.test(textoResp2);
    const citouDeltaOuOndeEsta = /delta|empresa|arquivad[oa]/i.test(textoResp2);
    const sugeriuCadastro = /cadastr/i.test(textoResp2);

    console.log(`- Entregou CPF de documento de Nilceia: ${entregouCpf}`);
    console.log(`- Citou CNH / documento de origem: ${citouCnhOuDocumento}`);
    console.log(`- Citou onde está arquivado (Delta Plan / empresa): ${citouDeltaOuOndeEsta}`);
    console.log(`- Sugeriu cadastrar como titular: ${sugeriuCadastro}`);

    if (entregouCpf && citouCnhOuDocumento) {
      console.log('✅ CENÁRIO 2 PASSOU: Localizou a pessoa sem cadastro, entregou o CPF correto citando a CNH arquivada!');
    } else {
      console.error('❌ CENÁRIO 2 FALHOU: Não entregou o CPF ou não citou a CNH.');
    }

    console.log('\n================================================================');
    console.log('RESUMO FINAL: TESTE DOS DOIS CENÁRIOS CONCLUÍDO');
    console.log('================================================================\n');
  } finally {
    console.log('🧹 Limpando dados temporários de teste no Supabase...');
    if (trechosParaLimpar.length > 0) {
      await supabase.from('trechos').delete().in('id', trechosParaLimpar);
    }
    if (docsParaLimpar.length > 0) {
      await supabase.from('trechos').delete().in('documento_id', docsParaLimpar);
      await supabase.from('documentos').delete().in('id', docsParaLimpar);
    }
    console.log('Limpeza concluída.');
  }
}

testarCenariosReais().catch((err) => {
  console.error('Erro fatal no teste de cenários reais:', err);
  process.exit(1);
});
