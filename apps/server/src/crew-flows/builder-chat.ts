import { BUILDER_KEEP_HOURS, TEST_RUN_CHAT_KIND, type BuilderChat } from '@spark-outpost/contracts';
import { removeChatFolder } from '../chat-files/folders.ts';
import { createConversation } from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import {
  BUSY_RUN,
  LAST_ACTIVITY,
  QUEUED_MESSAGE,
  WAITING_CARD,
  archiveInactiveSetting,
} from '../persistence/inactive-chats.ts';
import { stopConversationWork } from '../workflow/stop-conversation.ts';
import { removeChat } from './test-run.ts';

const BUILDER_TITLE = 'Build Sparks and workflows';

export class BuilderChatNotFoundError extends Error {
  constructor() {
    super('That builder chat no longer exists.');
  }
}

export class BuilderChatTakenError extends Error {
  constructor() {
    super('That id belongs to another chat.');
  }
}

export interface BuilderChatDeps {
  db: Db;
  workspaceId: string;
  chatFolders?: string | undefined;
  deleteSettleMs?: number | undefined;
}

const DONE = `b.done_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = b.conversation_id AND m.role = 'user' AND m.created_at > b.done_at
  )
  AND NOT EXISTS (SELECT 1 FROM chat_queue q WHERE q.conversation_id = b.conversation_id)`;

const DONE_EXPIRED = `${DONE}
  AND b.done_at < now() - make_interval(hours => ${BUILDER_KEEP_HOURS})
  AND NOT ${BUSY_RUN}`;

const ABANDONED = `NOT (${DONE})
  AND ${LAST_ACTIVITY} < now() - make_interval(days => $2)
  AND NOT ${BUSY_RUN}
  AND NOT ${QUEUED_MESSAGE}
  AND NOT ${WAITING_CARD}`;

const AUDIT_LEFT = `EXISTS (
  SELECT 1 FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
  WHERE r.conversation_id = c.id
)`;

interface BuilderRow {
  conversation_id: string;
  created_at: Date;
  done_at: Date | null;
  done: boolean;
}

const SELECT_ROW = `SELECT b.conversation_id, b.created_at, b.done_at, (${DONE}) AS done
  FROM crew_builder_chats b`;

function toBuilderChat(row: BuilderRow): BuilderChat {
  const doneAt = row.done && row.done_at ? row.done_at : null;
  return {
    conversationId: row.conversation_id,
    createdAt: row.created_at.toISOString(),
    doneAt: doneAt?.toISOString() ?? null,
    removeAt: doneAt
      ? new Date(doneAt.getTime() + BUILDER_KEEP_HOURS * 3_600_000).toISOString()
      : null,
  };
}

async function builderRow(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<BuilderRow | null> {
  const { rows } = await db.query<BuilderRow>(
    `${SELECT_ROW}
     WHERE b.conversation_id = $1 AND b.workspace_id = $2 AND b.removed_at IS NULL`,
    [conversationId, workspaceId],
  );
  return rows[0] ?? null;
}

export async function isBuilderChat(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM crew_builder_chats WHERE conversation_id = $1 AND removed_at IS NULL',
    [conversationId],
  );
  return rowCount === 1;
}

export async function currentBuilderChat(
  deps: BuilderChatDeps,
  id?: string,
): Promise<BuilderChat | null> {
  if (id) {
    const row = await builderRow(deps.db, deps.workspaceId, id);
    if (!row) throw new BuilderChatNotFoundError();
    return toBuilderChat(row);
  }
  const { rows } = await deps.db.query<BuilderRow>(
    `${SELECT_ROW}
     WHERE b.workspace_id = $1 AND b.removed_at IS NULL
     ORDER BY b.created_at DESC LIMIT 1`,
    [deps.workspaceId],
  );
  return rows[0] ? toBuilderChat(rows[0]) : null;
}

export async function startBuilderChat(deps: BuilderChatDeps, id: string): Promise<BuilderChat> {
  return withTransaction(deps.db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`builder:${id}`]);
    const known = await builderRow(client, deps.workspaceId, id);
    if (known) return toBuilderChat(known);
    const taken = await client.query('SELECT 1 FROM conversations WHERE id = $1', [id]);
    if (taken.rowCount) throw new BuilderChatTakenError();
    await createConversation(client, deps.workspaceId, id, { title: BUILDER_TITLE });
    await client.query('UPDATE conversations SET kind = $2 WHERE id = $1', [
      id,
      TEST_RUN_CHAT_KIND,
    ]);
    await client.query(
      'INSERT INTO crew_builder_chats (conversation_id, workspace_id) VALUES ($1, $2)',
      [id, deps.workspaceId],
    );
    const row = await builderRow(client, deps.workspaceId, id);
    if (!row) throw new BuilderChatNotFoundError();
    return toBuilderChat(row);
  });
}

export async function markBuilderDone(deps: BuilderChatDeps, id: string): Promise<BuilderChat> {
  await deps.db.query(
    `UPDATE crew_builder_chats b SET done_at = now()
     WHERE b.conversation_id = $1 AND b.workspace_id = $2 AND b.removed_at IS NULL
       AND NOT (${DONE})`,
    [id, deps.workspaceId],
  );
  const row = await builderRow(deps.db, deps.workspaceId, id);
  if (!row) throw new BuilderChatNotFoundError();
  return toBuilderChat(row);
}

async function dueChats(deps: BuilderChatDeps): Promise<string[]> {
  const days = await archiveInactiveSetting(deps.db, deps.workspaceId);
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT c.id FROM crew_builder_chats b JOIN conversations c ON c.id = b.conversation_id
     WHERE b.workspace_id = $1 AND b.removed_at IS NULL
       AND ((${DONE_EXPIRED}) OR ($2::int IS NOT NULL AND ${ABANDONED}))`,
    [deps.workspaceId, days],
  );
  return rows.map((row) => row.id);
}

async function retire(deps: BuilderChatDeps, conversationId: string): Promise<void> {
  await stopConversationWork(deps.db, conversationId, deps.deleteSettleMs);
  await deps.db.query(
    `UPDATE approvals SET status = 'expired', decided_at = now()
     WHERE status = 'pending' AND run_id IN (SELECT id FROM runs WHERE conversation_id = $1)`,
    [conversationId],
  );
  if (deps.chatFolders) await removeChatFolder(deps.chatFolders, conversationId);
  await deps.db.query(
    'UPDATE crew_builder_chats SET removed_at = now() WHERE conversation_id = $1',
    [conversationId],
  );
  await deps.db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'conversation', conversationId, runId: null }),
  ]);
}

async function auditGone(deps: BuilderChatDeps): Promise<string[]> {
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT c.id FROM crew_builder_chats b JOIN conversations c ON c.id = b.conversation_id
     WHERE b.workspace_id = $1 AND b.removed_at IS NOT NULL AND NOT ${AUDIT_LEFT}`,
    [deps.workspaceId],
  );
  return rows.map((row) => row.id);
}

export async function sweepBuilderChats(deps: BuilderChatDeps): Promise<string[]> {
  const removed: string[] = [];
  for (const id of await dueChats(deps)) {
    try {
      await retire(deps, id);
      removed.push(id);
    } catch (error) {
      console.error(`Could not remove the builder chat ${id}; the next sweep tries again`, error);
    }
  }
  for (const id of await auditGone(deps)) {
    await removeChat(deps, id).catch((error: unknown) => {
      console.error(`Could not delete the builder chat ${id}`, error);
    });
  }
  return removed;
}
