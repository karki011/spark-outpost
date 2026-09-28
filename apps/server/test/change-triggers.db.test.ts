import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { listen, type NotificationListener } from '../src/persistence/notifications.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let listener: NotificationListener;
let notified: string[];

beforeEach(async () => {
  t = await createTestDb();
  notified = [];
  listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    const change = JSON.parse(payload) as { conversationId: string | null };
    if (change.conversationId) notified.push(change.conversationId);
  });
});

afterEach(async () => {
  await listener.close();
  await t.cleanup();
});

async function conversation(kind: 'chat' | 'digest'): Promise<string> {
  const { id } = await createConversation(t.db, t.workspaceId, randomUUID());
  if (kind === 'digest') {
    await t.db.query(`UPDATE conversations SET kind = 'digest' WHERE id = $1`, [id]);
  }
  return id;
}

async function settled(): Promise<void> {
  const fence = await conversation('chat');
  await eventually(async () => notified.includes(fence));
  notified.length = 0;
}

it('names the conversation insert and delete triggers after what fires them', async () => {
  const { rows } = await t.db.query<{ tgname: string; action: string }>(
    `SELECT tgname, pg_get_triggerdef(oid) AS action FROM pg_trigger
     WHERE tgrelid = 'conversations'::regclass AND NOT tgisinternal
       AND tgname IN ('conversations_insert_change', 'conversations_delete_change')
     ORDER BY tgname`,
  );
  expect(rows.map((row) => row.tgname)).toEqual([
    'conversations_delete_change',
    'conversations_insert_change',
  ]);
  expect(rows[0]!.action).toMatch(/AFTER DELETE ON/);
  expect(rows[1]!.action).toMatch(/AFTER INSERT ON/);
});

it('announces a deleted chat but not a deleted digest conversation', async () => {
  const digest = await conversation('digest');
  const chat = await conversation('chat');
  await settled();

  await t.db.query('DELETE FROM conversations WHERE id = $1', [digest]);
  await t.db.query('DELETE FROM conversations WHERE id = $1', [chat]);

  await eventually(async () => notified.includes(chat));
  expect(notified).not.toContain(digest);
});
