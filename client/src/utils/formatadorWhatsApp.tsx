import React from 'react';

/**
 * Renderiza texto com as formatações nativas do WhatsApp:
 * *negrito*, _itálico_, ~tachado~ e `código`
 */
export function renderizarTextoWhatsApp(textoBruto: string): React.ReactNode {
  if (!textoBruto) return null;

  // 1. Remove blocos de comando internos (```nao_encontrado...```, ```documento...```)
  const textoLimpo = textoBruto
    .replace(/```nao_encontrado[\s\S]*?```/gi, '')
    .replace(/```documento[\s\S]*?```/gi, '')
    .replace(/```(nao_encontrado|documento)[\s\S]*$/gi, '')
    .trim();

  // 2. Divide em linhas para manter quebras de linha com precisão
  const linhas = textoLimpo.split('\n');

  return linhas.map((linha, linhaIdx) => {
    return (
      <React.Fragment key={linhaIdx}>
        {linhaIdx > 0 && <br />}
        {renderizarLinhaFormatada(linha)}
      </React.Fragment>
    );
  });
}

function renderizarTextoComLinks(texto: string, keyPrefix: string | number): React.ReactNode {
  if (!texto) return null;
  // Regex para capturar URLs iniciadas com http://, https:// ou www.
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const pedacos = texto.split(urlRegex);

  return pedacos.map((pedaco, idx) => {
    if (!pedaco) return null;
    const isUrl = /^(https?:\/\/|www\.)/i.test(pedaco);
    if (isUrl) {
      // Remove pontuação de fechamento comum no final de URLs digitadas no chat (como . , : ;)
      const matchPontuacao = pedaco.match(/[.,;:)]+$/);
      const pontuacaoFinal = matchPontuacao ? matchPontuacao[0] : '';
      const urlLimpa = pontuacaoFinal ? pedaco.slice(0, -pontuacaoFinal.length) : pedaco;
      const href = urlLimpa.startsWith('http') ? urlLimpa : `https://${urlLimpa}`;

      return (
        <React.Fragment key={`${keyPrefix}-url-${idx}`}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline font-medium break-all inline-flex items-center gap-0.5 transition-colors cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            title={`Abrir link: ${href}`}
          >
            <span>{urlLimpa}</span>
            <svg
              className="w-3 h-3 inline-block shrink-0 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
          {pontuacaoFinal}
        </React.Fragment>
      );
    }
    return <span key={`${keyPrefix}-txt-${idx}`}>{pedaco}</span>;
  });
}

function renderizarLinhaFormatada(linha: string): React.ReactNode {
  if (!linha) return null;

  // Regex para capturar marcações válidas do padrão WhatsApp:
  // - Negrito duplo: **texto**
  // - Negrito simples WhatsApp: *texto* (não precedido/sucedido por outro asterisco e sem espaços internos adjacentes)
  // - Itálico WhatsApp: _texto_ (não precedido/sucedido por outro underline e sem espaços internos adjacentes)
  // - Tachado WhatsApp: ~texto~
  // - Código inline: `texto`
  // IMPORTANTE: Asteriscos que fazem parte de valores literais (ex.: "12.***.***-9" ou "***") NÃO viram negrito!
  const regex =
    /((?<!\*)\*\*(?!\*|\s)(?:[^\*\n]+?)(?<!\s|\*)\*\*(?!\*)|(?<!\*)\*(?!\*|\s)(?:[^\*\n]+?)(?<!\s|\*)\*(?!\*)|(?<!_)_(?!\s|_)(?:[^_\n]+?)(?<!\s|_)_(?!_)|(?<!~)~(?!\s|~)(?:[^~\n]+?)(?<!\s|~)~(?!~)|(?<!`)(?:`)(?!\s|`)(?:[^`\n]+?)(?<!\s|`)(?:`)(?!`))/g;
  const partes = linha.split(regex);

  return partes.map((parte, i) => {
    if (!parte) return null;

    // Negrito duplo: **texto**
    if (parte.startsWith('**') && parte.endsWith('**') && parte.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-wa-textPrimary">
          {renderizarTextoComLinks(parte.slice(2, -2), `b2-${i}`)}
        </strong>
      );
    }

    // Negrito simples WhatsApp: *texto*
    if (parte.startsWith('*') && parte.endsWith('*') && parte.length >= 2) {
      return (
        <strong key={i} className="font-semibold text-wa-textPrimary">
          {renderizarTextoComLinks(parte.slice(1, -1), `b1-${i}`)}
        </strong>
      );
    }

    // Itálico WhatsApp: _texto_
    if (parte.startsWith('_') && parte.endsWith('_') && parte.length >= 2) {
      return (
        <em key={i} className="italic text-wa-textSecondary">
          {renderizarTextoComLinks(parte.slice(1, -1), `em-${i}`)}
        </em>
      );
    }

    // Tachado WhatsApp: ~texto~
    if (parte.startsWith('~') && parte.endsWith('~') && parte.length >= 2) {
      return (
        <del key={i} className="line-through opacity-70">
          {renderizarTextoComLinks(parte.slice(1, -1), `del-${i}`)}
        </del>
      );
    }

    // Código inline: `texto`
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length >= 2) {
      return (
        <code key={i} className="px-1 py-0.5 bg-black/30 rounded font-mono text-[12px] text-emerald-300">
          {parte.slice(1, -1)}
        </code>
      );
    }

    return renderizarTextoComLinks(parte, `p-${i}`);
  });
}
