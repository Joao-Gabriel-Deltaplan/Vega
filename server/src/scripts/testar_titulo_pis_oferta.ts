import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { Contato, Mensagem } from '../types.js';

const contatoTeste: Contato = {
  id: 'contato_teste_validacao',
  telefone: '5514999999999',
  nome: 'Diretoria',
  pushname: 'Diretoria',
  criadoEm: new Date().toISOString(),
  atualizadoEm: new Date().toISOString(),
  conversaAtiva: true,
  nivelAcesso: 'diretoria',
};

async function rodarTestes() {
  console.log('\n================================================================');
  console.log('🧪 BATERIA DE TESTES: TÍTULO ELEITORAL, PIS E OFERTA DE DOCUMENTO');
  console.log('================================================================\n');

  let aprovados = 0;
  const total = 3;

  // --------------------------------------------------------------------------
  // TESTE 1: "qual número do título eleitoral do thomaz"
  // Deve responder 308476780167 citando o Imposto de Renda
  // --------------------------------------------------------------------------
  console.log('--- Teste 1: Título de Eleitor do Thomaz ---');
  const res1 = await processarMensagemChat({
    mensagemUsuario: 'qual número do título eleitoral do thomaz',
    historicoRecente: [],
    contato: contatoTeste,
  });

  console.log(`Resposta: "${res1.textoResposta}"`);
  const r1Lower = res1.textoResposta.toLowerCase();
  const temNumeroTitulo = res1.textoResposta.includes('308476780167');
  const citaImpostoRenda = r1Lower.includes('imposto de renda');
  const naoTemFiliacao = !r1Lower.includes('moises') && !r1Lower.includes('lidia');
  const passou1 = temNumeroTitulo && citaImpostoRenda && naoTemFiliacao;

  console.log(`- Contém o número 308476780167: ${temNumeroTitulo}`);
  console.log(`- Cita o Imposto de Renda: ${citaImpostoRenda}`);
  console.log(`- Não misturou com filiação: ${naoTemFiliacao}`);
  if (passou1) {
    console.log('✅ APROVADO: Respondeu o número correto do título e citou a fonte.');
    aprovados++;
  } else {
    console.error('❌ FALHOU no Teste 1.');
  }

  // --------------------------------------------------------------------------
  // TESTE 2: "qual o PIS do thomaz"
  // Deve dizer que não encontrou (inexistente na ficha e nos documentos)
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 2: PIS do Thomaz (campo inexistente) ---');
  const res2 = await processarMensagemChat({
    mensagemUsuario: 'qual o PIS do thomaz?',
    historicoRecente: [],
    contato: contatoTeste,
  });

  console.log(`Resposta: "${res2.textoResposta}"`);
  const r2Lower = res2.textoResposta.toLowerCase();
  const naoEncontrouPis = r2Lower.includes('não encontrei') && r2Lower.includes('pis');
  const naoInventouDado = !r2Lower.includes('333.599') && !r2Lower.includes('moises');
  const passou2 = naoEncontrouPis && naoInventouDado;

  console.log(`- Respondeu que não encontrou o PIS: ${naoEncontrouPis}`);
  console.log(`- Não inventou nem substituiu dado: ${naoInventouDado}`);
  if (passou2) {
    console.log('✅ APROVADO: Declarou corretamente que não encontrou.');
    aprovados++;
  } else {
    console.error('❌ FALHOU no Teste 2.');
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Pergunta citando "thomaz" após oferta de documento NÃO pode enviar anexo
  // --------------------------------------------------------------------------
  console.log('\n--- Teste 3: Nova pergunta citando "thomaz" após oferta de documento ---');
  const historicoComOferta: Mensagem[] = [
    {
      id: 'msg-ant-1',
      remetente: 'cliente',
      texto: 'qual o cpf do thomaz?',
      horario: '10:00',
    },
    {
      id: 'msg-ant-2',
      remetente: 'assistente',
      texto: 'O CPF do Thomaz é 333.599.518-08.\n\nQuer que eu envie o documento de onde tirei essa informação (CNH Thomaz)?',
      documentoOferecidoId: '034f2eab-c6f7-4efd-b030-b2fc19d5a03a', // ID da CNH
      horario: '10:01',
    },
  ];

  const res3 = await processarMensagemChat({
    mensagemUsuario: 'qual a data de nascimento do thomaz?',
    historicoRecente: historicoComOferta,
    contato: contatoTeste,
  });

  console.log(`Resposta: "${res3.textoResposta}"`);
  console.log(`Anexos entregues:`, res3.anexos ? res3.anexos.map((a: any) => a.nome) : []);

  const r3Lower = res3.textoResposta.toLowerCase();
  const respondeuDataNascimento = res3.textoResposta.includes('06/10/1984') || r3Lower.includes('6 de outubro de 1984');
  const naoEnviouAnexoInvoluntario = !res3.anexos || res3.anexos.length === 0;
  const passou3 = respondeuDataNascimento && naoEnviouAnexoInvoluntario;

  console.log(`- Respondeu a nova pergunta (data de nascimento 06/10/1984): ${respondeuDataNascimento}`);
  console.log(`- Não disparou anexo indevido da CNH: ${naoEnviouAnexoInvoluntario}`);
  if (passou3) {
    console.log('✅ APROVADO: A nova pergunta foi respondida e o documento ofertado não foi disparado.');
    aprovados++;
  } else {
    console.error('❌ FALHOU no Teste 3.');
  }

  console.log('\n================================================================');
  console.log(`Resultado: ${aprovados}/${total} aprovados.`);
  console.log('================================================================\n');

  if (aprovados === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

rodarTestes().catch((err) => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
