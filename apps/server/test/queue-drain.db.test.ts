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
