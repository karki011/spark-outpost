import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const OUTPOSTS_MIGRATION = '0154_outposts.sql';

async function oldRun(db: Db, conversationId: string, source: string): Promise<string> {
  const messageId = randomUUID();
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'go')`,
    [messageId, conversationId],
  );
  const runId = randomUUID();
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, mode, source)
     VALUES ($1, $2, $3, 'fake', 'succeeded', 'do', $4)`,
    [runId, conversationId, messageId, source],
  );
  return runId;
}

async function outpost(db: Db, workspaceId: string, name = 'Orders launch'): Promise<string> {
  const id = randomUUID();
  await db.query('INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, $3)', [
    id,
    workspaceId,
    name,
  ]);
  return id;
}

function join(db: Db, outpostId: string, conversationId: string, handle: string) {
  return db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, $3, 1)`,
    [outpostId, conversationId, handle],
  );
}

async function request(
  db: Db,
  outpostId: string,
  from: { conversationId: string; runId: string },
  to: string,
  hash = 'h1',
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_conversation_id, from_run_id,
       request_hash, from_handle, to_handle, to_conversation_id)
     VALUES ($1, $2, 'request', 'What is the response shape?', $3, $4, $5, 'fe', 'api', $6)`,
    [id, outpostId, from.conversationId, from.runId, hash, to],
  );
  return id;
}

async function seeded(db: Db) {
  const workspaceId = await ensureLocalWorkspace(db);
  const frontend = await oldConversation(db, workspaceId);
  const backend = await oldConversation(db, workspaceId);
  const runId = await oldRun(db, frontend.id, 'ui');
  await runMigrations(db);
  const outpostId = await outpost(db, workspaceId);
  await join(db, outpostId, frontend.id, 'fe');
  await join(db, outpostId, backend.id, 'api');
  return { workspaceId, frontend, backend, runId, outpostId };
}

