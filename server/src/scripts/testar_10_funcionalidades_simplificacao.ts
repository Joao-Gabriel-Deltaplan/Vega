import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { processarMensagemChat } from '../chat/chatOrquestrador.js';
import { obterTodosDocumentos } from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface CasoTeste {
  id: number;
  nome: string;
  mensagem: string;
  historico?: any[];
  intencaoEsperada?: string;
  validar?: (res: any) => { ok: boolean; detalhe: string };
}

async function main() {
  console.log('================================================================');
  console.log('🔍 VARREDURA DAS 10 FUNCIONALIDADES PÓS-SIMPLIFICAÇÃO');
  console.log('================================================================\n');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY ausente no .env');
  }
  const openai = new OpenAI({ apiKey });

  const todosDocs = await obterTodosDocumentos();
  const docCnh = todosDocs.find((d) => d.tipo?.toLowerCase().includes('cnh') || d.titulo.toLowerCase().includes('cnh'));
  const docCrea = todosDocs.find((d) => d.tipo?.toLowerCase().includes('crea') || d.titulo.toLowerCase().includes('crea'));

  const casos: CasoTeste[] = [
    // 1. Links de sistema
    {
      id: 1,
      nome: 'Links de sistema',
      mensagem: 'qual o link do sistema de máquinas?',
      intencaoEsperada: 'pergunta_conteudo',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'pergunta_conteudo' && (r.textoResposta.includes('http') || r.dadosEstruturados?.link || r.dadosEstruturados?.tipo === 'link');
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 2. Contatos corporativos
    {
      id: 2,
      nome: 'Contatos corporativos',
      mensagem: 'qual o contato do financeiro?',
      intencaoEsperada: 'pergunta_conteudo',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'pergunta_conteudo';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 3. Vencimentos
    {
      id: 3,
      nome: 'Vencimentos de documentos',
      mensagem: 'o que vence este mês?',
      intencaoEsperada: 'consultar_vencimentos',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'consultar_vencimentos';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 4. Checklist de faltantes
    {
      id: 4,
      nome: 'Checklist de faltantes',
      mensagem: 'o que falta do Thomaz?',
      intencaoEsperada: 'consultar_checklist_faltantes',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'consultar_checklist_faltantes';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 5. Listagem do cofre
    {
      id: 5,
      nome: 'Listagem do cofre',
      mensagem: 'o que tem no cofre?',
      intencaoEsperada: 'listar_documentos',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'listar_documentos';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 6. Silenciar alertas
    {
      id: 6,
      nome: 'Silenciar alertas',
      mensagem: 'pare de alertar o CRT do Thomaz',
      intencaoEsperada: 'silenciar_alerta',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'silenciar_alerta';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 7. Correção de dados
    {
      id: 7,
      nome: 'Correção de dados cadastrais',
      mensagem: 'a profissão do Thomaz está errada, é Engenheiro Civil',
      intencaoEsperada: 'corrigir_dado',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'corrigir_dado';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 8. Fatos documentais vs Nascimento
    {
      id: 8,
      nome: 'Fatos documentais vs Nascimento',
      mensagem: 'quando fui dispensado do serviço militar?',
      intencaoEsperada: 'pergunta_conteudo',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'pergunta_conteudo' && !/data de nascimento/i.test(r.textoResposta);
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 9. Múltiplos documentos
    {
      id: 9,
      nome: 'Múltiplos documentos',
      mensagem: 'me manda o crea e a certidão de casamento do Thomaz',
      intencaoEsperada: 'pedir_arquivo',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'pedir_arquivo';
        const anexosQtd = r.anexos?.length || 0;
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Anexos: ${anexosQtd} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 10. Confirmação de oferta
    {
      id: 10,
      nome: 'Confirmação de oferta ("sim")',
      mensagem: 'sim',
      historico: [
        {
          id: 'h1',
          remetente: 'cliente',
          nomeRemetente: 'Usuário',
          horario: '10:00',
          texto: 'preciso da cnh do Thomaz',
        },
        {
          id: 'h2',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:00',
          texto: 'Encontrei a CNH DIGITAL THOMAZ. Deseja que eu envie o arquivo?',
          documentoOferecidoId: docCnh ? docCnh.id : 'doc-cnh-fake',
        },
      ],
      intencaoEsperada: 'pedir_arquivo',
      validar: (r) => {
        const temAnexo = (r.anexos?.length || 0) > 0;
        const ok = r.intencaoDetectada === 'pedir_arquivo' && (temAnexo || r.textoResposta?.includes('Aqui está o documento'));
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Anexos: ${r.anexos?.length || 0} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 10B. Confirmação de oferta ("pode mandar")
    {
      id: 11,
      nome: 'Confirmação de oferta ("pode mandar")',
      mensagem: 'pode mandar',
      historico: [
        {
          id: 'h1',
          remetente: 'cliente',
          nomeRemetente: 'Usuário',
          horario: '10:00',
          texto: 'tem o CREA do Thomaz?',
        },
        {
          id: 'h2',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:00',
          texto: 'Encontrei a CERTIDÃO DO CREA. Deseja que eu envie?',
          documentoOferecidoId: docCrea ? docCrea.id : 'doc-crea-fake',
        },
      ],
      intencaoEsperada: 'pedir_arquivo',
      validar: (r) => {
        const temAnexo = (r.anexos?.length || 0) > 0;
        const ok = r.intencaoDetectada === 'pedir_arquivo' && (temAnexo || r.textoResposta?.includes('Aqui está o documento'));
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Anexos: ${r.anexos?.length || 0} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },

    // 10C. Confirmação de oferta ("o primeiro")
    {
      id: 12,
      nome: 'Confirmação de oferta ("o primeiro")',
      mensagem: 'o primeiro',
      historico: [
        {
          id: 'h1',
          remetente: 'cliente',
          nomeRemetente: 'Usuário',
          horario: '10:00',
          texto: 'quais documentos você tem do Thomaz?',
        },
        {
          id: 'h2',
          remetente: 'assistente',
          nomeRemetente: 'VEGA',
          horario: '10:00',
          texto: 'Encontrei 1) CNH e 2) CREA. De qual precisa?',
          documentoOferecidoId: docCnh && docCrea ? `${docCnh.id},${docCrea.id}` : 'doc-1,doc-2',
        },
      ],
      intencaoEsperada: 'pedir_arquivo',
      validar: (r) => {
        const ok = r.intencaoDetectada === 'pedir_arquivo';
        return { ok, detalhe: `Intenção: ${r.intencaoDetectada} | Anexos: ${r.anexos?.length || 0} | Resposta: ${r.textoResposta?.slice(0, 80)}...` };
      },
    },
  ];

  let falhas = 0;
  let sucessos = 0;

  for (const c of casos) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`[TESTE ${c.id}] ${c.nome}`);
    console.log(`Mensagem: "${c.mensagem}"`);
    if (c.historico && c.historico.length > 0) {
      console.log(`Histórico: ${c.historico.length} mensagens anteriores`);
    }

    try {
      const res = await processarMensagemChat({
        mensagemUsuario: c.mensagem,
        historicoRecente: c.historico || [],
        openai,
        documentosDisponiveis: todosDocs,
      });

      const avaliacao = c.validar ? c.validar(res) : { ok: res.intencaoDetectada === c.intencaoEsperada, detalhe: `Intenção: ${res.intencaoDetectada}` };

      if (avaliacao.ok) {
        console.log(`✅ PASSOU: ${avaliacao.detalhe}`);
        sucessos++;
      } else {
        console.error(`❌ FALHOU: ${avaliacao.detalhe}`);
        falhas++;
      }
    } catch (err: any) {
      console.error(`❌ ERRO TÉCNICO:`, err?.message || err);
      falhas++;
    }
  }

  console.log(`\n============================================================`);
  console.log(`RESULTADO DA VARREDURA: ${sucessos} passaram, ${falhas} falharam.`);
  console.log(`============================================================`);

  if (falhas > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
