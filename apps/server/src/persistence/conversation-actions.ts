import type { ConversationSummary, UpdateConversationRequest } from '@spark-outpost/contracts';
import { endAsksToDeletedChat } from '../sub-chats/asks.ts';
import { ConversationNotFoundError, getSummary } from './conversations.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { notifySubChatsChanged, refreshParentTitle } from './sub-chats.ts';

function flag(value: boolean | undefined): boolean | null {
  return value === undefined ? null : value;
}

export async function updateConversation(
  db: Queryable,
  workspaceId: string,
  id: string,
  update: UpdateConversationRequest,
): Promise<ConversationSummary> {
  const { rowCount } = await db.query(
    `UPDATE conversations SET
       title = COALESCE($3, title),
       title_source = CASE WHEN $3 IS NOT NULL OR $6::boolean IS FALSE THEN 'user'
         WHEN $6::boolean IS TRUE AND title_source = 'user' THEN 'message'
         ELSE title_source END,
       pinned_at = CASE WHEN $4::boolean IS NULL THEN pinned_at
         WHEN $4 THEN COALESCE(pinned_at, now()) ELSE NULL END,
       pinned_order = CASE WHEN $4::boolean IS FALSE THEN NULL ELSE pinned_order END,
       archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at
         WHEN $5 THEN COALESCE(archived_at, now()) ELSE NULL END,
       restored_at = CASE WHEN $5::boolean IS FALSE AND archived_at IS NOT NULL THEN now()
         ELSE restored_at END,
       auto_archived_days = CASE WHEN $5::boolean IS FALSE THEN NULL ELSE auto_archived_days END
     WHERE id = $1 AND workspace_id = $2`,
    [
      id,
      workspaceId,
      update.title ?? null,
      flag(update.pinned),
      flag(update.archived),
      flag(update.autoTitle),
    ],
  );
  if (!rowCount) throw new ConversationNotFoundError(id);
  if (update.archived !== undefined) await notifySubChatsChanged(db, id);
  const summary = await getSummary(db, id);
  if (!summary) throw new ConversationNotFoundError(id);
  return summary;
}

export async function orderPinned(
  db: Queryable,
  workspaceId: string,
  conversationIds: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE conversations c SET pinned_order = ordered.position
     FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered (id, position)
     WHERE c.id = ordered.id AND c.workspace_id = $1 AND c.pinned_at IS NOT NULL`,
    [workspaceId, conversationIds],
  );
}

export async function markConversationSeen(
  db: Queryable,
  workspaceId: string,
  id: string,
  before: Date | null = null,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE conversations SET seen_at = CASE WHEN $3::timestamptz IS NULL THEN now()
       ELSE GREATEST(seen_at, LEAST(now(), $3::timestamptz - interval '1 millisecond')) END
     WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId, before],
  );
  if (!rowCount) throw new ConversationNotFoundError(id);
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'seen', conversationId: id, runId: null }),
  ]);
}

export async function deleteConversation(db: Db, workspaceId: string, id: string): Promise<void> {
  await withTransaction(db, async (client) => {
    const found = await client.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
      [id, workspaceId],
    );
    if (!found.rowCount) throw new ConversationNotFoundError(id);
    await refreshParentTitle(client, id);
    await endAsksToDeletedChat(client, id);
    await client.query('DELETE FROM conversations WHERE id = $1', [id]);
    await notifySubChatsChanged(client, null);
  });
}
