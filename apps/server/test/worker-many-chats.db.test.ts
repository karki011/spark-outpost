import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { FAKE_EDIT_FILE } from '../src/providers/fake-approvals.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import type { Provider } from '../src/providers/provider.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { doRun } from './approval-support.ts';
import { gate, type Gate } from './outposts-e2e-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const HOLD = 'hold this turn';
const CHATS = 6;
const CRASHED_RUNS = 15;

let t: TestDb;
let root: string;
let worker: Worker | null = null;
let held: Gate;

beforeEach(async () => {
  t = await createTestDb();
  held = gate();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-many-chats-')));
  await writeFile(join(root, FAKE_EDIT_FILE), 'original\n');
});

afterEach(async () => {
  held.open();
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function untilOpenedOrStopped(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return Promise.race([
    held.opened,
    new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  ]);
}

function holdingProvider(): Provider {
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return {
    name: fake.name,
    async *run(turn) {
      if (turn.prompt.includes(HOLD)) await untilOpenedOrStopped(turn.signal);
      yield* fake.run(turn);
    },
  };
}

function start(): void {
  const provider = holdingProvider();
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
  });
}

async function newChat(): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

async function send(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
  );
  return sent.run.id;
}

async function sendInNewChats(count: number, content: string): Promise<string[]> {
  const runIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    runIds.push(await send(await newChat(), content));
  }
  return runIds;
}

async function statuses(runIds: readonly string[]): Promise<string[]> {
  return Promise.all(runIds.map(async (runId) => (await getRun(t.db, runId))?.status ?? 'gone'));
}

async function allReach(runIds: readonly string[], status: string): Promise<void> {
  await eventually(async () => (await statuses(runIds)).every((each) => each === status), 10_000);
}

async function chatRuns(conversationId: string) {
  const { rows } = await t.db.query<{
    id: string;
    status: string;
    created_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, status, created_at, finished_at FROM runs
     WHERE conversation_id = $1 AND parent_run_id IS NULL ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

describe('a worker with no limit on running chats', () => {
  it("starts every chat's turn as soon as it is sent", async () => {
    start();
    const runIds = await sendInNewChats(CHATS, HOLD);
    await allReach(runIds, 'running');
    held.open();
    await allReach(runIds, 'succeeded');
  });

  it('keeps starting other chats while one waits on an approval card', async () => {
    start();
    const waiting = await doRun(t, root, '#approve');
    await allReach([waiting.runId], 'awaiting_approval');
    const others = await sendInNewChats(CHATS, HOLD);
    await allReach(others, 'running');
    held.open();
    await allReach(others, 'succeeded');
    expect(await statuses([waiting.runId])).toEqual(['awaiting_approval']);
    await requestCancel(t.db, waiting.runId);
    await allReach([waiting.runId], 'cancelled');
  });

  it('keeps the turns of one chat in order while other chats run', async () => {
    start();
    const chat = await newChat();
    const first = await send(chat, HOLD);
    await allReach([first], 'running');
    await addToQueue(t.db, chat, { id: randomUUID(), content: 'And then this' });
    const others = await sendInNewChats(3, 'Hello');
    await allReach(others, 'succeeded');
    expect((await chatRuns(chat)).map((run) => run.id)).toEqual([first]);
    held.open();
    const [earlier, later] = await eventually(async () => {
      const runs = await chatRuns(chat);
      return runs.length === 2 && runs.every((run) => run.status === 'succeeded') ? runs : null;
    }, 10_000);
    expect(earlier!.id).toBe(first);
    expect(later!.created_at.getTime()).toBeGreaterThanOrEqual(earlier!.finished_at!.getTime());
  });

  it('stops many running turns, and only the ones asked to stop', async () => {
    start();
    const runIds = await sendInNewChats(CHATS, HOLD);
    await allReach(runIds, 'running');
    const stopping = runIds.slice(0, CHATS - 1);
    for (const runId of stopping) await requestCancel(t.db, runId);
    await allReach(stopping, 'cancelled');
    expect(await statuses(runIds.slice(-1))).toEqual(['running']);
    held.open();
    await allReach(runIds.slice(-1), 'succeeded');
  });

  it('recovers every run a crashed worker left behind in one sweep', async () => {
    const runIds = await sendInNewChats(CRASHED_RUNS, 'Hello');
    for (let index = 0; index < CRASHED_RUNS; index += 1) {
      expect(await claimNextJob(t.db, 30)).not.toBeNull();
    }
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    expect(await recoverExpiredLeases(t.db)).toBe(CRASHED_RUNS);
    expect(new Set(await statuses(runIds))).toEqual(new Set(['outcome_unknown']));
    start();
    const after = await sendInNewChats(CHATS, 'Hello');
    await allReach(after, 'succeeded');
  });
});
