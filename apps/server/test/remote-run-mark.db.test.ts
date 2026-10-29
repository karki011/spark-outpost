import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { removeMemberMessages } from '../src/persistence/member-messages.ts';
import { asDevice, rememberRemoteTyping, runFromDevice } from '../src/remote/run-mark.ts';
import { drainQueue, sendNow } from '../src/workflow/queue-drain.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
const DEVICE = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function deviceOf(runId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ device: string | null }>(
    'SELECT remote_device_id AS device FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.device ?? null;
}

function send(conversationId: string, id = randomUUID()) {
  return sendUserMessage(t.db, conversationId, { id, content: 'Next' }, { provider: 'fake' });
}

describe('marking runs a paired device started', () => {
  it('marks a run a device started with its message, and only that run', async () => {
    const { conversationId, runId } = await startChat(t, 'From the Mac');
    expect(await deviceOf(runId)).toBeNull();
    expect(await runFromDevice(t.db, runId)).toBe(false);
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const sent = await asDevice(DEVICE, () => send(conversationId));
    expect(await deviceOf(sent.run.id)).toBe(DEVICE);
    expect(await runFromDevice(t.db, sent.run.id)).toBe(true);
  });

  it('carries the device from a queued message to the run that sends it later', async () => {
    const { conversationId, runId } = await startChat(t, 'Busy turn');
    const id = randomUUID();
    await asDevice(DEVICE, () => addToQueue(t.db, conversationId, { id, content: 'Later' }));
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const sent = await send(conversationId, id);
    expect(await deviceOf(sent.run.id)).toBe(DEVICE);
    const after = await send(conversationId);
    expect(await deviceOf(after.run.id)).toBeNull();
  });

  it('marks the next Terminal turn after a device typed into the session, once', async () => {
    const { conversationId } = await startChat(t, 'Terminal session');
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      conversationId,
    ]);
    await asDevice(DEVICE, () => rememberRemoteTyping(t.db, conversationId));
    await rememberRemoteTyping(t.db, conversationId);
    const typed = await send(conversationId);
    expect(await deviceOf(typed.run.id)).toBe(DEVICE);
    const next = await send(conversationId);
    expect(await deviceOf(next.run.id)).toBeNull();
  });
});

describe('a message a paired device sent now into a running turn', () => {
  const target = async () => ({ provider: 'fake' });

  async function steerFromDevice() {
    const { conversationId, runId } = await startChat(t, 'Busy turn');
    const id = randomUUID();
    const outcome = await asDevice(DEVICE, () =>
      sendNow(t.db, conversationId, { id, content: 'Change course' }, target),
    );
    expect(outcome).toBe('steering');
    return { conversationId, runId, id };
  }

  async function newestRun(conversationId: string): Promise<string> {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    );
    return rows[0]!.id;
  }

  it('keeps the device when Spark stops the turn to send it', async () => {
    const { conversationId, runId, id } = await steerFromDevice();
    await t.db.query(`UPDATE member_messages SET status = 'interrupting' WHERE id = $1`, [id]);
    await t.db.query(`UPDATE runs SET status = 'cancelled' WHERE id = $1`, [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
    const sent = await newestRun(conversationId);
    expect(sent).not.toBe(runId);
    expect(await deviceOf(sent)).toBe(DEVICE);
  });

  it('keeps the device when it waits in the queue for the turn to end', async () => {
    const { conversationId, runId, id } = await steerFromDevice();
    await removeMemberMessages(t.db, [id]);
    await addToQueue(t.db, conversationId, { id, content: 'Change course' });
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    expect(await drainQueue(t.db, conversationId, target)).toBe('sent');
    expect(await deviceOf(await newestRun(conversationId))).toBe(DEVICE);
  });
});
