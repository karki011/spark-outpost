import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getPost } from '../src/persistence/outpost-posts.ts';
import { ProviderError, type Provider, type ProviderTurn } from '../src/providers/provider.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import {
  acceptRequestRow,
  addMemberChat,
  createOutpostRow,
  finishRun,
  insertRequestRow,
  postRunId,
} from './outpost-fixtures.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null;
let turns: ProviderTurn[];
let failing: boolean;

const recording: Provider = {
  name: 'fake',
  async *run(turn) {
    turns.push(turn);
    if (failing) throw new ProviderError('The agent could not start.');
    yield { kind: 'text_delta', delta: 'Done.' };
  },
};

beforeEach(async () => {
  t = await createTestDb();
  worker = null;
  turns = [];
  failing = false;
});

afterEach(async () => {
  await worker?.stop();
  await t.cleanup();
});

async function answeredRequest(lead: string, api: string, outpostId: string): Promise<string> {
  const postId = await insertRequestRow(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
  });
  await t.db.query(
    `UPDATE outpost_posts SET from_user = false, from_conversation_id = $2, from_handle = 'lead'
     WHERE id = $1`,
    [postId, lead],
  );
  await acceptRequestRow(t.db, postId);
  expect(await drainQueue(t.db, api, async () => ({ provider: 'fake' }))).toBe('sent');
  await finishRun(t.db, (await postRunId(t.db, postId))!, 'succeeded', 'It returns a list.');
  return postId;
}

async function leadTurn(lead: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    lead,
    { id: randomUUID(), content, source: 'ui' },
    { provider: 'fake' },
  );
  return eventually(async () => {
    const { rows } = await t.db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
      sent.run.id,
    ]);
    const status = rows[0]?.status;
    return status === 'succeeded' || status === 'failed' ? status : null;
  });
}

const seenAt = async (postId: string) => (await getPost(t.db, postId))!.post.answerSeenAt;

describe('a late answer on the way to the chat that asked', () => {
  it('stays unseen when the turn fails, then reaches the next prompt once', async () => {
    const outpostId = await createOutpostRow(t);
    const lead = await addMemberChat(t, outpostId, 'lead');
    const api = await addMemberChat(t, outpostId, 'api');
    const postId = await answeredRequest(lead, api, outpostId);
    worker = startWorker({
      db: t.db,
      providers: new Map([[recording.name, recording]]),
      leaseSeconds: 30,
      concurrency: 1,
      pollMs: 20,
    });

    failing = true;
    expect(await leadTurn(lead, 'First.')).toBe('failed');
    expect(await seenAt(postId)).toBeNull();

    failing = false;
    expect(await leadTurn(lead, 'Second.')).toBe('succeeded');
    expect(turns.at(-1)?.turnPreamble).toContain('It returns a list.');
    expect(await seenAt(postId)).not.toBeNull();

    expect(await leadTurn(lead, 'Third.')).toBe('succeeded');
    expect(turns.at(-1)?.turnPreamble ?? '').not.toContain('It returns a list.');
  });
});
