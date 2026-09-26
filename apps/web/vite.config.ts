import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = Number(process.env.SPARK_WEB_PORT ?? 5173);
const apiPort = Number(process.env.SPARK_API_PORT ?? 4318);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    watch: { useFsEvents: false },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