describe('upgrading to outposts', () => {
  const state = migratedUpTo(OUTPOSTS_MIGRATION);

  it('keeps queued messages and every earlier run source, and accepts an outpost run', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const chat = await oldConversation(db, workspaceId);
    const sources = ['ui', 'e2e', 'bench', 'digest', 'ticket', 'pr_follow_up', 'queue', 'slack'];
    for (const source of sources) await oldRun(db, chat.id, source);
    await expect(oldRun(db, chat.id, 'outpost')).rejects.toThrow(/runs_source_check/);
    const queuedId = randomUUID();
    await db.query(
      `INSERT INTO chat_queue (id, conversation_id, position, content) VALUES ($1, $2, 1, 'next')`,
      [queuedId, chat.id],
    );

    await runMigrations(db);

    const kept = await db.query<{ source: string }>(
      'SELECT source FROM runs WHERE conversation_id = $1',
      [chat.id],
    );
    expect(kept.rows.map((row) => row.source).toSorted()).toEqual(sources.toSorted());
    const queued = await db.query<{ outpost_post_id: string | null }>(
      'SELECT outpost_post_id FROM chat_queue WHERE id = $1',
      [queuedId],
    );
    expect(queued.rows).toEqual([{ outpost_post_id: null }]);
    await oldRun(db, chat.id, 'outpost');
    await expect(oldRun(db, chat.id, 'a2a')).rejects.toThrow(/runs_source_check/);
  });

  it('lets a chat join one outpost under a handle no other member has', async () => {
    const { db } = state;
    const { workspaceId, frontend, outpostId } = await seeded(db);
    const other = await outpost(db, workspaceId, 'Billing');
    const third = await oldConversation(db, workspaceId);

    await expect(join(db, other, frontend.id, 'web')).rejects.toThrow(
      /outpost_members_one_outpost/,
    );
    await expect(join(db, outpostId, third.id, 'api')).rejects.toThrow(/outpost_members_handle/);
    for (const handle of ['all', 'a', 'Docs', '2nd', `a${'2'.repeat(32)}`]) {
      await expect(join(db, outpostId, third.id, handle), handle).rejects.toThrow(/handle_check/);
    }
    await join(db, outpostId, third.id, 'docs-2');
    await expect(outpost(db, workspaceId, '')).rejects.toThrow(/outposts_name_check/);
    await expect(outpost(db, workspaceId, 'x'.repeat(61))).rejects.toThrow(/outposts_name_check/);
  });

  it('stores one task and one queued turn per request, and one ask per run, chat and text', async () => {
    const { db } = state;
    const { frontend, backend, runId, outpostId } = await seeded(db);
    const from = { conversationId: frontend.id, runId };
    const first = await request(db, outpostId, from, backend.id);
    const second = await request(db, outpostId, from, backend.id, 'h2');

    await expect(request(db, outpostId, from, backend.id)).rejects.toThrow(
      /outpost_posts_agent_ask/,
    );
    const taskId = randomUUID();
    await db.query('UPDATE outpost_posts SET task_id = $2 WHERE id = $1', [first, taskId]);
    await expect(
      db.query('UPDATE outpost_posts SET task_id = $2 WHERE id = $1', [second, taskId]),
    ).rejects.toThrow(/outpost_posts_task/);
    const queue = (id: string) =>
      db.query(
        `INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
         VALUES ($1, $2, 1, 'x', $3)`,
        [id, backend.id, first],
      );
    await queue(first);
    await expect(queue(randomUUID())).rejects.toThrow(/chat_queue_outpost_post/);
    const unsent = await db.query<{ id: string }>(
      `SELECT id FROM outpost_posts
       WHERE kind = 'request' AND task_id IS NULL AND closed_state IS NULL`,
    );
    expect(unsent.rows).toEqual([{ id: second }]);
  });

  it('refuses a request with no handle, a pinned request and a half-closed post', async () => {
    const { db } = state;
    const { frontend, backend, runId, outpostId } = await seeded(db);
    const post = await request(db, outpostId, { conversationId: frontend.id, runId }, backend.id);
    const update = (set: string) =>
      db.query(`UPDATE outpost_posts SET ${set} WHERE id = $1`, [post]);

    await expect(update('to_handle = NULL')).rejects.toThrow(/outpost_posts_request_handle/);
    await expect(update('pinned_at = now()')).rejects.toThrow(/outpost_posts_pinned_note/);
    await expect(update(`closed_state = 'rejected'`)).rejects.toThrow(/outpost_posts_closed/);
    await expect(update(`closed_state = 'answered', closed_at = now()`)).rejects.toThrow(
      /closed_state_check/,
    );
    await update(`closed_state = 'rejected', closed_reason = 'queue_full', closed_at = now()`);
    await expect(
      db.query(
        `INSERT INTO outpost_posts (id, outpost_id, kind, body) VALUES ($1, $2, 'answer', 'x')`,
        [randomUUID(), outpostId],
      ),
    ).rejects.toThrow(/kind_check/);
  });

  it('keeps a post and its handles when a chat is deleted, and drops the member and queued turn', async () => {
    const { db } = state;
    const { frontend, backend, runId, outpostId } = await seeded(db);
    const post = await request(db, outpostId, { conversationId: frontend.id, runId }, backend.id);
    await db.query(
      `INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
       VALUES ($1, $2, 1, 'x', $1)`,
      [post, backend.id],
    );

    await db.query('DELETE FROM conversations WHERE id = $1', [backend.id]);

    const members = await db.query<{ handle: string }>(
      'SELECT handle FROM outpost_members WHERE outpost_id = $1',
      [outpostId],
    );
    expect(members.rows).toEqual([{ handle: 'fe' }]);
    const posts = await db.query(
      `SELECT from_handle, to_handle, to_conversation_id, from_conversation_id, from_user
       FROM outpost_posts WHERE id = $1`,
      [post],
    );
    expect(posts.rows).toEqual([
      {
        from_handle: 'fe',
        to_handle: 'api',
        to_conversation_id: null,
        from_conversation_id: frontend.id,
        from_user: false,
      },
    ]);
    const queued = await db.query('SELECT 1 FROM chat_queue WHERE id = $1', [post]);
    expect(queued.rowCount).toBe(0);

    await db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);

    const left = await db.query('SELECT 1 FROM outpost_posts WHERE outpost_id = $1', [outpostId]);
    expect(left.rowCount).toBe(0);
    const chats = await db.query('SELECT 1 FROM conversations WHERE id = $1', [frontend.id]);
    expect(chats.rowCount).toBe(1);
  });
});
