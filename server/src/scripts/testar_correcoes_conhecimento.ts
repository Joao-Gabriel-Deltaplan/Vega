import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';
import { Contato } from '../types.js';

async function rodarTestes() {
  console.log('================================================================');
  console.log('🧪 INICIANDO TESTE DAS CORREÇÕES DE CLASSIFICAÇÃO E BUSCA');
  console.log('================================================================\n');

  const contatoTeste: Contato = {
    id: 'ct-colaborador',
    nome: 'Colaborador Teste',
    telefone: '5500000000005',
    avatarCor: '#25D366',
    setor: 'Diretoria',
    nivelAcesso: 'diretoria',
    ficha: {
      cargo: 'Diretor',
      setor: 'Diretoria',
      nivelAcesso: 'diretoria',
      observacoes: '',
    },
  };

  const docsDisponiveis = await obterTodosDocumentos();

  const perguntas = [
    {
      label: 'TESTE 1: "o que tem em testes jg" (pergunta_conteudo -> conteúdo atualizado)',
      mensagem: 'o que tem em testes jg',
    },
    {
      label: 'TESTE 2: "testes jg" (busca por nome na Aba Conhecimento -> conteúdo atualizado)',
      mensagem: 'testes jg',
    },
    {
      label: 'TESTE 3: Pergunta sobre o conteúdo atual sem citar o nome ("qual a regra para pedido de compra acima de 5000?")',
      mensagem: 'qual a regra para pedido de compra acima de 5000?',
    },
    {
      label: 'TESTE 4: Verificação da frase antiga apagada ("O que consta sobre a nova versão teste?")',
      mensagem: 'O que consta sobre a nova versão teste?',
    },
  ];

  for (const p of perguntas) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`📨 EXECUTANDO ${p.label}`);
    console.log(`Mensagem do usuário: "${p.mensagem}"`);
    console.log(`----------------------------------------------------------------`);

    const resultado = await processarMensagemChat({
      mensagemUsuario: p.mensagem,
      historicoRecente: [],
      contato: contatoTeste,
      documentosDisponiveis: docsDisponiveis,
    });

    console.log(`\n🤖 RESPOSTA DA VEGA:`);
    console.log(`"${resultado.textoResposta}"`);
    if (resultado.anexos && resultado.anexos.length > 0) {
      console.log(`📎 Anexos entregues:`, resultado.anexos.map((a) => a.nome));
    }
  }

  console.log('\n================================================================');
  console.log('✅ TESTES CONCLUÍDOS');
  console.log('================================================================\n');
}

rodarTestes().catch((err) => {
  console.error('Erro nos testes:', err);
  process.exit(1);
});
