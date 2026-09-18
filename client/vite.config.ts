import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Carrega variáveis do arquivo .env localizado na raiz do projeto
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const port = parseInt(env.VITE_PORT || '4300', 10);
  const backendPort = env.PORT || '4301';

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/arquivos': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
