import type { StoredSparkBrief } from '../crew/spark-brief.ts';
import type { Queryable } from './db.ts';

export interface MentionableSpark {
  id: string;
  name: string;
  role: string;
  provider: string | null;
  model: string | null;
  connected: boolean;
}

export async function mentionableSparks(
  db: Queryable,
  conversationId: string,
): Promise<MentionableSpark[]> {
  const { rows } = await db.query<MentionableSpark>(
    `SELECT t.id, t.name, t.role, t.provider, t.model,
       EXISTS (
         SELECT 1 FROM provider_connections pc
         WHERE pc.workspace_id = t.workspace_id AND pc.provider = t.provider
           AND pc.disconnected_at IS NULL
       ) AS connected
     FROM conversations c
     JOIN teammates t ON t.workspace_id = c.workspace_id
     WHERE c.id = $1 AND t.id IS DISTINCT FROM c.teammate_id
     ORDER BY t.created_at, t.id`,
    [conversationId],
  );
  return rows;
}

export async function subagentBrief(
  db: Queryable,
  runId: string,
): Promise<StoredSparkBrief | null> {
  const { rows } = await db.query<StoredSparkBrief>(
    `SELECT t.id, t.name, t.role, t.instructions,
       t.instructions_moved_at IS NOT NULL AS "instructionsMoved",
       t.instructions_path AS "instructionsPath"
     FROM runs r
     JOIN teammates t ON t.id = (r.route->'spark'->>'id')::uuid
     WHERE r.id = $1 AND r.role = 'spark'`,
    [runId],
  );
  return rows[0] ?? null;
}

export async function replyText(db: Queryable, runId: string): Promise<string> {
  const { rows } = await db.query<{ text: string | null }>(
    `SELECT string_agg(payload->>'delta', '' ORDER BY seq) AS text FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
    [runId],
  );
  return rows[0]?.text ?? '';
}

export interface SparkJobCount {
  sparkId: string;
  jobs: number;
  lastChatId: string;
  lastAt: Date;
}

export async function sparkJobCounts(db: Queryable, workspaceId: string): Promise<SparkJobCount[]> {
  const { rows } = await db.query<SparkJobCount>(
    `SELECT DISTINCT ON (r.route->'spark'->>'id')
       r.route->'spark'->>'id' AS "sparkId",
       (count(*) OVER (PARTITION BY r.route->'spark'->>'id'))::int AS jobs,
       r.conversation_id AS "lastChatId", r.created_at AS "lastAt"
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.role = 'spark'
     ORDER BY r.route->'spark'->>'id', r.created_at DESC`,
    [workspaceId],
  );
  return rows;
}
