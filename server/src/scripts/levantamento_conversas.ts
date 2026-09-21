import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../db/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function levantarConversas() {
  const supabase = getSupabaseClient();

  console.log('Consultando tabela "usuarios"...');
  const { data: usuarios, error: errUsuarios } = await supabase
    .from('usuarios')
    .select('*');

  if (errUsuarios) {
    console.error('Erro ao consultar usuarios:', errUsuarios);
  } else {
    console.log(`Total de usuários autorizados cadastrados: ${usuarios?.length || 0}`);
    console.log(JSON.stringify(usuarios, null, 2));
  }

  console.log('\nConsultando tabela "conversas"...');
  const { data: conversas, error: errConversas } = await supabase
    .from('conversas')
    .select('id, contato, nao_lidas, ultima_atualizacao, mensagens, created_at')
    .order('ultima_atualizacao', { ascending: false });

  if (errConversas) {
    console.error('Erro ao consultar conversas:', errConversas);
    return;
  }

  console.log(`Total de conversas encontradas no Supabase: ${conversas?.length || 0}\n`);

  const relatorio = (conversas || []).map((c: any, index: number) => {
    const mensagens = Array.isArray(c.mensagens) ? c.mensagens : [];
    const totalMensagens = mensagens.length;
    const primeiraMensagem = totalMensagens > 0 ? mensagens[0] : null;
    const ultimaMensagem = totalMensagens > 0 ? mensagens[totalMensagens - 1] : null;
    const temAudio = mensagens.some((m: any) => m.tipoMensagem === 'audio' || m.audioOriginal);

    // Critério para identificar se é WhatsApp Real ou Teste/Seed
    // Conversas do WhatsApp real são criadas com id `wa-<numero>` ou tem mensagens com IDs da Evolution (`wa-msg-...` ou hashes do WhatsApp)
    const isWaId = typeof c.id === 'string' && c.id.startsWith('wa-');
    const contatoTelefone = c.contato?.telefone || '';
    const contatoNome = c.contato?.nome || '';
    const matchUsuario = (usuarios || []).find((u: any) => 
      (u.numero && contatoTelefone.includes(u.numero.replace(/\D/g, ''))) ||
      (u.lid && (c.id.includes(u.lid) || contatoTelefone.includes(u.lid)))
    );

    const origem = isWaId || matchUsuario ? 'WhatsApp Real (Evolution)' : 'Teste / Seed do Painel';

    return {
      indice: index + 1,
      id: c.id,
      origem,
      contatoNome,
      contatoTelefone,
      cargo: c.contato?.cargo,
      setor: c.contato?.setor,
      nivelAcesso: c.contato?.nivelAcesso,
      totalMensagens,
      temAudio,
      ultimaAtualizacao: c.ultima_atualizacao || c.updated_at,
      ultimaMensagemTexto: ultimaMensagem ? (ultimaMensagem.texto?.slice(0, 80) || '(sem texto)') : '(vazia)',
      ultimaMensagemRemetente: ultimaMensagem?.remetente,
      ultimaMensagemHorario: ultimaMensagem?.horario,
    };
  });

  console.log('| # | ID Conversa | Origem | Contato | Telefone | Nível | Msgs | Áudio | Última Mensagem | Última Atualização |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  relatorio.forEach((r: any) => {
    console.log(`| ${r.indice} | ${r.id} | **${r.origem}** | ${r.contatoNome} | ${r.contatoTelefone} | ${r.nivelAcesso} | ${r.totalMensagens} | ${r.temAudio ? 'Sim 🎙️' : 'Não'} | "${r.ultimaMensagemTexto.replace(/\|/g, '')}" | ${r.ultimaAtualizacao} |`);
  });
}

levantarConversas().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
