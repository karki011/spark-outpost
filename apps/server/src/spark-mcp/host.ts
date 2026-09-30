import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { SparkScope, SparkToolDeps } from './deps.ts';
import { sparkMcpServer } from './server.ts';

export interface SparkGrant {
  url: string;
  token: string;
  revoke(): void;
}

export interface SparkMcpHost {
  grant(scope: SparkScope): SparkGrant;
  close(): Promise<void>;
}

const MCP_PATH = '/mcp';
const BODY_LIMIT_BYTES = 1_000_000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

function reply(res: ServerResponse, status: number, message: string): void {
  res
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
  return match?.[1] ?? null;
}

export async function startSparkMcpHost(deps: SparkToolDeps): Promise<SparkMcpHost> {
  const grants = new Map<string, SparkScope>();
  let host = '';

  const serve = async (req: IncomingMessage, res: ServerResponse, scope: SparkScope) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      reply(res, 400, 'Send one JSON-RPC message as JSON.');
      return;
    }
    const server = sparkMcpServer(deps, scope);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, body);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== MCP_PATH) return reply(res, 404, 'Not found.');
    if (req.headers.host !== host || req.headers.origin !== undefined) {
      return reply(res, 403, 'Only local agent sessions can call Spark tools.');
    }
    const token = bearer(req);
    const scope = token ? grants.get(digest(token)) : undefined;
    if (!scope) return reply(res, 401, 'This Spark session has ended or the token is wrong.');
    if (req.method !== 'POST') return reply(res, 405, 'Spark tools answer POST requests only.');
    await serve(req, res, scope);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, 'Spark tools failed.');
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  const url = `http://${host}${MCP_PATH}`;

  return {
    grant(scope) {
      const token = randomBytes(32).toString('base64url');
      const key = digest(token);
      grants.set(key, scope);
      return { url, token, revoke: () => void grants.delete(key) };
    },
    async close() {
      grants.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
