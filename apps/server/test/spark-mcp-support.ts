import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SparkScope, SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { startSparkMcpHost, type SparkGrant, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import type { TestDb } from './support.ts';

export interface SparkToolsHarness {
  host: SparkMcpHost;
  call(name: string, args?: Record<string, unknown>): Promise<CallResult>;
  close(): Promise<void>;
}

export interface CallResult {
  text: string;
  isError: boolean;
  json<T = Record<string, unknown>>(): T;
}

export function toolDeps(t: TestDb, overrides: Partial<SparkToolDeps> = {}): SparkToolDeps {
  return {
    db: t.db,
    secrets: memorySecretStore(),
    fetch,
    github: {
      runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing' }),
      locateGh: async () => null,
    },
    serverSpendCapUsd: null,
    timeZone: 'UTC',
    ...overrides,
  };
}

export async function connectClient(grant: SparkGrant): Promise<Client> {
  const client = new Client({ name: 'spark-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(grant.url), {
      requestInit: { headers: { Authorization: `Bearer ${grant.token}` } },
    }) as Transport,
  );
  return client;
}

export async function startSparkTools(
  t: TestDb,
  scope: Partial<SparkScope> = {},
  overrides: Partial<SparkToolDeps> = {},
): Promise<SparkToolsHarness> {
  const host = await startSparkMcpHost(toolDeps(t, overrides));
  const grant = host.grant({
    workspaceId: t.workspaceId,
    conversationId: null,
    runId: null,
    ...scope,
  });
  const client = await connectClient(grant);
  return {
    host,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const first = result.content[0];
      const text = first?.type === 'text' ? first.text : '';
      return {
        text,
        isError: result.isError === true,
        json: <T>() => JSON.parse(text) as T,
      };
    },
    async close() {
      await client.close();
      await host.close();
    },
  };
}
