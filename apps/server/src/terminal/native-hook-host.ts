import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type PermissionHandler = (
  token: string,
  body: unknown,
  signal: AbortSignal,
) => Promise<'allow' | 'deny' | null>;

export async function nativeHookHost(
  authorised: (token: string) => boolean,
  observe: (token: string, body: unknown) => Promise<boolean>,
  permission: PermissionHandler,
) {
  let host = '';
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/events' && req.url !== '/permission') return res.writeHead(404).end();
    if (req.headers.host !== host || req.headers.origin !== undefined)
      return res.writeHead(403).end();
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token || !authorised(token)) return res.writeHead(401).end();
    if (req.method !== 'POST') return res.writeHead(405).end();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 1_000_000) return res.writeHead(413).end();
      chunks.push(chunk);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return res.writeHead(400).end();
    }
    if (req.url === '/permission') {
      const gone = new AbortController();
      res.once('close', () => gone.abort());
      const answer = await permission(token, body, gone.signal);
      if (!answer || gone.signal.aborted) return res.writeHead(204).end();
      return res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ behavior: answer }));
    }
    const accepted = await observe(token, body);
    return res.writeHead(accepted ? 204 : 400).end();
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  return {
    port,
    url: `http://${host}/events`,
    permissionUrl: `http://${host}/permission`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
