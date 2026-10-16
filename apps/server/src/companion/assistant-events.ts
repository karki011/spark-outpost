import type { AssistantEvent, AssistantEventKind } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

export const ASSISTANT_AUDIT_METHOD = 'spark/assistant';

export interface SessionPlan {
  resume: unknown;
  handoff?: string | undefined;
}

export function sessionEventKind(plan: SessionPlan | null, continued: boolean): AssistantEventKind {
  if (continued) return 'session_resumed';
  return plan?.resume || plan?.handoff ? 'session_reseeded' : 'session_started';
}

export function eventLine(kind: AssistantEventKind, detail: string | null): string {
  const lines: Record<AssistantEventKind, string> = {
    session_started: 'Ask Spark started a new session',
    session_resumed: 'Ask Spark resumed its session',
    session_reseeded: "Ask Spark couldn't resume its session and started a new one from a summary",
    compacted_threshold: 'Ask Spark compacted its context at the threshold',
    compacted_idle: 'Ask Spark compacted its context while idle',
    settings_changed: 'Ask Spark settings changed',
    fact_added: 'Key fact added',
    fact_removed: 'Key fact removed',
    history_cleared: 'Ask Spark history cleared',
  };
  return detail ? `${lines[kind]}: ${detail}` : lines[kind];
}

export async function recordAssistantEvent(
  db: Queryable,
  workspaceId: string,
  kind: AssistantEventKind,
  detail: string | null,
  runId: string | null = null,
  audited = false,
): Promise<void> {
  await db.query(
    `INSERT INTO assistant_events (id, workspace_id, run_id, kind, detail, audited)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), workspaceId, runId, kind, detail, audited],
  );
}

interface EventRow {
  id: string;
  run_id: string | null;
  kind: AssistantEventKind;
  detail: string | null;
  at: Date;
}

function toEvent(row: EventRow): AssistantEvent {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    line: eventLine(row.kind, row.detail),
    at: row.at.toISOString(),
  };
}

export async function listAssistantEvents(
  db: Queryable,
  workspaceId: string,
): Promise<AssistantEvent[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT id, run_id, kind, detail, at FROM assistant_events WHERE workspace_id = $1
     ORDER BY at, id`,
    [workspaceId],
  );
  return rows.map(toEvent);
}

export async function claimAssistantEvents(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<AssistantEvent[]> {
  const { rows } = await db.query<EventRow>(
    `UPDATE assistant_events SET run_id = COALESCE(run_id, $2), audited = true
     WHERE workspace_id = $1 AND NOT audited AND (run_id IS NULL OR run_id = $2)
     RETURNING id, run_id, kind, detail, at`,
    [workspaceId, runId],
  );
  return rows.map(toEvent).toSorted((a, b) => a.at.localeCompare(b.at));
}

export function auditAssistantEvent(audit: ProtocolObserver, event: AssistantEvent): void {
  audit.message('harness', {
    method: `${ASSISTANT_AUDIT_METHOD}/${event.kind}`,
    params: { line: event.line, at: event.at },
  });
}
