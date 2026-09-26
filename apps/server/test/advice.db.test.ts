import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdviceBody } from '@spark-outpost/contracts';
import { createIntakeRecorder, type IntakeRecorder } from '../src/advisor/intake-recorder.ts';
import { runAdvice } from '../src/persistence/advice.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { activityTypesOf, createTestDb, eventTypes, eventually, type TestDb } from './support.ts';

const FAKE_JEV_KEY = 'fake-jev-key-for-db-tests';

let t: TestDb;
let worker: Worker | null = null;
let intake: IntakeRecorder;
let jevCalls: { authorization: string | null; body: Record<string, unknown> }[];

beforeEach(async () => {
  t = await createTestDb();
  jevCalls = [];
});

afterEach(async () => {
  await worker?.stop();
  await intake?.settled();
  worker = null;
  await t.cleanup();
});

const jevAnswer = {
  model: 'jev-1.13.0',
  answers: {
    intent: {
      type: 'choice',
      choice: 'bug_fix',
      probabilities: { bug_fix: 0.9 },
      confidence: 0.86,
    },
    complexity: { type: 'score', score: 0.4, confidence: 0.8 },
    risk: { type: 'score', score: 1, confidence: 0.7 },
    depth: { type: 'choice', choice: 'execute', probabilities: { execute: 0.8 }, confidence: 0.81 },
    effort_claude: { type: 'score', score: 1, confidence: 0.6 },
  },
  usage: { input_tokens: 1000, output_tokens: 0 },
};

