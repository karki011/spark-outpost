import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { expandReferences, type McpServerConfig } from '../agent-config/mcp-json.ts';
import { redactText } from '../audit/redact.ts';
import { childEnvironment } from '../setup/environment.ts';

export interface ProbeResult {
  ok: boolean;
  tools: string[];
  error: string | null;
}

export interface McpProbeOptions {
  timeoutMs?: number;
  env?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const STDERR_TAIL = 600;
const TOOL_LIST_MAX = 100;

type AnyTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

function expanded(map: Record<string, string>, env: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(map).map(([name, value]) => [name, expandReferences(value, env)]),
  );
}

function transportFor(
  server: McpServerConfig,
  env: Readonly<Record<string, string>>,
  cwd: string,
): AnyTransport {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: expandReferences(server.command ?? '', env),
      args: server.args.map((arg) => expandReferences(arg, env)),
      env: { ...getDefaultEnvironment(), PATH: env.PATH ?? '', ...expanded(server.env, env) },
      cwd,
      stderr: 'pipe',
    });
  }
  const url = new URL(expandReferences(server.url ?? '', env));
  const requestInit = { headers: expanded(server.headers, env) };
  return server.transport === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
}

function stderrOf(transport: AnyTransport): () => string {
  let tail = '';
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });
  }
  return () => tail.trim();
}

function failure(error: unknown, stderr: string): ProbeResult {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stderr ? `${message}\n${stderr}` : message;
  return { ok: false, tools: [], error: redactText(detail).slice(0, 1200) };
}

export async function probeMcpServer(
  server: McpServerConfig,
  options: McpProbeOptions = {},
): Promise<ProbeResult> {
  const env = options.env ?? childEnvironment(process.env);
  const cwd = await mkdtemp(join(tmpdir(), 'spark-outpost-mcp-probe-'));
  const client = new Client({ name: 'spark-outpost-probe', version: '1.0.0' });
  let transport: AnyTransport | null = null;
  let stderr = () => '';
  let timer: NodeJS.Timeout | undefined;
  try {
    transport = transportFor(server, env, cwd);
    stderr = stderrOf(transport);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s.`)),
        timeoutMs,
      );
    });
    const listed = (async () => {
      await client.connect(transport as Transport);
      return client.listTools();
    })();
    listed.catch(() => undefined);
    const result = await Promise.race([listed, timeout]);
    const tools = result.tools.map((tool) => tool.name).slice(0, TOOL_LIST_MAX);
    return { ok: true, tools, error: null };
  } catch (error) {
    return failure(error, stderr());
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true });
  }
}
