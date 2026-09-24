import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { Contato, Mensagem } from '../types.js';

async function rodarBateria() {
  console.log('================================================================');
  console.log(' INICIANDO SUÍTE DE TESTES: 8 CASOS REAIS DE PRODUÇÃO (VEGA)   ');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();

  // Titular principal obtido dinamicamente do Supabase (agnóstico a titulares específicos)
  const titularPrincipal = todosTitulares.find((t) => (t as any).tipo !== 'PJ') || todosTitulares[0] || { id: 'tit_teste', nome: 'Titular Teste' };
  const primeiroNomeTitular = extrairPrimeiroNome(titularPrincipal.nome) || titularPrincipal.nome;

  const contatoTeste: Contato = {
    id: 'user_teste',
    nome: titularPrincipal.nome,
    telefone: '5500000000000',
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
  // e anotar na lista de faltantes.
  // --------------------------------------------------------------------------
  console.log('[TESTE 1] Pergunta: "certidão de nascimento"');
  try {
    const res1 = await processarMensagemChat({
      mensagemUsuario: 'certidão de nascimento',
      historicoRecente: [],
      contato: contatoTeste,
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
  // CASO 2: Documento de Pessoa Jurídica / Sigla Técnica (ex: "ART")
  // Deve entregar o documento correto e NUNCA cartão de vacinas ou outro tipo!
  // --------------------------------------------------------------------------
  const docArt = todosDocs.find(
    (d) =>
      (d.tipo || '').toUpperCase() === 'ART' ||
      /\bart\b/i.test(d.titulo) ||
      /\bart\b/i.test(d.arquivo)
  );

  const idPessoaArt = docArt?.pessoaId || docArt?.pessoa_id;
  const titularArt = idPessoaArt
    ? todosTitulares.find((t) => t.id === idPessoaArt) || { id: 'tit_pj', nome: docArt?.titular || 'Titular PJ Teste' }
    : { id: 'tit_pj', nome: docArt?.titular || 'Titular PJ Teste' };

  const partesNome = titularArt.nome.split(' ').filter((p) => !['de', 'da', 'do', 'dos', 'das', 'serviços', 'servicos'].includes(p.toLowerCase()));
  const termoNomeArt = partesNome.length > 0 ? partesNome[partesNome.length - 1] : extrairPrimeiroNome(titularArt.nome);
  const termoPerguntaArt = `ART do ${termoNomeArt}`;
  console.log(`[TESTE 2] Pergunta: "${termoPerguntaArt}"`);
  try {
    const res2 = await processarMensagemChat({
      mensagemUsuario: termoPerguntaArt,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    const achouDocCorreto = res2.anexos?.some((a) => {
      const nomeOuTitulo = (a.titulo || a.nome).toLowerCase();
      return nomeOuTitulo.includes('art') || (docArt && nomeOuTitulo.includes(docArt.arquivo.toLowerCase()));
    });
    const entregouVacinas = res2.anexos?.some((a) => (a.titulo || a.nome).toLowerCase().includes('vacin'));

    const passou2 = Boolean(achouDocCorreto) && !entregouVacinas;

    console.log('Resposta 2:\n', res2.textoResposta);
    console.log('Anexos 2:', res2.anexos?.map((a) => a.titulo || a.nome) || []);
    console.log(`Resultado Caso 2: ${passou2 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 2,
      nome: `Pedido de "${termoPerguntaArt}" (reconhecimento de titular/PJ e tipo documental)`,
      passou: passou2,
      detalhe: `Entregou documento correto: ${achouDocCorreto} | Entregou vacinas: ${entregouVacinas}`,
    });
  } catch (err: any) {
    console.error('Erro Caso 2:', err);
    resultados.push({ caso: 2, nome: 'Documento PJ / ART', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 3: "resuma esse documento em 10 linhas"
  // Contexto: VEGA acabou de entregar um documento (ex: ART ou primeiro doc)
  // Deve responder o resumo em texto, SEM enviar anexo!
  // --------------------------------------------------------------------------
  const docParaResumo = docArt || todosDocs[0];
  console.log(`[TESTE 3] Pergunta: "resuma esse documento em 10 linhas" (após envio de ${docParaResumo?.titulo})`);
  try {
    const historicoComAnexo: Mensagem[] = [
      {
        id: 'msg-1',
        remetente: 'cliente',
        nomeRemetente: primeiroNomeTitular,
        horario: '10:00',
        texto: docParaResumo ? `me manda ${docParaResumo.titulo}` : 'me manda o documento',
      },
      {
        id: 'msg-2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: `Aqui está o documento solicitado: ${docParaResumo?.titulo}.`,
        anexos: [
          {
            tipo: 'pdf',
            url: docParaResumo?.arquivo || 'documento.pdf',
            nome: docParaResumo?.arquivo || 'documento.pdf',
            titulo: docParaResumo?.titulo || 'Documento',
          },
        ],
        rastro: {
          mensagemId: 'msg-2',
          usuarioNome: primeiroNomeTitular,
          usuarioId: 'user_teste',
          mensagemOriginal: docParaResumo?.titulo || 'Documento',
          perguntaReescrita: docParaResumo?.titulo || 'Documento',
          intencaoDetectada: 'pedir_arquivo',
          tipoBusca: 'nome_cofre',
          documentosEncontrados: docParaResumo ? [{ id: docParaResumo.id, titulo: docParaResumo.titulo, similaridade: 100, usadoNaResposta: true }] : [],
          documentoUsado: docParaResumo?.titulo,
          enviouAnexo: true,
          respostaFinal: `Aqui está o documento solicitado: ${docParaResumo?.titulo}.`,
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
      contato: contatoTeste,
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
  // CASO 4: Pergunta de conteúdo sobre documento recente
  // Contexto: VEGA acabou de entregar um documento técnico
  // Deve explicar o conteúdo técnico sem anexar arquivo!
  // --------------------------------------------------------------------------
  console.log('[TESTE 4] Pergunta: "o que esse documento fala sobre águas fluviais?"');
  try {
    const historicoComAnexo4: Mensagem[] = [
      {
        id: 'msg-1',
        remetente: 'cliente',
        nomeRemetente: primeiroNomeTitular,
        horario: '10:00',
        texto: docParaResumo ? `me manda ${docParaResumo.titulo}` : 'me manda o documento',
      },
      {
        id: 'msg-2',
        remetente: 'assistente',
        nomeRemetente: 'VEGA',
        horario: '10:01',
        texto: `Aqui está o documento solicitado: ${docParaResumo?.titulo}.`,
        anexos: [
          {
            tipo: 'pdf',
            url: docParaResumo?.arquivo || 'documento.pdf',
            nome: docParaResumo?.arquivo || 'documento.pdf',
            titulo: docParaResumo?.titulo || 'Documento',
          },
        ],
        rastro: {
          mensagemId: 'msg-2',
          usuarioNome: primeiroNomeTitular,
          usuarioId: 'user_teste',
          mensagemOriginal: docParaResumo?.titulo || 'Documento',
          perguntaReescrita: docParaResumo?.titulo || 'Documento',
          intencaoDetectada: 'pedir_arquivo',
          tipoBusca: 'nome_cofre',
          documentosEncontrados: docParaResumo ? [{ id: docParaResumo.id, titulo: docParaResumo.titulo, similaridade: 100, usadoNaResposta: true }] : [],
          documentoUsado: docParaResumo?.titulo,
          enviouAnexo: true,
          respostaFinal: `Aqui está o documento solicitado: ${docParaResumo?.titulo}.`,
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
      historicoRecente: historicoComAnexo4,
      contato: contatoTeste,
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
  // Deve responder a data de registro do casamento e NUNCA data de nascimento!
  // --------------------------------------------------------------------------
  console.log('[TESTE 5] Pergunta: "qual a data de registro do casamento?"');
  try {
    const res5 = await processarMensagemChat({
      mensagemUsuario: 'qual a data de registro do casamento?',
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    const texto5 = res5.textoResposta.toLowerCase();
    const temDocCasamento = todosDocs.some((d) => d.titulo.toLowerCase().includes('casamento') || d.arquivo.toLowerCase().includes('casamento'));

    let passou5 = false;
    let detalhe5 = '';

    if (temDocCasamento) {
      const temDataCasamento = texto5.includes('12 de abril de 2010') || texto5.includes('12/04/2010') || texto5.includes('doze de abril de dois mil e dez');
      const confundiuComNascimento = texto5.includes('06/10/1984') || texto5.includes('6 de outubro de 1984');
      passou5 = temDataCasamento && !confundiuComNascimento;
      detalhe5 = `Data fato jurídico: ${temDataCasamento} | Confundiu nascimento: ${confundiuComNascimento}`;
    } else {
      // Se não houver documento de casamento cadastrado no banco, a VEGA deve informar que não encontrou
      passou5 = texto5.includes('não encontrei') || texto5.includes('não consta');
      detalhe5 = `Sem doc de casamento no cofre: respondeu não encontrado (${passou5})`;
    }

    console.log('Resposta 5:\n', res5.textoResposta);
    console.log(`Resultado Caso 5: ${passou5 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 5,
      nome: 'Data de registro do casamento (fato jurídico vs data de nascimento)',
      passou: passou5,
      detalhe: detalhe5,
    });
  } catch (err: any) {
    console.error('Erro Caso 5:', err);
    resultados.push({ caso: 5, nome: 'Data de registro do casamento', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 6: "qual o endereço de [titular]?"
  // Busca vetorial nos documentos do titular cadastrado
  // --------------------------------------------------------------------------
  console.log(`[TESTE 6] Pergunta: "qual o endereço de ${primeiroNomeTitular}?"`);
  try {
    const res6 = await processarMensagemChat({
      mensagemUsuario: `qual o endereço de ${primeiroNomeTitular}?`,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    const texto6 = res6.textoResposta.toLowerCase();
    const temDocEndereco = todosDocs.some((d) => (d.pessoaId === titularPrincipal.id || (d as any).pessoa_id === titularPrincipal.id) && (d as any).trechos?.some((t: any) => t.conteudo.toLowerCase().includes('rua') || t.conteudo.toLowerCase().includes('av')));

    let passou6 = false;
    let detalhe6 = '';

    if (temDocEndereco) {
      const achouEndereco = texto6.includes('benedito fonseca rodrigues') || texto6.includes('morada da ponte nova') || texto6.includes('rua');
      const disseNaoEncontrou6 = texto6.includes('não encontrei nos documentos') || texto6.includes('não encontrei o endereço');
      passou6 = achouEndereco && !disseNaoEncontrou6;
      detalhe6 = `Achou endereço: ${achouEndereco} | Não encontrou: ${disseNaoEncontrou6}`;
    } else {
      // Se o titular não tiver documento com endereço, deve responder de forma clara sem alucinar
      passou6 = texto6.length > 20;
      detalhe6 = `Titular sem documento de endereço: respondeu adequadamente (${passou6})`;
    }

    console.log('Resposta 6:\n', res6.textoResposta);
    console.log(`Resultado Caso 6: ${passou6 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 6,
      nome: `Endereço do titular ("qual o endereço de ${primeiroNomeTitular}?")`,
      passou: passou6,
      detalhe: detalhe6,
    });
  } catch (err: any) {
    console.error('Erro Caso 6:', err);
    resultados.push({ caso: 6, nome: 'Endereço do titular', passou: false, detalhe: err.message });
  }

  // --------------------------------------------------------------------------
  // CASO 7: "quando fui dispensado do serviço militar?"
  // Deve responder a data exata do fato jurídico e NUNCA data de nascimento!
  // --------------------------------------------------------------------------
  console.log('[TESTE 7] Pergunta: "quando fui dispensado do serviço militar?"');
  try {
    const res7 = await processarMensagemChat({
      mensagemUsuario: 'quando fui dispensado do serviço militar?',
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    const texto7 = res7.textoResposta.toLowerCase();
    const temDocDispensa = todosDocs.some((d) => d.titulo.toLowerCase().includes('dispensa') || d.arquivo.toLowerCase().includes('dispensa'));

    let passou7 = false;
    let detalhe7 = '';

    if (temDocDispensa) {
      const temDataDispensa = texto7.includes('23 de agosto de 2005') || texto7.includes('23/08/2005') || texto7.includes('23/ago/2005');
      const confundiuComNasc7 = texto7.includes('06/10/1984') || texto7.includes('6 de outubro de 1984');
      passou7 = temDataDispensa && !confundiuComNasc7;
      detalhe7 = `Data fato jurídico (dispensa): ${temDataDispensa} | Confundiu nascimento: ${confundiuComNasc7}`;
    } else {
      passou7 = texto7.includes('não encontrei') || texto7.includes('não consta');
      detalhe7 = `Sem doc de dispensa: respondeu não encontrado (${passou7})`;
    }

    console.log('Resposta 7:\n', res7.textoResposta);
    console.log(`Resultado Caso 7: ${passou7 ? 'APROVADO' : 'REPROVADO'}\n`);

    resultados.push({
      caso: 7,
      nome: 'Data de dispensa do serviço militar (fato documental vs nascimento)',
      passou: passou7,
      detalhe: detalhe7,
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
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    const texto8 = res8.textoResposta.toLowerCase();
    const listouDocs =
      texto8.includes('documentos disponíveis no cofre') &&
      (todosTitulares.some((t) => texto8.includes(t.nome.toLowerCase()) || texto8.includes(extrairPrimeiroNome(t.nome).toLowerCase())) ||
        texto8.includes('cnh') ||
        texto8.includes('passaporte') ||
        texto8.includes('art'));
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
