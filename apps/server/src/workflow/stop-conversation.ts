import type { Db } from '../persistence/db.ts';
import { stopRun } from './stop-run.ts';

const ACTIVE_RUN_STATUSES = ['queued', 'running', 'awaiting_approval'];
const POLL_MS = 100;

export const DEFAULT_SETTLE_MS = 10_000;

async function activeRunIds(db: Db, conversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM runs WHERE conversation_id = $1 AND status = ANY($2::text[])',
    [conversationId, ACTIVE_RUN_STATUSES],
  );
  return rows.map((row) => row.id);
}

async function abandonUnsettled(db: Db, conversationId: string): Promise<void> {
  await db.query(
    `UPDATE jobs SET status = 'done', lease_token = NULL, lease_expires_at = NULL,
       updated_at = now()
     WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = $1 AND status = ANY($2::text[]))
       AND status <> 'done'`,
    [conversationId, ACTIVE_RUN_STATUSES],
  );
  await db.query(
    `UPDATE runs SET status = 'cancelled', finished_at = now(),
       cancel_requested_at = COALESCE(cancel_requested_at, now())
     WHERE conversation_id = $1 AND status = ANY($2::text[])`,
    [conversationId, ACTIVE_RUN_STATUSES],
  );
}

export async function stopConversationWork(
  db: Db,
  conversationId: string,
  settleMs: number = DEFAULT_SETTLE_MS,
): Promise<void> {
  const first = await activeRunIds(db, conversationId);
  if (first.length === 0) return;
  await Promise.all(first.map((id) => stopRun(db, id)));
  const deadline = Date.now() + settleMs;
  while ((await activeRunIds(db, conversationId)).length > 0) {
    if (Date.now() >= deadline) {
      await abandonUnsettled(db, conversationId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
