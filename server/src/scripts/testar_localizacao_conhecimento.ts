import dotenv from 'dotenv';
dotenv.config();

import { ItemConhecimento } from '../types.js';
import { buscarConhecimentoPorNome } from '../chat/chatOrquestrador.js';
import { estruturarConhecimentoComIA } from '../conhecimentoEstruturadorService.js';
import { classificarIntencao } from '../busca/intencao.js';

async function rodarTestes() {
  console.log('=== TESTE DE LOCALIZAÇÃO NA BASE DA VEGA ===\n');

  // 1. Base simulada com itens de localização
  const baseTeste: ItemConhecimento[] = [
    {
      id: 'k-loc-1',
      titulo: 'Escritório Central Delta Plan',
      categoria: 'Localização',
      conteudo: 'Local: Escritório Central Delta Plan | Endereço: Av. Independência, 1200, Sala 402, Piracicaba - SP | Como Chegar / Ponto de Referência: Ao lado da Praça Central, em frente ao Banco Santander',
      tipo: 'local',
      dadosEstruturados: {
        nomeLocal: 'Escritório Central Delta Plan',
        endereco: 'Av. Independência, 1200, Sala 402, Piracicaba - SP',
        pontoReferencia: 'Ao lado da Praça Central, em frente ao Banco Santander',
        cidade: 'Piracicaba - SP',
        linkMaps: 'https://maps.app.goo.gl/exemploEscritorio',
      },
      dataAtualizacao: '28/09/2026',
    },
    {
      id: 'k-loc-2',
      titulo: 'Obra Residencial Solar das Palmeiras',
      categoria: 'Obras',
      conteudo: 'Local: Obra Residencial Solar das Palmeiras | Endereço: Rua dos Ipês, 550, Bairro Jardim Primavera, Piracicaba - SP | Como Chegar / Ponto de Referência: Próximo à rotatória da rodovia, entrada pelo portão 2',
      tipo: 'local',
      dadosEstruturados: {
        nomeLocal: 'Obra Residencial Solar das Palmeiras',
        endereco: 'Rua dos Ipês, 550, Bairro Jardim Primavera, Piracicaba - SP',
        pontoReferencia: 'Próximo à rotatória da rodovia, entrada pelo portão 2',
        cidade: 'Piracicaba - SP',
      },
      dataAtualizacao: '28/09/2026',
    },
    {
      id: 'k-loc-3',
      titulo: 'Depósito de Suprimentos e Almoxarifado',
      categoria: 'Localização',
      conteudo: 'Local: Depósito de Suprimentos e Almoxarifado | Endereço: Rua das Indústrias, 880, Distrito Industrial | Como Chegar / Ponto de Referência: Galpão azul após o posto Ipiranga',
      tipo: 'local',
      dadosEstruturados: {
        nomeLocal: 'Depósito de Suprimentos e Almoxarifado',
        endereco: 'Rua das Indústrias, 880, Distrito Industrial',
        pontoReferencia: 'Galpão azul após o posto Ipiranga',
      },
      dataAtualizacao: '28/09/2026',
    },
  ];

  // Teste 1: Classificador determinístico de intenção
  console.log('--- TESTE 1: Classificador de Intenção ---');
  const perguntasIntencao = [
    'onde fica o escritório central?',
    'como chegar na obra solar?',
    'qual o endereço do depósito?',
    'quais locais temos cadastrados?',
  ];

  for (const p of perguntasIntencao) {
    const res = classificarIntencao(p);
    console.log(`Pergunta: "${p}" -> Tipo: "${res.tipo}"`);
    if (res.tipo !== 'consulta_conhecimento') {
      console.error(`❌ FALHA: Esperado consulta_conhecimento, obtido ${res.tipo}`);
      process.exit(1);
    }
  }
  console.log('✅ Classificador de intenção direcionou perfeitamente para conhecimento!\n');

  // Teste 2: Busca por "onde fica..."
  console.log('--- TESTE 2: Pergunta "Onde fica o depósito?" ---');
  const resDeposito = await buscarConhecimentoPorNome('onde fica o deposito', baseTeste);
  if (!resDeposito || resDeposito.item.id !== 'k-loc-3') {
    console.error('❌ FALHA ao localizar depósito:', resDeposito);
    process.exit(1);
  }
  console.log(`✅ Sucesso! Encontrou: "${resDeposito.item.titulo}" (Score: ${resDeposito.score})`);

  // Teste 3: Busca por "como chegar..."
  console.log('--- TESTE 3: Pergunta "Como chegar na obra solar?" ---');
  const resSolar = await buscarConhecimentoPorNome('como chegar na obra residencial solar', baseTeste);
  if (!resSolar || resSolar.item.id !== 'k-loc-2') {
    console.error('❌ FALHA ao localizar obra solar:', resSolar);
    process.exit(1);
  }
  console.log(`✅ Sucesso! Encontrou: "${resSolar.item.titulo}" (Score: ${resSolar.score})`);

  // Teste 4: Busca ampla por locais cadastrados
  console.log('--- TESTE 4: Pergunta "Quais locais temos cadastrados?" ---');
  const resLista = await buscarConhecimentoPorNome('quais os locais cadastrados', baseTeste);
  if (!resLista || !resLista.item.conteudo.includes('Escritório Central') || !resLista.item.conteudo.includes('Solar')) {
    console.error('❌ FALHA ao retornar lista de locais:', resLista);
    process.exit(1);
  }
  console.log(`✅ Sucesso! Consolidou locais cadastrados:\n${resLista.item.conteudo}\n`);

  // Teste 5: Estruturação com IA (se apiKey presente)
  if (process.env.OPENAI_API_KEY) {
    console.log('--- TESTE 5: Estruturação de Localização com IA ---');
    const textoEntrada = 'O nosso almoxarifado fica na Rua das Flores, 200, perto do viaduto, cidade Campinas - SP';
    const resIA = await estruturarConhecimentoComIA(textoEntrada);
    console.log('Resposta IA:', JSON.stringify(resIA, null, 2));
    if (!resIA.sucesso || resIA.itens.length === 0 || resIA.itens[0].tipo !== 'local') {
      console.error('❌ FALHA: IA não identificou tipo "local"');
      process.exit(1);
    }
    console.log('✅ IA identificou e estruturou localização com sucesso!');
  } else {
    console.log('⚠️ OPENAI_API_KEY não definida, pulando teste de IA.');
  }

  console.log('\n🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
}

rodarTestes().catch((err) => {
  console.error('Erro nos testes:', err);
  process.exit(1);
});
