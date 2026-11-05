import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneOldRows } from '../src/api/startup-prune.ts';
import { saveAttachment } from '../src/persistence/attachments.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function oldEmptyChat(): Promise<string> {
  const chat = await createConversation(t.db, t.workspaceId, randomUUID());
  await t.db.query(
    `UPDATE conversations SET updated_at = now() - interval '2 days' WHERE id = $1`,
    [chat.id],
  );
  return chat.id;
}

async function oldUnsentAttachment(): Promise<string> {
  const saved = await saveAttachment(t.db, t.workspaceId, {
    name: 'stale.txt',
    mediaType: 'text/plain',
    data: Buffer.from('stale'),
  });
  await t.db.query(`UPDATE attachments SET created_at = now() - interval '2 days' WHERE id = $1`, [
    saved.id,
  ]);
  return saved.id;
}

async function ids(table: 'conversations' | 'attachments'): Promise<string[]> {
  const { rows } = await t.db.query<{ id: string }>(`SELECT id FROM ${table}`);
  return rows.map((row) => row.id);
}

function failQueriesWith(db: Db, fragment: string): () => void {
  const query = db.query;
  db.query = ((...args: unknown[]) =>
    String(args[0]).includes(fragment)
      ? Promise.reject(new Error('disk is full'))
      : (query as (...inner: unknown[]) => unknown)(...args)) as Db['query'];
  return () => {
    db.query = query;
  };
}

describe('pruning old rows after the API starts', () => {
  it('removes day-old empty chats and unsent attachments and keeps fresh ones', async () => {
    const stale = await oldEmptyChat();
    const fresh = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    await oldUnsentAttachment();
    await pruneOldRows({ db: t.db, workspaceId: t.workspaceId, auditRetentionDays: 90 });
    expect(await ids('conversations')).toEqual([fresh]);
    expect(await ids('conversations')).not.toContain(stale);
    expect(await ids('attachments')).toEqual([]);
  });

  it('reports a step that fails and still runs the others', async () => {
    const stale = await oldEmptyChat();
    await oldUnsentAttachment();
    const reported: string[] = [];
    const restore = failQueriesWith(t.db, 'DELETE FROM conversations');
    await pruneOldRows({
      db: t.db,
      workspaceId: t.workspaceId,
      auditRetentionDays: 90,
      report: (message, error) => reported.push(`${message}: ${(error as Error).message}`),
    });
    restore();
    expect(reported).toEqual(['Could not prune empty chats: disk is full']);
    expect(await ids('conversations')).toEqual([stale]);
    expect(await ids('attachments')).toEqual([]);
  });
});
