import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { providerHealthSchema, spendSummarySchema } from '@spark-outpost/contracts';
import { listConversations, sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

interface RunSpec {
  provider: string;
  model?: string;
  status?: string;
  error?: string;
  cost?: number | null;
  costSource?: 'reported' | 'estimated';
  input?: number;
  output?: number;
  route?: Record<string, unknown>;
  hoursAgo?: number;
}

async function run(spec: RunSpec): Promise<{ runId: string; conversationId: string }> {
  const conversationId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: `ask ${spec.provider}` },
    { provider: spec.provider, model: spec.model ?? null },
    t.workspaceId,
  );
  const at = new Date(Date.now() - (spec.hoursAgo ?? 0) * 3_600_000);
  await t.db.query(
    `UPDATE runs SET status = $2, error = $3, cost_usd = $4, cost_source = $5,
       input_tokens = $6, output_tokens = $7, total_tokens = $6::int + $7::int, route = $8,
       created_at = $9, finished_at = $9
     WHERE id = $1`,
    [
      sent.run.id,
      spec.status ?? 'succeeded',
      spec.error ?? null,
      spec.cost ?? null,
      spec.cost === undefined || spec.cost === null ? null : (spec.costSource ?? 'reported'),
      spec.input ?? 0,
      spec.output ?? 0,
      spec.route ? JSON.stringify(spec.route) : null,
      at,
    ],
  );
  return { runId: sent.run.id, conversationId };
}

async function jevAdvice(runId: string, costUsd: number) {
  await t.db.query(
    `INSERT INTO run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body)
     VALUES ($1, 'route', 'answered', 1200, $2, '{}')`,
    [runId, costUsd],
  );
}

async function spend(range: string, tz = 'UTC') {
  const response = await get(`/api/usage/spend?range=${range}&tz=${encodeURIComponent(tz)}`);
  expect(response.status).toBe(200);
  return spendSummarySchema.parse(response.body);
}

describe('GET /api/usage/spend', () => {
  it('totals cost, runs and tokens by provider for the range and marks estimates', async () => {
    await run({ provider: 'claude', cost: 0.1, input: 1000, output: 200 });
    await run({ provider: 'codex', cost: 0.02, costSource: 'estimated', input: 500, output: 50 });
    await run({ provider: 'claude', cost: 5, input: 9000, output: 900, hoursAgo: 24 * 10 });

    const today = await spend('today');
    expect(today.range).toBe('today');
    expect(today.runs).toBe(2);
    expect(today.costUsd).toBeCloseTo(0.12);
    expect(today.costSource).toBe('mixed');
    expect(today.totalTokens).toBe(1750);
    expect(today.byProvider.map((row) => [row.provider, row.runs, row.costSource])).toEqual([
      ['claude', 1, 'reported'],
      ['codex', 1, 'estimated'],
    ]);

    const week = await spend('week');
    expect(week.runs).toBeGreaterThanOrEqual(2);
    expect(week.costUsd).toBeLessThan(5);
  });

  it('adds Jev as its own estimated slice', async () => {
    const { runId } = await run({ provider: 'claude', cost: 0.1, input: 100, output: 10 });
    await jevAdvice(runId, 0.004);

    const today = await spend('today');
    expect(today.runs).toBe(1);
    expect(today.byProvider.find((row) => row.provider === 'jev')).toMatchObject({
      runs: 1,
      costUsd: 0.004,
      costSource: 'estimated',
      totalTokens: 1200,
    });
    expect(today.costUsd).toBeCloseTo(0.104);
    expect(today.costSource).toBe('mixed');
  });

  it('starts the day in the viewer time zone and rejects bad parameters', async () => {
    const utc = await spend('today', 'UTC');
    const kiritimati = await spend('today', 'Pacific/Kiritimati');
    expect(utc.since).not.toBe(kiritimati.since);
    expect(new Date(utc.since).getUTCHours()).toBe(0);

    expect((await get('/api/usage/spend?range=year')).status).toBe(400);
    expect((await get('/api/usage/spend?range=today&tz=Not%20A%20Zone')).status).toBe(400);
    expect((await get('/api/usage/spend?range=today&tz=Mars/Olympus')).status).toBe(400);
  });
});

