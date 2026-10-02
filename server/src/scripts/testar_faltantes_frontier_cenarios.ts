import dotenv from 'dotenv';
dotenv.config();

import {
  toolBuscarDocumentos,
  toolRegistrarDocumentoFaltante,
  toolListarDocumentosFaltantes,
  identificarAtributoDocumentoFaltante,
} from '../chat/chatOrquestrador.js';
import { obterDocumentosFaltantes, registrarOuIncrementarDocumentoFaltante } from '../documentosFaltantesService.js';
import { getSupabaseClient } from '../db/supabaseClient.js';
import { Contato, DocumentoRegistro } from '../types.js';

async function main() {
  console.log('=== INICIANDO TESTES DE DOCUMENTOS FALTANTES (CENÁRIOS REAIS) ===\n');

  const supabase = getSupabaseClient();
  const idCriadosParaLimpar: string[] = [];

  const contatoTeste: Contato = {
    id: 'ct-teste-faltante',
    nome: 'Operador Teste',
    telefone: '5511999990000',
    perfil: 'admin',
    nivelAcesso: 'admin',
  };

  // Acervo simulado (possui apenas Amarok, não possui Frontier)
  const acervoSimulado: DocumentoRegistro[] = [
    {
      id: 'doc-amarok-teste',
      titulo: 'Documento da Caminhonete Amarok V6',
      tipo: 'Documento de Veículo',
      titular: 'Delta Plan',
      arquivo: 'crlv_amarok.pdf',
      dataCadastro: new Date().toISOString(),
      statusIndexacao: 'concluido',
    },
  ];

  try {
    // -------------------------------------------------------------
    // TESTE 1: Extração de Atributo Identificador
    // -------------------------------------------------------------
    console.log('--- TESTE 1: Extração de Atributos Identificadores ---');
    const infoFrontier = identificarAtributoDocumentoFaltante('Me envie o documento da Frontier');
    console.log('Frontier identificada:', infoFrontier);
    if (infoFrontier.tipoAtributo !== 'veiculo' || !infoFrontier.descricaoItem.includes('Nissan Frontier')) {
      throw new Error(`Falha no reconhecimento da Frontier: ${JSON.stringify(infoFrontier)}`);
    }
    console.log('✅ Reconhecimento de veículo Frontier OK!\n');

    const infoRua = identificarAtributoDocumentoFaltante('Comprovante de residência da Rua das Acácias');
    console.log('Rua identificada:', infoRua);
    if (infoRua.tipoAtributo !== 'imovel' || !infoRua.descricaoItem.includes('Rua das Acácias')) {
      throw new Error(`Falha no reconhecimento de imóvel: ${JSON.stringify(infoRua)}`);
    }
    console.log('✅ Reconhecimento de imóvel Rua OK!\n');

    const infoAmbiguo = identificarAtributoDocumentoFaltante('Me envie o documento');
    console.log('Pedido ambíguo:', infoAmbiguo);
    if (!infoAmbiguo.ehAmbiguo) {
      throw new Error(`Pedido genérico não foi marcado como ambíguo: ${JSON.stringify(infoAmbiguo)}`);
    }
    console.log('✅ Detecção de ambiguidade OK!\n');

    // -------------------------------------------------------------
    // TESTE 2: "Me envie o documento da Frontier" -> Registro automático
    // -------------------------------------------------------------
    console.log('--- TESTE 2: Registro Automático ("Me envie o documento da Frontier") ---');
    const resBusca = await toolBuscarDocumentos(
      'documento da Frontier',
      undefined,
      acervoSimulado,
      'texto',
      contatoTeste
    );
    console.log('Resultado da busca:', resBusca.mensagem);

    if (!resBusca.mensagem?.includes('Registrei como documento faltante')) {
      throw new Error(`Busca não registrou como faltante: ${resBusca.mensagem}`);
    }
    if (!resBusca.mensagem?.includes('Amarok')) {
      throw new Error(`Busca não ofereceu a Amarok como alternativa: ${resBusca.mensagem}`);
    }
    console.log('✅ Registro automático e oferta de alternativa da Frontier OK!\n');

    // Verifica no banco se foi registrado
    const faltantesAposBusca = await obterDocumentosFaltantes();
    const itemFrontier = faltantesAposBusca.find((f) => f.tipoDocumento.includes('Nissan Frontier'));
    if (!itemFrontier) {
      throw new Error('Item da Frontier não foi localizado na tabela documentos_faltantes do Supabase!');
    }
    idCriadosParaLimpar.push(itemFrontier.id);
    console.log(`✅ Item persistido no Supabase com id: ${itemFrontier.id} (tipo: ${itemFrontier.tipoDocumento})`);

    // -------------------------------------------------------------
    // TESTE 3: "Coloque ele em documentos faltantes" via toolRegistrarDocumentoFaltante
    // -------------------------------------------------------------
    console.log('\n--- TESTE 3: Tool registrar_documento_faltante ("Coloque ele em documentos faltantes") ---');
    const historicoSimulado: any[] = [
      { remetente: 'cliente', texto: 'Me envie o documento da Frontier' },
      { remetente: 'assistente', texto: 'Não encontrei documento do veículo Nissan Frontier no Cofre. Registrei como documento faltante. Tenho o da caminhonete Amarok, quer esse?' },
    ];

    const resManual = await toolRegistrarDocumentoFaltante(
      'ele',
      undefined,
      undefined,
      contatoTeste,
      'Coloque ele em documentos faltantes',
      historicoSimulado
    );
    console.log('Resultado do registro manual:', resManual);
    if (!resManual.sucesso || !resManual.mensagem.includes('Registrei como faltante: documento da Nissan Frontier')) {
      throw new Error(`Falha no registro manual com 'ele': ${JSON.stringify(resManual)}`);
    }
    if (resManual.item_registrado) {
      idCriadosParaLimpar.push(resManual.item_registrado.id);
      console.log(`✅ Quantidade de pedidos incrementada: ${resManual.item_registrado.quantidade_pedidos}`);
    }
    console.log('✅ Tool registrar_documento_faltante resolveu "ele" pelo histórico com sucesso!\n');

    // -------------------------------------------------------------
    // TESTE 4: "me manda a lista de documentos faltantes" -> "de todos"
    // -------------------------------------------------------------
    console.log('--- TESTE 4: Listar Documentos Faltantes ---');
    // Pedido genérico sem escopo definido -> pergunta de esclarecimento
    const resListarSemEscopo = await toolListarDocumentosFaltantes(undefined, undefined, contatoTeste, 'me manda a lista de documentos faltantes');
    console.log('Resposta sem escopo:', resListarSemEscopo.pergunta_esclarecimento);
    if (!resListarSemEscopo.precisa_esclarecer || resListarSemEscopo.pergunta_esclarecimento !== 'Quer só os seus ou de todos os titulares?') {
      throw new Error(`Falha na pergunta de esclarecimento: ${JSON.stringify(resListarSemEscopo)}`);
    }
    console.log('✅ Pergunta de esclarecimento sobre escopo OK!\n');

    // Usuário respondeu "de todos"
    const resListarTodos = await toolListarDocumentosFaltantes(undefined, 'todos', contatoTeste, 'de todos');
    console.log('Resposta de todos:\n' + resListarTodos.mensagem);
    if (!resListarTodos.documentos?.some((d) => d.tipo.includes('Nissan Frontier'))) {
      throw new Error('Item da Frontier não apareceu na listagem de todos os faltantes!');
    }
    console.log('✅ Item da Frontier listado com sucesso em "de todos"!\n');

    console.log('🎉 TODOS OS CENÁRIOS PASSARAM COM SUCESSO!');
  } finally {
    // LIMPEZA OBRIGATÓRIA DE REGISTROS DE TESTE (REGRA 24)
    if (idCriadosParaLimpar.length > 0) {
      console.log('\n[Limpeza Regra 24] Removendo registros criados pelo teste automatizado...');
      for (const id of idCriadosParaLimpar) {
        await supabase.from('documentos_faltantes').delete().eq('id', id);
        console.log(`Item de teste ${id} removido do Supabase.`);
      }
    }
  }
}

main().catch((err) => {
  console.error('ERRO FATAL NO TESTE:', err);
  process.exit(1);
});
