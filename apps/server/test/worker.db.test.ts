import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import {
  FAKE_COST_USD,
  FAKE_TOKENS,
  createFakeProvider,
  fakeReply,
} from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventTypes, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function start(timing = { stepMs: 0, wordMs: 0 }) {
  const provider = createFakeProvider(timing);
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    cancelPollMs: 20,
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

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run && run.finishedAt ? run : null;
  });
}

describe('worker', () => {
  it('runs a message to completion and stores the reply', async () => {
    start();
    const { conversationId, runId } = await send('Hello');

    expect((await settled(runId)).status).toBe('succeeded');
    const types = await eventTypes(t.db, runId);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types).toContain('STEP_STARTED');
    expect(types.slice(-2)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);

    const detail = await getConversationDetail(t.db, conversationId);
    const reply = detail?.messages.find((message) => message.role === 'assistant');
    expect(reply?.content).toBe(fakeReply('Hello'));
    expect(reply?.runId).toBe(runId);
    expect(detail?.runs[0]?.usage).toEqual({
      contextUsed: 12_000,
      contextSize: 200_000,
      costUsd: FAKE_COST_USD,
      costSource: 'reported',
      tokens: FAKE_TOKENS,
    });
    expect(detail?.usageTotals).toMatchObject({ costUsd: FAKE_COST_USD, totalTokens: 1200 });
  });

  it('stops a run when cancellation is requested', async () => {
    start({ stepMs: 50, wordMs: 50 });
    const { runId } = await send('Take your time');
    await eventually(async () => (await getRun(t.db, runId))?.status === 'running');

    await requestCancel(t.db, runId);

    expect((await settled(runId)).status).toBe('cancelled');
    const { rows } = await t.db.query<{ payload: { outcome?: { type: string } } }>(
      `SELECT payload FROM run_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1`,
      [runId],
    );
    expect(rows[0]?.payload.outcome?.type).toBe('cancelled');
  });

  it('reports a provider failure as a run error', async () => {
    start();
    const { runId } = await send('Please #fail');

    const run = await settled(runId);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('#fail');
    expect((await eventTypes(t.db, runId)).at(-1)).toBe('RUN_ERROR');
  });

  it('retries a full database with backoff instead of failing the run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tooMany = Object.assign(new Error('sorry, too many clients already'), { code: '53300' });
    start({ stepMs: 20, wordMs: 5 });
    const { runId } = await send('Hello');
    await eventually(async () => (await getRun(t.db, runId))?.status === 'running');
    const connect = vi
      .spyOn(pg.Pool.prototype, 'connect')
      .mockImplementationOnce(() => Promise.reject(tooMany) as never)
      .mockImplementationOnce(() => Promise.reject(tooMany) as never)
      .mockImplementationOnce(() => Promise.reject(tooMany) as never);

    expect((await settled(runId)).status).toBe('succeeded');
    expect(connect.mock.calls.length).toBeGreaterThan(3);
  });
});
