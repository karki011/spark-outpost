import {
  scheduleSlotSchema,
  workflowScheduleSchema,
  type ScheduleSlot,
  type ScheduleSlotReason,
  type ScheduleSlotSource,
  type WorkflowSchedule,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export const SCHEDULE_SLOTS_PAGE = 100;

export interface StoredSchedule {
  workflowId: string;
  schedule: WorkflowSchedule;
  conversationId: string | null;
  lastCheckedAt: Date;
}

interface ScheduleRow {
  workflow_id: string;
  enabled: boolean;
  every: number;
  unit: string;
  days: number[];
  from_time: string;
  to_time: string | null;
  anchor: string;
  project_id: string | null;
  message: string;
  missed: string;
  conversation_id: string | null;
  last_checked_at: Date;
}

function toStored(row: ScheduleRow): StoredSchedule {
  return {
    workflowId: row.workflow_id,
    schedule: workflowScheduleSchema.parse({
      enabled: row.enabled,
      every: row.every,
      unit: row.unit,
      days: row.days,
      from: row.from_time,
      to: row.to_time,
      anchor: row.anchor,
      projectId: row.project_id,
      message: row.message,
      missed: row.missed,
    }),
    conversationId: row.conversation_id,
    lastCheckedAt: row.last_checked_at,
  };
}

export async function getSchedule(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<StoredSchedule | null> {
  const { rows } = await db.query<ScheduleRow>(
    'SELECT * FROM workflow_schedules WHERE workspace_id = $1 AND workflow_id = $2',
    [workspaceId, workflowId],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

export async function listSchedules(
  db: Queryable,
  workspaceId: string,
  only: 'all' | 'enabled' = 'all',
): Promise<StoredSchedule[]> {
  const { rows } = await db.query<ScheduleRow>(
    `SELECT * FROM workflow_schedules
     WHERE workspace_id = $1 AND (enabled OR $2 = 'all') ORDER BY workflow_id`,
    [workspaceId, only],
  );
  return rows.map(toStored);
}

export async function saveSchedule(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  schedule: WorkflowSchedule,
  now: Date,
): Promise<StoredSchedule> {
  const { rows } = await db.query<ScheduleRow>(
    `INSERT INTO workflow_schedules (workspace_id, workflow_id, enabled, every, unit, days,
       from_time, to_time, anchor, project_id, message, missed, last_checked_at)
     VALUES ($1, $2, $3, $4, $5, $6::smallint[], $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (workspace_id, workflow_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, every = EXCLUDED.every, unit = EXCLUDED.unit,
       days = EXCLUDED.days, from_time = EXCLUDED.from_time, to_time = EXCLUDED.to_time,
       anchor = EXCLUDED.anchor, project_id = EXCLUDED.project_id, message = EXCLUDED.message,
       missed = EXCLUDED.missed, last_checked_at = EXCLUDED.last_checked_at, updated_at = now(),
       conversation_id = CASE
         WHEN workflow_schedules.project_id IS NOT DISTINCT FROM EXCLUDED.project_id
         THEN workflow_schedules.conversation_id END
     RETURNING *`,
    [
      workspaceId,
      workflowId,
      schedule.enabled,
      schedule.every,
      schedule.unit,
      schedule.days,
      schedule.from,
      schedule.to,
      schedule.anchor,
      schedule.projectId,
      schedule.message,
      schedule.missed,
      now,
    ],
  );
  await db.query(
    `UPDATE workflow_schedule_slots SET released_at = $3
     WHERE workspace_id = $1 AND workflow_id = $2 AND state = 'held' AND released_at IS NULL`,
    [workspaceId, workflowId, now],
  );
  return toStored(rows[0]!);
}

export async function deleteSchedule(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM workflow_schedules WHERE workspace_id = $1 AND workflow_id = $2',
    [workspaceId, workflowId],
  );
  return rowCount === 1;
}

export async function advanceChecked(
  db: Queryable,
  workspaceId: string,
  stored: StoredSchedule,
  now: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE workflow_schedules SET last_checked_at = $3
     WHERE workspace_id = $1 AND workflow_id = $2 AND enabled
       AND date_trunc('milliseconds', last_checked_at) = $4`,
    [workspaceId, stored.workflowId, now, stored.lastCheckedAt],
  );
  return rowCount === 1;
}

export async function setScheduleChat(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  conversationId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE workflow_schedules SET conversation_id = $3
     WHERE workspace_id = $1 AND workflow_id = $2`,
    [workspaceId, workflowId, conversationId],
  );
}

export async function openScheduleChat(
  db: Queryable,
  workspaceId: string,
  conversationId: string | null,
): Promise<string | null> {
  if (conversationId === null) return null;
  const { rowCount } = await db.query(
    `SELECT 1 FROM conversations
     WHERE id = $1 AND workspace_id = $2 AND session_type = 'chat' AND archived_at IS NULL`,
    [conversationId, workspaceId],
  );
  return rowCount === 1 ? conversationId : null;
}

interface SlotRow {
  id: string;
  workflow_id: string;
  slot_at: Date;
  last_slot_at: Date;
  state: string;
  reason: string | null;
  detail: string | null;
  source: string;
  message_id: string;
  workflow_run_id: string | null;
  released_at: Date | null;
}

function toSlot(row: SlotRow): ScheduleSlot {
  return scheduleSlotSchema.parse({
    id: row.id,
    slotAt: row.slot_at.toISOString(),
    lastSlotAt: row.last_slot_at.toISOString(),
    state: row.state,
    reason: row.reason,
    detail: row.detail,
    source: row.source,
    workflowRunId: row.workflow_run_id,
    releasedAt: row.released_at ? row.released_at.toISOString() : null,
  });
}

export async function listScheduleSlots(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<ScheduleSlot[]> {
  const { rows } = await db.query<SlotRow>(
    `SELECT * FROM workflow_schedule_slots WHERE workspace_id = $1 AND workflow_id = $2
     ORDER BY last_slot_at DESC, id LIMIT $3`,
    [workspaceId, workflowId, SCHEDULE_SLOTS_PAGE],
  );
  return rows.map(toSlot);
}

export async function heldSince(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<Date | null> {
  const { rows } = await db.query<{ slot_at: Date }>(
    `SELECT slot_at FROM workflow_schedule_slots
     WHERE workspace_id = $1 AND workflow_id = $2 AND state = 'held' AND released_at IS NULL
     ORDER BY slot_at LIMIT 1`,
    [workspaceId, workflowId],
  );
  return rows[0]?.slot_at ?? null;
}

export async function releaseHeld(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE workflow_schedule_slots SET released_at = $3
     WHERE workspace_id = $1 AND workflow_id = $2 AND state = 'held' AND released_at IS NULL`,
    [workspaceId, workflowId, now],
  );
}

export interface QuietSlot {
  workflowId: string;
  state: 'skipped' | 'held' | 'not_started';
  reason: ScheduleSlotReason;
  detail: string | null;
  source: ScheduleSlotSource;
  slotAt: Date;
  lastSlotAt: Date;
}

export async function recordQuietSlot(
  db: Queryable,
  workspaceId: string,
  slot: QuietSlot,
  now: Date,
): Promise<void> {
  const extended = await db.query(
    `UPDATE workflow_schedule_slots s SET last_slot_at = GREATEST(s.last_slot_at, $6)
     WHERE s.id = (
       SELECT latest.id FROM workflow_schedule_slots latest
       WHERE latest.workspace_id = $1 AND latest.workflow_id = $2
       ORDER BY latest.claimed_at DESC, latest.last_slot_at DESC LIMIT 1
     ) AND s.state = $3 AND s.reason = $4 AND s.detail IS NOT DISTINCT FROM $5
       AND s.released_at IS NULL`,
    [workspaceId, slot.workflowId, slot.state, slot.reason, slot.detail, slot.lastSlotAt],
  );
  if (extended.rowCount === 1) return;
  await db.query(
    `INSERT INTO workflow_schedule_slots (id, workspace_id, workflow_id, slot_at, last_slot_at,
       state, reason, detail, source, message_id, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      newId(),
      workspaceId,
      slot.workflowId,
      slot.slotAt,
      slot.lastSlotAt,
      slot.state,
      slot.reason,
      slot.detail,
      slot.source,
      newId(),
      now,
    ],
  );
}

export interface ClaimedSlot {
  id: string;
  workflowId: string;
  source: ScheduleSlotSource;
  messageId: string;
}

export async function claimSlot(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  source: ScheduleSlotSource,
  slotAt: Date,
  now: Date,
): Promise<ClaimedSlot | null> {
  const { rows } = await db.query<{ id: string; message_id: string }>(
    `INSERT INTO workflow_schedule_slots (id, workspace_id, workflow_id, slot_at, last_slot_at,
       state, source, message_id, claimed_at)
     VALUES ($1, $2, $3, $4, $4, 'claimed', $5, $6, $7)
     ON CONFLICT (workspace_id, workflow_id, slot_at) WHERE state IN ('claimed', 'started')
     DO NOTHING
     RETURNING id, message_id`,
    [newId(), workspaceId, workflowId, slotAt, source, newId(), now],
  );
  const row = rows[0];
  return row ? { id: row.id, workflowId, source, messageId: row.message_id } : null;
}

export async function reclaimStrandedSlots(
  db: Queryable,
  workspaceId: string,
  now: Date,
  olderThanMs: number,
): Promise<ClaimedSlot[]> {
  const { rows } = await db.query<SlotRow>(
    `UPDATE workflow_schedule_slots SET claimed_at = $2
     WHERE workspace_id = $1 AND state = 'claimed' AND claimed_at < $3
     RETURNING *`,
    [workspaceId, now, new Date(now.getTime() - olderThanMs)],
  );
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    source: row.source as ScheduleSlotSource,
    messageId: row.message_id,
  }));
}

