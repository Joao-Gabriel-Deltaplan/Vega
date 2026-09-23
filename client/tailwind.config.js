/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        corporate: {
          bg: '#0b0f14',
          card: '#121820',
          elevated: '#18202b',
          border: '#202937',
          borderSubtle: '#19222e',
          accent: '#10b981',
          accentHover: '#059669',
          accentMuted: 'rgba(16, 185, 129, 0.15)',
        },
        wa: {
          bg: '#0b0f14',
          chat: '#0d1219',
          panel: '#121820',
          panelHover: '#18202b',
          border: '#202937',
          bubbleClient: '#18202b',
          bubbleAssistant: '#1a2536',
          green: '#10b981',
          greenHover: '#059669',
          greenLight: '#34d399',
          textPrimary: '#f1f5f9',
          textSecondary: '#94a3b8',
          textMuted: '#64748b',
          badge: '#10b981',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
