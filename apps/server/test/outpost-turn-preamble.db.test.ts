import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { turnObservations } from '../src/persistence/observations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { addMemberChat, createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;
let preambles: (string | undefined)[];
let outpostId: string;
let api: string;
let web: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });

const recording: Provider = {
  name: 'fake',
  async *run(turn) {
    preambles.push(turn.preamble);
    yield { kind: 'text_delta', delta: 'Done.' };
  },
};

beforeEach(async () => {
  t = await createTestDb();
  preambles = [];
  outpostId = await createOutpostRow(t, 'Orders launch');
  api = await addMemberChat(t, outpostId, 'api');
  web = await addMemberChat(t, outpostId, 'web');
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function note(body: string, from: { conversationId: string; handle: string } | null) {
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, from_conversation_id, from_handle)
     VALUES ($1, $2, 'note', $3, $4, $5, $6)`,
    [
      randomUUID(),
      outpostId,
      body,
      from === null,
      from?.conversationId ?? null,
      from?.handle ?? null,
    ],
  );
}

async function finished(runId: string): Promise<void> {
  worker ??= startWorker({
    db: t.db,
    providers: new Map([['fake', recording]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
    coordinator: 'off',
  });
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null));
}

async function requestTurn(toConversationId: string, toHandle: string): Promise<string> {
  const postId = await deliverRequest(t.db, { outpostId, toConversationId, toHandle });
  await drainQueue(t.db, toConversationId, target);
  const runId = (await postRunId(t.db, postId))!;
  await finished(runId);
  return runId;
}

describe('what a member chat is told before its turn', () => {
  it('is the outpost notes written since its last turn, once', async () => {
    await note('The orders table moved to the v2 schema.', { conversationId: web, handle: 'web' });

    const first = await requestTurn(api, 'api');
    const second = await requestTurn(api, 'api');

    expect(preambles).toHaveLength(2);
    expect(preambles[0]).toContain('Outpost notes since your last turn');
    expect(preambles[0]).toContain(
      '<outpost-note from="@web">\nThe orders table moved to the v2 schema.\n</outpost-note>',
    );
    expect(preambles[1] ?? '').not.toContain('Outpost notes');
    const labels = async (runId: string) =>
      (await turnObservations(t.db, runId)).map((observed) => observed.label);
    expect(await labels(first)).toContain('private work data (outpost notes)');
    expect(await labels(second)).not.toContain('private work data (outpost notes)');
  });

  it('leaves out a note the chat wrote itself', async () => {
    await note('I renamed the route.', { conversationId: api, handle: 'api' });

    await requestTurn(api, 'api');

    expect(preambles).toEqual([undefined]);
  });

  it('is nothing for a chat in no outpost', async () => {
    const plain = randomUUID();
    await createConversation(t.db, t.workspaceId, plain);
    await note('Not for chats outside.', null);

    const sent = await sendUserMessage(
      t.db,
      plain,
      { id: randomUUID(), content: 'Hello', source: 'ui' },
      { provider: 'fake' },
    );
    await finished(sent.run.id);

    expect(preambles).toEqual([undefined]);
  });
});
