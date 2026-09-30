import 'dotenv/config';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { getSupabaseClient } from '../db/supabaseClient.js';

interface Caso {
  nome: string;
  mensagem: string;
  remetenteNome: string;
  toolEsperada: string;
  proibirTool: string;
  validarResposta: (texto: string) => boolean;
}

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTE DOS CENÁRIOS DE LISTAGEM GERAL DO COFRE VS REMETENTE');
  console.log('1. "liste todos os documentos" (não deve assumir remetente)');
  console.log('2. "o que você tem no cofre?" (resumo geral por titular)');
  console.log('3. "quais são os meus documentos?" (busca titular do remetente)');
  console.log('================================================================\n');

  const casos: Caso[] = [
    {
      nome: 'Cenário 1: "liste todos os documentos" por Mauro',
      mensagem: 'liste todos os documentos',
      remetenteNome: 'Mauro Cesar Paiva',
      toolEsperada: 'listar_documentos_cofre',
      proibirTool: 'listar_documentos_titular',
      validarResposta: (texto) => {
        // NÃO pode dizer que não encontrou documentos vinculados ao Mauro
        const errouAssumindoMauro = texto.toLowerCase().includes('vinculados ao mauro') ||
          (texto.toLowerCase().includes('não encontrei') && texto.toLowerCase().includes('mauro'));
        // DEVE mencionar termos de resumo/titulares ou contagem
        const temResumoOuTitulares = texto.length > 50;
        return !errouAssumindoMauro && temResumoOuTitulares;
      },
    },
    {
      nome: 'Cenário 2: "o que você tem no cofre?" por Mauro',
      mensagem: 'o que você tem no cofre?',
      remetenteNome: 'Mauro Cesar Paiva',
      toolEsperada: 'listar_documentos_cofre',
      proibirTool: 'listar_documentos_titular',
      validarResposta: (texto) => {
        const errouAssumindoMauro = texto.toLowerCase().includes('vinculados ao mauro');
        return !errouAssumindoMauro && texto.length > 50;
      },
    },
    {
      nome: 'Cenário 3: "quais são os meus documentos?" por Mauro',
      mensagem: 'quais são os meus documentos?',
      remetenteNome: 'Mauro Cesar Paiva',
      toolEsperada: 'listar_documentos_titular',
      proibirTool: 'listar_documentos_cofre',
      validarResposta: (texto) => {
        // Como o Mauro não tem documentos no Cofre, a resposta deve dizer educadamente que não há documentos dele
        const textoNorm = texto.toLowerCase();
        return textoNorm.includes('não encontrei') || textoNorm.includes('não há') || textoNorm.includes('não localizei') || textoNorm.includes('mauro');
      },
    },
  ];

  let totalPassou = 0;

  for (let i = 0; i < casos.length; i++) {
    const c = casos[i];
    console.log(`------------------------------------------------------------`);
    console.log(`[TESTE ${i + 1}] ${c.nome}`);
    console.log(`Mensagem: "${c.mensagem}" (Remetente: ${c.remetenteNome})`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: c.mensagem,
      mensagem: c.mensagem,
      contato: {
        id: 'contato_teste_mauro',
        nome: c.remetenteNome,
        telefone: '5511999999999',
        cargo: 'Diretor',
        setor: 'Diretoria',
        nivelAcesso: 'admin',
        permiteExclusao: true,
        permiteCadastroConhecimento: true,
      },
      historicoRecente: [],
    });

    const toolsUsadas: string[] = [];
    if (resultado.rastro && resultado.rastro.etapas) {
      for (const e of resultado.rastro.etapas) {
        if (e.nome.startsWith('Tool: ')) {
          toolsUsadas.push(e.nome.replace('Tool: ', ''));
        }
      }
    }

    console.log(`[Tools acionadas]: ${toolsUsadas.join(', ') || 'nenhuma'}`);
    console.log(`[Resposta da VEGA]:\n${resultado.textoResposta}\n`);

    const chamouEsperada = toolsUsadas.includes(c.toolEsperada);
    const naoChamouProibida = !toolsUsadas.includes(c.proibirTool);
    const respostaValida = c.validarResposta(resultado.textoResposta);

    console.log(`- Chamou tool esperada (${c.toolEsperada}): ${chamouEsperada ? '✅' : '❌'}`);
    console.log(`- NÃO chamou proibida (${c.proibirTool}): ${naoChamouProibida ? '✅' : '❌'}`);
    console.log(`- Resposta válida (sem falsa premissa): ${respostaValida ? '✅' : '❌'}`);

    if (chamouEsperada && naoChamouProibida && respostaValida) {
      console.log(`✅ ${c.nome}: PASSOU COM SUCESSO!`);
      totalPassou++;
    } else {
      console.log(`❌ ${c.nome}: FALHOU!`);
    }
    console.log(`\n`);
  }

  console.log(`================================================================`);
  console.log(`RESULTADO FINAL: ${totalPassou}/${casos.length} cenários passaram.`);
  console.log(`================================================================`);

  if (totalPassou !== casos.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
