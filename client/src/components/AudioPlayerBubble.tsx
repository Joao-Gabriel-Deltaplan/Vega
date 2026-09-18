import React from 'react';
import { Play, Pause, Square, Volume2 } from 'lucide-react';
import { ASSISTENTE } from '../config/assistente.js';

interface AudioPlayerBubbleProps {
  isPlaying: boolean;
  isPaused: boolean;
  progress: number;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export const AudioPlayerBubble: React.FC<AudioPlayerBubbleProps> = ({
  isPlaying,
  isPaused,
  progress,
  onPlay,
  onPause,
  onResume,
  onStop,
}) => {
  return (
    <div className="mt-2.5 p-2 bg-black/25 rounded-lg border border-white/10 flex items-center gap-3">
      {/* Botão Play / Pause */}
      <button
        onClick={isPlaying ? (isPaused ? onResume : onPause) : onPlay}
        className="w-8 h-8 rounded-full bg-wa-green hover:bg-wa-greenHover text-slate-950 flex items-center justify-center transition-transform active:scale-95 flex-shrink-0 shadow"
        title={isPlaying && !isPaused ? 'Pausar áudio' : 'Ouvir resposta'}
      >
        {isPlaying && !isPaused ? (
          <Pause className="w-4 h-4 fill-slate-950" />
        ) : (
          <Play className="w-4 h-4 ml-0.5 fill-slate-950" />
        )}
      </button>

      {/* Barra de Progresso */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="flex items-center justify-between text-[11px] text-white/80 mb-1">
          <span className="flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-wa-greenLight" />
            {isPlaying
              ? isPaused
                ? 'Pausado'
                : `Reproduzindo voz da ${ASSISTENTE.nome}...`
              : `Ouvir ${ASSISTENTE.nome} em voz alta (pt-BR)`}
          </span>
          <span>{isPlaying ? `${progress}%` : ''}</span>
        </div>
        <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-wa-greenLight h-full rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Botão Parar */}
      {isPlaying && (
        <button
          onClick={onStop}
          className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          title="Parar áudio"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
      )}
    </div>
  );
};
