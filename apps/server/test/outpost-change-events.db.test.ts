import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import {
  addMemberChat,
  createOutpostRow,
  deliverRequest,
  finishRun,
  postRunId,
} from './outpost-fixtures.ts';
import { outpostEvents } from './outpost-store-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;
let events: Awaited<ReturnType<typeof outpostEvents>>;

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  api = await addMemberChat(t, outpostId, 'api');
  events = await outpostEvents();
});

afterEach(async () => {
  await events.close();
  await t.cleanup();
});

async function settled(): Promise<void> {
  const marker = await createOutpostRow(t, 'Marker');
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body) VALUES (gen_random_uuid(), $1, 'note', 'x')`,
    [marker],
  );
  await eventually(async () => events.seen.includes(marker));
}

async function eventsFrom(change: () => Promise<unknown>): Promise<string[]> {
  await settled();
  const before = events.seen.length;
  await change();
  await settled();
  return events.seen.slice(before, -1);
}

async function startedRequest(): Promise<string> {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body: 'List the order fields',
  });
  await drainQueue(t.db, api, async () => ({ provider: 'fake' }));
  const runId = await postRunId(t.db, postId);
  if (runId === null) throw new Error('The request did not start a turn.');
  return runId;
}

describe('outpost_changed', () => {
  it('is sent when a request is written and when its turn starts', async () => {
    expect(await eventsFrom(startedRequest)).toContain(outpostId);
  });

  it.each(['running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'] as const)(
    'is sent when the turn of a request becomes %s',
    async (status) => {
      const runId = await startedRequest();
      const seen = await eventsFrom(() =>
        t.db.query('UPDATE runs SET status = $2 WHERE id = $1', [runId, status]),
      );
      expect(seen).toEqual([outpostId]);
    },
  );

  it('is sent when the user’s own turn in a member chat ends, which can hold a queued request', async () => {
    const own = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'my own work' },
      { provider: 'fake' },
    );
    const seen = await eventsFrom(() => finishRun(t.db, own.run.id, 'failed'));
    expect(seen).toEqual([outpostId]);
  });

  it('is not sent for a turn in a chat outside every outpost', async () => {
    const seen = await eventsFrom(() => startChat(t, 'unrelated work'));
    expect(seen).toEqual([]);
  });

  it('is not sent when a run changes without changing status', async () => {
    const runId = await startedRequest();
    const seen = await eventsFrom(() =>
      t.db.query('UPDATE runs SET cancel_requested_at = now() WHERE id = $1', [runId]),
    );
    expect(seen).toEqual([]);
  });
});
