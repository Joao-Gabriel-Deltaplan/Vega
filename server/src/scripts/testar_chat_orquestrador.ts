import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos, obterTodosTitulares } from '../storage.js';
import { extrairPrimeiroNome } from '../utils/nomeUtils.js';
import { Contato, Mensagem } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function executarTestesChat() {
  console.log('================================================================');
  console.log('TESTES DE VALIDAÇÃO DAS FASES 4 E 5 — ORQUESTRADOR DO CHAT');
  console.log('================================================================\n');

  const todosDocs = await obterTodosDocumentos();
  const todosTitulares = await obterTodosTitulares();
  const titularAlvo = todosTitulares.find(t => t.tipo !== 'PJ') || todosTitulares[0] || { id: 'tit_teste', nome: 'Titular Teste' };
  const primeiroNome = extrairPrimeiroNome(titularAlvo.nome) || titularAlvo.nome;

  const contatoTeste: Contato = {
    id: 'contato_diretoria',
    nome: 'Usuario Teste',
    telefone: '5500000000005',
    avatarCor: '#22c55e',
    nivelAcesso: 'diretoria',
    cargo: 'Diretor',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: 'Diretor Executivo',
    },
  };

  const cenarios = [
    {
      titulo: 'Cenário 1: Saudação ou pedido vago',
      mensagem: 'Olá, boa tarde! Como você pode me ajudar?',
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 2: Pedir arquivo (Download de PDF)',
      mensagem: `Me manda a CNH de ${primeiroNome} por favor`,
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 3a: Dado pessoal conferido na ficha (CPF)',
      mensagem: `Qual o CPF de ${primeiroNome}?`,
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 3b: Dado pessoal pendente de conferência na ficha (Pai)',
      mensagem: `Qual o nome do pai de ${primeiroNome}?`,
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 3c: Dado pessoal não na ficha -> cai na busca vetorial da pessoa (CREA)',
      mensagem: `Qual o número de registro de ${primeiroNome} no CREA?`,
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 4: Pergunta de conteúdo corporativo (Política de Agendamento)',
      mensagem: 'Qual é a política e o horário de agendamento de reuniões na Delta Plan?',
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 5: Fora de escopo',
      mensagem: 'Qual é a capital da França?',
      historico: [] as Mensagem[],
    },
    {
      titulo: 'Cenário 6: Pergunta de conteúdo não encontrada nos documentos',
      mensagem: `Qual é a cor preferida e o signo de ${primeiroNome}?`,
      historico: [] as Mensagem[],
    },
  ];

  for (const c of cenarios) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`📌 ${c.titulo}`);
    console.log(`👤 Usuário: "${c.mensagem}"`);
    console.log(`----------------------------------------------------------------`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: c.mensagem,
      historicoRecente: c.historico,
      contato: contatoTeste,
      documentosDisponiveis: todosDocs,
    });

    console.log(`🤖 VEGA (${resultado.origem}): "${resultado.textoResposta}"`);
    if (resultado.anexos && resultado.anexos.length > 0) {
      console.log(`📎 Anexos entregues:`, resultado.anexos.map((a) => a.nome));
    }
    if (resultado.opcoes && resultado.opcoes.length > 0) {
      console.log(`🔘 Opções sugeridas:`, resultado.opcoes.map((o) => o.titulo));
    }
  }

  console.log('\n================================================================');
  console.log('FIM DOS TESTES DO CHAT');
  console.log('================================================================');
}

executarTestesChat().catch(console.error);
