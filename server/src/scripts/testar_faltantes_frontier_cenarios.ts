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
    // TESTE 1: Classificação por IA com tipo_referencia livre (Regra 25)
    // -------------------------------------------------------------
    console.log('--- TESTE 1: Classificação por IA com tipo_referencia ---');
    const infoStrada = identificarAtributoDocumentoFaltante('documento da Strada', null, 'veiculo', 'Strada');
    console.log('Strada (veículo fora da lista):', infoStrada);
    if (infoStrada.tipoAtributo !== 'veiculo' || !infoStrada.descricaoItem.includes('Strada')) {
      throw new Error(`Falha no reconhecimento da Strada: ${JSON.stringify(infoStrada)}`);
    }

    const infoVolvo = identificarAtributoDocumentoFaltante('documento do caminhão Volvo FH', null, 'veiculo', 'caminhão Volvo FH');
    console.log('Volvo FH (caminhão fora da lista):', infoVolvo);
    if (infoVolvo.tipoAtributo !== 'veiculo' || !infoVolvo.descricaoItem.includes('Volvo FH')) {
      throw new Error(`Falha no reconhecimento do Volvo FH: ${JSON.stringify(infoVolvo)}`);
    }

    const infoFazenda = identificarAtributoDocumentoFaltante('escritura da Fazenda Santa Rita', null, 'imovel', 'Fazenda Santa Rita');
    console.log('Fazenda Santa Rita (imóvel):', infoFazenda);
    if (infoFazenda.tipoAtributo !== 'imovel' || !infoFazenda.descricaoItem.includes('Fazenda Santa Rita')) {
      throw new Error(`Falha no reconhecimento de imóvel: ${JSON.stringify(infoFazenda)}`);
    }
    console.log('✅ Reconhecimento dinâmico guiado pela IA OK!\n');

    // -------------------------------------------------------------
    // TESTE 2: Checagem de correspondência de nomes de pessoas físicas
    // "CPF do Danilo" por ÁUDIO -> DEVE pedir confirmação do nome Danilo (Regra 23)
    // -------------------------------------------------------------
    console.log('--- TESTE 2: "CPF do Danilo" por ÁUDIO (tipo_referencia: pessoa) ---');
    const resAudioDanilo = await toolBuscarDocumentos(
      'CPF do Danilo',
      'Danilo',
      acervoSimulado,
      'audio',
      contatoTeste,
      'pessoa',
      'Danilo'
    );
    console.log('Resultado Áudio Danilo:', resAudioDanilo.mensagem);
    if (!resAudioDanilo.mensagem?.includes('Pode confirmar o nome?') || !resAudioDanilo.mensagem?.includes('Danilo')) {
      throw new Error(`Áudio de pessoa inexistente não pediu confirmação do nome: ${resAudioDanilo.mensagem}`);
    }
    console.log('✅ Áudio com nome de pessoa não cadastrada pede confirmação conforme Regra 23!\n');

    // -------------------------------------------------------------
    // TESTE 3: "Me envie o documento da Frontier" -> Registro automático
    // -------------------------------------------------------------
    console.log('--- TESTE 3: Registro Automático ("Me envie o documento da Frontier") ---');
    const resBusca = await toolBuscarDocumentos(
      'documento da Frontier',
      undefined,
      acervoSimulado,
      'texto',
      contatoTeste,
      'veiculo',
      'Nissan Frontier'
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
    const itemFrontier = faltantesAposBusca.find((f) => f.tipoDocumento.includes('Nissan Frontier') || (f as any).descricaoItem?.includes('Nissan Frontier') || f.tipoDocumento.includes('Veículo'));
    if (!itemFrontier) {
      throw new Error('Item da Frontier não foi localizado na tabela documentos_faltantes do Supabase!');
    }
    idCriadosParaLimpar.push(itemFrontier.id);
    console.log(`✅ Item persistido no Supabase com id: ${itemFrontier.id} (solicitante: ${itemFrontier.solicitanteNome})`);

    // -------------------------------------------------------------
    // TESTE 4: Tool registrar_documento_faltante ("Coloque ele em documentos faltantes")
    // A IA formula a descrição completa "documento da Nissan Frontier"
    // -------------------------------------------------------------
    console.log('\n--- TESTE 4: Tool registrar_documento_faltante com descrição formulada pela IA ---');
    const resManual = await toolRegistrarDocumentoFaltante(
      'documento da Nissan Frontier',
      'Documento de Veículo',
      undefined,
      contatoTeste,
      'Coloque ele em documentos faltantes',
      'veiculo',
      'Nissan Frontier'
    );
    console.log('Resultado do registro manual:', resManual);
    if (!resManual.sucesso || !resManual.mensagem.includes('Registrei como faltante: documento da Nissan Frontier')) {
      throw new Error(`Falha no registro manual: ${JSON.stringify(resManual)}`);
    }
    if (resManual.item_registrado) {
      idCriadosParaLimpar.push(resManual.item_registrado.id);
      console.log(`✅ Quantidade de pedidos incrementada: ${resManual.item_registrado.quantidade_pedidos}`);
    }
    console.log('✅ Tool registrar_documento_faltante executada com sucesso!\n');

    // -------------------------------------------------------------
    // TESTE 5: "me manda a lista de documentos faltantes" -> "de todos"
    // -------------------------------------------------------------
    console.log('--- TESTE 5: Listar Documentos Faltantes ---');
    const resListarSemEscopo = await toolListarDocumentosFaltantes(undefined, undefined, contatoTeste, 'me manda a lista de documentos faltantes');
    if (!resListarSemEscopo.precisa_esclarecer || resListarSemEscopo.pergunta_esclarecimento !== 'Quer só os seus ou de todos os titulares?') {
      throw new Error(`Falha na pergunta de esclarecimento: ${JSON.stringify(resListarSemEscopo)}`);
    }

    const resListarTodos = await toolListarDocumentosFaltantes(undefined, 'todos', contatoTeste, 'de todos');
    console.log('Resposta de todos:\n' + resListarTodos.mensagem);
    console.log('✅ Listagem de todos os faltantes OK!\n');

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
