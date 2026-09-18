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
          {parte.slice(2, -2)}
        </strong>
      );
    }

    // Negrito simples WhatsApp: *texto*
    if (parte.startsWith('*') && parte.endsWith('*') && parte.length >= 2) {
      return (
        <strong key={i} className="font-semibold text-wa-textPrimary">
          {parte.slice(1, -1)}
        </strong>
      );
    }

    // Itálico WhatsApp: _texto_
    if (parte.startsWith('_') && parte.endsWith('_') && parte.length >= 2) {
      return (
        <em key={i} className="italic text-wa-textSecondary">
          {parte.slice(1, -1)}
        </em>
      );
    }

    // Tachado WhatsApp: ~texto~
    if (parte.startsWith('~') && parte.endsWith('~') && parte.length >= 2) {
      return (
        <del key={i} className="line-through opacity-70">
          {parte.slice(1, -1)}
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

    return parte;
  });
}
