import {
  TRIGGER_EVENTS_PAGE,
  workflowTriggersSchema,
  type QueuedTriggerKind,
  type TriggerEvent,
  type TriggerEventReason,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export interface StoredTriggers {
  workflowId: string;
  triggers: WorkflowTriggers;
}

interface TriggersRow {
  workflow_id: string;
  turn_changed: boolean;
  before_publish: boolean;
  hold_on_findings: boolean;
  on_commit: boolean;
  branch_glob: string;
  pull_request: boolean;
  chat_started: boolean;
  project_id: string | null;
  debounce_minutes: number;
  edits: boolean;
}

function toStored(row: TriggersRow): StoredTriggers {
  return {
    workflowId: row.workflow_id,
    triggers: workflowTriggersSchema.parse({
      turnChanged: row.turn_changed,
      beforePublish: row.before_publish,
      holdOnFindings: row.hold_on_findings,
      commit: row.on_commit,
      branchGlob: row.branch_glob,
      pullRequest: row.pull_request,
      chatStarted: row.chat_started,
      projectId: row.project_id,
      debounceMinutes: row.debounce_minutes,
      edits: row.edits,
    }),
  };
}

export async function getTriggers(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<StoredTriggers | null> {
  const { rows } = await db.query<TriggersRow>(
    'SELECT * FROM workflow_triggers WHERE workspace_id = $1 AND workflow_id = $2',
    [workspaceId, workflowId],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

export type TriggerFlag =
  'turn_changed' | 'before_publish' | 'on_commit' | 'pull_request' | 'chat_started';

export async function triggersWith(
  db: Queryable,
  workspaceId: string,
  flag: TriggerFlag,
  conversationId: string | null = null,
): Promise<StoredTriggers[]> {
  const { rows } = await db.query<TriggersRow>(
    `SELECT t.* FROM workflow_triggers t
     WHERE t.workspace_id = $1 AND t.${flag}
       AND ($2::uuid IS NULL OR t.project_id IS NULL OR t.project_id = (
         SELECT cp.project_id FROM conversation_projects cp WHERE cp.conversation_id = $2
         ORDER BY cp.position, cp.created_at LIMIT 1))
     ORDER BY t.workflow_id`,
    [workspaceId, conversationId],
  );
  return rows.map(toStored);
}

export async function saveTriggers(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  triggers: WorkflowTriggers,
): Promise<StoredTriggers> {
  const { rows } = await db.query<TriggersRow>(
    `INSERT INTO workflow_triggers (workspace_id, workflow_id, turn_changed, before_publish,
       hold_on_findings, on_commit, branch_glob, pull_request, chat_started, project_id,
       debounce_minutes, edits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (workspace_id, workflow_id) DO UPDATE SET
       turn_changed = EXCLUDED.turn_changed, before_publish = EXCLUDED.before_publish,
       hold_on_findings = EXCLUDED.hold_on_findings, on_commit = EXCLUDED.on_commit,
       branch_glob = EXCLUDED.branch_glob, pull_request = EXCLUDED.pull_request,
       chat_started = EXCLUDED.chat_started, project_id = EXCLUDED.project_id,
       debounce_minutes = EXCLUDED.debounce_minutes, edits = EXCLUDED.edits, updated_at = now()
     RETURNING *`,
    [
      workspaceId,
      workflowId,
      triggers.turnChanged,
      triggers.beforePublish,
      triggers.holdOnFindings,
      triggers.commit,
      triggers.branchGlob,
      triggers.pullRequest,
      triggers.chatStarted,
      triggers.projectId,
      triggers.debounceMinutes,
      triggers.edits,
    ],
  );
  await db.query(
    `DELETE FROM workflow_trigger_events WHERE workspace_id = $1 AND workflow_id = $2
       AND state = 'pending' AND (
         (kind = 'turn_changed' AND NOT $3) OR (kind = 'commit' AND NOT $4)
         OR (kind = 'pull_request' AND NOT $5) OR (kind = 'chat_started' AND NOT $6))`,
    [
      workspaceId,
      workflowId,
      triggers.turnChanged,
      triggers.commit,
      triggers.pullRequest,
      triggers.chatStarted,
    ],
  );
  return toStored(rows[0]!);
}

export async function deleteTriggers(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<void> {
  await db.query('DELETE FROM workflow_triggers WHERE workspace_id = $1 AND workflow_id = $2', [
    workspaceId,
    workflowId,
  ]);
}

export async function runEditsAllowed(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ edits: boolean }>(
    'SELECT edits FROM workflow_triggers WHERE workspace_id = $1 AND workflow_id = $2',
    [workspaceId, workflowId],
  );
  return rows[0]?.edits === true;
}

export interface QueuedTrigger {
  workflowId: string;
  conversationId: string;
  kind: QueuedTriggerKind;
  debounceMinutes: number;
}

export async function queueTrigger(
  db: Queryable,
  workspaceId: string,
  queued: QueuedTrigger,
  now: Date,
): Promise<void> {
  const due = new Date(now.getTime() + queued.debounceMinutes * 60_000);
  await db.query(
    `INSERT INTO workflow_trigger_events
       (id, workspace_id, workflow_id, conversation_id, kind, due_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, workflow_id, conversation_id) WHERE state = 'pending'
     DO UPDATE SET kind = EXCLUDED.kind, due_at = EXCLUDED.due_at, updated_at = now()`,
    [newId(), workspaceId, queued.workflowId, queued.conversationId, queued.kind, due],
  );
}

export async function markSeen(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  mark: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO workflow_trigger_marks (workspace_id, workflow_id, mark) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [workspaceId, workflowId, mark],
  );
  return rowCount === 1;
}

export interface ClaimedTrigger {
  id: string;
  workflowId: string;
  conversationId: string;
  kind: QueuedTriggerKind;
  messageId: string;
}

interface ClaimRow {
  id: string;
  workflow_id: string;
  conversation_id: string;
  kind: QueuedTriggerKind;
  message_id: string;
}

const toClaim = (row: ClaimRow): ClaimedTrigger => ({
  id: row.id,
  workflowId: row.workflow_id,
  conversationId: row.conversation_id,
  kind: row.kind,
  messageId: row.message_id,
});

export async function claimDueTriggers(
  db: Queryable,
  workspaceId: string,
  now: Date,
): Promise<ClaimedTrigger[]> {
  const { rows } = await db.query<ClaimRow>(
    `UPDATE workflow_trigger_events e
     SET state = 'claimed', claimed_at = $2, message_id = gen_random_uuid(), updated_at = now()
     WHERE e.id IN (
       SELECT id FROM workflow_trigger_events
       WHERE workspace_id = $1 AND state = 'pending' AND due_at <= $2
       ORDER BY due_at FOR UPDATE SKIP LOCKED)
     RETURNING e.id, e.workflow_id, e.conversation_id, e.kind, e.message_id`,
    [workspaceId, now],
  );
  return rows.map(toClaim);
}

export async function reclaimStrandedTriggers(
  db: Queryable,
  workspaceId: string,
  now: Date,
  strandedMs: number,
): Promise<ClaimedTrigger[]> {
  const { rows } = await db.query<ClaimRow>(
    `UPDATE workflow_trigger_events SET claimed_at = $2, updated_at = now()
     WHERE workspace_id = $1 AND state = 'claimed' AND claimed_at < $3
     RETURNING id, workflow_id, conversation_id, kind, message_id`,
    [workspaceId, now, new Date(now.getTime() - strandedMs)],
  );
  return rows.map(toClaim);
}

export async function releaseClaim(db: Queryable, id: string, now: Date): Promise<void> {
  await db.query(
    `DELETE FROM workflow_trigger_events e WHERE e.id = $1 AND e.state = 'claimed'
       AND EXISTS (
         SELECT 1 FROM workflow_trigger_events other
         WHERE other.state = 'pending' AND other.workspace_id = e.workspace_id
           AND other.workflow_id = e.workflow_id AND other.conversation_id = e.conversation_id)`,
    [id],
  );
  await db.query(
    `UPDATE workflow_trigger_events SET state = 'pending', due_at = $2, message_id = NULL,
       claimed_at = NULL, updated_at = now()
     WHERE id = $1 AND state = 'claimed'`,
    [id, now],
  );
}

export type TriggerOutcome =
  | { state: 'started'; workflowRunId: string }
  | { state: 'skipped' | 'not_started'; reason: TriggerEventReason; detail: string | null };

export async function settleTrigger(
  db: Queryable,
  id: string,
  outcome: TriggerOutcome,
): Promise<void> {
  await db.query(
    `UPDATE workflow_trigger_events
     SET state = $2, workflow_run_id = $3, reason = $4, detail = $5, updated_at = now()
     WHERE id = $1 AND state = 'claimed'`,
    [
      id,
      outcome.state,
      outcome.state === 'started' ? outcome.workflowRunId : null,
      outcome.state === 'started' ? null : outcome.reason,
      outcome.state === 'started' ? null : outcome.detail,
    ],
  );
}

interface EventRow {
  id: string;
  kind: QueuedTriggerKind;
  conversation_id: string;
  chat_title: string | null;
  state: TriggerEvent['state'];
  reason: TriggerEventReason | null;
  detail: string | null;
  due_at: Date;
  workflow_run_id: string | null;
  updated_at: Date;
}

export async function listTriggerEvents(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<TriggerEvent[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT e.*, c.title AS chat_title FROM workflow_trigger_events e
     LEFT JOIN conversations c ON c.id = e.conversation_id
     WHERE e.workspace_id = $1 AND e.workflow_id = $2
     ORDER BY e.updated_at DESC, e.id LIMIT $3`,
    [workspaceId, workflowId, TRIGGER_EVENTS_PAGE],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    conversationId: row.conversation_id,
    chatTitle: row.chat_title ?? '',
    state: row.state,
    reason: row.reason,
    detail: row.detail,
    dueAt: row.due_at.toISOString(),
    workflowRunId: row.workflow_run_id,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function lastTriggeredHash(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  conversationId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ diff_hash: string | null }>(
    `SELECT diff_hash FROM workflow_runs
     WHERE workspace_id = $1 AND workflow_id = $2 AND conversation_id = $3
       AND source = 'trigger' AND gates_run_id IS NULL
       AND status IN ('running', 'succeeded')
     ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, workflowId, conversationId],
  );
  return rows[0]?.diff_hash ?? null;
}

export async function workflowRunningInChat(
  db: Queryable,
  workflowId: string,
  conversationId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM workflow_runs
     WHERE workflow_id = $1 AND conversation_id = $2 AND status = 'running' LIMIT 1`,
    [workflowId, conversationId],
  );
  return (rowCount ?? 0) > 0;
}
