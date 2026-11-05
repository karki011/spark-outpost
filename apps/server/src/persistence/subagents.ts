import {
  SUBAGENT_REPORT,
  applySubagentEvent,
  emptySubagentRoster,
  parseRunEvent,
  subagentWaitSchema,
  type BackgroundWait,
  type SubagentRoster,
  type SubagentRow,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface EventRow {
  run_id: string;
  payload: unknown;
}

const LIFECYCLE = `('SUBAGENT_STARTED', 'SUBAGENT_FINISHED', 'SUBAGENT_ERROR')`;

export function subagentsFromEvents(rows: readonly EventRow[]): Record<string, SubagentRow[]> {
  const rosters = new Map<string, SubagentRoster>();
  for (const row of rows) {
    const event = parseRunEvent(row.payload);
    if (!event) continue;
    const roster = rosters.get(row.run_id) ?? emptySubagentRoster;
    rosters.set(row.run_id, applySubagentEvent(roster, event));
  }
  const byRun: Record<string, SubagentRow[]> = {};
  for (const [runId, roster] of rosters) {
    if (roster.rows.length > 0) byRun[runId] = [...roster.rows];
  }
  return byRun;
}

export async function conversationSubagents(
  db: Queryable,
  conversationId: string,
): Promise<Record<string, SubagentRow[]>> {
  const spawning = await db.query<{ run_id: string }>(
    `SELECT DISTINCT e.run_id FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = $1 AND e.type IN ${LIFECYCLE}`,
    [conversationId],
  );
  if (spawning.rows.length === 0) return {};
  const { rows } = await db.query<EventRow>(
    `SELECT e.run_id, e.payload FROM run_events e
     WHERE e.run_id = ANY($1::uuid[])
       AND (e.type IN ${LIFECYCLE}
         OR (e.type IN ('STEP_STARTED', 'STEP_FINISHED') AND e.payload ? 'subagentRunId')
         OR (e.type = 'CUSTOM' AND e.payload->>'name' = '${SUBAGENT_REPORT}'))
     ORDER BY e.run_id, e.seq`,
    [spawning.rows.map((row) => row.run_id)],
  );
  return subagentsFromEvents(rows);
}

export async function runWaitingOn(db: Queryable, runId: string): Promise<number> {
  const { rows } = await db.query<{ waiting_on: number | null }>(
    `SELECT (e.payload->'content'->>'waitingOn')::int AS waiting_on FROM run_events e
     WHERE e.run_id = $1 AND e.type = 'ACTIVITY_SNAPSHOT'
       AND e.payload->>'activityType' = 'subagents'
     ORDER BY e.seq DESC LIMIT 1`,
    [runId],
  );
  return rows[0]?.waiting_on ?? 0;
}

export async function runBackgroundWait(
  db: Queryable,
  runId: string,
): Promise<BackgroundWait | null> {
  const { rows } = await db.query<{ content: unknown }>(
    `SELECT e.payload->'content' AS content FROM run_events e
     WHERE e.run_id = $1 AND e.type = 'ACTIVITY_SNAPSHOT'
       AND e.payload->>'activityType' = 'subagents'
     ORDER BY e.seq DESC LIMIT 1`,
    [runId],
  );
  const wait = subagentWaitSchema.safeParse(rows[0]?.content);
  return wait.success ? (wait.data.background ?? null) : null;
}
