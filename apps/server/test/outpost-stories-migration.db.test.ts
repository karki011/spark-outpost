import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const STORIES_MIGRATION = '0160_outpost_stories.sql';

async function outpost(db: Db, workspaceId: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, 'Orders launch')`, [
    id,
    workspaceId,
  ]);
  return id;
}

async function request(db: Db, outpostId: string, to: string, handle: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, to_handle, to_conversation_id)
     VALUES ($1, $2, 'request', 'Build it.', $3, $4)`,
    [id, outpostId, handle, to],
  );
  return id;
}

async function draft(db: Db, workspaceId: string, lead: string, title = 'Checkout') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_drafts (id, workspace_id, conversation_id, title, body)
     VALUES ($1, $2, $3, $4, '{}')`,
    [id, workspaceId, lead, title],
  );
  return id;
}

interface Task {
  outpostId: string;
  chat: string;
  draftId: string;
  lead: string;
  position: number;
  dependsOn?: string;
  opening?: string;
}

function task(db: Db, row: Task) {
  return db.query(
    `INSERT INTO outpost_story_tasks (conversation_id, outpost_id, draft_id, lead_conversation_id,
       title, position, depends_on_conversation_id, opening_post_id)
     VALUES ($1, $2, $3, $4, 'Orders endpoint', $5, $6, $7)`,
    [
      row.chat,
      row.outpostId,
      row.draftId,
      row.lead,
      row.position,
      row.dependsOn ?? null,
      row.opening ?? null,
    ],
  );
}

async function story(db: Db) {
  const workspaceId = await ensureLocalWorkspace(db);
  const [lead, api, web] = await Promise.all(
    [1, 2, 3].map(async () => (await oldConversation(db, workspaceId)).id),
  );
  if (!lead || !api || !web) throw new Error('The chats were not created.');
  const outpostId = await outpost(db, workspaceId);
  const draftId = await draft(db, workspaceId, lead);
  const first = await request(db, outpostId, api, 'api');
  const held = await request(db, outpostId, web, 'web');
  await db.query('UPDATE outpost_posts SET after_post_id = $2, user_started = true WHERE id = $1', [
    held,
    first,
  ]);
  await task(db, { outpostId, chat: api, draftId, lead, position: 0, opening: first });
  await task(db, {
    outpostId,
    chat: web,
    draftId,
    lead,
    position: 1,
    dependsOn: api,
    opening: held,
  });
  return { workspaceId, lead, api, web, outpostId, draftId, first, held };
}

async function tasks(db: Db, outpostId: string) {
  const { rows } = await db.query(
    `SELECT conversation_id, draft_id, lead_conversation_id, depends_on_conversation_id,
       opening_post_id
     FROM outpost_story_tasks WHERE outpost_id = $1 ORDER BY position`,
    [outpostId],
  );
  return rows;
}

describe('upgrading to outpost stories', () => {
  const state = migratedUpTo(STORIES_MIGRATION);

  it('keeps earlier posts as not held and not started from a draft', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const chat = await oldConversation(db, workspaceId);
    const outpostId = await outpost(db, workspaceId);
    const post = await request(db, outpostId, chat.id, 'api');

    await runMigrations(db);

    const { rows } = await db.query(
      'SELECT after_post_id, user_started FROM outpost_posts WHERE id = $1',
      [post],
    );
    expect(rows).toEqual([{ after_post_id: null, user_started: false }]);
  });

  it('refuses a post held by itself, a task that depends on itself and a second story for a chat', async () => {
    const { db } = state;
    await runMigrations(db);
    const { workspaceId, outpostId, lead, api, draftId, first } = await story(db);

    await expect(
      db.query('UPDATE outpost_posts SET after_post_id = id WHERE id = $1', [first]),
    ).rejects.toThrow(/outpost_posts_after_other/);
    await expect(
      db.query(
        'UPDATE outpost_story_tasks SET depends_on_conversation_id = $1 WHERE conversation_id = $1',
        [api],
      ),
    ).rejects.toThrow(/outpost_story_tasks_depends_on_other/);
    await expect(task(db, { outpostId, chat: api, draftId, lead, position: 2 })).rejects.toThrow(
      /outpost_story_tasks_pkey/,
    );
    await expect(draft(db, workspaceId, lead, '')).rejects.toThrow(/outpost_drafts_title_check/);
  });

  it('drops the task of a deleted chat and leaves its dependent held with no parent', async () => {
    const { db } = state;
    await runMigrations(db);
    const { outpostId, lead, api, web, draftId, first, held } = await story(db);

    await db.query('DELETE FROM conversations WHERE id = $1', [api]);

    expect(await tasks(db, outpostId)).toEqual([
      {
        conversation_id: web,
        draft_id: draftId,
        lead_conversation_id: lead,
        depends_on_conversation_id: null,
        opening_post_id: held,
      },
    ]);
    const { rows } = await db.query('SELECT after_post_id FROM outpost_posts WHERE id = $1', [
      held,
    ]);
    expect(rows).toEqual([{ after_post_id: first }]);
  });

  it('keeps the tasks and their draft when the lead chat is deleted, without the lead', async () => {
    const { db } = state;
    await runMigrations(db);
    const { outpostId, lead, api, web, draftId } = await story(db);

    await db.query('DELETE FROM conversations WHERE id = $1', [lead]);

    const left = await tasks(db, outpostId);
    expect(left.map((row) => row.conversation_id)).toEqual([api, web]);
    for (const row of left) {
      expect(row).toMatchObject({ draft_id: draftId, lead_conversation_id: null });
    }
    expect(left[1]).toMatchObject({ depends_on_conversation_id: api });
    const drafts = await db.query('SELECT id, conversation_id, title FROM outpost_drafts');
    expect(drafts.rows).toEqual([{ id: draftId, conversation_id: null, title: 'Checkout' }]);
  });

  it('releases a held post when the post it waits for is deleted, and drops tasks with the outpost', async () => {
    const { db } = state;
    await runMigrations(db);
    const { outpostId, draftId, first, held } = await story(db);
    await db.query('UPDATE outpost_drafts SET outpost_id = $2, started_at = now() WHERE id = $1', [
      draftId,
      outpostId,
    ]);

    await db.query('DELETE FROM outpost_posts WHERE id = $1', [first]);

    const waiting = await db.query('SELECT after_post_id FROM outpost_posts WHERE id = $1', [held]);
    expect(waiting.rows).toEqual([{ after_post_id: null }]);
    expect((await tasks(db, outpostId))[0]).toMatchObject({ opening_post_id: null });

    await db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);

    expect(await tasks(db, outpostId)).toEqual([]);
    const drafts = await db.query(
      'SELECT outpost_id, started_at IS NOT NULL AS started, reported_at FROM outpost_drafts',
    );
    expect(drafts.rows).toEqual([{ outpost_id: null, started: true, reported_at: null }]);
  });
});
