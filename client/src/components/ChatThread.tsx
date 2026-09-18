import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  MicOff,
  Circle,
  X,
  FileText,
  Image as ImageIcon,
  FolderOpen,
} from 'lucide-react';
import { Conversa, Anexo } from '../types/chat.js';
import { MessageBubble } from './MessageBubble.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis.js';
import { ASSISTENTE } from '../config/assistente.js';
import { renderizarTextoWhatsApp } from '../utils/formatadorWhatsApp.js';

interface ChatThreadProps {
  conversa: Conversa;
  emStreaming: boolean;
  textoStreaming: string;
  onEnviarMensagem: (texto: string, anexos?: Anexo[]) => Promise<void>;
  onSelecionarOpcaoDocumento?: (documentoId: string, titulo: string) => Promise<void>;
  onNavegarParaDocumentos?: () => void;
}

function getIniciais(nome: string): string {
  if (!nome) return '??';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  conversa,
  emStreaming,
  textoStreaming,
  onEnviarMensagem,
  onSelecionarOpcaoDocumento,
  onNavegarParaDocumentos,
}) => {
  const [textoInput, setTextoInput] = useState('');
  const [anexosPendentes, setAnexosPendentes] = useState<Anexo[]>([]);

  const mensagensEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hook de Gravação de Voz (STT)
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: micSuportado,
  } = useSpeechRecognition();

  // Hook de Síntese de Voz (TTS)
  const {
    play: playSpeech,
    pause: pauseSpeech,
    resume: resumeSpeech,
    stop: stopSpeech,
    activeMessageId,
    isPlaying: isPlayingSpeech,
    isPaused: isPausedSpeech,
    progress: speechProgress,
  } = useSpeechSynthesis();

  // Concatena a transcrição da fala ao input
  useEffect(() => {
    if (transcript) {
      setTextoInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  }, [transcript]);

  // Rola para a mensagem mais recente
  const rolarParaFinal = useCallback((smooth = true) => {
    mensagensEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  useEffect(() => {
    rolarParaFinal(true);
  }, [conversa.mensagens.length, textoStreaming, rolarParaFinal]);

  // Ajusta altura do textarea conforme o texto cresce
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [textoInput]);

  // Manipulador de seleção de arquivo para envio direto no chat
  const handleSelecionarArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();

    reader.onload = () => {
      const base64 = reader.result as string;
      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
      const isImg = file.type.startsWith('image/');

      const novoAnexo: Anexo = {
        tipo: isPdf ? 'pdf' : isImg ? 'imagem' : 'arquivo',
        url: '',
        nome: file.name,
        titulo: file.name,
        tamanho: `${(file.size / 1024).toFixed(1)} KB`,
        base64,
        mimeType: file.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
      };

      setAnexosPendentes((prev) => [...prev, novoAnexo]);
    };

    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removerAnexo = (index: number) => {
    setAnexosPendentes((prev) => prev.filter((_, i) => i !== index));
  };

  // Envio de mensagem
  const handleEnviar = async () => {
    const textoLimpo = textoInput.trim();
    if (!textoLimpo && anexosPendentes.length === 0) return;
    if (emStreaming) return;

    if (isListening) {
      stopListening();
    }

    const anexosParaEnviar = [...anexosPendentes];
    setTextoInput('');
    setAnexosPendentes([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await onEnviarMensagem(textoLimpo, anexosParaEnviar.length > 0 ? anexosParaEnviar : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnviar();
    }
  };

  const toggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const nivelAcesso = conversa.contato.nivelAcesso || conversa.contato.ficha?.nivelAcesso || 'geral';
  const cargo = conversa.contato.cargo || conversa.contato.ficha?.cargo || 'Colaborador';

  return (
    <main className="flex-1 h-full flex flex-col bg-wa-chat relative">
      {/* Header da Conversa */}
      <header className="h-[60px] px-4 bg-wa-panel border-b border-wa-border flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm text-white flex-shrink-0 shadow"
            style={{ backgroundColor: conversa.contato.avatarCor || '#00a884' }}
          >
            {getIniciais(conversa.contato.nome)}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm text-wa-textPrimary truncate flex items-center gap-2">
              <span>{conversa.contato.nome}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-wa-bg text-wa-greenLight border border-wa-border font-medium">
                {cargo}
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                nivelAcesso === 'diretoria'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-wa-border text-wa-textMuted'
              }`}>
                {nivelAcesso}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-wa-textSecondary">{conversa.contato.telefone}</span>
              <span className="text-wa-border">•</span>
              {emStreaming ? (
                <span className="text-wa-greenLight font-medium flex items-center gap-1 text-[11px] animate-pulse">
                  <span>{ASSISTENTE.nome} está processando</span>
                  <span className="flex gap-0.5">
                    <span className="animate-dot-1">•</span>
                    <span className="animate-dot-2">•</span>
                    <span className="animate-dot-3">•</span>
                  </span>
                </span>
              ) : (
                <span className="text-wa-green font-medium flex items-center gap-1 text-[11px]">
                  <Circle className="w-2 h-2 fill-wa-green text-wa-green" />
                  <span>pronta para busca</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tag Delta Plan */}
        <div className="hidden sm:flex items-center gap-2 bg-wa-bg/60 px-3 py-1 rounded-full border border-wa-border">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-xs text-wa-textSecondary font-medium">
            Cofre Delta Plan • VEGA Ativa
          </span>
        </div>
      </header>

      {/* Área de Mensagens com Fundo WhatsApp */}
      <div className="flex-1 overflow-y-auto p-4 wa-chat-pattern">
        <div className="max-w-4xl mx-auto flex flex-col justify-end min-h-full">
          {/* Mensagens históricas */}
          {conversa.mensagens.map((msg) => (
            <MessageBubble
              key={msg.id}
              mensagem={msg}
              activeSpeechId={activeMessageId}
              isPlayingSpeech={isPlayingSpeech}
              isPausedSpeech={isPausedSpeech}
              speechProgress={speechProgress}
              onPlaySpeech={playSpeech}
              onPauseSpeech={pauseSpeech}
              onResumeSpeech={resumeSpeech}
              onStopSpeech={stopSpeech}
              onSelecionarOpcao={onSelecionarOpcaoDocumento}
            />
          ))}

          {/* Mensagem em streaming do assistente */}
          {emStreaming && (() => {
            const textoStreamingLimpo = (textoStreaming || '')
              .replace(/```nao_encontrado[\s\S]*?```/gi, '')
              .replace(/```documento[\s\S]*?```/gi, '')
              .replace(/```(nao_encontrado|documento)[\s\S]*$/gi, '')
              .trim();

            return (
              <div className="flex flex-col mb-3.5 max-w-[85%] md:max-w-[75%] ml-auto items-end animate-fadeIn">
                <div className="relative px-3.5 py-2 rounded-2xl shadow-md text-sm bg-wa-bubbleAssistant text-wa-textPrimary rounded-tr-none">
                  <div className="flex items-center justify-between gap-3 mb-1 text-[11px] font-medium opacity-75">
                    <span className="text-emerald-300">{ASSISTENTE.nomeExibicao}</span>
                    <span className="text-emerald-200 text-[10px] animate-pulse">buscando no cofre...</span>
                  </div>
                  <div className="leading-relaxed break-words text-sm">
                    {textoStreamingLimpo ? renderizarTextoWhatsApp(textoStreamingLimpo) : '...'}
                  </div>
                </div>
              </div>
            );
          })()}

          <div ref={mensagensEndRef} />
        </div>
      </div>

      {/* Prévia de Anexos Pendentes */}
      {anexosPendentes.length > 0 && (
        <div className="px-4 py-2 bg-wa-panel border-t border-wa-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {anexosPendentes.map((anexo, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-3 py-1.5 bg-wa-bg rounded-lg border border-wa-border text-xs text-wa-textPrimary"
              >
                {anexo.tipo === 'pdf' ? (
                  <FileText className="w-4 h-4 text-rose-400" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-sky-400" />
                )}
                <span className="truncate max-w-[160px] font-medium">{anexo.titulo || anexo.nome}</span>
                <span className="text-[10px] text-wa-textSecondary">({anexo.tamanho})</span>
                <button
                  onClick={() => removerAnexo(idx)}
                  className="p-0.5 rounded hover:bg-white/10 text-wa-textSecondary hover:text-rose-400 transition-colors"
                  title="Remover anexo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {onNavegarParaDocumentos && (
            <div className="text-[11px] text-wa-textMuted flex items-center gap-1.5 self-end sm:self-center">
              <span>Quer salvar no cofre definitivo?</span>
              <button
                type="button"
                onClick={onNavegarParaDocumentos}
                className="text-wa-greenLight hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                <FolderOpen className="w-3 h-3 text-wa-green" />
                <span>Base da VEGA &gt; Documentos</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Barra de Status do Microfone se estiver gravando */}
      {isListening && (
        <div className="px-4 py-1.5 bg-rose-500/20 border-t border-rose-500/30 flex items-center justify-between text-xs text-rose-300 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
            <span>Microfone ativo (pt-BR). Dite sua solicitação para a VEGA...</span>
          </div>
          <button
            onClick={stopListening}
            className="text-[11px] px-2 py-0.5 bg-rose-600 text-white rounded font-medium hover:bg-rose-700"
          >
            Finalizar fala
          </button>
        </div>
      )}

      {/* Rodapé / Input de Mensagem */}
      <footer className="p-3 bg-wa-panel border-t border-wa-border flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleSelecionarArquivo}
          accept="application/pdf,image/*"
          className="hidden"
        />

        {/* Botão de Anexo (Clipe) */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivo para a VEGA analisar nesta conversa"
          className="p-2.5 rounded-full text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-panelHover transition-colors flex-shrink-0"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Textarea multilinhas */}
        <div className="flex-1 bg-wa-bg rounded-xl border border-transparent focus-within:border-wa-green/60 transition-colors px-3 py-1.5 flex items-center">
          <textarea
            ref={textareaRef}
            rows={1}
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Consulte um documento ou arquivo da Delta Plan..."
            className="w-full bg-transparent text-sm text-wa-textPrimary placeholder:text-wa-textMuted focus:outline-none resize-none max-h-32 py-1 leading-relaxed"
          />
        </div>

        {/* Botão de Microfone */}
        {micSuportado && (
          <button
            onClick={toggleMic}
            title={isListening ? 'Parar gravação de voz' : 'Falar solicitação'}
            className={`p-2.5 rounded-full transition-all flex-shrink-0 ${
              isListening
                ? 'bg-rose-600 text-white shadow-lg animate-pulse'
                : 'text-wa-textSecondary hover:text-wa-textPrimary hover:bg-wa-panelHover'
            }`}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}

        {/* Botão de Envio */}
        <button
          onClick={handleEnviar}
          disabled={(!textoInput.trim() && anexosPendentes.length === 0) || emStreaming}
          className="p-2.5 rounded-full bg-wa-green hover:bg-wa-greenHover text-slate-950 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex-shrink-0 shadow"
          title="Enviar mensagem"
        >
          <Send className="w-5 h-5" />
        </button>
      </footer>
    </main>
  );
};
