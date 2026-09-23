import React, { useState } from 'react';
import {
  Download,
  ExternalLink,
  Calendar,
  Volume2,
  Image as ImageIcon,
  Sparkles,
  Mic,
  Copy,
  Check,
  QrCode,
  Globe,
  Phone,
  User,
  FileText,
  Info,
} from 'lucide-react';
import { Mensagem } from '../types/chat.js';
import { ASSISTENTE } from '../config/assistente.js';
import { AudioPlayerBubble } from './AudioPlayerBubble.js';
import { AudioPlayerCustom } from './AudioPlayerCustom.js';
import { ModalRaciocinio } from './ModalRaciocinio.js';
import { renderizarTextoWhatsApp } from '../utils/formatadorWhatsApp.js';
import { formatarHorario } from '../utils/dataHoraUtils.js';

interface MessageBubbleProps {
  mensagem: Mensagem;
  activeSpeechId: string | null;
  isPlayingSpeech: boolean;
  isPausedSpeech: boolean;
  speechProgress: number;
  onPlaySpeech: (id: string, text: string) => void;
  onPauseSpeech: () => void;
  onResumeSpeech: () => void;
  onStopSpeech: () => void;
  onSelecionarOpcao?: (documentoId: string, titulo: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  mensagem,
  activeSpeechId,
  isPlayingSpeech,
  isPausedSpeech,
  speechProgress,
  onPlaySpeech,
  onPauseSpeech,
  onResumeSpeech,
  onStopSpeech,
  onSelecionarOpcao,
}) => {
  const isAssistente = mensagem.remetente === 'assistente';
  const isThisSpeechActive = activeSpeechId === mensagem.id;
  const [showPlayer, setShowPlayer] = useState(false);
  const [modalRaciocinioAberto, setModalRaciocinioAberto] = useState(false);
  const [copiadoCampo, setCopiadoCampo] = useState<string | null>(null);

  const toggleVoice = () => {
    if (isThisSpeechActive && isPlayingSpeech) {
      onPauseSpeech();
    } else if (isThisSpeechActive && isPausedSpeech) {
      onResumeSpeech();
    } else {
      setShowPlayer(true);
      onPlaySpeech(mensagem.id, mensagem.texto);
    }
  };

  const copiarTexto = async (texto: string, campoId: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoCampo(campoId);
      setTimeout(() => setCopiadoCampo(null), 2000);
    } catch (e) {
      console.error('Falha ao copiar:', e);
    }
  };

  const temAnexos = mensagem.anexos && mensagem.anexos.length > 0;
  const temAudio =
    mensagem.tipoMensagem === 'audio' ||
    mensagem.audioOriginal ||
    Boolean(mensagem.audioStoragePath);
  const temEstruturado = Boolean(mensagem.dadosEstruturados);
  const temOpcoes = Boolean(mensagem.opcoes && mensagem.opcoes.length > 0);
  const temTextoValido = Boolean(mensagem.texto && mensagem.texto.trim().length > 0);
  const mensagemTotalmenteVazia = !temTextoValido && !temAnexos && !temAudio && !temEstruturado && !temOpcoes;

  return (
    <div
      className={`group flex flex-col mb-3.5 max-w-[88%] md:max-w-[75%] ${
        isAssistente ? 'ml-auto items-end' : 'mr-auto items-start'
      }`}
    >
      <div
        className={`relative px-4 py-2.5 rounded-2xl shadow-sm text-sm transition-all border ${
          isAssistente
            ? 'bg-[#1a2536] border-[#233348] text-slate-100 rounded-tr-sm'
            : 'bg-[#18202b] border-[#222c3a] text-slate-100 rounded-tl-sm'
        }`}
      >
        {/* Cabeçalho da bolha com botão Ouvir no Hover */}
        <div className="flex items-center justify-between gap-4 mb-1 text-[11px] font-medium">
          <span className={isAssistente ? 'text-emerald-400' : 'text-slate-400'}>
            {mensagem.nomeRemetente}
          </span>

          {/* Botão de voz no canto superior: aparece APENAS no hover */}
          {isAssistente && temTextoValido && (
            <button
              onClick={toggleVoice}
              className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/10 flex items-center gap-1 ${
                isThisSpeechActive ? 'text-emerald-400 opacity-100' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`Ouvir ${ASSISTENTE.nome} em voz alta`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span className="text-[10px]">Ouvir</span>
            </button>
          )}
        </div>

        {/* 1. Anexos de Imagem (Recebidos do usuário ou enviados pela VEGA) */}
        {mensagem.anexos &&
          mensagem.anexos
            .filter((a) => a.tipo === 'imagem')
            .map((anexo, idx) => {
              const urlImg = anexo.url || anexo.base64 || '';
              return (
                <div
                  key={`img-${idx}`}
                  className="mb-2.5 rounded-xl overflow-hidden bg-[#111722] border border-slate-700/60 shadow-md max-w-sm"
                >
                  <a
                    href={urlImg}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block relative group/img overflow-hidden cursor-zoom-in"
                    title="Clique para ampliar em nova aba"
                  >
                    <img
                      src={urlImg}
                      alt={anexo.nome || 'Imagem'}
                      className="w-full h-auto max-h-64 object-cover hover:scale-[1.02] transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-medium gap-1.5 backdrop-blur-[2px]">
                      <ExternalLink className="w-4 h-4" />
                      <span>Visualizar imagem</span>
                    </div>
                  </a>

                  {/* Barra de detalhes e ações da imagem */}
                  <div className="p-2 bg-[#141b27] border-t border-slate-700/50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-300 truncate" title={anexo.nome}>
                        {anexo.nome}
                      </span>
                      {anexo.tamanho && (
                        <span className="text-[10px] text-slate-400 shrink-0">({anexo.tamanho})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={urlImg}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 transition-colors"
                        title="Abrir em nova aba"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Abrir</span>
                      </a>
                      <a
                        href={urlImg}
                        download={anexo.nome || 'imagem'}
                        className="p-1 px-2 rounded bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-[11px] font-semibold flex items-center gap-1 transition-colors shadow-sm"
                        title="Baixar imagem"
                      >
                        <Download className="w-3 h-3" />
                        <span>Baixar</span>
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}

        {/* 2. Mensagens de Áudio: Player e Transcrição */}
        {temAudio ? (
          <div className="flex flex-col gap-1.5 my-1">
            <AudioPlayerCustom
              audioStoragePath={mensagem.audioStoragePath}
              audioMimeType={mensagem.audioMimeType}
              duracaoSegundos={mensagem.duracaoAudioSegundos}
              audioExpirado={mensagem.audioExpirado}
            />

            {temTextoValido && (
              <div className="leading-relaxed break-words text-sm pt-1.5 border-t border-slate-700/40">
                <div className="text-[11px] font-semibold text-emerald-400 mb-0.5 flex items-center gap-1">
                  <Mic className="w-3 h-3" />
                  <span>Transcrição:</span>
                </div>
                {renderizarTextoWhatsApp(mensagem.texto)}
              </div>
            )}
          </div>
        ) : (
          /* Mensagem de Texto Normal */
          temTextoValido && (
            <div className="leading-relaxed break-words whitespace-pre-wrap">
              {renderizarTextoWhatsApp(mensagem.texto)}
            </div>
          )
        )}

        {/* 3. Cards Estruturados da Base de Conhecimento (PIX, Link de Sistema, Contato) */}
        {mensagem.dadosEstruturados && (
          <div className="mt-2.5 p-3 rounded-xl bg-[#121820] border border-emerald-500/30 flex flex-col gap-2.5 shadow-sm">
            {/* Caso PIX */}
            {mensagem.dadosEstruturados.tipo === 'pix' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 border-b border-slate-700/50 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                      <QrCode className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-100">
                        {mensagem.dadosEstruturados.titulo || 'Chave PIX Oficial'}
                      </p>
                      {mensagem.dadosEstruturados.tipoChavePix && (
                        <p className="text-[10px] text-slate-400 capitalize">
                          Tipo: {mensagem.dadosEstruturados.tipoChavePix}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {mensagem.dadosEstruturados.chavePix && (
                  <div className="flex flex-col gap-1 bg-[#0b0f15] p-2 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-medium">Chave para transferência:</span>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs font-mono text-emerald-400 select-all break-all">
                        {mensagem.dadosEstruturados.chavePix}
                      </code>
                      <button
                        onClick={() =>
                          copiarTexto(mensagem.dadosEstruturados?.chavePix || '', 'chave-pix')
                        }
                        className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1 shrink-0 transition-colors"
                        title="Copiar chave PIX"
                      >
                        {copiadoCampo === 'chave-pix' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar Chave</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {(mensagem.dadosEstruturados.titularPix || mensagem.dadosEstruturados.bancoPix) && (
                  <div className="text-[11px] text-slate-300 flex flex-wrap gap-x-3 gap-y-1">
                    {mensagem.dadosEstruturados.titularPix && (
                      <span>
                        <strong className="text-slate-400">Titular:</strong> {mensagem.dadosEstruturados.titularPix}
                      </span>
                    )}
                    {mensagem.dadosEstruturados.bancoPix && (
                      <span>
                        <strong className="text-slate-400">Banco:</strong> {mensagem.dadosEstruturados.bancoPix}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Caso Link de Sistema */}
            {mensagem.dadosEstruturados.tipo === 'link' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-100 truncate">
                      {mensagem.dadosEstruturados.titulo || 'Sistema'}
                    </p>
                    {mensagem.dadosEstruturados.link && (
                      <p className="text-[11px] text-emerald-400 font-mono truncate">
                        {mensagem.dadosEstruturados.link}
                      </p>
                    )}
                  </div>
                </div>

                {mensagem.dadosEstruturados.link && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-700/50">
                    <a
                      href={mensagem.dadosEstruturados.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      title="Abrir sistema em nova aba"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Acessar Sistema</span>
                    </a>
                    <button
                      onClick={() =>
                        copiarTexto(mensagem.dadosEstruturados?.link || '', 'link-sistema')
                      }
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors border border-slate-700"
                      title="Copiar URL"
                    >
                      {copiadoCampo === 'link-sistema' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Caso Contato */}
            {mensagem.dadosEstruturados.tipo === 'contato' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-100 truncate">
                      {mensagem.dadosEstruturados.titulo}
                    </p>
                    {mensagem.dadosEstruturados.setor && (
                      <p className="text-[10px] text-slate-400">
                        Setor: {mensagem.dadosEstruturados.setor}
                      </p>
                    )}
                  </div>
                </div>

                {mensagem.dadosEstruturados.telefone && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-700/50">
                    <a
                      href={`https://wa.me/${mensagem.dadosEstruturados.telefone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      title="Chamar no WhatsApp"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Conversar no WhatsApp</span>
                    </a>
                    <button
                      onClick={() =>
                        copiarTexto(mensagem.dadosEstruturados?.telefone || '', 'telefone')
                      }
                      className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors border border-slate-700"
                      title="Copiar telefone"
                    >
                      {copiadoCampo === 'telefone' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Caso Regra ou Geral */}
            {mensagem.dadosEstruturados.tipo === 'regra' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                  <FileText className="w-4 h-4" />
                  <span>{mensagem.dadosEstruturados.titulo}</span>
                </div>
                {mensagem.dadosEstruturados.conteudo && (
                  <div className="text-xs text-slate-300 leading-relaxed bg-[#0c1118] p-2 rounded-lg border border-slate-800/80">
                    {renderizarTextoWhatsApp(mensagem.dadosEstruturados.conteudo)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 4. Opções de Documentos Clicáveis */}
        {mensagem.opcoes && mensagem.opcoes.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-700/40 space-y-1.5">
            <p className="text-[11px] text-slate-400 font-medium">Selecione uma opção:</p>
            <div className="flex flex-col gap-1">
              {mensagem.opcoes.map((opcao) => (
                <button
                  key={opcao.id}
                  onClick={() => onSelecionarOpcao && onSelecionarOpcao(opcao.id, opcao.titulo)}
                  className="text-left px-3 py-1.5 rounded-lg bg-[#121820] hover:bg-emerald-500/10 border border-[#263345] hover:border-emerald-500/30 text-xs text-slate-200 transition-colors"
                >
                  {opcao.titulo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. Cards de Anexos / Documentos (PDF, etc. - Enviados pela VEGA ou Recebidos do usuário) */}
        {mensagem.anexos &&
          mensagem.anexos
            .filter((a) => a.tipo !== 'imagem')
            .map((anexo, idx) => {
              const dataExibicao =
                anexo.dataCadastro ||
                (mensagem.timestamp ? new Date(mensagem.timestamp).toLocaleDateString('pt-BR') : '');

              return (
                <div
                  key={`doc-${idx}`}
                  className="mt-2.5 p-3 rounded-xl bg-[#121820] border border-[#263345] flex flex-col gap-2.5 shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      📄
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-100 truncate" title={anexo.titulo || anexo.nome}>
                        {anexo.titulo || anexo.nome}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                        {dataExibicao && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-emerald-400" />
                            {dataExibicao}
                          </span>
                        )}
                        {anexo.tamanho && (
                          <>
                            <span>•</span>
                            <span>{anexo.tamanho}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ações: Abrir e Baixar */}
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-700/40">
                    <a
                      href={(anexo.url || '').trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1 px-2.5 rounded-lg bg-[#18202b] hover:bg-[#202937] text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-slate-700/50"
                      title="Visualizar documento em nova aba"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir</span>
                    </a>

                    <a
                      href={(anexo.url || '').trim()}
                      download={(anexo.nome || '').trim()}
                      className="flex-1 py-1 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      title="Baixar arquivo para o computador"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar</span>
                    </a>
                  </div>
                </div>
              );
            })}

        {/* 6. Blindagem contra mensagens vazias ou não exibíveis ("Nada pode ficar invisível") */}
        {mensagemTotalmenteVazia && (
          <div className="flex items-center gap-2 text-xs text-slate-400 italic py-1">
            <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>[Mensagem recebida sem conteúdo de texto exibível]</span>
          </div>
        )}

        {/* Player de áudio TTS quando ativado */}
        {(isThisSpeechActive || showPlayer) && (
          <AudioPlayerBubble
            isPlaying={isThisSpeechActive && isPlayingSpeech}
            isPaused={isThisSpeechActive && isPausedSpeech}
            progress={isThisSpeechActive ? speechProgress : 0}
            onPlay={() => {
              setShowPlayer(true);
              onPlaySpeech(mensagem.id, mensagem.texto);
            }}
            onPause={onPauseSpeech}
            onResume={onResumeSpeech}
            onStop={() => {
              onStopSpeech();
              setShowPlayer(false);
            }}
          />
        )}

        {/* Rodapé da bolha: Horário e Botão Ver Raciocínio (APENAS no Hover) */}
        <div className="flex items-center justify-between gap-3 mt-1.5 pt-0.5 text-[10px] text-slate-500">
          {isAssistente ? (
            <button
              onClick={() => setModalRaciocinioAberto(true)}
              className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 rounded transition-colors"
              title="Ver etapas de raciocínio da VEGA"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Ver raciocínio</span>
            </button>
          ) : (
            <div />
          )}
          <span className="font-mono text-[10px]">{formatarHorario(mensagem.timestamp || mensagem.horario)}</span>
        </div>
      </div>

      {/* Modal de Raciocínio */}
      {isAssistente && (
        <ModalRaciocinio
          isOpen={modalRaciocinioAberto}
          onClose={() => setModalRaciocinioAberto(false)}
          mensagemId={mensagem.id}
          rastroInicial={mensagem.rastro}
        />
      )}
    </div>
  );
};
