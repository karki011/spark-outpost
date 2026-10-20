import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserHost } from '../browser/host-client.ts';
import type { Db } from '../persistence/db.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { sparkGrantKey, startSparkMcpHost, type SparkMcpHost } from './host.ts';

let host: SparkMcpHost;

const deps = () => ({
  db: { query: async () => ({ rows: [] }) } as unknown as Db,
  secrets: memorySecretStore(),
  fetch,
  github: {
    runCommand: async () => ({ code: 1, stdout: '', stderr: '' }),
    locateGh: async () => null,
  },
});

beforeEach(async () => {
  host = await startSparkMcpHost(deps());
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

  it('restores a grant from its digest so a token issued before a restart still works', async () => {
    const grant = await host.grant(scope);
    const port = host.port;
    await host.close();
    host = await startSparkMcpHost(deps(), undefined, port);
    expect(host.port).toBe(port);
    const auth = { Authorization: `Bearer ${grant.token}` };
    expect((await post(grant.url, auth)).status).toBe(401);
    const restored = await host.restore(scope, sparkGrantKey(grant.token));
    expect(restored.token).toBe('');
    expect((await post(grant.url, auth)).status).toBe(200);
    await expect(host.restore(scope, sparkGrantKey(grant.token))).rejects.toThrow(
      'cannot be restored',
    );
    await expect(host.restore(scope, grant.token)).rejects.toThrow('cannot be restored');
    restored.revoke();
    expect((await post(grant.url, auth)).status).toBe(401);
  });

  it('rebinds a grant to a new scope without ending a call already in flight', async () => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const grant = await host.grant({ ...scope, rebinds: true, beforeToolCall: () => waiting });
    const auth = { Authorization: `Bearer ${grant.token}` };
    const call = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'spark_providers', arguments: {} },
    });
    const inFlight = post(grant.url, auth, call);

    const rebinding = host.rebind({ ...scope, runId: null }, sparkGrantKey(grant.token));
    expect((await post(grant.url, auth)).status).toBe(200);
    const rebound = await rebinding;
    release();

    expect((await inFlight).status).toBe(200);
    expect((await post(grant.url, auth)).status).toBe(200);
    await expect(host.rebind(scope, grant.token)).rejects.toThrow('cannot be rebound');
    rebound.revoke();
    expect((await post(grant.url, auth)).status).toBe(401);
  });

  it('ends the browser run of the turn that ended when it rebinds to the next turn', async () => {
    await host.close();
    const shotDir = await mkdtemp(join(tmpdir(), 'spark-shots-'));
    const requests: unknown[] = [];
    const browser = {
      request: async (request: unknown) => {
        requests.push(request);
        return {} as never;
      },
    } as unknown as BrowserHost;
    host = await startSparkMcpHost({ ...deps(), browser, shotDir });
    const first = { workspaceId: 'w', conversationId: 'c', runId: 'run-1' };
    const grant = await host.grant(first);
    await mkdir(join(shotDir, 'run-1'));

    await host.rebind({ ...first, runId: 'run-2' }, sparkGrantKey(grant.token));

    await vi.waitFor(() =>
      expect(requests).toContainEqual({ op: 'end_run', chatId: 'c', runId: 'run-1' }),
    );
    await expect(stat(join(shotDir, 'run-1'))).rejects.toThrow();
    await rm(shotDir, { recursive: true, force: true });
  });

  it('listens on another port when the one it had is taken', async () => {
    const other = await startSparkMcpHost(deps(), undefined, host.port);
    expect(other.port).not.toBe(host.port);
    await other.close();
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

  it('checks the native turn before dispatching a tool and fails closed when unavailable', async () => {
    let calls = 0;
    const grant = await host.grant({
      ...scope,
      beforeToolCall: async () => {
        calls += 1;
        throw new Error('Ended turn');
      },
    });
    const auth = { Authorization: `Bearer ${grant.token}` };
    expect((await post(grant.url, auth)).status).toBe(200);
    expect(calls).toBe(0);
    const response = await post(
      grant.url,
      auth,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'spark_docs', arguments: {} },
      }),
    );
    expect(response.status).toBe(409);
    expect(calls).toBe(1);
    expect(await response.text()).not.toContain('Ended turn');
  });

  it('does not dispatch a tool if its grant is revoked while waiting for the native turn', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const grant = await host.grant({
      ...scope,
      beforeToolCall: async () => {
        entered();
        await waiting;
      },
    });
    const response = post(
      grant.url,
      { Authorization: `Bearer ${grant.token}` },
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'spark_docs', arguments: {} },
      }),
    );
    await started;
    grant.revoke();
    release();
    expect((await response).status).toBe(401);
  });
});
