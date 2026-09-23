import React, { useState } from 'react';

interface LogoDeltaPlanProps {
  tamanho?: 'sm' | 'md' | 'lg';
  mostrarTexto?: boolean;
  className?: string;
}

export const LogoDeltaPlan: React.FC<LogoDeltaPlanProps> = ({
  tamanho = 'md',
  mostrarTexto = false,
  className = '',
}) => {
  const [erroImg, setErroImg] = useState(false);

  const dimensoes = {
    sm: { box: 'w-7 h-7', icon: 'w-4 h-4', text: 'text-xs' },
    md: { box: 'w-9 h-9', icon: 'w-5 h-5', text: 'text-sm' },
    lg: { box: 'w-12 h-12', icon: 'w-7 h-7', text: 'text-base' },
  }[tamanho];

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Insígnia do Logo */}
      <div
        className={`${dimensoes.box} rounded-xl bg-gradient-to-br from-slate-900 to-[#121820] border border-slate-700/60 flex items-center justify-center shadow-lg shadow-black/40 overflow-hidden relative group shrink-0`}
      >
        {!erroImg ? (
          <img
            src="/logo-delta-plan.png"
            alt="Delta Plan"
            className="w-full h-full object-contain p-1"
            onError={() => setErroImg(true)}
          />
        ) : (
          /* Fallback moderno em SVG vetorial corporativo (Símbolo Delta estilizado) */
          <svg
            viewBox="0 0 24 24"
            className={`${dimensoes.icon} text-emerald-400`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Triângulo Delta estilizado corporativo */}
            <path d="M12 3L2 20h20L12 3z" />
            <path d="M12 9l-4 7h8l-4-7z" fill="currentColor" fillOpacity="0.2" />
          </svg>
        )}
      </div>

      {/* Rótulo Opcional */}
      {mostrarTexto && (
        <div className="flex flex-col min-w-0">
          <span className={`font-bold tracking-tight text-slate-100 uppercase ${dimensoes.text}`}>
            Delta <span className="text-emerald-400">Plan</span>
          </span>
          <span className="text-[10px] tracking-widest text-slate-400 uppercase font-medium">
            VEGA
          </span>
        </div>
      )}
    </div>
  );
};
