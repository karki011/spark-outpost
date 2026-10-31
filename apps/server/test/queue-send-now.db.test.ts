import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue, listQueue } from '../src/persistence/chat-queue.ts';
import { drainQueue, sendNow } from '../src/workflow/queue-drain.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
const target = async () => ({ provider: 'fake' });

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function sourceOf(messageId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ source: string }>(
    'SELECT source FROM runs WHERE user_message_id = $1',
    [messageId],
  );
  return rows[0]?.source ?? null;
}

describe('Send now with an origin', () => {
  it('starts a spoken message as spoken when the chat is free', async () => {
    const { conversationId, runId } = await startChat(t, 'Done');
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const id = randomUUID();
    const outcome = await sendNow(
      t.db,
      conversationId,
      { id, content: 'Summarise it', origin: 'voice' },
      target,
    );
    expect(outcome).toBe('sent');
    expect(await sourceOf(id)).toBe('voice');
  });

  it('refuses to steer a running turn with a spoken message or a tabs question', async () => {
    const { conversationId } = await startChat(t, 'Busy');
    for (const origin of ['voice', 'pages'] as const) {
      const id = randomUUID();
      await expect(
        sendNow(t.db, conversationId, { id, content: 'Now', origin }, target),
      ).rejects.toMatchObject({ status: 409 });
      const steered = await t.db.query('SELECT 1 FROM member_messages WHERE id = $1', [id]);
      expect(steered.rowCount).toBe(0);
    }
    expect(await listQueue(t.db, conversationId)).toEqual([]);
  });
});

describe('reordering the queue', () => {
  it('refuses an order that no longer matches the queue, so positions never tie', async () => {
    const { conversationId } = await startChat(t, 'Busy');
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of [a, b]) await addToQueue(t.db, conversationId, { id, content: id });
    const api = localClient(createTestApp(t));
    const order = `/api/conversations/${conversationId}/queue/order`;
    await addToQueue(t.db, conversationId, { id: c, content: c });

    for (const stale of [
      [b, a],
      [b, a, a],
      [b, a, c, c],
    ]) {
      const moved = await api.send('put', order, { ids: stale });
      expect(moved.status).toBe(409);
    }
    const ordered = await api.send('put', order, { ids: [c, b, a] });
    expect(ordered.status).toBe(200);
    const queue = await listQueue(t.db, conversationId);
    expect(queue.map((item) => item.id)).toEqual([c, b, a]);
    expect(new Set(queue.map((item) => item.position)).size).toBe(3);
  });
});

describe('changing a queued message after it was sent', () => {
  it('says it was already sent instead of pretending to remove or edit it', async () => {
    const { conversationId, runId } = await startChat(t, 'Busy');
    const id = randomUUID();
    await addToQueue(t.db, conversationId, { id, content: 'Next' });
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');

    const api = localClient(createTestApp(t));
    const item = `/api/conversations/${conversationId}/queue/${id}`;
    const removed = await api.send('delete', item);
    expect(removed.status).toBe(409);
    expect(removed.body.error).toBe('That message has already been sent.');
    const edited = await api.send('patch', item, { content: 'Changed' });
    expect(edited.status).toBe(404);
    expect(edited.body.error).toBe('That message has already been sent.');
  });

  it('removes a queued message, and removing it again is not an error', async () => {
    const { conversationId } = await startChat(t, 'Busy');
    const id = randomUUID();
    await addToQueue(t.db, conversationId, { id, content: 'Next' });
    const api = localClient(createTestApp(t));
    const item = `/api/conversations/${conversationId}/queue/${id}`;
    expect((await api.send('delete', item)).status).toBe(200);
    expect((await api.send('delete', item)).status).toBe(200);
    expect(await listQueue(t.db, conversationId)).toEqual([]);
  });
});
