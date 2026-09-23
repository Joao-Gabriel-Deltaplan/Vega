import OpenAI from 'openai';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato, Mensagem } from '../types.js';

async function rodarBateria() {
  console.log('================================================================');
  console.log(' INICIANDO SUÍTE DE TESTES: 8 CASOS REAIS DE PRODUÇÃO (VEGA)   ');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();

  const contatoThomaz: Contato = {
    id: 'user_thomaz',
    nome: 'Thomaz Lustri Fabre',
    telefone: '5514997275101',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    avatarCor: '#2563eb',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  const resultados: { caso: number; nome: string; passou: boolean; detalhe: string }[] = [];

  // --------------------------------------------------------------------------
  // CASO 1: "certidão de nascimento"
  // Não entregar certidão de casamento; responder "Não encontrei esse documento no Cofre."
  // e listar o que tem do Thomaz.
  // --------------------------------------------------------------------------
  console.log('[TESTE 1] Pergunta: "certidão de nascimento"');
  try {
    const res1 = await processarMensagemChat({
      mensagemUsuario: 'certidão de nascimento',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const texto1 = res1.textoResposta.toLowerCase();
    const enviouCasamento = res1.anexos?.some((a) => a.titulo?.toLowerCase().includes('casamento') || a.nome.toLowerCase().includes('casamento'));
    const disseNaoEncontrou = texto1.includes('não encontrei') && texto1.includes('no cofre');
    const anotouPendentes = texto1.includes('anotei na lista de documentos pendentes');

    const passou1 = !enviouCasamento && (!res1.anexos || res1.anexos.length === 0) && disseNaoEncontrou && anotouPendentes;

    console.log('Resposta 1:\n', res1.textoResposta);
    console.log('Anexos 1:', res1.anexos?.map((a) => a.titulo || a.nome) || []);
    console.log(`Resultado Caso 1: ${passou1 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 1,
      nome: 'Pedido de Certidão de Nascimento (tipo inexistente com anotação na lista de faltantes)',
      passou: passou1,
      detalhe: `Disse não encontrou: ${disseNaoEncontrou} | Anotou pendente: ${anotouPendentes} | Anexos: ${res1.anexos?.length || 0}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 1:', err);
    resultados.push({ caso: 1, nome: 'Certidão de Nascimento', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 2: "ART do Menegazzo"
  // Deve entregar a ART de Serviços Menegazzo, e NUNCA cartão de vacinas!
  // --------------------------------------------------------------------------
  console.log('[TESTE 2] Pergunta: "ART do Menegazzo"');
  try {
    const res2 = await processarMensagemChat({
      mensagemUsuario: 'ART do Menegazzo',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const achouArt = res2.anexos?.some((a) => (a.titulo || a.nome).toLowerCase().includes('art') && (a.titulo || a.nome).toLowerCase().includes('menegazzo'));
    const entregouVacinas = res2.anexos?.some((a) => (a.titulo || a.nome).toLowerCase().includes('vacin'));

    const passou2 = Boolean(achouArt) && !entregouVacinas;

    console.log('Resposta 2:\n', res2.textoResposta);
    console.log('Anexos 2:', res2.anexos?.map((a) => a.titulo || a.nome) || []);
    console.log(`Resultado Caso 2: ${passou2 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 2,
      nome: 'Pedido de "ART do Menegazzo" (reconhecimento de PJ e tipo ART)',
      passou: passou2,
      detalhe: `Entregou ART Menegazzo: ${achouArt} | Entregou vacinas: ${entregouVacinas}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 2:', err);
    resultados.push({ caso: 2, nome: 'ART do Menegazzo', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 3: "resuma esse documento em 10 linhas"
  // Contexto: VEGA acabou de entregar a ART do Menegazzo
  // Deve responder o resumo em texto, SEM enviar anexo!
  // --------------------------------------------------------------------------
  console.log('[TESTE 3] Pergunta: "resuma esse documento em 10 linhas" (após envio de ART)');
  try {
    const docArt = todosDocs.find((d) => d.titulo.toLowerCase().includes('menegazzo') || d.arquivo.toLowerCase().includes('menegazzo'))!;
    const historicoComAnexo: Mensagem[] = [
      {
        id: 'msg-1',
        remetente: 'cliente',
        nomeRemetente: 'Thomaz',
        horario: '10:00',
        texto: 'ART do Menegazzo',
      },
      {
        id: 'msg-2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: `Aqui está o documento solicitado: ${docArt.titulo}.`,
        anexos: [
          {
            tipo: 'pdf',
            url: docArt.arquivo,
            nome: docArt.arquivo,
            titulo: docArt.titulo,
          },
        ],
        rastro: {
          mensagemId: 'msg-2',
          usuarioNome: 'Thomaz',
          usuarioId: 'user_thomaz',
          mensagemOriginal: 'ART do Menegazzo',
          perguntaReescrita: 'ART do Menegazzo',
          intencaoDetectada: 'pedir_arquivo',
          tipoBusca: 'nome_cofre',
          documentosEncontrados: [{ id: docArt.id, titulo: docArt.titulo, similaridade: 100, usadoNaResposta: true }],
          documentoUsado: docArt.titulo,
          enviouAnexo: true,
          respostaFinal: `Aqui está o documento solicitado: ${docArt.titulo}.`,
          modeloUsado: 'Motor Interno',
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: 10,
          etapas: [],
        },
      },
    ];

    const res3 = await processarMensagemChat({
      mensagemUsuario: 'resuma esse documento em 10 linhas',
      historicoRecente: historicoComAnexo,
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const temAnexo3 = Boolean(res3.anexos && res3.anexos.length > 0);
    const linhas3 = res3.textoResposta.split('\n').filter((l) => l.trim().length > 0);
    const passou3 = !temAnexo3 && res3.intencaoDetectada === 'pergunta_conteudo' && res3.textoResposta.length > 50;

    console.log('Resposta 3:\n', res3.textoResposta);
    console.log('Intenção 3:', res3.intencaoDetectada);
    console.log('Anexos 3:', res3.anexos || []);
    console.log(`Resultado Caso 3: ${passou3 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 3,
      nome: 'Resumo de documento recente ("resuma esse documento em 10 linhas")',
      passou: passou3,
      detalhe: `Sem anexo: ${!temAnexo3} | Intenção: ${res3.intencaoDetectada} | Linhas: ${linhas3.length}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 3:', err);
    resultados.push({ caso: 3, nome: 'Resumo em 10 linhas', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 4: "o que esse documento fala sobre águas fluviais?"
  // Contexto: VEGA acabou de entregar a ART do Menegazzo (que trata de redes pluviais)
  // Deve explicar o conteúdo técnico sem anexar arquivo!
  // --------------------------------------------------------------------------
  console.log('[TESTE 4] Pergunta: "o que esse documento fala sobre águas fluviais?"');
  try {
    const docArt = todosDocs.find((d) => d.titulo.toLowerCase().includes('menegazzo') || d.arquivo.toLowerCase().includes('menegazzo'))!;
    const historicoComAnexo: Mensagem[] = [
      {
        id: 'msg-1',
        remetente: 'cliente',
        nomeRemetente: 'Thomaz',
        horario: '10:00',
        texto: 'ART do Menegazzo',
      },
      {
        id: 'msg-2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: `Aqui está o documento solicitado: ${docArt.titulo}.`,
        anexos: [
          {
            tipo: 'pdf',
            url: docArt.arquivo,
            nome: docArt.arquivo,
            titulo: docArt.titulo,
          },
        ],
        rastro: {
          mensagemId: 'msg-2',
          usuarioNome: 'Thomaz',
          usuarioId: 'user_thomaz',
          mensagemOriginal: 'ART do Menegazzo',
          perguntaReescrita: 'ART do Menegazzo',
          intencaoDetectada: 'pedir_arquivo',
          tipoBusca: 'nome_cofre',
          documentosEncontrados: [{ id: docArt.id, titulo: docArt.titulo, similaridade: 100, usadoNaResposta: true }],
          documentoUsado: docArt.titulo,
          enviouAnexo: true,
          respostaFinal: `Aqui está o documento solicitado: ${docArt.titulo}.`,
          modeloUsado: 'Motor Interno',
          tokensTotal: 0,
          tokensPrompt: 0,
          tokensCompletion: 0,
          custoEstimadoUsd: 0,
          tempoTotalMs: 10,
          etapas: [],
        },
      },
    ];

    const res4 = await processarMensagemChat({
      mensagemUsuario: 'o que esse documento fala sobre águas fluviais?',
      historicoRecente: historicoComAnexo,
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const temAnexo4 = Boolean(res4.anexos && res4.anexos.length > 0);
    const texto4L = res4.textoResposta.toLowerCase();
    const abordouPluviais = texto4L.includes('pluvia') || texto4L.includes('drenagem') || texto4L.includes('águas') || texto4L.includes('aguas');
    const passou4 = !temAnexo4 && res4.intencaoDetectada === 'pergunta_conteudo' && abordouPluviais;

    console.log('Resposta 4:\n', res4.textoResposta);
    console.log('Intenção 4:', res4.intencaoDetectada);
    console.log('Anexos 4:', res4.anexos || []);
    console.log(`Resultado Caso 4: ${passou4 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 4,
      nome: 'Pergunta de conteúdo ("o que esse documento fala sobre águas fluviais?")',
      passou: passou4,
      detalhe: `Sem anexo: ${!temAnexo4} | Abordou águas/pluviais: ${abordouPluviais}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 4:', err);
    resultados.push({ caso: 4, nome: 'Pergunta sobre águas fluviais', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 5: "qual a data de registro do casamento?"
  // Deve responder 12 de abril de 2010 (ou 12/04/2010) e NUNCA data de nascimento!
  // --------------------------------------------------------------------------
  console.log('[TESTE 5] Pergunta: "qual a data de registro do casamento?"');
  try {
    const res5 = await processarMensagemChat({
      mensagemUsuario: 'qual a data de registro do casamento?',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const texto5 = res5.textoResposta.toLowerCase();
    const temDataCasamento = texto5.includes('12 de abril de 2010') || texto5.includes('12/04/2010') || texto5.includes('doze de abril de dois mil e dez');
    const confundiuComNascimento = texto5.includes('06/10/1984') || texto5.includes('6 de outubro de 1984');
    const passou5 = temDataCasamento && !confundiuComNascimento;

    console.log('Resposta 5:\n', res5.textoResposta);
    console.log(`Resultado Caso 5: ${passou5 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 5,
      nome: 'Data de registro do casamento (12/04/2010 vs 06/10/1984)',
      passou: passou5,
      detalhe: `Data 12/04/2010: ${temDataCasamento} | Confundiu nascimento: ${confundiuComNascimento}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 5:', err);
    resultados.push({ caso: 5, nome: 'Data de registro do casamento', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 6: "qual o endereço do Thomaz?"
  // Deve responder Rua Benedito Fonseca Rodrigues, 195... (consta em Dados Thomaz)
  // e NUNCA dizer "não encontrei nos documentos"
  // --------------------------------------------------------------------------
  console.log('[TESTE 6] Pergunta: "qual o endereço do Thomaz?"');
  try {
    const res6 = await processarMensagemChat({
      mensagemUsuario: 'qual o endereço do Thomaz?',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const texto6 = res6.textoResposta.toLowerCase();
    const achouEndereco = texto6.includes('benedito fonseca rodrigues') || texto6.includes('morada da ponte nova');
    const disseNaoEncontrou6 = texto6.includes('não encontrei nos documentos') || texto6.includes('não encontrei o endereço');
    const passou6 = achouEndereco && !disseNaoEncontrou6;

    console.log('Resposta 6:\n', res6.textoResposta);
    console.log(`Resultado Caso 6: ${passou6 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 6,
      nome: 'Endereço do Thomaz (busca vetorial em Dados Thomaz)',
      passou: passou6,
      detalhe: `Achou rua Benedito Fonseca: ${achouEndereco} | Não encontrou: ${disseNaoEncontrou6}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 6:', err);
    resultados.push({ caso: 6, nome: 'Endereço do Thomaz', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 7: "quando fui dispensado do serviço militar?"
  // Deve responder 23 de agosto de 2005 (consta no Certificado de Dispensa)
  // e NUNCA a data de nascimento (06/10/1984)!
  // --------------------------------------------------------------------------
  console.log('[TESTE 7] Pergunta: "quando fui dispensado do serviço militar?"');
  try {
    const res7 = await processarMensagemChat({
      mensagemUsuario: 'quando fui dispensado do serviço militar?',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const texto7 = res7.textoResposta.toLowerCase();
    const temDataDispensa = texto7.includes('23 de agosto de 2005') || texto7.includes('23/08/2005') || texto7.includes('23/ago/2005');
    const confundiuComNasc7 = texto7.includes('06/10/1984') || texto7.includes('6 de outubro de 1984');
    const passou7 = temDataDispensa && !confundiuComNasc7;

    console.log('Resposta 7:\n', res7.textoResposta);
    console.log(`Resultado Caso 7: ${passou7 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 7,
      nome: 'Data de dispensa do serviço militar (23/08/2005 vs 06/10/1984)',
      passou: passou7,
      detalhe: `Data 23/08/2005: ${temDataDispensa} | Confundiu nascimento: ${confundiuComNasc7}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 7:', err);
    resultados.push({ caso: 7, nome: 'Dispensa serviço militar', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 8: "o que você tem no cofre?"
  // Deve listar os documentos disponíveis organizados por titular ou geral,
  // perguntar qual enviar, e NÃO mandar anexos soltos!
  // --------------------------------------------------------------------------
  console.log('[TESTE 8] Pergunta: "o que você tem no cofre?"');
  try {
    const res8 = await processarMensagemChat({
      mensagemUsuario: 'o que você tem no cofre?',
      historicoRecente: [],
      contato: contatoThomaz,
      documentosDisponiveis: todosDocs,
    });

    const texto8 = res8.textoResposta.toLowerCase();
    const listouDocs = texto8.includes('documentos disponíveis no cofre') && (texto8.includes('thomaz') || texto8.includes('cnh') || texto8.includes('passaporte'));
    const semAnexo8 = !res8.anexos || res8.anexos.length === 0;
    const ehListarDocs = res8.intencaoDetectada === 'listar_documentos';
    const passou8 = listouDocs && semAnexo8 && ehListarDocs;

    console.log('Resposta 8:\n', res8.textoResposta);
    console.log('Intenção 8:', res8.intencaoDetectada);
    console.log(`Resultado Caso 8: ${passou8 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 8,
      nome: 'Listagem de documentos do cofre ("o que você tem no cofre?")',
      passou: passou8,
      detalhe: `Intenção listar_documentos: ${ehListarDocs} | Listou docs: ${listouDocs} | Sem anexo: ${semAnexo8}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 8:', err);
    resultados.push({ caso: 8, nome: 'Listagem do cofre', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // RESUMO GERAL
  // --------------------------------------------------------------------------
  console.log('================================================================');
  console.log('                    RELATÓRIO FINAL DA BATERIA                  ');
  console.log('================================================================');
  let aprovados = 0;
  for (const r of resultados) {
    const status = r.passou ? 'APROVADO' : 'FALHOU';
    if (r.passou) aprovados++;
    console.log(`[${status}] Caso ${r.caso}: ${r.nome}`);
    console.log(`         Detalhe: ${r.detalhe}`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`TOTAL: ${aprovados} de ${resultados.length} casos aprovados (${((aprovados / resultados.length) * 100).toFixed(0)}%)`);
  console.log('================================================================');
}

rodarBateria().catch(console.error);
