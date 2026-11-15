import type { PublishHold } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

const HOLDS_PAGE = 20;

export class PublishHoldNotFoundError extends Error {
  constructor() {
    super('That hold is not open.');
  }
}

export interface NewHold {
  workspaceId: string;
  conversationId: string;
  workflowId: string;
  workflowRunId: string | null;
  diffHash: string;
  findings: number;
  finished: boolean;
}

export async function holdPublish(db: Queryable, hold: NewHold): Promise<void> {
  await db.query(
    `UPDATE workflow_publish_holds SET state = 'cleared', settled_at = now()
     WHERE conversation_id = $1 AND workflow_id = $2 AND state = 'open'`,
    [hold.conversationId, hold.workflowId],
  );
  await db.query(
    `INSERT INTO workflow_publish_holds (id, workspace_id, conversation_id, workflow_id,
       workflow_run_id, diff_hash, findings, finished)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newId(),
      hold.workspaceId,
      hold.conversationId,
      hold.workflowId,
      hold.workflowRunId,
      hold.diffHash,
      hold.findings,
      hold.finished,
    ],
  );
}

export async function clearHolds(
  db: Queryable,
  conversationId: string,
  workflowId: string,
): Promise<void> {
  await db.query(
    `UPDATE workflow_publish_holds SET state = 'cleared', settled_at = now()
     WHERE conversation_id = $1 AND workflow_id = $2 AND state = 'open'`,
    [conversationId, workflowId],
  );
}

export interface OpenHold {
  diffHash: string;
  findings: number;
  finished: boolean;
}

export async function openHold(
  db: Queryable,
  conversationId: string,
  workflowId: string,
): Promise<OpenHold | null> {
  const { rows } = await db.query<{ diff_hash: string; findings: number; finished: boolean }>(
    `SELECT diff_hash, findings, finished FROM workflow_publish_holds
     WHERE conversation_id = $1 AND workflow_id = $2 AND state = 'open'`,
    [conversationId, workflowId],
  );
  const row = rows[0];
  return row ? { diffHash: row.diff_hash, findings: row.findings, finished: row.finished } : null;
}

export async function releaseHold(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE workflow_publish_holds SET state = 'released', settled_at = now()
     WHERE id = $1 AND workspace_id = $2 AND state = 'open'`,
    [id, workspaceId],
  );
  return rowCount === 1;
}

interface HoldRow {
  id: string;
  conversation_id: string;
  chat_title: string | null;
  workflow_id: string;
  findings: number;
  finished: boolean;
  state: PublishHold['state'];
  created_at: Date;
}

export async function listHolds(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<PublishHold[]> {
  const { rows } = await db.query<HoldRow>(
    `SELECT h.*, c.title AS chat_title FROM workflow_publish_holds h
     JOIN conversations c ON c.id = h.conversation_id
     WHERE h.workspace_id = $1 AND h.workflow_id = $2
     ORDER BY (h.state = 'open') DESC, h.created_at DESC LIMIT $3`,
    [workspaceId, workflowId, HOLDS_PAGE],
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    chatTitle: row.chat_title ?? '',
    workflowId: row.workflow_id,
    findings: row.findings,
    finished: row.finished,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function lastGateHash(
  db: Queryable,
  workflowId: string,
  conversationId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ diff_hash: string | null }>(
    `SELECT diff_hash FROM workflow_runs
     WHERE workflow_id = $1 AND conversation_id = $2 AND gates_run_id IS NOT NULL
       AND trigger_kind = 'before_publish' AND status IN ('succeeded', 'failed')
     ORDER BY started_at DESC LIMIT 1`,
    [workflowId, conversationId],
  );
  return rows[0]?.diff_hash ?? null;
}
