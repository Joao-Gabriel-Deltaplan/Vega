import { useState, useEffect, useRef, useCallback } from 'react';

export function useSpeechSynthesis() {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const totalLengthRef = useRef<number>(1);
  const progressIntervalRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;

      const carregarVozes = () => {
        voicesRef.current = window.speechSynthesis.getVoices();
      };

      carregarVozes();
      window.speechSynthesis.onvoiceschanged = carregarVozes;
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    setIsPlaying(false);
    setIsPaused(false);
    setActiveMessageId(null);
    setProgress(0);
  }, []);

  const pause = useCallback(() => {
    if (synthRef.current && isPlaying && !isPaused) {
      synthRef.current.pause();
      setIsPaused(true);
    }
  }, [isPlaying, isPaused]);

  const resume = useCallback(() => {
    if (synthRef.current && isPaused) {
      synthRef.current.resume();
      setIsPaused(false);
    }
  }, [isPaused]);

  const play = useCallback((messageId: string, text: string) => {
    if (!synthRef.current) return;

    // Se já estiver tocando a mesma mensagem, alterna para pause ou resume
    if (activeMessageId === messageId) {
      if (isPaused) {
        resume();
        return;
      } else if (isPlaying) {
        pause();
        return;
      }
    }

    // Cancela qualquer reprodução anterior
    stop();

    // Limpa marcadores de markdown para voz mais natural
    const textoLimpo = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_#>`-]/g, '')
      .trim();

    if (!textoLimpo) return;

    const utterance = new SpeechSynthesisUtterance(textoLimpo);
    utteranceRef.current = utterance;
    totalLengthRef.current = Math.max(1, textoLimpo.length);

    // Tenta selecionar voz pt-BR
    const vozPt = voicesRef.current.find(
      (v) => v.lang === 'pt-BR' || v.lang.startsWith('pt')
    );
    if (vozPt) {
      utterance.voice = vozPt;
    }
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05; // Levemente mais dinâmico
    utterance.pitch = 1.0;

    // Rastreamento de progresso por caractere pronunciado
    utterance.onboundary = (event) => {
      if (event.charIndex !== undefined && totalLengthRef.current > 0) {
        const perc = Math.min(100, Math.round((event.charIndex / totalLengthRef.current) * 100));
        setProgress(perc);
      }
    };

    utterance.onstart = () => {
      setActiveMessageId(messageId);
      setIsPlaying(true);
      setIsPaused(false);
      setProgress(5);
    };

    utterance.onend = () => {
      setProgress(100);
      setTimeout(() => {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveMessageId(null);
        setProgress(0);
      }, 300);
    };

    utterance.onerror = (e) => {
      console.warn('Erro no SpeechSynthesis:', e);
      stop();
    };

    synthRef.current.speak(utterance);
  }, [activeMessageId, isPlaying, isPaused, stop, pause, resume]);

  return {
    activeMessageId,
    isPlaying,
    isPaused,
    progress,
    play,
    pause,
    resume,
    stop,
    isSupported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  };
}
