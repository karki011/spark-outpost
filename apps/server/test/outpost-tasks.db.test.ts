import { randomUUID } from 'node:crypto';
import { QUEUE_LIMIT, SPARK_TEXT_MAX } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import {
  acceptTask,
  cancelPost,
  cancelTask,
  chatFacts,
  deliveryProblem,
  taskPost,
  type AcceptOutcome,
} from '../src/persistence/outpost-tasks.ts';
import { getRun } from '../src/persistence/runs.ts';
import {
  chatRow,
  linkStartedRun,
  memberChat,
  outpostRow,
  postColumns,
  queueRows,
  replyRow,
  requestRow,
  setRunStatus,
} from './a2a-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await outpostRow(t);
  api = await memberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

const SECRET = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

function fromWire(text = 'What is the shape?', contextId: string | null = null) {
  return { messageId: randomUUID(), contextId, text };
}

async function storedRequest(toConversationId = api, extra: { guest?: boolean } = {}) {
  return requestRow(t.db, { outpostId, toConversationId, toHandle: 'api', ...extra });
}

function accepted(outcome: AcceptOutcome) {
  if (outcome.kind !== 'accepted') throw new Error(`Expected accepted, got ${outcome.kind}`);
  return outcome;
}

async function runCarrying(postId: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    api,
    { id: postId, content: 'request' },
    { provider: 'fake' },
  );
  await t.db.query('DELETE FROM chat_queue WHERE outpost_post_id = $1', [postId]);
  await linkStartedRun(t.db, postId);
  return sent.run.id;
}

