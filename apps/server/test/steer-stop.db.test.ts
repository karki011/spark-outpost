import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listQueue } from '../src/persistence/chat-queue.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import {
  claimMemberMessages,
  getMemberMessage,
  insertMemberMessage,
  markUnreadOnStop,
} from '../src/persistence/member-messages.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function turn() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Fix the build' },
    { provider: 'fake' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function steer(conversationId: string, runId: string, status?: 'interrupting') {
  const id = randomUUID();
  await insertMemberMessage(t.db, {
    id,
    conversationId,
    runId,
    body: `message ${id.slice(0, 4)}`,
    urgency: 'now',
    ...(status ? { status } : {}),
  });
  return id;
}

async function agentEvent(runId: string, type: string, secondsAfterNow: number) {
  await t.db.query(
    `INSERT INTO run_events (run_id, seq, type, payload, created_at)
     VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, '{}',
       now() + make_interval(secs => $3))`,
    [runId, type, secondsAfterNow],
  );
}

const status = async (id: string) => (await getMemberMessage(t.db, id))?.status;

describe('stopping a turn with messages sent to it', () => {
  it('marks a delivered message the agent never acted on as missed', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await claimMemberMessages(t.db, runId, runId, true);
    await agentEvent(runId, 'STEP_FINISHED', 5);

    await markUnreadOnStop(t.db, runId);

    expect(await status(id)).toBe('missed');
  });

  it('keeps a delivered message the agent went on to act on as delivered', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await claimMemberMessages(t.db, runId, runId, true);
    await agentEvent(runId, 'STEP_STARTED', 5);

    await markUnreadOnStop(t.db, runId);

    expect(await status(id)).toBe('delivered');
  });

  it('ignores agent steps from before the message arrived and reply text flushed at the stop', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await agentEvent(runId, 'STEP_STARTED', -5);
    await claimMemberMessages(t.db, runId, runId, true);
    await agentEvent(runId, 'TEXT_MESSAGE_CONTENT', 5);

    await markUnreadOnStop(t.db, runId);

    expect(await status(id)).toBe('missed');
  });

  it('marks a send-now message still waiting as missed instead of starting a new turn', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);

    await markUnreadOnStop(t.db, runId);

    expect(await status(id)).toBe('missed');
  });

  it('leaves waiting messages alone when Spark stopped the turn to send a message first', async () => {
    const { conversationId, runId } = await turn();
    const interrupting = await steer(conversationId, runId, 'interrupting');
    const waiting = await steer(conversationId, runId);

    await markUnreadOnStop(t.db, runId);

    expect(await status(interrupting)).toBe('interrupting');
    expect(await status(waiting)).toBe('queued');
  });

  it('is safe to run twice', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await markUnreadOnStop(t.db, runId);
    await markUnreadOnStop(t.db, runId);
    expect(await status(id)).toBe('missed');
  });
});

describe('where a message was taken in', () => {
  it('keeps the reply position it arrived at, and forgets it when sent back to waiting', async () => {
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    const anchor = { textOffset: 12, textBefore: 'Checking CI.', textHeld: 0 };

    const [claimed] = await claimMemberMessages(t.db, runId, runId, true, anchor);

    expect(claimed).toMatchObject({ id, status: 'delivered', ...anchor });
    expect(await getMemberMessage(t.db, id)).toMatchObject(anchor);
  });
});

describe('a missed message', () => {
  it('starts the next turn with it at once when the chat is free, and only once', async () => {
    const app = localClient(createTestApp(t));
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await markUnreadOnStop(t.db, runId);
    await t.db.query(`UPDATE runs SET status = 'cancelled', finished_at = now() WHERE id = $1`, [
      runId,
    ]);

    const resent = await app.send(
      'post',
      `/api/conversations/${conversationId}/steers/${id}/resend`,
    );
    expect(resent.status).toBe(202);
    expect(await getMemberMessage(t.db, id)).toBeNull();
    expect(await listQueue(t.db, conversationId)).toEqual([]);
    const next = await t.db.query('SELECT 1 FROM runs WHERE user_message_id = $1', [id]);
    expect(next.rowCount).toBe(1);

    const again = await app.send(
      'post',
      `/api/conversations/${conversationId}/steers/${id}/resend`,
    );
    expect(again.status).toBe(404);
  });

  it('queues it behind a turn that is already running', async () => {
    const app = localClient(createTestApp(t));
    const { conversationId, runId } = await turn();
    const id = await steer(conversationId, runId);
    await markUnreadOnStop(t.db, runId);

    const resent = await app.send(
      'post',
      `/api/conversations/${conversationId}/steers/${id}/resend`,
    );
    expect(resent.status).toBe(202);
    expect((await listQueue(t.db, conversationId)).map((item) => item.id)).toEqual([id]);
  });

  it('can be taken back to edit, and only while it is missed', async () => {
    const app = localClient(createTestApp(t));
    const { conversationId, runId } = await turn();
    const waiting = await steer(conversationId, runId);

    const early = await app.send(
      'delete',
      `/api/conversations/${conversationId}/steers/${waiting}`,
    );
    expect(early.status).toBe(404);
    expect(await status(waiting)).toBe('queued');

    await markUnreadOnStop(t.db, runId);
    const removed = await app.send(
      'delete',
      `/api/conversations/${conversationId}/steers/${waiting}`,
    );
    expect(removed.status).toBe(200);
    expect(await getMemberMessage(t.db, waiting)).toBeNull();
    expect(await listQueue(t.db, conversationId)).toEqual([]);
  });

  it('cannot be moved from another chat', async () => {
    const app = localClient(createTestApp(t));
    const { conversationId, runId } = await turn();
    const other = await turn();
    const id = await steer(conversationId, runId);
    await markUnreadOnStop(t.db, runId);

    const moved = await app.send(
      'post',
      `/api/conversations/${other.conversationId}/steers/${id}/resend`,
    );
    expect(moved.status).toBe(404);
    expect(await status(id)).toBe('missed');
  });
});
