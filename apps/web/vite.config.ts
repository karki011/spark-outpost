import { readFileSync } from 'node:fs';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { API_TOKEN_ENV, API_TOKEN_HEADER, DEV_API_TOKEN_FILE } from '@spark-outpost/contracts';
import { bundledFontsPlugin } from './bundled-fonts.ts';

const webPort = Number(process.env.SPARK_WEB_PORT ?? 5173);
const apiPort = Number(process.env.SPARK_API_PORT ?? 4318);
const launchedToken = process.env[API_TOKEN_ENV];
const tokenFile = resolve(import.meta.dirname, '../..', DEV_API_TOKEN_FILE);

function apiToken(): string | null {
  if (launchedToken) return launchedToken;
  try {
    return readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return null;
  }
}

function attachApiToken(proxyReq: ClientRequest) {
  const token = apiToken();
  if (token) proxyReq.setHeader(API_TOKEN_HEADER, token);
  else proxyReq.removeHeader(API_TOKEN_HEADER);
}

function endWithUpstream(proxyRes: IncomingMessage, _req: IncomingMessage, res: ServerResponse) {
  proxyRes.once('close', () => {
    if (!res.writableEnded) res.destroy();
  });
}

export default defineConfig({
  plugins: [react(), bundledFontsPlugin()],
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
        configure: (proxy) => {
          proxy.on('proxyReq', attachApiToken);
          proxy.on('proxyReqWs', attachApiToken);
          proxy.on('proxyRes', endWithUpstream);
        },
      },
    },
  },
});
