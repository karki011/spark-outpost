import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoopbackCallback {
  code: string | null;
  state: string | null;
  error: string | null;
}

export interface Loopback {
  redirectUri: string;
  close(): void;
}

const PAGE = (heading: string, line: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spark Outpost</title>` +
  `<style>body{font:16px -apple-system,system-ui,sans-serif;margin:15vh auto;max-width:28rem;` +
  `padding:0 1rem;color:#222;background:#fafafa}@media(prefers-color-scheme:dark){body{` +
  `color:#eee;background:#1c1c1e}}</style></head><body><h1>${heading}</h1><p>${line}</p></body></html>`;

export const LOOPBACK_DONE_PAGE = PAGE(
  'You can close this tab',
  'Go back to Spark Outpost to finish connecting Google Calendar.',
);
const NOT_HERE_PAGE = PAGE('Nothing here', 'This address only finishes a Spark Outpost sign-in.');

function callbackOf(url: URL): LoopbackCallback | null {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;
  return { code, state: url.searchParams.get('state'), error };
}

export async function startLoopback(
  onCallback: (callback: LoopbackCallback) => void,
): Promise<Loopback> {
  let answered = false;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const callback = request.method === 'GET' && url.pathname === '/' ? callbackOf(url) : null;
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      connection: 'close',
    };
    if (!callback || answered) {
      response.writeHead(404, headers).end(NOT_HERE_PAGE);
      return;
    }
    answered = true;
    response.writeHead(200, headers).end(LOOPBACK_DONE_PAGE);
    onCallback(callback);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${port}`,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
