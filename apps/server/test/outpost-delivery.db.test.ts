import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addToQueue,
  editQueued,
  listQueue,
  QueueError,
  takeQueued,
} from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import {
  drainQueue,
  drainWaiting,
  sendNow,
  waitingQueues,
  type ResolveTarget,
} from '../src/workflow/queue-drain.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { expectConformantRun } from './agui-conformance.ts';
import {
  addMemberChat,
  chatTurns,
  createOutpostRow,
  deliverRequest,
  finishRun,
  pauseOutpost,
  postRunId,
} from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({ provider: 'fake' });

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

const request = (body = 'Add the orders endpoint.') =>
  deliverRequest(t.db, { outpostId, toConversationId: api, toHandle: 'api', body });

const userTurn = (content = 'my own message') =>
  sendUserMessage(t.db, api, { id: randomUUID(), content }, { provider: 'fake' });

const queuedIds = async () => (await listQueue(t.db, api)).map((item) => item.id);

describe('an outpost request reaching an idle chat', () => {
  it('starts one turn from the outpost and writes the run back to the post', async () => {
    const postId = await request();

    expect(await drainQueue(t.db, api, target)).toBe('sent');

    const turns = await chatTurns(t.db, api);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      source: 'outpost',
      status: 'queued',
      user_message_id: postId,
    });
    expect(await postRunId(t.db, postId)).toBe(turns[0]!.id);
    expect(await queuedIds()).toEqual([]);
    const message = await t.db.query('SELECT role, content FROM messages WHERE id = $1', [postId]);
    expect(message.rows).toEqual([{ role: 'user', content: 'Add the orders endpoint.' }]);
    const jobs = await t.db.query('SELECT status FROM jobs WHERE run_id = $1', [turns[0]!.id]);
    expect(jobs.rows).toEqual([{ status: 'queued' }]);
  });

  it('runs under the target resolved for the receiving chat', async () => {
    await request();
    const asked: string[] = [];
    await drainQueue(t.db, api, async (conversationId) => {
      asked.push(conversationId);
      return { provider: 'fake', agentMode: 'plan', level: 'hands-off', permission: 'ask' };
    });

    expect(asked).toEqual([api]);
    const run = await t.db.query(
      'SELECT provider, agent_mode FROM runs WHERE conversation_id = $1',
      [api],
    );
    expect(run.rows).toEqual([{ provider: 'fake', agent_mode: 'plan' }]);
  });

  it('leaves an ordinary queued message a queue turn with no outpost link', async () => {
    const id = randomUUID();
    await addToQueue(t.db, api, { id, content: 'typed by the user' });
    expect((await listQueue(t.db, api))[0]).not.toHaveProperty('outpostPostId');

    expect(await drainQueue(t.db, api, target)).toBe('sent');

    expect((await chatTurns(t.db, api))[0]).toMatchObject({ source: 'queue', user_message_id: id });
  });
});

describe('an outpost request reaching a busy chat', () => {
  it('waits in the queue, marked as an outpost item, and starts when the turn ends', async () => {
    const running = await userTurn();
    const postId = await request();

    expect(await drainQueue(t.db, api, target)).toBe('busy');
    expect(await listQueue(t.db, api)).toMatchObject([{ id: postId, outpostPostId: postId }]);
    expect(await postRunId(t.db, postId)).toBeNull();

    await finishRun(t.db, running.run.id, 'succeeded', 'Done.');
    expect(await drainQueue(t.db, api, target)).toBe('sent');
    expect(await postRunId(t.db, postId)).not.toBeNull();
  });

  it('takes its turn in queue order with the user’s own queued messages', async () => {
    const running = await userTurn();
    const first = randomUUID();
    await addToQueue(t.db, api, { id: first, content: 'queued by the user' });
    const postId = await request();
    await finishRun(t.db, running.run.id, 'succeeded', 'Done.');

    expect(await drainQueue(t.db, api, target)).toBe('sent');
    expect(await queuedIds()).toEqual([postId]);
    const turns = await chatTurns(t.db, api);
    expect(turns.at(-1)).toMatchObject({ source: 'queue', user_message_id: first });
  });

  it('holds while the chat’s last turn did not succeed', async () => {
    const failed = await userTurn();
    await finishRun(t.db, failed.run.id, 'failed');
    const postId = await request();

    expect(await drainQueue(t.db, api, target)).toBe('paused');
    expect(await queuedIds()).toEqual([postId]);
    expect(await postRunId(t.db, postId)).toBeNull();
  });

  it('starts one turn when two drains race', async () => {
    const postId = await request();

    const outcomes = await Promise.all([
      drainQueue(t.db, api, target),
      drainQueue(t.db, api, target),
    ]);

    expect([...outcomes].sort()).toEqual(['busy', 'sent']);
    expect(await drainQueue(t.db, api, target)).toBe('busy');
    const turns = await chatTurns(t.db, api);
    expect(turns).toHaveLength(1);
    expect(await postRunId(t.db, postId)).toBe(turns[0]!.id);
  });
});

