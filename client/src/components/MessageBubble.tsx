import React, { useState } from 'react';
import { Download, ExternalLink, Calendar, Volume2, Image as ImageIcon, Sparkles, Mic } from 'lucide-react';
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

  return (
    <div
      className={`group flex flex-col mb-3.5 max-w-[85%] md:max-w-[72%] ${
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
          {isAssistente && (
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

        {/* Anexos de Imagem */}
        {mensagem.anexos &&
          mensagem.anexos
            .filter((a) => a.tipo === 'imagem')
            .map((anexo, idx) => (
              <div key={idx} className="mb-2 rounded-lg overflow-hidden max-w-sm bg-black/40 border border-slate-700/50">
                <img
                  src={anexo.url || anexo.base64}
                  alt={anexo.nome}
                  className="w-full h-auto max-h-64 object-cover"
                />
                <div className="p-1.5 text-xs text-slate-400 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  <span className="truncate">{anexo.nome}</span>
                </div>
              </div>
            ))}

        {/* Mensagens de Áudio: Player e Transcrição */}
        {(mensagem.tipoMensagem === 'audio' || mensagem.audioOriginal || Boolean(mensagem.audioStoragePath)) ? (
          <div className="flex flex-col gap-1.5 my-1">
            <AudioPlayerCustom
              audioStoragePath={mensagem.audioStoragePath}
              audioMimeType={mensagem.audioMimeType}
              duracaoSegundos={mensagem.duracaoAudioSegundos}
              audioExpirado={mensagem.audioExpirado}
            />

            {mensagem.texto && (
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
          <div className="leading-relaxed break-words whitespace-pre-wrap">
            {renderizarTextoWhatsApp(mensagem.texto)}
          </div>
        )}

        {/* Opções de Documentos Clicáveis */}
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

        {/* Cards de Anexos / Documentos (PDF/Arquivos) */}
        {mensagem.anexos &&
          mensagem.anexos
            .filter((a) => a.tipo !== 'imagem')
            .map((anexo, idx) => {
              const dataExibicao =
                anexo.dataCadastro ||
                (mensagem.timestamp ? new Date(mensagem.timestamp).toLocaleDateString('pt-BR') : '');

              return (
                <div
                  key={idx}
                  className="mt-2.5 p-3 rounded-xl bg-[#121820] border border-[#263345] flex flex-col gap-2.5"
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

        {/* Player de áudio quando ativado */}
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
