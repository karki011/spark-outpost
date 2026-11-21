import { DEFAULT_ARCHIVE_INACTIVE_DAYS, type ArchiveInactiveDays } from '@spark-outpost/contracts';
import { LISTED_CHAT } from './conversation-search.ts';
import type { Queryable } from './db.ts';

export const LAST_ACTIVITY = `GREATEST(
  c.created_at,
  c.restored_at,
  (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
  (SELECT max(GREATEST(r.created_at, r.started_at, r.finished_at))
   FROM runs r WHERE r.conversation_id = c.id),
  (SELECT max(a.decided_at) FROM approvals a JOIN runs ar ON ar.id = a.run_id
   WHERE ar.conversation_id = c.id),
  (SELECT max(t.updated_at) FROM native_terminal_sessions t WHERE t.conversation_id = c.id)
)`;

export const BUSY_RUN = `EXISTS (
  SELECT 1 FROM runs r
  WHERE r.conversation_id = c.id AND r.status IN ('queued', 'running', 'awaiting_approval')
)`;

export const QUEUED_MESSAGE = 'EXISTS (SELECT 1 FROM chat_queue q WHERE q.conversation_id = c.id)';

export const WAITING_CARD = `EXISTS (
  SELECT 1 FROM approvals a JOIN runs ar ON ar.id = a.run_id
  WHERE ar.conversation_id = c.id AND a.status = 'pending'
)`;

const RUNNING_TERMINAL = `EXISTS (
  SELECT 1 FROM native_terminal_sessions t
  WHERE t.conversation_id = c.id AND t.state NOT IN ('exited', 'error', 'interrupted')
)`;

const UNSETTLED_SUB_CHAT = `EXISTS (
  SELECT 1 FROM sub_chats piece
  WHERE piece.parent_conversation_id = c.id AND (
    piece.started_at IS NULL
    OR EXISTS (
      SELECT 1 FROM runs pr
      WHERE pr.conversation_id = piece.conversation_id AND pr.status IN ('queued', 'running')
    )
    OR EXISTS (SELECT 1 FROM chat_queue pq WHERE pq.conversation_id = piece.conversation_id)
    OR EXISTS (
      SELECT 1 FROM chat_asks pa
      WHERE pa.to_conversation_id = piece.conversation_id AND pa.delivered_as IS NULL
    )
  )
)`;

const HELD_SUB_CHAT = `EXISTS (
  SELECT 1 FROM sub_chats held WHERE held.conversation_id = c.id AND held.started_at IS NULL
)`;

const ENABLED_SCHEDULE = `EXISTS (
  SELECT 1 FROM workflow_schedules ws WHERE ws.conversation_id = c.id AND ws.enabled
)`;

const INACTIVE = `${LISTED_CHAT} AND c.archived_at IS NULL AND c.pinned_at IS NULL
  AND ${LAST_ACTIVITY} < now() - make_interval(days => $2)
  AND NOT ${BUSY_RUN}
  AND NOT ${QUEUED_MESSAGE}
  AND NOT ${WAITING_CARD}
  AND NOT ${RUNNING_TERMINAL}
  AND NOT ${UNSETTLED_SUB_CHAT}
  AND NOT ${HELD_SUB_CHAT}
  AND NOT ${ENABLED_SCHEDULE}`;

export type Days = NonNullable<ArchiveInactiveDays>;

export async function inactiveChats(
  db: Queryable,
  workspaceId: string,
  days: Days,
): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT c.id FROM conversations c WHERE ${INACTIVE} ORDER BY c.updated_at`,
    [workspaceId, days],
  );
  return rows.map((row) => row.id);
}

export async function markArchivedIfInactive(
  client: Queryable,
  workspaceId: string,
  conversationId: string,
  days: Days,
): Promise<boolean> {
  await client.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
  const { rowCount } = await client.query(
    `UPDATE conversations c SET archived_at = now(), auto_archived_days = $2
     WHERE c.id = $3 AND ${INACTIVE}`,
    [workspaceId, days, conversationId],
  );
  return rowCount === 1;
}

export async function archiveInactiveSetting(
  db: Queryable,
  workspaceId: string,
): Promise<ArchiveInactiveDays> {
  const { rows } = await db.query<{ archive_inactive_days: ArchiveInactiveDays }>(
    'SELECT archive_inactive_days FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0] ? rows[0].archive_inactive_days : DEFAULT_ARCHIVE_INACTIVE_DAYS;
}