function jevFetch(delayMs = 0): typeof fetch {
  return async (input, init) => {
    jevCalls.push({
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    expect(String(input)).toBe('https://typesafe.test/v1/systemone');
    await delay(delayMs, undefined, { signal: init?.signal ?? undefined });
    return new Response(JSON.stringify(jevAnswer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function connectClaude() {
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'cli', 'claude test', $2, 'sonnet', 'ask', 'high', now())`,
    [t.workspaceId, JSON.stringify([{ id: 'sonnet', label: 'Sonnet 5' }])],
  );
}

async function connectJev() {
  await t.db.query(
    `INSERT INTO advisor_connections
       (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())`,
    [t.workspaceId],
  );
}

function start(options: {
  fetch?: typeof fetch;
  timeoutMs?: number;
  stepMs?: number;
  key?: string | null;
}) {
  const provider = createFakeProvider({ stepMs: options.stepMs ?? 0, wordMs: 0 });
  intake = createIntakeRecorder({
    db: t.db,
    secrets: memorySecretStore(options.key === null ? {} : { jev: options.key ?? FAKE_JEV_KEY }),
    fetch: options.fetch ?? jevFetch(),
    baseUrl: 'https://typesafe.test',
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
    intake,
  });
}

async function send(content: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content },
    { provider: 'fake' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  });
}

async function advice(runId: string): Promise<AdviceBody> {
  return eventually(() => runAdvice(t.db, runId), 15_000);
}

describe('Jev intake recording', () => {
  it('records Jev and the rules next to a live run with an activity snapshot', async () => {
    await connectClaude();
    await connectJev();
    start({ stepMs: 150 });
    const { runId } = await send('Fix the typo in the README heading');

    const body = await advice(runId);
    expect(await getRun(t.db, runId).then((run) => run?.finishedAt)).toBeNull();
    expect(body).toMatchObject({
      jevStatus: 'answered',
      jevModel: 'jev-1.13.0',
      rules: { provider: 'fake', depth: 'direct', risk: 'read-only' },
      jev: {
        intent: 'bug_fix',
        provider: 'claude',
        model: 'sonnet',
        effort: 'medium',
        depth: 'execute',
      },
      gate: { decision: 'act', risk: 'read-only', level: 'balanced' },
      wouldApply: 'jev',
      usage: { inputTokens: 1000, tokenSource: 'reported', costSource: 'estimated' },
    });
    expect(body.usage?.costUsd).toBeCloseTo(0.000042);
    expect(jevCalls).toHaveLength(1);
    expect(jevCalls[0]!.authorization).toBe(`Bearer ${FAKE_JEV_KEY}`);
    expect(jevCalls[0]!.body.state).toEqual({
      task: 'Fix the typo in the README heading',
      mode: 'chat',
      reposLinked: false,
      providers: [{ provider: 'claude', models: ['sonnet'] }],
    });

    const run = await finished(runId);
    expect(run.status).toBe('succeeded');
    expect(await eventTypes(t.db, runId)).toContain('ACTIVITY_SNAPSHOT');
  });

  it('waits for Jev before acting and records its advice with the run', async () => {
    await connectClaude();
    await connectJev();
    start({ fetch: jevFetch(800) });
    const { runId, conversationId } = await send('Hello');

    const run = await finished(runId);
    expect(run.status).toBe('succeeded');
    const body = await runAdvice(t.db, runId);
    expect(body?.jevStatus).toBe('answered');
    expect(await activityTypesOf(t.db, runId)).toContain('advice');

    const app = createTestApp(t);
    const detail = await request(app).get(`/api/conversations/${conversationId}`).set('Host', HOST);
    expect(detail.body.advice[runId]).toMatchObject({ jevStatus: 'answered', wouldApply: 'jev' });
    expect(detail.body.advice[runId].questions).toBeUndefined();
    expect(detail.body.usageTotals.advisors).toEqual([
      { advisor: 'jev', calls: 1, inputTokens: 1000, costUsd: 0.000042 },
    ]);
    const summary = await request(app).get('/api/usage/summary').set('Host', HOST);
    expect(summary.body.advisors.last30Days).toEqual([
      { advisor: 'jev', calls: 1, inputTokens: 1000, costUsd: 0.000042 },
    ]);
  });

  it('records a timeout when Jev does not answer in time', async () => {
    await connectClaude();
    await connectJev();
    start({ fetch: jevFetch(5_000), timeoutMs: 100 });
    const { runId } = await send('Hello');

    const body = await advice(runId);
    expect(body).toMatchObject({
      jevStatus: 'timed_out',
      jevError: 'Jev did not answer in time.',
      jev: null,
      gate: null,
      wouldApply: 'rules',
      usage: null,
    });
    expect(body.latencyMs).toBeGreaterThanOrEqual(100);
    expect(body.questions).not.toBeNull();
    expect((await finished(runId)).status).toBe('succeeded');
  });

  it('records the rules alone, without calling Jev, when Jev is not connected', async () => {
    await connectClaude();
    start({});
    const { runId, conversationId } = await send('Hello');

    const body = await advice(runId);
    expect(body).toMatchObject({
      jevStatus: 'not_connected',
      jev: null,
      rules: { provider: 'fake', depth: 'direct' },
      wouldApply: 'rules',
      questions: null,
      state: null,
    });
    expect(jevCalls).toHaveLength(0);
    await finished(runId);
    expect(await activityTypesOf(t.db, runId)).not.toContain('advice');
    const app = createTestApp(t);
    const detail = await request(app).get(`/api/conversations/${conversationId}`).set('Host', HOST);
    expect(detail.body.usageTotals.advisors).toEqual([]);
  });

  it('records a failure when the keychain has no Jev key', async () => {
    await connectClaude();
    await connectJev();
    start({ key: null });
    const { runId } = await send('Hello');

    const body = await advice(runId);
    expect(body).toMatchObject({ jevStatus: 'failed', wouldApply: 'rules' });
    expect(body.jevError).toMatch(/key is missing/);
    expect(jevCalls).toHaveLength(0);
  });

  it('stores Auto as the chat routing without changing what runs', async () => {
    await connectClaude();
    await connectJev();
    const app = createTestApp(t);
    const id = randomUUID();
    await createConversation(t.db, t.workspaceId, id);
    const updated = await request(app)
      .patch(`/api/conversations/${id}/settings`)
      .set('Host', HOST)
      .set('Origin', ORIGIN)
      .send({ routing: 'auto' })
      .expect(200);
    expect(updated.body).toMatchObject({ provider: 'claude', model: 'sonnet', routing: 'auto' });
    start({});
    const sent = await sendUserMessage(
      t.db,
      id,
      { id: randomUUID(), content: 'Hi' },
      {
        provider: 'fake',
      },
    );
    const body = await advice(sent.run.id);
    expect(body.routing).toBe('auto');
    expect((await finished(sent.run.id)).provider).toBe('fake');
  });
});
