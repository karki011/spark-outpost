import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestStateSchema, type DigestState } from '@spark-outpost/contracts';
import { listConversations, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { FAKE_COST_USD, FAKE_UNKNOWN_CHAT, createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function startFakeWorker() {
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fake]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function connectClaude() {
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Ada', 'claude', now())`,
    [t.workspaceId],
  );
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'cli', 'claude test', '[]', NULL, 'ask', 'high', now())`,
    [t.workspaceId],
  );
}

async function chat(title: string, status = 'succeeded', error: string | null = null) {
  const id = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content: title },
    { provider: 'claude' },
    t.workspaceId,
  );
  await t.db.query(
    `UPDATE runs SET status = $2, error = $3, started_at = now(),
       finished_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() END
     WHERE id = $1`,
    [sent.run.id, status, error],
  );
  await t.db.query(`UPDATE jobs SET status = 'done' WHERE run_id = $1`, [sent.run.id]);
  return { id, runId: sent.run.id };
}

const post = (trigger: 'open' | 'refresh') =>
  request(app).post('/api/home/digest?tz=UTC').set(LOCAL_HEADERS).send({ trigger });

async function state(response: Promise<request.Response> | request.Test): Promise<DigestState> {
  const result = await response;
  expect(result.status).toBe(200);
  return digestStateSchema.parse(result.body);
}

async function digestCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM digests',
  );
  return rows[0]!.count;
}

async function ready(): Promise<DigestState> {
  return eventually(async () => {
    const current = await state(request(app).get('/api/home/digest').set(LOCAL_HEADERS));
    return current.digest?.status === 'ready' || current.digest?.status === 'failed'
      ? current
      : null;
  }, 10_000);
}

describe('home digest', () => {
  it('is unavailable without a connected default provider', async () => {
    await chat('Fix the parser');
    const result = await state(post('open'));
    expect(result).toMatchObject({ available: false, digest: null });
    expect(await digestCount()).toBe(0);
  });

  it('writes nothing when there has been no activity', async () => {
    await connectClaude();
    const result = await state(post('refresh'));
    expect(result).toMatchObject({ available: true, digest: null, newActivity: false });
    expect(await digestCount()).toBe(0);
  });

  it('runs a plain digest turn on the middle tier and keeps only known chat links', async () => {
    await connectClaude();
    const done = await chat('Refactor the date formatter');
    const failed = await chat('Mock fetch retries', 'failed', 'Claude is rate limited.');
    startFakeWorker();

    const started = await state(post('open'));
    expect(started.digest).toMatchObject({ status: 'running', provider: 'claude' });
    expect(started.digest?.modelLabel).toBe('Sonnet 5');

    const result = await ready();
    const digest = result.digest!;
    expect(digest.status).toBe('ready');
    expect(digest.body?.structured).toBe(true);
    expect(digest.body?.headline).toBe('1 chat finished, 1 chat failed or stalled.');
    expect(digest.stats).toEqual({ finished: 1, waiting: 0, failedOrStalled: 1, costUsd: null });
    const linked = digest.body!.lines.map((line) => line.chatId);
    expect(linked).not.toContain(FAKE_UNKNOWN_CHAT);
    const known: (string | null)[] = [done.id, failed.id];
    expect(linked.filter(Boolean).every((id) => known.includes(id))).toBe(true);
    expect(digest.body!.suggestions).toEqual([
      expect.objectContaining({ chatId: failed.id, reason: 'Unfinished: last run failed.' }),
    ]);
    expect(digest.costUsd).toBeCloseTo(FAKE_COST_USD);

    const { rows } = await t.db.query<{
      id: string;
      role: string;
      mode: string;
      model: string;
      effort: string;
    }>(
      `SELECT r.id, r.role, r.mode, r.model, r.effort FROM runs r
       JOIN digests d ON d.run_id = r.id`,
    );
    expect(rows[0]).toMatchObject({ role: 'digest', mode: 'chat', model: 'sonnet', effort: 'low' });
    expect((await getRun(t.db, rows[0]!.id))?.status).toBe('succeeded');
    const listed = await listConversations(t.db, t.workspaceId);
    expect(listed.map((entry) => entry.title).sort()).toEqual([
      'Mock fetch retries',
      'Refactor the date formatter',
    ]);
  });

  it('serves the cached digest, throttles refreshes and runs again after an hour', async () => {
    await connectClaude();
    await chat('Refactor the date formatter');
    startFakeWorker();
    await state(post('open'));
    await ready();

    await chat('Explore invalid dates');
    const throttled = await state(post('refresh'));
    expect(throttled.refreshableAt).not.toBeNull();
    expect(await digestCount()).toBe(1);

    await t.db.query(`UPDATE digests SET created_at = created_at - interval '20 minutes'`);
    const cached = await state(post('open'));
    expect(cached.digest?.status).toBe('ready');
    expect(cached.newActivity).toBe(true);
    expect(await digestCount()).toBe(1);

    const refreshed = await state(post('refresh'));
    expect(refreshed.digest?.status).toBe('running');
    expect(await digestCount()).toBe(2);
    await ready();

    const hourAgo = `created_at - interval '61 minutes'`;
    await t.db.query(`UPDATE digests SET created_at = ${hourAgo}`);
    await t.db.query(
      `UPDATE runs SET created_at = ${hourAgo}, finished_at = finished_at - interval '61 minutes'`,
    );
    const quiet = await state(post('open'));
    expect(quiet.newActivity).toBe(false);
    expect(await digestCount()).toBe(2);

    await chat('Tidy the exports');
    const again = await state(post('open'));
    expect(again.digest?.status).toBe('running');
    expect(await digestCount()).toBe(3);
    await ready();
  });

  it('records a failed digest quietly', async () => {
    await connectClaude();
    await chat('Break things #fail');
    startFakeWorker();
    await state(post('refresh'));
    const result = await ready();
    expect(result.digest).toMatchObject({ status: 'failed', body: null });
    expect(result.digest?.error).toContain('#fail');
  });

  it('waits for the worker to record a finished digest before calling it unfinished', async () => {
    await connectClaude();
    await chat('Fix the parser');
    const started = await state(post('refresh'));
    expect(started.digest?.status).toBe('running');
    const digestRun = `id = (SELECT run_id FROM digests)`;

    await t.db.query(`UPDATE runs SET status = 'failed', finished_at = now() WHERE ${digestRun}`);
    expect((await state(post('open'))).digest?.status).toBe('running');

    await t.db.query(
      `UPDATE runs SET finished_at = now() - interval '2 minutes' WHERE ${digestRun}`,
    );
    expect((await state(post('open'))).digest).toMatchObject({
      status: 'failed',
      error: 'The digest did not finish. Try again.',
    });
  });

  it('calls a digest unfinished when it has been running for over ten minutes', async () => {
    await connectClaude();
    await chat('Fix the parser');
    await state(post('refresh'));
    await t.db.query(`UPDATE digests SET created_at = created_at - interval '11 minutes'`);
    expect((await state(post('open'))).digest).toMatchObject({
      status: 'failed',
      error: 'The digest did not finish. Try again.',
    });
  });

  it('rejects an unknown trigger', async () => {
    const response = await request(app)
      .post('/api/home/digest')
      .set(LOCAL_HEADERS)
      .send({ trigger: 'always' });
    expect(response.status).toBe(400);
  });
});
