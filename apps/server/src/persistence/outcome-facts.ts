import {
  categorySchema,
  checkBodySchema,
  runStatusSchema,
  type CheckStatus,
} from '@spark-outpost/contracts';
import { FOLLOW_UP_WINDOW_MS, type TurnFacts } from '../outcomes/derive.ts';
import type { Queryable } from './db.ts';

export interface TurnRow {
  id: string;
  conversation_id: string;
  workspace_id: string;
  task_id: string | null;
  status: string;
  created_at: Date;
  finished_at: Date | null;
  reverted_at: Date | null;
  snapshot_kind: string | null;
  snapshot_ref: string | null;
  snapshot_root: string | null;
  depth: string | null;
  request: string;
}

export async function loadTurn(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<TurnRow | null> {
  const { rows } = await db.query<TurnRow>(
    `SELECT r.id, r.conversation_id, c.workspace_id, r.task_id, r.status, r.created_at,
            r.finished_at, r.reverted_at, r.snapshot_kind, r.snapshot_ref, r.snapshot_root,
            o.depth, COALESCE(m.content, '') AS request
     FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN orchestrations o ON o.run_id = r.id
     LEFT JOIN messages m ON m.id = r.user_message_id
     WHERE r.id = $1 AND c.workspace_id = $2 AND r.parent_run_id IS NULL AND r.role IS DISTINCT FROM 'digest'`,
    [runId, workspaceId],
  );
  return rows[0] ?? null;
}

async function accepts(db: Queryable, runId: string) {
  const { rows } = await db.query<{ decision_option_id: string; decided_at: Date }>(
    `SELECT decision_option_id, decided_at FROM approvals
     WHERE run_id = $1 AND kind = 'accept' AND status IN ('allowed', 'denied')
     ORDER BY decided_at`,
    [runId],
  );
  return rows
    .filter((row) => row.decision_option_id && row.decided_at)
    .map((row) => ({ optionId: row.decision_option_id, decidedAt: row.decided_at }));
}

function finalCheckStatus(bodies: readonly unknown[]): CheckStatus | null {
  const latest = new Map<string, CheckStatus>();
  for (const raw of bodies) {
    const body = checkBodySchema.safeParse(raw);
    if (body.success) latest.set(`${body.data.name}:${body.data.copy ?? ''}`, body.data.status);
  }
  const statuses = [...latest.values()];
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('passed')) return 'passed';
  return statuses.length > 0 ? 'skipped' : null;
}

async function checks(db: Queryable, runId: string) {
  const { rows } = await db.query<{ body: unknown; created_at: Date }>(
    `SELECT a.body, a.created_at FROM run_artifacts a
     WHERE a.kind = 'check' AND (
       a.source_run_id = $1
       OR a.source_run_id IN (SELECT id FROM runs WHERE parent_run_id = $1)
     )
     ORDER BY a.created_at, a.version`,
    [runId],
  );
  const status = finalCheckStatus(rows.map((row) => row.body));
  const at = rows.at(-1)?.created_at;
  return status && at ? { status, at } : null;
}

async function changedFiles(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ changed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM approvals WHERE run_id = $1 AND kind = 'accept'
     ) OR EXISTS (
       SELECT 1 FROM runs WHERE (id = $1 OR parent_run_id = $1) AND role = 'builder'
     ) AS changed`,
    [runId],
  );
  return rows[0]?.changed ?? false;
}

interface FollowUpRow {
  id: string;
  conversation_id: string;
  status: string;
  category: string | null;
  created_at: Date;
  text: string;
  intake: boolean;
}

const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];

async function followUps(db: Queryable, turn: TurnRow) {
  if (!turn.finished_at) return [];
  const until = new Date(turn.finished_at.getTime() + FOLLOW_UP_WINDOW_MS);
  const { rows } = await db.query<FollowUpRow>(
    `SELECT r.id, r.conversation_id, r.status, r.category, r.created_at,
            COALESCE(m.content, '') AS text,
            EXISTS (
              SELECT 1 FROM run_advice a WHERE a.run_id = r.id AND a.purpose = 'intake'
            ) AS intake
     FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN messages m ON m.id = r.user_message_id
     WHERE c.workspace_id = $1 AND r.id <> $2
       AND r.parent_run_id IS NULL AND r.role IS DISTINCT FROM 'digest'
       AND r.created_at > $3 AND r.created_at <= $4
     ORDER BY r.created_at
     LIMIT 50`,
    [turn.workspace_id, turn.id, turn.created_at, until],
  );
  return rows.map((row) => {
    const category = categorySchema.safeParse(row.category);
    return {
      runId: row.id,
      text: row.text,
      category: category.success ? category.data : null,
      classified: row.intake || TERMINAL_STATUSES.includes(row.status),
      sameChat: row.conversation_id === turn.conversation_id,
      createdAt: row.created_at,
    };
  });
}

export async function turnFacts(db: Queryable, turn: TurnRow): Promise<TurnFacts> {
  return {
    runId: turn.id,
    taskId: turn.task_id,
    status: runStatusSchema.parse(turn.status),
    finishedAt: turn.finished_at,
    revertedAt: turn.reverted_at,
    depth: turn.depth,
    request: turn.request,
    changedFiles: await changedFiles(db, turn.id),
    accepts: await accepts(db, turn.id),
    checks: await checks(db, turn.id),
    followUps: await followUps(db, turn),
  };
}
