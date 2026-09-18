/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wa: {
          bg: '#111b21',
          chat: '#0b141a',
          panel: '#202c33',
          panelHover: '#2a3942',
          border: '#222e35',
          bubbleClient: '#202c33',
          bubbleAssistant: '#005c4b',
          green: '#00a884',
          greenHover: '#02906f',
          greenLight: '#25d366',
          textPrimary: '#e9edef',
          textSecondary: '#8696a0',
          textMuted: '#667781',
          badge: '#00a884',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'Helvetica Neue', 'Helvetica', 'Lucida Grande', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