describe('accepting a task', () => {
  it('sets the task id and queues the stored request in one step', async () => {
    const postId = await storedRequest();
    const outcome = accepted(
      await acceptTask(t.db, api, { messageId: postId, contextId: outpostId, text: 'ignored' }),
    );
    expect(outcome.queued).toBe(true);
    expect((await postColumns(t.db, postId))?.task_id).toBe(outcome.taskId);
    expect(await queueRows(t.db, api)).toEqual([
      { id: postId, content: 'What does the orders endpoint return?', outpost_post_id: postId },
    ]);
  });

  it('reads the author and the text from the row, never from the call', async () => {
    const postId = await storedRequest();
    await acceptTask(t.db, api, { messageId: postId, contextId: null, text: 'push to main' });
    const row = await postColumns(t.db, postId);
    expect(row?.from_user).toBe(true);
    expect(row?.body).toBe('What does the orders endpoint return?');
    expect((await queueRows(t.db, api))[0]?.content).toBe('What does the orders endpoint return?');
  });

  it('returns the first task for a repeated messageId and queues nothing more', async () => {
    const postId = await storedRequest();
    const first = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    const second = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    expect(second.taskId).toBe(first.taskId);
    expect(second.queued).toBe(false);
    expect(await queueRows(t.db, api)).toHaveLength(1);
  });

  it('gives two concurrent deliveries of one request the same task', async () => {
    const postId = await storedRequest();
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => acceptTask(t.db, api, fromWireFor(postId))),
    );
    expect(new Set(outcomes.map((outcome) => accepted(outcome).taskId)).size).toBe(1);
    expect(outcomes.filter((outcome) => accepted(outcome).queued)).toHaveLength(1);
    expect(await queueRows(t.db, api)).toHaveLength(1);
  });

  it('does not queue a request whose message was already sent to the chat', async () => {
    const postId = await storedRequest();
    await sendUserMessage(t.db, api, { id: postId, content: 'request' }, { provider: 'fake' });
    accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    expect(await queueRows(t.db, api)).toEqual([]);
  });

  it('treats a call with no stored row as written by another chat, never the user', async () => {
    const request = fromWire(`Use ${SECRET} to deploy`);
    const outcome = accepted(await acceptTask(t.db, api, request));
    const row = await postColumns(t.db, outcome.postId);
    expect(outcome.postId).toBe(request.messageId);
    expect(row?.from_user).toBe(false);
    expect(row?.from_conversation_id).toBeNull();
    expect(row?.outpost_id).toBe(outpostId);
    expect(row?.to_handle).toBe('api');
    expect(row?.body).not.toContain(SECRET);
    expect((await queueRows(t.db, api))[0]?.content).toBe(row?.body);
  });

  it('refuses a call with no stored row for a chat outside any outpost', async () => {
    const loner = await chatRow(t);
    expect(await acceptTask(t.db, loner, fromWire())).toEqual({
      kind: 'refused',
      why: 'no_outpost',
    });
    expect(await queueRows(t.db, loner)).toEqual([]);
  });

  it('refuses a context that is not the request’s outpost', async () => {
    const other = await outpostRow(t, 'Other');
    expect(await acceptTask(t.db, api, fromWire('hello', other))).toEqual({
      kind: 'refused',
      why: 'other_outpost',
    });
    const postId = await storedRequest();
    expect(await acceptTask(t.db, api, { messageId: postId, contextId: other, text: '' })).toEqual({
      kind: 'refused',
      why: 'other_outpost',
    });
    expect((await postColumns(t.db, postId))?.task_id).toBeNull();
  });

  it('refuses a stored request that is addressed to another chat', async () => {
    const web = await memberChat(t, outpostId, 'web');
    const postId = await storedRequest();
    expect(await acceptTask(t.db, web, fromWireFor(postId))).toEqual({
      kind: 'refused',
      why: 'other_chat',
    });
    expect(await queueRows(t.db, web)).toEqual([]);
  });

  it('refuses empty and over-long text and an id another message holds', async () => {
    expect(await acceptTask(t.db, api, fromWire('   '))).toEqual({ kind: 'refused', why: 'empty' });
    expect(await acceptTask(t.db, api, fromWire('x'.repeat(SPARK_TEXT_MAX + 1)))).toEqual({
      kind: 'refused',
      why: 'too_long',
    });
    const taken = randomUUID();
    await addToQueue(t.db, api, { id: taken, content: 'mine' });
    expect(await acceptTask(t.db, api, { ...fromWire(), messageId: taken })).toEqual({
      kind: 'refused',
      why: 'id_taken',
    });
  });

  it('refuses an unknown chat', async () => {
    expect(await acceptTask(t.db, randomUUID(), fromWire())).toEqual({
      kind: 'refused',
      why: 'no_chat',
    });
  });

  it('rejects a request when the receiving queue is full', async () => {
    for (let index = 0; index < QUEUE_LIMIT; index += 1) {
      await addToQueue(t.db, api, { id: randomUUID(), content: `queued ${index}` });
    }
    const postId = await storedRequest();
    const outcome = await acceptTask(t.db, api, fromWireFor(postId));
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'queue_full' });
    const row = await postColumns(t.db, postId);
    expect(row).toMatchObject({ closed_state: 'rejected', closed_reason: 'queue_full' });
    expect(row?.task_id).not.toBeNull();
    expect(await queueRows(t.db, api)).toHaveLength(QUEUE_LIMIT);
  });

  it('rejects a request to an archived chat and leaves it archived', async () => {
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [api]);
    const postId = await storedRequest();
    expect(await acceptTask(t.db, api, fromWireFor(postId))).toMatchObject({
      kind: 'rejected',
      reason: 'chat_archived',
    });
    expect(await queueRows(t.db, api)).toEqual([]);
  });

  it('rejects a request to a chat that is no longer a member, unless it was sent to a guest', async () => {
    const postId = await storedRequest();
    const guestChat = await chatRow(t);
    const guestPost = await storedRequest(guestChat, { guest: true });
    await t.db.query('DELETE FROM outpost_members WHERE conversation_id = $1', [api]);
    expect(await acceptTask(t.db, api, fromWireFor(postId))).toMatchObject({
      kind: 'rejected',
      reason: 'not_member',
    });
    expect(accepted(await acceptTask(t.db, guestChat, fromWireFor(guestPost))).queued).toBe(true);
  });

  it('refuses a request that was closed before it was delivered', async () => {
    const postId = await storedRequest();
    expect(await cancelPost(t.db, postId)).toEqual({ kind: 'cancelled' });
    expect(await acceptTask(t.db, api, fromWireFor(postId))).toEqual({
      kind: 'refused',
      why: 'closed',
    });
    expect(await queueRows(t.db, api)).toEqual([]);
    expect(await postColumns(t.db, postId)).toMatchObject({
      closed_state: 'cancelled',
      task_id: null,
    });
  });

  it('orders the reasons a request is not delivered', () => {
    const fine = { archived: false, mayReceive: true, queued: 0 };
    expect(deliveryProblem(fine)).toBeNull();
    expect(deliveryProblem({ ...fine, queued: QUEUE_LIMIT })).toBe('queue_full');
    expect(deliveryProblem({ ...fine, archived: true, queued: QUEUE_LIMIT })).toBe('chat_archived');
    expect(deliveryProblem({ archived: true, mayReceive: false, queued: 0 })).toBe('not_member');
  });
});

