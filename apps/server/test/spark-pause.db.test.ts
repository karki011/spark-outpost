import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sparkPauseSchema } from '@spark-outpost/contracts';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { setSparkPaused, sparkPause } from '../src/persistence/spark-pause.ts';
import {
  drainQueue,
  drainWaiting,
  sendNow,
  waitingQueues,
  type ResolveTarget,
} from '../src/workflow/queue-drain.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import {
  addMemberChat,
  chatTurns,
  createOutpostRow,
  deliverRequest,
  finishRun,
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

const outpostRequest = (fromUser: boolean) =>
  deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body: fromUser ? 'Typed by you.' : 'Written by another chat.',
    fromUser,
  });

async function queueMessage(content: string): Promise<string> {
  const id = randomUUID();
  await addToQueue(t.db, api, { id, content });
  return id;
}

const queuedIds = async () => (await listQueue(t.db, api)).map((item) => item.id);

const pause = (paused: boolean) => setSparkPaused(t.db, t.workspaceId, paused);

describe('pausing Spark', () => {
  it('holds a queued message without dropping it, and sends it once Spark is resumed', async () => {
    const queued = await queueMessage('next step');
    await pause(true);

    expect(await drainQueue(t.db, api, target)).toBe('held');
    expect(await waitingQueues(t.db)).toEqual([]);
    expect(await drainWaiting(t.db, target)).toBe(0);
    expect(await queuedIds()).toEqual([queued]);
    expect(await chatTurns(t.db, api)).toHaveLength(0);

    await pause(false);
    expect(await drainWaiting(t.db, target)).toBe(1);
    expect(await queuedIds()).toEqual([]);
    expect(await chatTurns(t.db, api)).toHaveLength(1);
  });

  it('still runs a message the user types and sends', async () => {
    await pause(true);

    const sent = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'do it now' },
      { provider: 'fake' },
    );

    const lease = await claimNextJob(t.db, 30);
    expect(lease?.runId).toBe(sent.run.id);
  });

  it('still lets the user send a held queued message with Send now', async () => {
    const queued = await queueMessage('next step');
    await pause(true);

    expect(await sendNow(t.db, api, { id: queued }, target)).toBe('sent');
    expect(await queuedIds()).toEqual([]);
    expect(await chatTurns(t.db, api)).toHaveLength(1);
  });

  it('starts a request the user typed in an outpost, but holds one another chat wrote', async () => {
    const written = await outpostRequest(false);
    const typed = await outpostRequest(true);
    await pause(true);

    expect(await drainQueue(t.db, api, target, written)).toBe('held');
    expect(await drainQueue(t.db, api, target, typed)).toBe('sent');

    const turns = await chatTurns(t.db, api);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ user_message_id: typed });
    expect(await queuedIds()).toEqual([written]);
  });

  it('holds a typed request to a chat whose last turn failed, as it would while running', async () => {
    const failed = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'first' },
      { provider: 'fake' },
    );
    await finishRun(t.db, failed.run.id, 'failed');
    const typed = await outpostRequest(true);

    expect(await drainQueue(t.db, api, target, typed)).toBe('paused');
    await pause(true);
    expect(await drainQueue(t.db, api, target, typed)).toBe('held');

    expect(await queuedIds()).toHaveLength(1);
    expect(await chatTurns(t.db, api)).toHaveLength(1);
  });

  it('starts a request the user typed after stopping the last turn', async () => {
    const stopped = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'first' },
      { provider: 'fake' },
    );
    await t.db.query(
      `UPDATE runs SET status = 'cancelled', cancel_requested_at = now() - interval '1 minute'
       WHERE id = $1`,
      [stopped.run.id],
    );
    const typed = await outpostRequest(true);
    await pause(true);

    expect(await drainQueue(t.db, api, target, typed)).toBe('sent');
    expect(await queuedIds()).toEqual([]);
  });

  it('does not start the next queued message when a turn ends while paused', async () => {
    const sent = await sendUserMessage(
      t.db,
      api,
      { id: randomUUID(), content: 'first' },
      { provider: 'fake' },
    );
    const queued = await queueMessage('after that');
    await pause(true);
    await finishRun(t.db, sent.run.id, 'succeeded');

    expect(await drainQueue(t.db, api, target)).toBe('held');
    expect(await queuedIds()).toEqual([queued]);
  });

  it('keeps the time it was first paused when paused again', async () => {
    const first = await pause(true);
    const again = await pause(true);

    expect(again.pausedAt).toBe(first.pausedAt);
    expect((await pause(false)).pausedAt).toBeNull();
    expect((await sparkPause(t.db, t.workspaceId)).pausedAt).toBeNull();
  });
});

describe('the pause route', () => {
  it('pauses, reports and resumes Spark, and resuming sends what was held', async () => {
    const app = createTestApp(t);
    const queued = await queueMessage('next step');

    const paused = await request(app)
      .put('/api/spark-pause')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ paused: true })
      .expect(200);
    expect(sparkPauseSchema.parse(paused.body).pausedAt).not.toBeNull();
    expect(await drainQueue(t.db, api, target)).toBe('held');

    const read = await request(app).get('/api/spark-pause').set(LOCAL_HEADERS).expect(200);
    expect(read.body).toEqual(paused.body);

    await request(app)
      .put('/api/spark-pause')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ paused: false })
      .expect(200, { pausedAt: null });
    expect(await queuedIds()).not.toContain(queued);
    expect(await chatTurns(t.db, api)).toHaveLength(1);
  });

  it('refuses a body that is not a pause request', async () => {
    const app = createTestApp(t);
    await request(app)
      .put('/api/spark-pause')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({ paused: 'yes' })
      .expect(400);
  });
});
