import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Db } from '../persistence/db.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { EVERYTHING_AVAILABLE } from '../spark-mcp/availability.ts';
import type { SparkToolDeps } from '../spark-mcp/deps.ts';
import { callSparkTool } from '../spark-mcp/server.ts';
import { sparkTool, type SparkTool, type SparkToolContext } from '../spark-mcp/tool.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { createCodeModeBridge } from './bridge.ts';

beforeEach(() => vi.stubEnv('SPARK_CODE_MODE', '1'));
afterEach(() => vi.unstubAllEnvs());

function fixture(tools: SparkTool[]) {
  const stop = new AbortController();
  const audit = vi.fn();
  const observed = vi.fn();
  const before = vi.fn(async () => {});
  const deps: SparkToolDeps = {
    db: {} as Db,
    secrets: memorySecretStore(),
    fetch: vi.fn<typeof fetch>(),
    github: { locateGh: async () => '/gh', runCommand: vi.fn() },
  };
  const context: SparkToolContext = {
    deps,
    scope: {
      workspaceId: 'workspace',
      conversationId: 'chat',
      runId: 'run',
      codeMode: true,
      beforeToolCall: before,
      observations: { record: observed } as unknown as NonNullable<
        SparkToolContext['scope']['observations']
      >,
      actions: {
        signal: stop.signal,
        append: vi.fn(),
        waiters: new ApprovalWaiters(),
        timeoutMs: Infinity,
        pollMs: 500,
        audit: { message: audit, stderr: vi.fn() },
      },
    },
  };
  const available = vi.fn(async () => EVERYTHING_AVAILABLE);
  const toolsFor = vi.fn(() => tools);
  const bridge = createCodeModeBridge(context, {
    toolsFor,
    availabilityOf: available,
    callTool: callSparkTool,
  });
  return { context, bridge, stop, audit, observed, before, available, toolsFor };
}

function readTool(run: SparkTool['run'], extra: Partial<SparkTool> = {}) {
  return sparkTool({
    name: 'spark_tickets',
    title: 'Tickets',
    description: 'Read tickets',
    input: { query: z.string() },
    privateData: true,
    ...extra,
    run,
  });
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('preserves scope, argument validation, private observations and redacted results', async () => {
  const run = vi.fn(async (_args: unknown, context: SparkToolContext) => ({
    workspace: context.scope.workspaceId,
    access_token: 'private-access-token',
    items: ['ticket'],
  }));
  const { bridge, observed, audit } = fixture([readTool(run)]);
  const result = await bridge.invoke('spark_tickets', { query: 'private search' }, bridge.signal);
  expect(result).toMatchObject({
    isError: false,
    data: { workspace: 'workspace', items: ['ticket'] },
  });
  expect(JSON.stringify(result)).not.toContain('private-access-token');
  expect(observed).toHaveBeenCalledWith({
    source: 'private_data',
    label: 'private work data (spark_tickets)',
  });
  expect(audit.mock.calls.map((call) => call[1].params.outcome)).toEqual(['started', 'completed']);
  expect(JSON.stringify(audit.mock.calls)).not.toContain('private search');
  expect(JSON.stringify(audit.mock.calls)).not.toContain('ticket"');
  const invalid = await bridge.invoke('spark_tickets', { query: 8 }, bridge.signal);
  expect(invalid).toMatchObject({ isError: true });
  expect(run).toHaveBeenCalledTimes(1);
  bridge.close();
});

it('refuses mutations, unknown names and recursive execution even if offered', async () => {
  const run = vi.fn(async () => ({}));
  const { bridge } = fixture([
    readTool(run, { acts: true }),
    readTool(run, { name: 'spark_execute' }),
    readTool(run, { name: 'spark_browser_read' }),
  ]);
  for (const name of ['spark_tickets', 'spark_execute', 'spark_browser_read', 'constructor']) {
    await expect(bridge.invoke(name, {}, bridge.signal)).rejects.toThrow('not available');
  }
  expect(run).not.toHaveBeenCalled();
  bridge.close();
});

it('refreshes availability and the session hook before every inner call', async () => {
  const run = vi.fn(async () => ({}));
  const tool = readTool(run);
  const { bridge, toolsFor, available, before } = fixture([tool]);
  expect(await bridge.discover('tickets')).toMatchObject([
    { name: 'spark_tickets', inputSchema: { type: 'object' } },
  ]);
  toolsFor.mockReturnValueOnce([]);
  await expect(bridge.invoke('spark_tickets', { query: '' }, bridge.signal)).rejects.toThrow(
    'not available',
  );
  expect(available).toHaveBeenCalledTimes(2);
  expect(before).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
  bridge.close();
});

it('honors session-hook failures before connector access', async () => {
  const { bridge, before, available } = fixture([]);
  before.mockRejectedValueOnce(new Error('session ended'));
  await expect(bridge.discover()).rejects.toThrow('session ended');
  expect(available).not.toHaveBeenCalled();
  bridge.close();
});

it('propagates cancellation to fetch and refuses late results and subsequent calls', async () => {
  const entered = deferred();
  const finish = deferred();
  let requestSignal: AbortSignal | null | undefined;
  const run = vi.fn(async (_args: unknown, context: SparkToolContext) => {
    await context.deps.fetch('https://example.com/tickets', {
      signal: AbortSignal.timeout(10_000),
    });
    entered.resolve();
    await finish.promise;
    return { items: ['late private data'] };
  });
  const { bridge, context, stop, audit, observed } = fixture([readTool(run)]);
  context.deps.fetch = vi.fn(async (_input, init) => {
    requestSignal = init?.signal;
    return new Response('{}');
  });
  const pending = bridge.invoke('spark_tickets', { query: '' }, bridge.signal);
  await entered.promise;
  stop.abort();
  expect(requestSignal?.aborted).toBe(true);
  finish.resolve();
  await expect(pending).rejects.toThrow();
  expect(observed).toHaveBeenCalledTimes(1);
  await expect(bridge.invoke('spark_tickets', { query: '' }, bridge.signal)).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls.at(-1)?.[1].params.outcome).toBe('cancelled');
});

