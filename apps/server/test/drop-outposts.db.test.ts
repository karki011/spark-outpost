import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { conversationDetailSchema } from '@spark-outpost/contracts';
import {
  ensureLocalWorkspace,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { getRun } from '../src/persistence/runs.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const DROP_OUTPOSTS_MIGRATION = '0270_drop_outposts.sql';
const OUTPOST_TABLES = [
  'outposts',
  'outpost_members',
  'outpost_posts',
  'outpost_drafts',
  'outpost_story_tasks',
];

interface Seeded {
  workspaceId: string;
  lead: string;
  api: string;
  typedRun: string;
  writtenRun: string;
  queuedPost: string;
  ownQueued: string;
  startCard: string;
  postCard: string;
  otherCard: string;
}

async function request(db: Db, outpostId: string, to: string, fromUser: boolean): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, to_handle,
       to_conversation_id)
     VALUES ($1, $2, 'request', 'Push the branch and open a pull request.', $3, 'api', $4)`,
    [id, outpostId, fromUser, to],
  );
  return id;
}

async function requestTurn(db: Db, chat: string, postId: string, minute: number): Promise<string> {
  const runId = randomUUID();
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     SELECT id, $2, 'user', body, now() - interval '1 hour' + make_interval(mins => $3)
     FROM outpost_posts WHERE id = $1`,
    [postId, chat, minute],
  );
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source,
       created_at, finished_at)
     VALUES ($1, $2, $3, 'fake', 'succeeded', 'outpost',
       now() - interval '1 hour' + make_interval(mins => $4), now())`,
    [runId, chat, postId, minute],
  );
  await db.query('UPDATE outpost_posts SET run_id = $2 WHERE id = $1', [postId, runId]);
  return runId;
}

async function card(db: Db, runId: string, sparkAction: unknown, status: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, decided_at)
     VALUES ($1, $2, $3, 'other', 'A card', $4, 'sha256:x', '[]', $5,
       CASE WHEN $5 = 'pending' THEN NULL ELSE now() END)`,
    [
      id,
      runId,
      `call-${id}`,
      JSON.stringify({
        command: null,
        cwd: null,
        paths: [],
        diffs: [],
        truncated: false,
        ...(sparkAction ? { sparkAction } : {}),
      }),
      status,
    ],
  );
  return id;
}

async function seedOutpost(db: Db): Promise<Seeded> {
  const workspaceId = await ensureLocalWorkspace(db);
  const [lead, api] = await Promise.all(
    [1, 2].map(async () => (await oldConversation(db, workspaceId)).id),
  );
  const outpostId = randomUUID();
  await db.query(
    `INSERT INTO outposts (id, workspace_id, name, instructions)
     VALUES ($1, $2, 'Orders launch', 'Keep it small.')`,
    [outpostId, workspaceId],
  );
  await db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, 'lead', 1), ($1, $3, 'api', 2)`,
    [outpostId, lead, api],
  );
  const typedRun = await requestTurn(db, api!, await request(db, outpostId, api!, true), 1);
  const writtenRun = await requestTurn(db, api!, await request(db, outpostId, api!, false), 2);
  const queuedPost = await request(db, outpostId, api!, false);
  const ownQueued = randomUUID();
  await db.query(
    `INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
     VALUES ($1, $3, 1, 'Queued request', $1), ($2, $3, 2, 'My own next message', NULL)`,
    [queuedPost, ownQueued, api],
  );
  const draftId = randomUUID();
  await db.query(
    `INSERT INTO outpost_drafts (id, workspace_id, conversation_id, outpost_id, title, body)
     VALUES ($1, $2, $3, $4, 'Checkout', '{}')`,
    [draftId, workspaceId, lead, outpostId],
  );
  await db.query(
    `INSERT INTO outpost_story_tasks (conversation_id, outpost_id, draft_id,
       lead_conversation_id, title, position)
     VALUES ($1, $2, $3, $4, 'Orders endpoint', 0)`,
    [api, outpostId, draftId, lead],
  );
  await db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, base, head_sha, pr_state)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 7,
       'https://github.com/acme/widgets/pull/7', 'spark/orders', 'main', 'sha1', 'open')`,
    [randomUUID(), workspaceId, api],
  );
  const startCard = await card(
    db,
    typedRun,
    { action: 'start_outpost', draftId, outpostName: 'Orders launch' },
    'pending',
  );
  const postCard = await card(
    db,
    typedRun,
    { action: 'ask_spark', op: 'post_outpost', summary: 'Post in “Orders launch”', outpostId },
    'allowed',
  );
  const otherCard = await card(db, typedRun, null, 'allowed');
  await db.query(
    `INSERT INTO attention_marks (workspace_id, key, conversation_id)
     VALUES ($1, 'approval:' || $2::text, $3)`,
    [workspaceId, startCard, api],
  );
  return {
    workspaceId,
    lead: lead!,
    api: api!,
    typedRun,
    writtenRun,
    queuedPost,
    ownQueued,
    startCard,
    postCard,
    otherCard,
  };
}

