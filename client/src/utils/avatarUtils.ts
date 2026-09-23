export interface AvatarPalette {
  bg: string;
  text: string;
  border: string;
}

// 10 paletas corporativas suaves, refinadas e com contraste ideal
const PALETAS_AVATAR: AvatarPalette[] = [
  { bg: '#1e293b', text: '#94a3b8', border: '#334155' }, // Slate neutro
  { bg: '#1e3a5f', text: '#93c5fd', border: '#2563eb' }, // Azul corporativo
  { bg: '#064e3b', text: '#6ee7b7', border: '#059669' }, // Verde esmeralda suave
  { bg: '#312e81', text: '#c7d2fe', border: '#4f46e5' }, // Índigo elegante
  { bg: '#4c1d95', text: '#ddd6fe', border: '#7c3aed' }, // Lavanda nobre
  { bg: '#701a75', text: '#f5d0fe', border: '#c026d3' }, // Fúcsia sutil
  { bg: '#78350f', text: '#fde68a', border: '#d97706' }, // Âmbar quente
  { bg: '#134e4a', text: '#5eead4', border: '#0d9488' }, // Teal / Petróleo
  { bg: '#831843', text: '#fbcfe8', border: '#db2777' }, // Rose suave
  { bg: '#365314', text: '#bef264', border: '#65a30d' }, // Oliva suave
];

/**
 * Retorna uma paleta fixa e consistente para cada pessoa a partir do hash do nome.
 */
export function obterPaletaAvatar(nome?: string | null): AvatarPalette {
  if (!nome || !nome.trim()) {
    return PALETAS_AVATAR[0];
  }

  let hash = 0;
  const str = nome.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % PALETAS_AVATAR.length;
  return PALETAS_AVATAR[index];
}

/**
 * Extrai até 2 iniciais maiúsculas do nome.
 */
export function obterIniciais(nome?: string | null): string {
  if (!nome || !nome.trim()) return '??';
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 1) {
    return partes[0].substring(0, 2).toUpperCase();
  }
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
