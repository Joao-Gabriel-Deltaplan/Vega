import React, { useState } from 'react';
import { FileText, Download, ExternalLink, Calendar, Volume2, Image as ImageIcon, Sparkles, Mic } from 'lucide-react';
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
      className={`flex flex-col mb-3.5 max-w-[85%] md:max-w-[75%] ${
        isAssistente ? 'ml-auto items-end' : 'mr-auto items-start'
      }`}
    >
      <div
        className={`relative px-3.5 py-2 rounded-2xl shadow-md text-sm transition-all ${
          isAssistente
            ? 'bg-wa-bubbleAssistant text-wa-textPrimary rounded-tr-none'
            : 'bg-wa-bubbleClient text-wa-textPrimary rounded-tl-none'
        }`}
      >
        {/* Cabeçalho da bolha (Nome do remetente) */}
        <div className="flex items-center justify-between gap-3 mb-1 text-[11px] font-medium opacity-75">
          <span className={isAssistente ? 'text-emerald-300' : 'text-sky-300'}>
            {mensagem.nomeRemetente}
          </span>
          {/* Botão de voz no canto da bolha do assistente */}
          {isAssistente && (
            <button
              onClick={toggleVoice}
              className={`p-1 rounded-full hover:bg-black/20 transition-colors flex items-center gap-1 ${
                isThisSpeechActive ? 'text-wa-greenLight' : 'text-wa-textSecondary hover:text-white'
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
              <div key={idx} className="mb-2 rounded-lg overflow-hidden max-w-sm bg-black/30 border border-white/10">
                <img
                  src={anexo.url || anexo.base64}
                  alt={anexo.nome}
                  className="w-full h-auto max-h-64 object-cover"
                />
                <div className="p-1.5 text-xs text-wa-textSecondary flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  <span className="truncate">{anexo.nome}</span>
                </div>
              </div>
            ))}

        {/* Mensagens de Áudio: Player de Áudio Original e Transcrição */}
        {(mensagem.tipoMensagem === 'audio' || mensagem.audioOriginal || Boolean(mensagem.audioStoragePath)) ? (
          <div className="flex flex-col gap-1.5 my-1">
            <AudioPlayerCustom
              audioStoragePath={mensagem.audioStoragePath}
              audioMimeType={mensagem.audioMimeType}
              duracaoSegundos={mensagem.duracaoAudioSegundos}
              audioExpirado={mensagem.audioExpirado}
            />

            {mensagem.texto && (
              <div className="leading-relaxed break-words text-sm pt-1 border-t border-white/10">
                <div className="text-[11px] font-semibold text-emerald-400 mb-0.5 flex items-center gap-1">
                  <Mic className="w-3 h-3" />
                  <span>Transcrição:</span>
                </div>
                {renderizarTextoWhatsApp(mensagem.texto)}
              </div>
            )}
          </div>
        ) : (
          /* Conteúdo textual padrão */
          mensagem.texto && (
            <div className="leading-relaxed break-words text-sm">
              {renderizarTextoWhatsApp(mensagem.texto)}
            </div>
          )
        )}

        {/* Opções Clicáveis de Documentos (Desambiguação) */}
        {mensagem.opcoes && mensagem.opcoes.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {mensagem.opcoes.map((opcao) => (
              <button
                key={opcao.id}
                onClick={() => onSelecionarOpcao?.(opcao.id, opcao.titulo)}
                className="w-full text-left px-3 py-2 rounded-lg bg-black/40 hover:bg-black/60 border border-emerald-500/30 hover:border-emerald-400 text-xs font-medium text-emerald-300 transition-all flex items-center justify-between group active:scale-[0.99]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="truncate">{opcao.titulo}</span>
                </div>
                <span className="text-[10px] text-white/50 group-hover:text-emerald-300">Entregar &rarr;</span>
              </button>
            ))}
          </div>
        )}

        {/* Anexos de PDF e Arquivos do Cofre de Documentos */}
        {mensagem.anexos &&
          mensagem.anexos
            .filter((a) => a.tipo === 'pdf' || a.tipo === 'arquivo')
            .map((anexo, idx) => {
              const tituloExibicao =
                anexo.titulo ||
                anexo.nome.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
              const dataExibicao =
                anexo.dataCadastro || new Date().toLocaleDateString('pt-BR');

              return (
                <div
                  key={idx}
                  className="mt-2.5 p-3 rounded-xl bg-black/35 border border-white/10 flex flex-col gap-2.5 hover:bg-black/45 transition-colors shadow-inner"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Título Cadastrado do Documento */}
                      <p className="text-xs font-bold text-white truncate leading-snug">
                        {tituloExibicao}
                      </p>
                      {/* Titular do Documento */}
                      {anexo.titular && (
                        <p className="text-[11px] font-semibold text-emerald-400 truncate mt-0.5">
                          Titular: {anexo.titular}
                        </p>
                      )}
                      {/* Nome original do arquivo */}
                      <p className="text-[11px] text-white/70 truncate mt-0.5">
                        {anexo.nome}
                      </p>
                      {/* Data de cadastro e tamanho */}
                      <div className="flex items-center gap-2 text-[10px] text-white/50 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-wa-greenLight" />
                          {dataExibicao}
                        </span>
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
                  <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                    <a
                      href={(anexo.url || '').trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors active:scale-98"
                      title="Visualizar documento em nova aba"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir</span>
                    </a>

                    <a
                      href={(anexo.url || '').trim()}
                      download={(anexo.nome || '').trim()}
                      className="flex-1 py-1 px-2.5 rounded-lg bg-wa-green hover:bg-wa-greenHover text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow active:scale-98"
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

        {/* Rodapé da bolha (Horário e Botão Ver Raciocínio) */}
        <div className="flex items-center justify-between gap-3 mt-1.5 pt-0.5 text-[10px] text-wa-textMuted">
          {isAssistente ? (
            <button
              onClick={() => setModalRaciocinioAberto(true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-950/40 px-1.5 py-0.5 rounded transition-colors"
              title="Ver raciocínio e etapas desta resposta"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Ver raciocínio</span>
            </button>
          ) : (
            <div />
          )}
          <span>{formatarHorario(mensagem.timestamp || mensagem.horario)}</span>
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