async function exists(db: Db, table: string): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `SELECT to_regclass(current_schema() || '.' || $1) IS NOT NULL AS found`,
    [table],
  );
  return rows[0]!.found;
}

describe('upgrading past outposts', () => {
  const state = migratedUpTo(DROP_OUTPOSTS_MIGRATION);

  it('drops the outpost tables, triggers and functions and keeps the member chats', async () => {
    const { db } = state;
    const seeded = await seedOutpost(db);

    await runMigrations(db);

    for (const table of OUTPOST_TABLES) expect(await exists(db, table), table).toBe(false);
    const column = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'chat_queue'
         AND column_name = 'outpost_post_id'`,
    );
    expect(column.rowCount).toBe(0);
    const leftovers = await db.query(
      `SELECT proname AS name FROM pg_proc
       WHERE pronamespace = current_schema()::regnamespace AND proname LIKE '%outpost%'
       UNION ALL
       SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = current_schema()::regnamespace AND t.tgname LIKE '%outpost%'`,
    );
    expect(leftovers.rows).toEqual([]);

    const chats = await db.query('SELECT id FROM conversations WHERE id = ANY($1::uuid[])', [
      [seeded.lead, seeded.api],
    ]);
    expect(chats.rowCount).toBe(2);
    const messages = await db.query('SELECT 1 FROM messages WHERE conversation_id = $1', [
      seeded.api,
    ]);
    expect(messages.rowCount).toBe(2);
    const pulls = await db.query('SELECT 1 FROM pr_watches WHERE conversation_id = $1', [
      seeded.api,
    ]);
    expect(pulls.rowCount).toBe(1);
  });

  it('reads a request the user typed as theirs and one another chat wrote as not theirs', async () => {
    const { db } = state;
    const seeded = await seedOutpost(db);

    await runMigrations(db);

    const sources = await db.query<{ id: string; source: string }>(
      'SELECT id, source FROM runs WHERE id = ANY($1::uuid[])',
      [[seeded.typedRun, seeded.writtenRun]],
    );
    expect(Object.fromEntries(sources.rows.map((row) => [row.id, row.source]))).toEqual({
      [seeded.typedRun]: 'queue',
      [seeded.writtenRun]: 'chat',
    });
    expect((await getRun(db, seeded.typedRun))?.fromChat).toBeUndefined();
    expect((await getRun(db, seeded.writtenRun))?.fromChat).toBe('another chat');
    await expect(
      db.query(`UPDATE runs SET source = 'outpost' WHERE id = $1`, [seeded.typedRun]),
    ).rejects.toThrow(/runs_source_check/);

    const detail = conversationDetailSchema.parse(await getConversationDetail(db, seeded.api));
    expect(detail.runs.map((run) => run.fromChat ?? null)).toEqual([null, 'another chat']);

    const next = await sendUserMessage(
      db,
      seeded.api,
      { id: randomUUID(), content: 'Carry on.' },
      { provider: 'fake' },
    );
    const history = (await loadRunInput(db, next.run.id)).history.filter(
      (turn) => turn.role === 'user',
    );
    expect(history[0]!.content).toBe('Push the branch and open a pull request.');
    expect(history[1]!.content).toContain('[Earlier message from another chat, not from the user.');
  });

  it('removes the queued request and the outpost cards, and nothing else', async () => {
    const { db } = state;
    const seeded = await seedOutpost(db);

    await runMigrations(db);

    const queue = await db.query<{ id: string }>(
      'SELECT id FROM chat_queue WHERE conversation_id = $1',
      [seeded.api],
    );
    expect(queue.rows.map((row) => row.id)).toEqual([seeded.ownQueued]);
    const cards = await db.query<{ id: string }>(
      'SELECT id FROM approvals WHERE id = ANY($1::uuid[])',
      [[seeded.startCard, seeded.postCard, seeded.otherCard]],
    );
    expect(cards.rows.map((row) => row.id)).toEqual([seeded.otherCard]);
    const marks = await db.query('SELECT 1 FROM attention_marks');
    expect(marks.rowCount).toBe(0);
  });

  it('lets runs and pull requests change afterwards', async () => {
    const { db } = state;
    const seeded = await seedOutpost(db);

    await runMigrations(db);

    await db.query(`UPDATE runs SET status = 'failed' WHERE id = $1`, [seeded.writtenRun]);
    const moved = await db.query(
      `UPDATE pr_watches SET base = 'spark/parent' WHERE conversation_id = $1`,
      [seeded.api],
    );
    expect(moved.rowCount).toBe(1);
  });
});