it('uses saved GitHub connections without invoking the gh fallback', async () => {
  const run = vi.fn(async (_args: unknown, context: SparkToolContext) => {
    expect(await context.deps.github.locateGh()).toBeNull();
    await expect(context.deps.github.runCommand('gh', ['api'], 1000)).rejects.toThrow(
      'saved GitHub connection',
    );
    return { ok: true };
  });
  const { bridge, context } = fixture([readTool(run, { name: 'spark_pr' })]);
  expect(await bridge.invoke('spark_pr', { query: '' }, bridge.signal)).toMatchObject({
    data: { ok: true },
  });
  expect(context.deps.github.runCommand).not.toHaveBeenCalled();
  bridge.close();
});

it('returns schemas only for an eligible discovery match', async () => {
  const { bridge } = fixture([
    readTool(async () => ({})),
    readTool(async () => ({}), { name: 'spark_push', acts: true }),
  ]);
  expect(await bridge.discover('push')).toEqual([]);
  expect(await bridge.discover('tickets')).toMatchObject([
    { inputSchema: { required: ['query'] } },
  ]);
  bridge.close();
});

it('cancels concurrent reads together without returning late data', async () => {
  const entered = deferred();
  const finish = deferred();
  let started = 0;
  const run = vi.fn(async () => {
    if (++started === 2) entered.resolve();
    await finish.promise;
    return { private: 'late data' };
  });
  const { bridge, stop, observed } = fixture([readTool(run)]);
  const calls = Promise.allSettled([
    bridge.invoke('spark_tickets', { query: 'first' }, bridge.signal),
    bridge.invoke('spark_tickets', { query: 'second' }, bridge.signal),
  ]);
  await entered.promise;
  stop.abort();
  finish.resolve();
  expect((await calls).map((call) => call.status)).toEqual(['rejected', 'rejected']);
  expect(observed).toHaveBeenCalledTimes(2);
  expect(bridge.receipts().map((call) => call.outcome)).toEqual(['cancelled', 'cancelled']);
});

it('records private reads before the next dependent call executes', async () => {
  let reads = 0;
  const { bridge, observed } = fixture([
    readTool(async () => {
      if (reads++ > 0) expect(observed).toHaveBeenCalledTimes(1);
      return { next: 'read another ticket' };
    }),
  ]);
  await bridge.invoke('spark_tickets', { query: 'first' }, bridge.signal);
  await bridge.invoke('spark_tickets', { query: 'second' }, bridge.signal);
  expect(observed).toHaveBeenCalledTimes(2);
  bridge.close();
});

it('bounds receipt memory without limiting completed calls or dropping audit entries', async () => {
  const run = vi.fn(async () => ({ ok: true }));
  const { bridge, audit } = fixture([readTool(run)]);
  for (let index = 0; index < 120; index += 1) {
    await bridge.invoke('spark_tickets', { query: String(index) }, bridge.signal);
  }
  expect(run).toHaveBeenCalledTimes(120);
  expect(bridge.receipts()).toHaveLength(50);
  expect(bridge.receipts()[0]?.callId).toBe('execute:71');
  expect(bridge.receipts().at(-1)?.callId).toBe('execute:120');
  expect(bridge.receiptCounts()).toEqual({ totalCalls: 120, omittedCalls: 70 });
  expect(audit).toHaveBeenCalledTimes(240);
  bridge.close();
});
