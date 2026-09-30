import { chmod, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../stack.ts';

const UPSTREAM = 'https://chatgpt.com/backend-api/codex';
const PROXY_PORT = 4493;
const PROVIDER_ID = 'benchproxy';
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

export interface ProxyLine {
  at: string;
  method: string;
  path: string;
  toolOutputs: number;
  status: number;
}

export interface RateLimitProxy {
  env: Record<string, string>;
  lines: ProxyLine[];
  close(): Promise<void>;
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (encoding === 'zstd') return zlib.zstdDecompressSync(body);
  if (encoding === 'gzip') return zlib.gunzipSync(body);
  if (encoding === 'br') return zlib.brotliDecompressSync(body);
  return body;
}

export function toolOutputs(body: Buffer, encoding: string | undefined): number {
  try {
    const json = JSON.parse(decode(body, encoding).toString('utf8')) as { input?: unknown };
    const input = Array.isArray(json.input) ? (json.input as { type?: unknown }[]) : [];
    return input.filter((item) => typeof item.type === 'string' && item.type.endsWith('_output'))
      .length;
  } catch {
    return -1;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function rateLimited(res: ServerResponse): number {
  res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3600' });
  res.end(
    JSON.stringify({
      error: { type: 'rate_limit_exceeded', message: 'Rate limit reached (story bench proxy).' },
    }),
  );
  return 429;
}

async function forward(req: IncomingMessage, body: Buffer, res: ServerResponse): Promise<number> {
  const headers = { ...req.headers } as Record<string, string>;
  delete headers.host;
  delete headers['content-length'];
  delete headers.connection;
  const upstream = await fetch(`${UPSTREAM}${req.url ?? ''}`, {
    method: req.method ?? 'GET',
    headers,
    ...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.includes(name)) out[name] = value;
  });
  res.writeHead(upstream.status, out);
  if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
  res.end();
  return upstream.status;
}

function codexBinary(): string {
  const server = createRequire(join(ROOT, 'apps/server/package.json'));
  const adapter = server.resolve('@agentclientprotocol/codex-acp/package.json');
  return createRequire(adapter).resolve('@openai/codex/bin/codex.js');
}

async function codexWrapper(dir: string): Promise<string> {
  const path = join(dir, 'codex-through-proxy.sh');
  const provider = `model_providers.${PROVIDER_ID}={name="OpenAI",base_url="http://127.0.0.1:${PROXY_PORT}",wire_api="responses",requires_openai_auth=true}`;
  const script = [
    '#!/bin/sh',
    `exec "${process.execPath}" "${codexBinary()}" "$@" -c model_provider=${PROVIDER_ID} -c '${provider}'`,
    '',
  ].join('\n');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

export async function startRateLimitProxy(
  dir: string,
  limitFromToolOutputs: number,
): Promise<RateLimitProxy> {
  const lines: ProxyLine[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const outputs = toolOutputs(body, req.headers['content-encoding'] as string | undefined);
      const limited = limitFromToolOutputs > 0 && outputs >= limitFromToolOutputs;
      const status = limited
        ? rateLimited(res)
        : await forward(req, body, res).catch(() => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
            return 502;
          });
      lines.push({
        at: new Date().toISOString(),
        method: req.method ?? '',
        path: (req.url ?? '').split('?')[0]!,
        toolOutputs: outputs,
        status,
      });
    })();
  });
  await new Promise<void>((done) => server.listen(PROXY_PORT, '127.0.0.1', done));
  return {
    env: { CODEX_PATH: await codexWrapper(dir) },
    lines,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
