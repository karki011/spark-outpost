import type { SparkPause } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export function sparkPausedForChat(conversation: string): string {
  return `EXISTS (
    SELECT 1 FROM conversations paused_chat
    JOIN profiles paused_profile ON paused_profile.workspace_id = paused_chat.workspace_id
    WHERE paused_chat.id = ${conversation} AND paused_profile.spark_paused_at IS NOT NULL
  )`;
}

export async function sparkPause(db: Queryable, workspaceId: string): Promise<SparkPause> {
  const { rows } = await db.query<{ spark_paused_at: Date | null }>(
    'SELECT spark_paused_at FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return { pausedAt: rows[0]?.spark_paused_at?.toISOString() ?? null };
}

export async function sparkPaused(db: Queryable, workspaceId: string): Promise<boolean> {
  return (await sparkPause(db, workspaceId)).pausedAt !== null;
}

export async function anySparkPaused(db: Queryable): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM profiles WHERE spark_paused_at IS NOT NULL LIMIT 1',
  );
  return rowCount === 1;
}

export async function chatSparkPaused(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ paused: boolean }>(
    `SELECT ${sparkPausedForChat('$1')} AS paused`,
    [conversationId],
  );
  return rows[0]?.paused === true;
}

export async function setSparkPaused(
  db: Queryable,
  workspaceId: string,
  paused: boolean,
): Promise<SparkPause> {
  const { rows } = await db.query<{ spark_paused_at: Date | null }>(
    `INSERT INTO profiles (workspace_id, spark_paused_at)
     VALUES ($1, CASE WHEN $2 THEN now() END)
     ON CONFLICT (workspace_id) DO UPDATE SET spark_paused_at = CASE
       WHEN $2 THEN COALESCE(profiles.spark_paused_at, now())
     END
     RETURNING spark_paused_at`,
    [workspaceId, paused],
  );
  return { pausedAt: rows[0]?.spark_paused_at?.toISOString() ?? null };
}
