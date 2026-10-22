import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskWakes } from '../src/a2a/task-wakes.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { listPosts } from '../src/persistence/outpost-posts.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import type { Provider } from '../src/providers/provider.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { outpostAskTool } from '../src/spark-mcp/tools/outpost-ask-tool.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { addMemberChat, createOutpostRow, postRunId } from './outpost-fixtures.ts';
import { accept } from './outpost-store-support.ts';
import { gate, type Gate } from './outposts-e2e-support.ts';
import { outpostChanged } from './outpost-tool-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const HOLD = 'hold this turn';
const ASK = 'ask the api chat';
const STARTS_WITHIN_MS = 4_000;

let t: TestDb;
let worker: Worker | null = null;
let wakes: TaskWakes;
let held: Gate;
let outpostId: string;
let web: string;
let api: string;

beforeEach(async () => {
  t = await createTestDb();
  wakes = new TaskWakes();
  held = gate();
  outpostId = await createOutpostRow(t);
  web = await addMemberChat(t, outpostId, 'web');
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  held.open();
  outpostChanged(wakes, outpostId);
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

function askingProvider(deps: SparkToolDeps): Provider {
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return {
    name: fake.name,
    async *run(turn) {
      if (turn.prompt.includes(HOLD)) await held.opened;
      if (turn.sparkScope?.conversationId === web && turn.prompt.includes(ASK)) {
        await outpostAskTool.run(
          { to: 'api', text: 'Which fields does an order have?', wait: true },
          { deps, scope: turn.sparkScope, signal: turn.signal },
        );
      }
      yield* fake.run(turn);
    },
  };
}

function start(): void {
  const deps = { db: t.db, outposts: { wakes } } as unknown as SparkToolDeps;
  const provider = askingProvider(deps);
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
}

async function send(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
    t.workspaceId,
  );
  return sent.run.id;
}

async function statusOf(runId: string): Promise<string | undefined> {
  return (await getRun(t.db, runId))?.status;
}

async function deliverTheAsk(): Promise<string> {
  const request = await eventually(async () =>
    (await listPosts(t.db, outpostId)).find(({ post }) => post.kind === 'request'),
  );
  await eventually(async () => wakes.waiters === 1);
  await accept(t, request.post.id);
  await drainQueue(t.db, api, async () => ({ provider: 'fake' }));
  const runId = await postRunId(t.db, request.post.id);
  if (runId === null) throw new Error('The request started no turn.');
  return runId;
}

async function answersWhileTheAskerWaits(asking: string): Promise<void> {
  const asked = await deliverTheAsk();
  await eventually(async () => (await statusOf(asked)) === 'succeeded', STARTS_WITHIN_MS);
  expect(await statusOf(asking)).toBe('running');
  outpostChanged(wakes, outpostId);
  await eventually(async () => (await statusOf(asking)) === 'succeeded');
}

describe('a turn that waits for another chat', () => {
  it('lets the asked chat start while the asker waits', async () => {
    start();
    await answersWhileTheAskerWaits(await send(web, ASK));
  });

  it('lets the asked chat start beside a long turn in a third chat', async () => {
    start();
    const long = await send(await addMemberChat(t, outpostId, 'docs'), HOLD);
    await eventually(async () => (await statusOf(long)) === 'running');
    await answersWhileTheAskerWaits(await send(web, ASK));
    expect(await statusOf(long)).toBe('running');
  });
});
