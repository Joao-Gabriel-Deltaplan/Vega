import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterDocumentosPorNivelAcesso, obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { Contato } from '../types.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 TESTE DE CLASSIFICAÇÃO, REESCRITA E ANEXOS DA VEGA');
  console.log('================================================================\n');

  const todosTitulares = await obterTodosTitulares();
  const titularAlvo = todosTitulares.find(t => t.tipo !== 'PJ') || todosTitulares[0] || { id: 'tit_teste', nome: 'Titular Teste' };
  const primeiroNome = extrairPrimeiroNome(titularAlvo.nome) || titularAlvo.nome;

  const contatoTeste: Contato = {
    id: 'contato-teste',
    nome: 'Usuario Teste',
    telefone: '5500000000005',
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

  const casosDeTeste = [
    `qual é a CNH de ${primeiroNome}`,
    `a CNH de ${primeiroNome}`,
    `CNH de ${primeiroNome}`,
    `qual o número da CNH de ${primeiroNome}?`,
    'qual o endereço do escritório?',
  ];

  for (let i = 0; i < casosDeTeste.length; i++) {
    const pergunta = casosDeTeste[i];
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[TESTE ${i + 1}/3] Pergunta: "${pergunta}"`);
    console.log(`----------------------------------------------------------------`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: pergunta,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    const temAnexo = Boolean(resultado.anexos && resultado.anexos.length > 0);
    const infoAnexos = temAnexo
      ? resultado.anexos!.map((a) => `${a.nome} (${a.titulo || 'Sem título'}, ${a.tamanho || 'Tam. N/D'})`).join(', ')
      : 'Nenhum';

    console.log(`\n📌 RESULTADO DO TESTE ${i + 1}:`);
    console.log(`- Intenção detectada: ${resultado.intencaoDetectada}`);
    console.log(`- Pergunta reescrita: "${resultado.perguntaReescrita}"`);
    console.log(`- Anexo enviado: ${temAnexo ? 'SIM' : 'NÃO'} [${infoAnexos}]`);
    console.log(`- Origem: ${resultado.origem}`);
    console.log(`- Busca usada: ${resultado.buscaUsada}`);
    console.log(`- Resposta:\n${resultado.textoResposta}\n`);
  }

  console.log('================================================================');
  console.log('✅ TESTES CONCLUÍDOS!');
  console.log('================================================================\n');
}

rodarTestes().catch((err) => {
  console.error('Erro ao executar testes:', err);
  process.exit(1);
});
