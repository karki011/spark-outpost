import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { sparkAvailability, type SparkAvailability } from './availability.ts';
import type { SparkScope, SparkToolDeps } from './deps.ts';
import { sparkMcpServer } from './server.ts';
import { endBrowserRun } from './tools/browser/end-run.ts';

export interface SparkGrant {
  url: string;
  token: string;
  revoke(): void;
}

export interface SparkMcpHost {
  port: number;
  browser: boolean;
  grant(scope: SparkScope): Promise<SparkGrant>;
  restore(scope: SparkScope, key: string): Promise<SparkGrant>;
  close(): Promise<void>;
}

const GRANT_KEY = /^[0-9a-f]{64}$/;

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const failed = () => resolve(false);
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', failed);
      resolve(true);
    });
  });
}

const MCP_PATH = '/mcp';
const BODY_LIMIT_BYTES = 1_000_000;

export const sparkGrantKey = (token: string) => createHash('sha256').update(token).digest('hex');
const digest = sparkGrantKey;

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

function message(body: unknown): { method?: unknown; id?: unknown; params?: unknown } {
  return body !== null && typeof body === 'object' ? body : {};
}

function toolCallId(body: unknown): string | null {
  const { method, id } = message(body);
  return method === 'tools/call' && (typeof id === 'string' || typeof id === 'number')
    ? String(id)
    : null;
}

function cancelledId(body: unknown): string | null {
  const { method, params } = message(body);
  if (method !== 'notifications/cancelled' || params === null || typeof params !== 'object') {
    return null;
  }
  const { requestId } = params as { requestId?: unknown };
  return typeof requestId === 'string' || typeof requestId === 'number' ? String(requestId) : null;
}

interface Session {
  scope: SparkScope;
  available: SparkAvailability;
}

export async function startSparkMcpHost(
  deps: SparkToolDeps,
  availabilityOf: typeof sparkAvailability = sparkAvailability,
  preferredPort = 0,
): Promise<SparkMcpHost> {
  const grants = new Map<string, Session>();
  let host = '';

  const calls = new Map<string, AbortController>();

  const serve = async (
    req: IncomingMessage,
    res: ServerResponse,
    session: Session,
    grant: string,
  ) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      reply(res, 400, 'Send one JSON-RPC message as JSON.');
      return;
    }
    const cancelled = cancelledId(body);
    if (cancelled !== null) calls.get(`${grant}:${cancelled}`)?.abort();
    const call = toolCallId(body);
    if (call !== null) {
      try {
        await session.scope.beforeToolCall?.();
      } catch {
        reply(res, 409, 'This terminal turn is unavailable. Check its session in Spark.');
        return;
      }
      if (grants.get(grant) !== session) {
        reply(res, 401, 'This Spark session has ended.');
        return;
      }
    }
    const key = call === null ? null : `${grant}:${call}`;
    const controller = new AbortController();
    if (key) calls.set(key, controller);
    const server = sparkMcpServer(deps, { ...session.scope }, session.available, controller.signal);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      controller.abort();
      if (key && calls.get(key) === controller) calls.delete(key);
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
    const grant = token ? digest(token) : '';
    const session = grants.get(grant);
    if (!session) return reply(res, 401, 'This Spark session has ended or the token is wrong.');
    if (req.method !== 'POST') return reply(res, 405, 'Spark tools answer POST requests only.');
    await serve(req, res, session, grant);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, 'Spark tools failed.');
      else res.end();
    });
  });
  if (preferredPort === 0 || !(await listenOn(server, preferredPort))) {
    if (!(await listenOn(server, 0))) throw new Error('Spark tools could not start listening.');
  }
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  const url = `http://${host}${MCP_PATH}`;
  const register = async (scope: SparkScope, key: string, token: string): Promise<SparkGrant> => {
    grants.set(key, { scope, available: await availabilityOf(deps, scope) });
    return {
      url,
      token,
      revoke: () => {
        grants.delete(key);
        for (const [callKey, controller] of calls) {
          if (callKey.startsWith(`${key}:`)) controller.abort();
        }
        void endBrowserRun(deps, scope);
      },
    };
  };

  return {
    port,
    browser: deps.browser !== undefined,
    grant(scope) {
      const token = randomBytes(32).toString('base64url');
      return register(scope, digest(token), token);
    },
    async restore(scope, key) {
      if (!GRANT_KEY.test(key) || grants.has(key))
        throw new Error('That Spark tools grant cannot be restored.');
      return register(scope, key, '');
    },
    async close() {
      grants.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
