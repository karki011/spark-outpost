import type { WorkflowRun, WorkflowRunSource } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';

export type StepSpark = MentionableSpark;

export async function workspaceSparkIds(db: Queryable, workspaceId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM teammates WHERE workspace_id = $1',
    [workspaceId],
  );
  return new Set(rows.map((row) => row.id));
}

export async function stepSparks(
  db: Queryable,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, StepSpark>> {
  const { rows } = await db.query<StepSpark>(
    `SELECT t.id, t.name, t.role, t.provider, t.model, t.effort, t.agent_mode AS "agentMode",
       t.level,
       EXISTS (
         SELECT 1 FROM provider_connections pc
         WHERE pc.workspace_id = t.workspace_id AND pc.provider = t.provider
           AND pc.disconnected_at IS NULL
       ) AS connected
     FROM teammates t WHERE t.workspace_id = $1 AND t.id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

const CHAT_SOURCES: ReadonlySet<WorkflowRunSource> = new Set(['mention', 'trigger', 'agent']);

export async function runsInChat(
  db: Queryable,
  turn: { run: Pick<WorkflowRun, 'kind' | 'source' | 'runId'> },
): Promise<boolean> {
  const { kind, source, runId } = turn.run;
  if (kind !== 'run') return false;
  if (CHAT_SOURCES.has(source)) return true;
  if (!runId) return false;
  const { rows } = await db.query<{ earlier: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs r
       JOIN messages own ON own.id = r.user_message_id
       JOIN messages m ON m.conversation_id = r.conversation_id AND m.created_at < own.created_at
       WHERE r.id = $1
     ) AS earlier`,
    [runId],
  );
  return rows[0]?.earlier === true;
}
