import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import { drainQueue, waitingQueues } from '../src/workflow/queue-drain.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
const target = async () => ({ provider: 'fake' });

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function finishedChat(title: string, status = 'succeeded') {
  const chat = await startChat(t, title);
  await t.db.query(`UPDATE runs SET status = $2 WHERE id = $1`, [chat.runId, status]);
  return chat;
}

async function queueOne(conversationId: string, content = 'Next') {
  const id = randomUUID();
  await addToQueue(t.db, conversationId, { id, content });
  return id;
}

async function archivedAt(conversationId: string): Promise<Date | null> {
  const { rows } = await t.db.query<{ archived_at: Date | null }>(
    'SELECT archived_at FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.archived_at ?? null;
}

describe('the sweep for queues waiting to send', () => {
  it('skips chats whose last turn stopped, so they never crowd out one that can go on', async () => {
    const stopped: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { conversationId } = await finishedChat(`Stopped ${index}`, 'cancelled');
      await queueOne(conversationId);
      stopped.push(conversationId);
    }
    const { conversationId: flowing } = await finishedChat('Flowing');
    await queueOne(flowing);

    const waiting = await waitingQueues(t.db);
    expect(waiting).toContain(flowing);
    expect(waiting.some((id) => stopped.includes(id))).toBe(false);
  });

  it('still sends a message waiting to interrupt a turn that stopped for it', async () => {
    const { conversationId, runId } = await finishedChat('Interrupted', 'cancelled');
    await queueOne(conversationId);
    await t.db.query(
      `INSERT INTO member_messages (id, conversation_id, run_id, body, urgency, status)
       VALUES ($1, $2, $3, 'Change course', 'now', 'interrupting')`,
      [randomUUID(), conversationId, runId],
    );
    expect(await waitingQueues(t.db)).toEqual([conversationId]);
  });

  it('takes the oldest waiting queue first', async () => {
    const { conversationId: older } = await finishedChat('Older');
    await queueOne(older);
    const { conversationId: newer } = await finishedChat('Newer');
    await queueOne(newer);
    expect(await waitingQueues(t.db, 1)).toEqual([older]);
  });
});

describe('an archived chat with queued messages', () => {
  it('holds its queue instead of bringing the chat back', async () => {
    const { conversationId } = await finishedChat('Archived');
    const id = await queueOne(conversationId);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      conversationId,
    ]);

    expect(await waitingQueues(t.db)).not.toContain(conversationId);
    expect(await drainQueue(t.db, conversationId, target)).toBe('archived');
    expect((await listQueue(t.db, conversationId)).map((item) => item.id)).toEqual([id]);
    expect(await archivedAt(conversationId)).not.toBeNull();

    await t.db.query('UPDATE conversations SET archived_at = NULL WHERE id = $1', [conversationId]);
    expect(await waitingQueues(t.db)).toContain(conversationId);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
  });
});
