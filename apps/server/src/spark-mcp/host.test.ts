import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { startSparkMcpHost, type SparkMcpHost } from './host.ts';

let host: SparkMcpHost;

beforeEach(async () => {
  host = await startSparkMcpHost({
    db: { query: async () => ({ rows: [] }) } as unknown as Db,
    secrets: memorySecretStore(),
    fetch,
    github: {
      runCommand: async () => ({ code: 1, stdout: '', stderr: '' }),
      locateGh: async () => null,
    },
  });
});

afterEach(async () => {
  await host.close();
});

const scope = { workspaceId: 'w', conversationId: null, runId: null };
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

function post(url: string, headers: Record<string, string>, body = LIST) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
}

describe('Spark tools host', () => {
  it('answers a session that shows its token', async () => {
    const grant = await host.grant(scope);
    const response = await post(grant.url, { Authorization: `Bearer ${grant.token}` });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name)).toContain('spark_providers');
  });

  it('refuses missing, wrong and revoked tokens', async () => {
    const grant = await host.grant(scope);
    expect((await post(grant.url, {})).status).toBe(401);
    expect((await post(grant.url, { Authorization: 'Bearer nope' })).status).toBe(401);
    grant.revoke();
    expect((await post(grant.url, { Authorization: `Bearer ${grant.token}` })).status).toBe(401);
  });

  it('refuses browsers, other host names, other paths and streams', async () => {
    const grant = await host.grant(scope);
    const auth = { Authorization: `Bearer ${grant.token}` };
    expect((await post(grant.url, { ...auth, Origin: 'https://evil.example' })).status).toBe(403);
    const port = new URL(grant.url).port;
    expect((await post(`http://localhost:${port}/mcp`, auth)).status).toBe(403);
    expect((await post(grant.url.replace('/mcp', '/other'), auth)).status).toBe(404);
    expect((await fetch(grant.url, { headers: auth })).status).toBe(405);
    expect((await post(grant.url, auth, '{not json')).status).toBe(400);
  });
});
