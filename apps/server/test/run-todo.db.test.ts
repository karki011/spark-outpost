import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanEntry, PlanStatus } from '@spark-outpost/contracts';
import {
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider, ProviderOutput } from '../src/providers/provider.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

const list = (...statuses: PlanStatus[]): PlanEntry[] =>
  statuses.map((status, index) => ({
    content: `Step ${index + 1}`,
    priority: 'medium',
    status,
  }));

const plan = (...statuses: PlanStatus[]): ProviderOutput => ({
  kind: 'plan',
  entries: list(...statuses),
});

const tool: ProviderOutput[] = [
  { kind: 'step_started', name: 'Read a file', tool: true },
  { kind: 'step_finished', name: 'Read a file' },
];

const scripts: Record<string, ProviderOutput[]> = {
  first: [plan('in_progress', 'pending'), plan('completed', 'in_progress'), ...tool],
  second: [plan('completed', 'completed'), { kind: 'text_delta', delta: 'Done' }],
  repeat: [plan('completed', 'completed'), plan('completed', 'completed')],
  question: [{ kind: 'text_delta', delta: 'It is Tuesday.' }],
};

let release: () => void = () => {};

function start() {
  const provider: Provider = {
    name: 'scripted',
    async *run(turn) {
      if (turn.prompt === 'held') {
        yield plan('completed', 'in_progress', 'in_progress');
        await new Promise<void>((resolve) => (release = resolve));
        return;
      }
      yield* scripts[turn.prompt] ?? [];
    },
  };
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
}

async function send(conversationId: string, content: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'scripted' },
  );
  return eventually(async () => {
    const run = await getRun(t.db, sent.run.id);
    return run?.finishedAt ? run : null;
  });
}

async function todoEvents(runId: string): Promise<number> {
  const { rows } = await t.db.query(
    `SELECT 1 FROM run_events WHERE run_id = $1 AND type = 'ACTIVITY_SNAPSHOT'
       AND payload->>'activityType' = 'todo'`,
    [runId],
  );
  return rows.length;
}

describe("each turn's own to-do", () => {
  it('keeps the list a turn ran even after a later turn only ticks it off', async () => {
    start();
    const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    const first = await send(conversationId, 'first');
    const second = await send(conversationId, 'second');

    expect((await getRun(t.db, first.id))?.todo).toEqual(list('completed', 'in_progress'));
    expect((await getRun(t.db, second.id))?.todo).toEqual(list('completed', 'completed'));

    const detail = await getConversationDetail(t.db, conversationId);
    const stored = new Map(detail!.runs.map((run) => [run.id, run.todo]));
    expect(stored.get(first.id)).toEqual(list('completed', 'in_progress'));
    expect(stored.get(second.id)).toEqual(list('completed', 'completed'));
    expect(detail!.tasks).toHaveLength(1);
    expect(detail!.tasks[0]!.todo.map((item) => item.state)).toEqual(['done', 'done']);
    expect(detail!.tasks[0]!.summary).toMatchObject({ done: 2, total: 2, text: '2 of 2 done' });
  });

  it('sends one live update per change and none for a repeat', async () => {
    start();
    const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    const first = await send(conversationId, 'first');
    const repeat = await send(conversationId, 'repeat');
    expect(await todoEvents(first.id)).toBe(2);
    expect(await todoEvents(repeat.id)).toBe(1);
    expect((await getRun(t.db, repeat.id))?.todo).toEqual(list('completed', 'completed'));
  });

  it('stores no list for a turn whose agent made none', async () => {
    start();
    const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    const run = await send(conversationId, 'question');
    expect(run.todo).toBeNull();
    expect(await todoEvents(run.id)).toBe(0);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail!.tasks).toEqual([]);
  });

  it('names the first entry in progress on the chat list while the turn runs', async () => {
    start();
    const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'held' },
      { provider: 'scripted' },
    );
    try {
      const running = await eventually(async () => {
        const row = (await listConversations(t.db, t.workspaceId)).find(
          (chat) => chat.id === conversationId,
        );
        return row?.latestRun?.doing ? row.latestRun : null;
      });
      expect(running).toMatchObject({
        doing: 'Step 2',
        progress: { done: 1, active: 2, total: 3 },
      });
    } finally {
      release();
    }
    await eventually(async () => (await getRun(t.db, sent.run.id))?.finishedAt ?? null);
    const done = (await listConversations(t.db, t.workspaceId)).find(
      (chat) => chat.id === conversationId,
    );
    expect(done?.latestRun?.doing).toBeNull();
  });
});
