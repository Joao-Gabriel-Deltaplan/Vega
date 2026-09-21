import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Clock, Mic, MicOff } from 'lucide-react';

interface AudioPlayerCustomProps {
  audioStoragePath?: string;
  audioMimeType?: string;
  duracaoSegundos?: number;
  audioExpirado?: boolean;
}

export const AudioPlayerCustom: React.FC<AudioPlayerCustomProps> = ({
  audioStoragePath,
  duracaoSegundos,
  audioExpirado: propAudioExpirado,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(duracaoSegundos || 0);
  const [velocidade, setVelocidade] = useState<number>(1);
  const [expirado, setExpirado] = useState(Boolean(propAudioExpirado));
  const [carregando, setCarregando] = useState(false);

  // URL protegida pela sessão do painel (cookies httpOnly enviados automaticamente)
  const audioSrc = audioStoragePath
    ? `/api/audios/${encodeURIComponent(audioStoragePath).replace(/%2F/g, '/')}`
    : undefined;

  useEffect(() => {
    if (propAudioExpirado) {
      setExpirado(true);
    }
  }, [propAudioExpirado]);

  // Formata segundos para MM:SS
  const formatarTempo = (segundos: number): string => {
    if (isNaN(segundos) || segundos < 0) return '0:00';
    const m = Math.floor(segundos / 60);
    const s = Math.floor(segundos % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const alternarPlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setCarregando(true);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setCarregando(false);
        })
        .catch((err) => {
          console.warn('[AudioPlayer] Erro ao reproduzir:', err);
          setIsPlaying(false);
          setCarregando(false);
        });
    }
  };

  const aoMudarProgresso = (e: React.ChangeEvent<HTMLInputElement>) => {
    const novoTempo = parseFloat(e.target.value);
    setCurrentTime(novoTempo);
    if (audioRef.current) {
      audioRef.current.currentTime = novoTempo;
    }
  };

  const alternarVelocidade = () => {
    const velocidades = [1, 1.5, 2];
    const proximoIdx = (velocidades.indexOf(velocidade) + 1) % velocidades.length;
    const novaVel = velocidades[proximoIdx];
    setVelocidade(novaVel);
    if (audioRef.current) {
      audioRef.current.playbackRate = novaVel;
    }
  };

  const aoTerminar = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const aoErro = (e: any) => {
    console.warn('[AudioPlayer] Áudio expirado no servidor ou erro de streaming:', e);
    setIsPlaying(false);
    setCarregando(false);
    setExpirado(true);
  };

  // CASO A: Mensagens sem caminho gravado (anteriores à funcionalidade ou com falha no salvamento)
  if (!audioStoragePath) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 my-1.5 rounded-xl bg-slate-800/50 border border-white/10 text-slate-300 text-xs font-medium">
        <MicOff className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-white/90 font-semibold">Áudio não disponível</span>
          <span className="text-[10px] text-white/50 font-normal">
            Arquivo de áudio original não gravado para esta mensagem.
          </span>
        </div>
      </div>
    );
  }

  // CASO B: Mensagens com caminho, mas cujo arquivo no Storage passou de 30 dias (expirado / 404)
  if (expirado) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 my-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-medium">
        <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <div className="flex flex-col">
          <span className="font-semibold text-amber-300">Áudio expirado</span>
          <span className="text-[10px] text-amber-400/80 font-normal">
            Arquivos de áudio originais são mantidos por até 30 dias.
          </span>
        </div>
      </div>
    );
  }

  const progressoPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 p-2.5 my-1.5 rounded-2xl bg-black/35 border border-white/10 shadow-inner max-w-sm">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && !isNaN(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={aoTerminar}
        onError={aoErro}
      />

      <div className="flex items-center gap-3">
        {/* Botão Play / Pause */}
        <button
          onClick={alternarPlayPause}
          disabled={carregando}
          className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center flex-shrink-0 transition-transform active:scale-95 shadow-md"
          title={isPlaying ? 'Pausar áudio' : 'Ouvir áudio original'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-slate-950" />
          ) : (
            <Play className="w-4 h-4 fill-slate-950 ml-0.5" />
          )}
        </button>

        {/* Barra de Progresso e Tempo */}
        <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
          <div className="relative w-full flex items-center h-4">
            <input
              type="range"
              min="0"
              max={duration > 0 ? duration : 100}
              step="0.1"
              value={currentTime}
              onChange={aoMudarProgresso}
              className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-400 focus:outline-hidden"
              style={{
                background: `linear-gradient(to right, #10b981 ${progressoPercent}%, rgba(255,255,255,0.2) ${progressoPercent}%)`,
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/60 font-mono">
            <span>{formatarTempo(currentTime)}</span>
            <span className="flex items-center gap-1 text-[10px] text-white/40">
              <Mic className="w-2.5 h-2.5" />
              {formatarTempo(duration)}
            </span>
          </div>
        </div>

        {/* Botão de Velocidade */}
        <button
          onClick={alternarVelocidade}
          className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-[10px] font-bold transition-colors flex-shrink-0"
          title="Alternar velocidade (1x / 1.5x / 2x)"
        >
          {velocidade}x
        </button>
      </div>
    </div>
  );
};