describe('a paused outpost', () => {
  it('does not start its request and does not block the user’s queued message behind it', async () => {
    const running = await userTurn();
    const postId = await request();
    const mine = randomUUID();
    await addToQueue(t.db, api, { id: mine, content: 'queued by the user' });
    await pauseOutpost(t.db, outpostId, true);
    await finishRun(t.db, running.run.id, 'succeeded', 'Done.');

    expect(await drainQueue(t.db, api, target)).toBe('sent');

    const turns = await chatTurns(t.db, api);
    expect(turns.at(-1)).toMatchObject({ source: 'queue', user_message_id: mine });
    expect(await queuedIds()).toEqual([postId]);
    expect(await postRunId(t.db, postId)).toBeNull();
  });

  it('reads as an empty queue to the drain and the sweep until it is resumed', async () => {
    const postId = await request();
    await pauseOutpost(t.db, outpostId, true);

    expect(await drainQueue(t.db, api, target)).toBe('empty');
    expect(await waitingQueues(t.db)).toEqual([]);
    expect(await drainWaiting(t.db, target)).toBe(0);
    expect(await queuedIds()).toEqual([postId]);

    await pauseOutpost(t.db, outpostId, false);
    expect(await waitingQueues(t.db)).toEqual([api]);
    expect(await drainWaiting(t.db, target)).toBe(1);
    expect((await chatTurns(t.db, api))[0]).toMatchObject({ source: 'outpost' });
  });

  it('lets the user remove the paused item', async () => {
    const postId = await request();
    await pauseOutpost(t.db, outpostId, true);

    expect(await takeQueued(t.db, api, postId)).toMatchObject({ id: postId });
    expect(await queuedIds()).toEqual([]);
  });

  it('refuses Send now for its item and leaves it queued', async () => {
    const postId = await request();
    await pauseOutpost(t.db, outpostId, true);

    await expect(sendNow(t.db, api, { id: postId }, target)).rejects.toMatchObject({
      status: 409,
      message: 'The outpost is paused.',
    });
    expect(await queuedIds()).toEqual([postId]);
    expect(await chatTurns(t.db, api)).toEqual([]);
  });
});

describe('the queue strip and an outpost item', () => {
  it('refuses an edit, which would make the user its author', async () => {
    const postId = await request();

    const edit = editQueued(t.db, api, postId, 'rewritten');
    await expect(edit).rejects.toBeInstanceOf(QueueError);
    await expect(edit).rejects.toMatchObject({ status: 409 });
    expect((await listQueue(t.db, api))[0]?.content).toBe('Add the orders endpoint.');
  });

  it('still edits the user’s own item', async () => {
    const id = randomUUID();
    const running = await userTurn();
    await addToQueue(t.db, api, { id, content: 'first draft' });
    await editQueued(t.db, api, id, 'second draft');
    expect((await listQueue(t.db, api))[0]?.content).toBe('second draft');
    await expect(editQueued(t.db, api, randomUUID(), 'x')).rejects.toMatchObject({ status: 404 });
    await finishRun(t.db, running.run.id, 'succeeded');
  });

  it('starts an outpost turn on Send now when the chat is free', async () => {
    const postId = await request();

    expect(await sendNow(t.db, api, { id: postId }, target)).toBe('sent');

    const turns = await chatTurns(t.db, api);
    expect(turns).toMatchObject([{ source: 'outpost', user_message_id: postId }]);
    expect(await postRunId(t.db, postId)).toBe(turns[0]!.id);
  });

  it('never turns an outpost item into a steering message for the running turn', async () => {
    await userTurn();
    const postId = await request();

    await expect(sendNow(t.db, api, { id: postId }, target)).rejects.toMatchObject({ status: 409 });

    expect(await queuedIds()).toEqual([postId]);
    const steering = await t.db.query('SELECT 1 FROM member_messages WHERE conversation_id = $1', [
      api,
    ]);
    expect(steering.rowCount).toBe(0);
  });
});

describe('a restart', () => {
  it('starts a request that was still queued, from the recovery sweep', async () => {
    const postId = await request();

    expect(await waitingQueues(t.db)).toEqual([api]);
    expect(await drainWaiting(t.db, target)).toBe(1);
    expect(await drainWaiting(t.db, target)).toBe(0);

    const turns = await chatTurns(t.db, api);
    expect(turns).toMatchObject([{ source: 'outpost', user_message_id: postId }]);
    expect(await postRunId(t.db, postId)).toBe(turns[0]!.id);
  });

  it('leaves a request whose turn was running on that run, failed, and retries nothing', async () => {
    const postId = await request();
    await drainQueue(t.db, api, target);
    const lease = (await claimNextJob(t.db, 30))!;
    await t.db.query(
      `UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [lease.jobId],
    );

    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await drainWaiting(t.db, target)).toBe(0);

    const turns = await chatTurns(t.db, api);
    expect(turns).toMatchObject([{ source: 'outpost', status: 'outcome_unknown' }]);
    expect(await postRunId(t.db, postId)).toBe(lease.runId);
    expect(await claimNextJob(t.db, 30)).toBeNull();
    await expectConformantRun(t.db, lease.runId);
  });

  it('holds a second request behind the interrupted turn until the user acts', async () => {
    await request('first');
    await drainQueue(t.db, api, target);
    const lease = (await claimNextJob(t.db, 30))!;
    await t.db.query(
      `UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [lease.jobId],
    );
    await recoverExpiredLeases(t.db);
    const second = await request('second');

    expect(await drainQueue(t.db, api, target)).toBe('paused');
    expect(await queuedIds()).toEqual([second]);
    expect(await postRunId(t.db, second)).toBeNull();
  });
});
