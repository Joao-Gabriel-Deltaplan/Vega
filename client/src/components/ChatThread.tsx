import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  MicOff,
  X,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { Conversa, Anexo } from '../types/chat.js';
import { MessageBubble } from './MessageBubble.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis.js';
import { ASSISTENTE } from '../config/assistente.js';
import { renderizarTextoWhatsApp } from '../utils/formatadorWhatsApp.js';
import { obterPaletaAvatar, obterIniciais } from '../utils/avatarUtils.js';
import { deveExibirSeparadorData, formatarRotuloData } from '../utils/dataSeparadorUtils.js';

interface ChatThreadProps {
  conversa: Conversa;
  emStreaming: boolean;
  textoStreaming: string;
  onEnviarMensagem: (texto: string, anexos?: Anexo[]) => Promise<void>;
  onSelecionarOpcaoDocumento?: (documentoId: string, titulo: string) => Promise<void>;
  onNavegarParaDocumentos?: () => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  conversa,
  emStreaming,
  textoStreaming,
  onEnviarMensagem,
  onSelecionarOpcaoDocumento,
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
  const isAdmin = nivelAcesso === 'diretoria';
  const paletaAvatar = obterPaletaAvatar(conversa.contato.nome);

  return (
    <main className="flex-1 h-full flex flex-col bg-[#0b0f14] relative">
      {/* Header Limpo da Conversa */}
      <header className="h-[60px] px-5 bg-[#121820] border-b border-[#1e2633] flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          {/* Avatar com cor suave */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-xs flex-shrink-0 shadow-inner"
            style={{
              backgroundColor: paletaAvatar.bg,
              color: paletaAvatar.text,
              border: `1px solid ${paletaAvatar.border}`,
            }}
          >
            {obterIniciais(conversa.contato.nome)}
          </div>

          {/* Nome, Telefone e Único Selo de Perfil */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm text-slate-100 truncate">
                {conversa.contato.nome}
              </h2>

              {/* Único selo de perfil: [Admin] ou [Comum] */}
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider ${
                  isAdmin
                    ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                    : 'bg-slate-800 text-slate-400 border border-slate-700/50'
                }`}
              >
                {isAdmin ? 'Admin' : 'Comum'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span className="font-mono text-[11px]">{conversa.contato.telefone}</span>
              {emStreaming && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-emerald-400 font-medium flex items-center gap-1 text-[11px] animate-pulse">
                    <span>{ASSISTENTE.nome} está digitando</span>
                    <span className="flex gap-0.5">
                      <span className="animate-dot-1">•</span>
                      <span className="animate-dot-2">•</span>
                      <span className="animate-dot-3">•</span>
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Badge Discreto de Conexão */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-[#18202b] border border-[#202937]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span className="text-[11px] text-slate-400 font-medium">
            WhatsApp Integrado
          </span>
        </div>
      </header>

      {/* Área de Mensagens com Textura Corporativa Suave */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 wa-chat-pattern">
        <div className="max-w-4xl mx-auto flex flex-col justify-end min-h-full">
          {/* Mensagens com Separadores de Data */}
          {conversa.mensagens.map((msg, idx) => {
            const msgAnterior = idx > 0 ? conversa.mensagens[idx - 1] : undefined;
            const exibirSeparador = deveExibirSeparadorData(msg, msgAnterior);
            const rotuloData = exibirSeparador
              ? formatarRotuloData(msg.timestamp || msg.horario)
              : '';

            return (
              <React.Fragment key={msg.id}>
                {exibirSeparador && rotuloData && (
                  <div className="flex items-center justify-center my-4 select-none">
                    <span className="px-3 py-1 rounded-md bg-[#121820] border border-[#202937] text-[11px] font-medium text-slate-400 shadow-sm">
                      {rotuloData}
                    </span>
                  </div>
                )}

                <MessageBubble
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
              </React.Fragment>
            );
          })}

          {/* Mensagem em streaming do assistente */}
          {emStreaming && (
            <div className="flex flex-col mb-3.5 max-w-[72%] ml-auto items-end">
              <div className="relative px-4 py-2.5 rounded-2xl rounded-tr-sm bg-[#1a2536] border border-[#233348] text-slate-100 shadow-md text-sm">
                <div className="flex items-center justify-between gap-3 mb-1 text-[11px] font-medium text-emerald-400">
                  <span>{ASSISTENTE.nome}</span>
                  <span className="flex items-center gap-1 text-slate-400 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    respondendo...
                  </span>
                </div>

                <div className="leading-relaxed break-words whitespace-pre-wrap">
                  {textoStreaming ? (
                    renderizarTextoWhatsApp(textoStreaming)
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400 text-xs py-1">
                      Consultando o Cofre Delta Plan...
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={mensagensEndRef} />
        </div>
      </div>

      {/* Prévia de Anexos Pendentes */}
      {anexosPendentes.length > 0 && (
        <div className="px-4 py-2 bg-[#121820] border-t border-[#1e2633] flex items-center gap-2 overflow-x-auto">
          {anexosPendentes.map((anexo, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 bg-[#18202b] border border-[#202937] px-3 py-1.5 rounded-lg text-xs text-slate-200"
            >
              {anexo.tipo === 'pdf' ? (
                <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : anexo.tipo === 'imagem' ? (
                <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              ) : (
                <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="max-w-[140px] truncate">{anexo.nome}</span>
              <button
                onClick={() => removerAnexo(idx)}
                className="text-slate-400 hover:text-rose-400 transition-colors ml-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Barra de Entrada de Mensagem */}
      <footer className="p-3 bg-[#121820] border-t border-[#1e2633] flex items-end gap-2 z-10">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          onChange={handleSelecionarArquivo}
          className="hidden"
        />

        {/* Botão de Anexo */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Anexar documento ou imagem"
          className="p-2.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-[#18202b] transition-colors shrink-0 cursor-pointer"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Campo de Texto */}
        <div className="flex-1 min-w-0 bg-[#0b0f14] border border-[#202937] rounded-xl px-3 py-2 focus-within:border-emerald-500 transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening
                ? 'Ouvindo microfone... Fale agora...'
                : 'Digite uma mensagem para o contato...'
            }
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none max-h-32"
          />
        </div>

        {/* Botão de Microfone (STT) */}
        {micSuportado && (
          <button
            type="button"
            onClick={toggleMic}
            title={isListening ? 'Parar gravação' : 'Gravar por voz'}
            className={`p-2.5 rounded-xl transition-colors shrink-0 cursor-pointer ${
              isListening
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse'
                : 'text-slate-400 hover:text-slate-100 hover:bg-[#18202b]'
            }`}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}

        {/* Botão de Enviar */}
        <button
          type="button"
          onClick={handleEnviar}
          disabled={(!textoInput.trim() && anexosPendentes.length === 0) || emStreaming}
          title="Enviar mensagem"
          className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 text-slate-950 transition-colors shrink-0 shadow-sm cursor-pointer"
        >
          <Send className="w-5 h-5" />
        </button>
      </footer>
    </main>
  );
};