describe('GET /api/providers/health', () => {
  const SIGNED_OUT = "Claude isn't signed in. Open Settings, reconnect Claude, and try again.";

  async function issues() {
    const response = await get('/api/providers/health');
    expect(response.status).toBe(200);
    return providerHealthSchema.parse(response.body).issues;
  }

  it('reports recent sign-in and limit errors that have not recovered', async () => {
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 1 });
    await run({
      provider: 'zai',
      status: 'failed',
      error: 'Z.ai reported an error: {"code":"1302","message":"High concurrency"}',
    });
    await run({
      provider: 'codex',
      status: 'failed',
      error: 'Codex is rate limited.',
      hoursAgo: 2,
    });
    await run({ provider: 'codex', status: 'succeeded', hoursAgo: 1 });
    await run({ provider: 'claude', status: 'failed', error: 'Claude stopped unexpectedly.' });

    const found = await issues();
    expect(found.map((issue) => [issue.provider, issue.kind]).sort()).toEqual([
      ['claude', 'auth'],
      ['zai', 'rate_limit'],
    ]);
  });

  async function connectClaude(hoursAgo: number, test: { ok: boolean; hoursAgo: number } | null) {
    const at = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    await t.db.query(
      `INSERT INTO provider_connections
         (workspace_id, provider, method, detail, models, model, permission, effort, verified_at,
          last_test_at, last_test_ok, last_test_message)
       VALUES ($1, 'claude', 'cli', 'claude test', '[]', NULL, 'ask', 'high', $2, $3, $4, $5)`,
      [
        t.workspaceId,
        at(hoursAgo),
        test ? at(test.hoursAgo) : null,
        test?.ok ?? null,
        test ? 'Hello' : null,
      ],
    );
  }

  it('clears a sign-in error once a test message passes after it', async () => {
    await connectClaude(5, { ok: true, hoursAgo: 1 });
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 2 });
    expect(await issues()).toEqual([]);
  });

  it('clears a sign-in error once the CLI login check passes after it', async () => {
    await connectClaude(1, null);
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 2 });
    expect(await issues()).toEqual([]);
  });

  it('keeps a sign-in error that came after the last passing check', async () => {
    await connectClaude(5, { ok: true, hoursAgo: 3 });
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 2 });
    expect(await issues()).toMatchObject([{ provider: 'claude', kind: 'auth' }]);
  });

  it('keeps a sign-in error when the later test message failed', async () => {
    await connectClaude(5, { ok: false, hoursAgo: 1 });
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 2 });
    expect(await issues()).toMatchObject([{ provider: 'claude', kind: 'auth' }]);
  });

  it('keeps an older error hidden behind a cleared sign-in error', async () => {
    await connectClaude(5, { ok: true, hoursAgo: 1 });
    await run({
      provider: 'claude',
      status: 'failed',
      error: 'Claude is rate limited.',
      hoursAgo: 3,
    });
    await run({ provider: 'claude', status: 'failed', error: SIGNED_OUT, hoursAgo: 2 });
    expect(await issues()).toEqual([]);
  });

  it('ignores failures older than a day and says nothing when all is well', async () => {
    await run({ provider: 'zai', status: 'failed', error: 'No balance (1113)', hoursAgo: 30 });
    expect(await issues()).toEqual([]);
    await run({ provider: 'zai', status: 'failed', error: 'Z.ai error 1113: no balance' });
    expect(await issues()).toMatchObject([{ provider: 'zai', kind: 'usage_limit' }]);
  });
});

describe('conversation summaries for Home', () => {
  it('carry the latest run provider and its plan progress while it runs', async () => {
    const { runId, conversationId } = await run({ provider: 'codex', status: 'running' });
    const taskId = randomUUID();
    await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      'Plan',
    ]);
    await t.db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);
    const entries = (statuses: string[]) =>
      JSON.stringify({
        entries: statuses.map((status, index) => ({
          content: `Step ${index + 1}`,
          priority: 'medium',
          status,
        })),
      });
    await t.db.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body) VALUES
         ($1, 'plan', 1, $2), ($1, 'plan', 2, $3)`,
      [
        taskId,
        entries(['pending', 'pending', 'pending']),
        entries(['completed', 'in_progress', 'pending', 'pending']),
      ],
    );

    const [summary] = await listConversations(t.db, t.workspaceId);
    expect(summary?.latestRun).toMatchObject({
      provider: 'codex',
      progress: { done: 1, active: 1, total: 4 },
    });

    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const [finished] = await listConversations(t.db, t.workspaceId);
    expect(finished?.latestRun).toMatchObject({ provider: 'codex', progress: null });
  });
});