export async function settleSlot(
  db: Queryable,
  id: string,
  outcome:
    | { state: 'started'; workflowRunId: string }
    | { state: 'not_started'; reason: ScheduleSlotReason; detail: string | null },
): Promise<void> {
  await db.query(
    `UPDATE workflow_schedule_slots SET state = $2, workflow_run_id = $3, reason = $4, detail = $5
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

export async function workflowRunning(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM workflow_runs
     WHERE workspace_id = $1 AND workflow_id = $2 AND kind = 'run' AND status = 'running' LIMIT 1`,
    [workspaceId, workflowId],
  );
  return rowCount === 1;
}

export async function projectLinked(
  db: Queryable,
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2',
    [projectId, workspaceId],
  );
  return rowCount === 1;
}

export async function lastRunCostUsd(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<number | null> {
  const { rows } = await db.query<{ cost: number | null }>(
    `SELECT (
       SELECT sum(r.cost_usd)::float8 FROM runs r
       WHERE r.id = w.run_id OR r.parent_run_id = w.run_id
     ) AS cost
     FROM workflow_runs w
     WHERE w.workspace_id = $1 AND w.workflow_id = $2 AND w.kind = 'run'
       AND w.status <> 'running'
     ORDER BY w.started_at DESC LIMIT 1`,
    [workspaceId, workflowId],
  );
  return rows[0]?.cost ?? null;
}
