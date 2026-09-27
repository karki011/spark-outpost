import { randomUUID } from 'node:crypto';
import type { Db } from '../src/persistence/db.ts';

export interface SeedTurn {
  conversationId?: string;
  request?: string;
  status?: string;
  finishedAt?: Date;
  createdAt?: Date;
  depth?: string;
  taskId?: string | null;
  category?: string | null;
  snapshot?: { ref: string; root: string } | null;
  intake?: boolean;
}

export async function seedConversation(db: Db, workspaceId: string): Promise<string> {
  const id = randomUUID();
  await db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
    id,
    workspaceId,
    'Outcomes',
  ]);
  return id;
}

export async function seedTask(db: Db, conversationId: string): Promise<string> {
  const id = randomUUID();
  await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    id,
    conversationId,
    'Task',
  ]);
  return id;
}

export async function seedTurn(db: Db, conversationId: string, turn: SeedTurn = {}) {
  const runId = randomUUID();
  const messageId = randomUUID();
  const createdAt = turn.createdAt ?? new Date(Date.now() - 60_000);
  const status = turn.status ?? 'succeeded';
  const terminal = !['queued', 'running', 'awaiting_approval'].includes(status);
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'user', $3, $4)`,
    [messageId, conversationId, turn.request ?? 'Move the date helpers into one module', createdAt],
  );
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, created_at,
       started_at, finished_at, task_id, category, mode, snapshot_kind, snapshot_ref, snapshot_root)
     VALUES ($1, $2, $3, 'claude', $4, $5, $5, $6, $7, $8, 'do', $9, $10, $11)`,
    [
      runId,
      conversationId,
      messageId,
      status,
      createdAt,
      terminal ? (turn.finishedAt ?? new Date(createdAt.getTime() + 30_000)) : null,
      turn.taskId ?? null,
      turn.category ?? null,
      turn.snapshot ? 'git' : null,
      turn.snapshot?.ref ?? null,
      turn.snapshot?.root ?? null,
    ],
  );
  await db.query(
    `INSERT INTO orchestrations (run_id, phase, depth, depth_source, risk, routing,
       active_limit_ms, tool_call_limit)
     VALUES ($1, 'finished', $2, 'rules', 'edits', 'pinned', 900000, 60)`,
    [runId, turn.depth ?? 'execute'],
  );
  if (turn.intake) await seedIntake(db, runId);
  return runId;
}

export async function seedIntake(db: Db, runId: string, body: object = {}): Promise<void> {
  await db.query(
    `INSERT INTO run_advice (run_id, purpose, jev_status, body)
     VALUES ($1, 'intake', 'not_connected', $2)`,
    [runId, JSON.stringify(body)],
  );
}

export async function seedAccept(db: Db, runId: string, optionId: 'keep' | 'revert' | 'fix') {
  await db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, decision_option_id, scope, decided_by, decided_at)
     VALUES ($1, $2, $3, 'accept', 'Keep these changes?', '{}', 'hash', '[]', $4, $5, 'once',
       'user', now())`,
    [
      randomUUID(),
      runId,
      `checkpoint:accept:${randomUUID()}`,
      optionId === 'keep' ? 'allowed' : 'denied',
      optionId,
    ],
  );
}

export async function seedCheck(
  db: Db,
  taskId: string,
  runId: string,
  status: 'passed' | 'failed',
): Promise<void> {
  const body = { runId, name: 'Bolt', copy: null, round: 1, status, results: [] };
  await db.query(
    `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
     VALUES ($1, 'check', COALESCE((SELECT max(version) + 1 FROM run_artifacts
       WHERE task_id = $1 AND kind = 'check'), 1), $2, $3)`,
    [taskId, JSON.stringify(body), runId],
  );
}
