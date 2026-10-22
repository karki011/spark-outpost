import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Queryable } from '../persistence/db.ts';
import { readVersionFile } from './files.ts';
import { sendArtifactPage } from './page-headers.ts';
import { versionByViewKey } from './store.ts';

export interface ArtifactOriginOptions {
  db: Queryable;
  chatFolders: string;
  port: number;
  frameAncestors: readonly string[];
}

export interface ArtifactOrigin {
  port: number;
  close(): Promise<void>;
}

const VIEW_PATH = /^\/v\/([0-9a-f]{64})$/;

function refuse(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(status === 404 ? 'Not found.' : 'Refused.');
}

export function artifactHandler(options: ArtifactOriginOptions, host: () => string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.headers.host !== host()) return refuse(res, 403);
    if (req.method !== 'GET') return refuse(res, 405);
    const key = VIEW_PATH.exec(new URL(req.url ?? '/', 'http://artifact').pathname)?.[1];
    const stored = key ? await versionByViewKey(options.db, key) : null;
    if (!stored || stored.kind !== 'html') return refuse(res, 404);
    const html = await readVersionFile(options.chatFolders, stored);
    if (html === null) return refuse(res, 404);
    sendArtifactPage(res, html, options.frameAncestors);
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

export async function startArtifactOrigin(options: ArtifactOriginOptions): Promise<ArtifactOrigin> {
  let host = '';
  const handle = artifactHandler(options, () => host);
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) refuse(res, 500);
      else res.end();
    });
  });
  const port = await listen(server, options.port);
  host = `127.0.0.1:${port}`;
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