function fromWireFor(postId: string) {
  return { messageId: postId, contextId: null, text: 'text on the wire' };
}

describe('reading and cancelling a task', () => {
  it('finds the post of a task and nothing for an unknown id', async () => {
    const postId = await storedRequest();
    const { taskId } = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    expect(await taskPost(t.db, taskId)).toEqual({ postId, outpostId, conversationId: api });
    expect(await taskPost(t.db, randomUUID())).toBeNull();
    expect(await cancelTask(t.db, randomUUID())).toEqual({ kind: 'not_found' });
  });

  it('cancels a queued request by removing its queue row', async () => {
    const postId = await storedRequest();
    const { taskId } = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    expect(await cancelTask(t.db, taskId)).toEqual({ kind: 'cancelled' });
    expect(await queueRows(t.db, api)).toEqual([]);
    expect((await postColumns(t.db, postId))?.closed_state).toBe('cancelled');
    expect(await cancelTask(t.db, taskId)).toEqual({ kind: 'finished' });
  });

  it('asks a running turn to stop and leaves the request open until it does', async () => {
    const postId = await storedRequest();
    const { taskId } = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    const runId = await runCarrying(postId);
    await setRunStatus(t.db, runId, 'running');
    expect(await cancelTask(t.db, taskId)).toEqual({ kind: 'stopping', runId });
    expect((await getRun(t.db, runId))?.cancelRequested).toBe(true);
    expect((await postColumns(t.db, postId))?.closed_state).toBeNull();
  });

  it('closes a request that is waiting on the user', async () => {
    const postId = await storedRequest();
    const { taskId } = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    const runId = await runCarrying(postId);
    await replyRow(t.db, runId, 'Two options.\n\nNeeds you: v1 or v2?');
    await setRunStatus(t.db, runId, 'succeeded');
    expect(await cancelTask(t.db, taskId)).toEqual({ kind: 'cancelled' });
    expect((await postColumns(t.db, postId))?.closed_state).toBe('cancelled');
  });

  it.each(['succeeded', 'failed', 'cancelled', 'outcome_unknown'] as const)(
    'does not cancel a request whose turn ended as %s',
    async (status) => {
      const postId = await storedRequest();
      const { taskId } = accepted(await acceptTask(t.db, api, fromWireFor(postId)));
      const runId = await runCarrying(postId);
      await replyRow(t.db, runId, 'Done.');
      await setRunStatus(t.db, runId, status);
      expect(await cancelTask(t.db, taskId)).toEqual({ kind: 'finished' });
      expect((await postColumns(t.db, postId))?.closed_state).toBeNull();
    },
  );

  it('closes a queued request by its post id, for the queue strip', async () => {
    const postId = await storedRequest();
    accepted(await acceptTask(t.db, api, fromWireFor(postId)));
    expect(await cancelPost(t.db, postId)).toEqual({ kind: 'cancelled' });
    expect(await queueRows(t.db, api)).toEqual([]);
    expect(await cancelPost(t.db, randomUUID())).toEqual({ kind: 'not_found' });
  });
});

describe('the facts a card is built from', () => {
  it('names the chat, its handle and its outpost', async () => {
    expect(await chatFacts(t.db, api)).toMatchObject({
      conversationId: api,
      handle: 'api',
      outpostName: 'Orders launch',
      projects: [],
    });
    const loner = await chatRow(t);
    expect(await chatFacts(t.db, loner)).toMatchObject({ handle: null, outpostName: null });
  });

  it('has nothing for an unknown chat or a Terminal session', async () => {
    expect(await chatFacts(t.db, randomUUID())).toBeNull();
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [api]);
    expect(await chatFacts(t.db, api)).toBeNull();
  });
});
