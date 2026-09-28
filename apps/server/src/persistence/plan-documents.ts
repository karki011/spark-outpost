import {
  PLAN_DOCUMENT_MAX_LENGTH,
  type ConversationPlans,
  type PlanDocument,
  type PlanDocumentSource,
  type PlanDocumentStatus,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type DbClient, type Queryable } from './db.ts';
import { newId } from './ids.ts';

interface PlanDocumentRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  version: number;
  status: PlanDocumentStatus;
  source: PlanDocumentSource;
  body: string;
  source_run_id: string | null;
  source_message_id: string | null;
  approved_at: Date | null;
  approved_by: 'user' | 'jev' | null;
  approved_option: string | null;
  approved_commit: string | null;
  created_at: Date;
}

export interface PlanApproval {
  by: 'user' | 'jev';
  option: string | null;
  runId: string | null;
  commit: string | null;
  approvalId?: string | null;
}

export interface NewPlanDocument {
  conversationId: string;
  taskId: string | null;
  source: PlanDocumentSource;
  body: string;
  sourceRunId: string | null;
  sourceMessageId?: string | null;
  toolCallId?: string | null;
  approval?: PlanApproval;
}

export class PlanDocumentError extends Error {}

function toPlanDocument(row: PlanDocumentRow): PlanDocument {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    version: row.version,
    status: row.status,
    source: row.source,
    body: row.body,
    sourceRunId: row.source_run_id,
    sourceMessageId: row.source_message_id,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedOption: row.approved_option,
    approvedCommit: row.approved_commit,
    createdAt: row.created_at.toISOString(),
  };
}

function planBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new PlanDocumentError('A plan needs some text to save.');
  return trimmed.slice(0, PLAN_DOCUMENT_MAX_LENGTH);
}

async function supersedeApproved(client: DbClient, conversationId: string, keep: string) {
  await client.query(
    `UPDATE plan_documents SET status = 'superseded'
     WHERE conversation_id = $1 AND status = 'approved' AND id <> $2`,
    [conversationId, keep],
  );
}

export async function insertPlanDocument(db: Db, plan: NewPlanDocument): Promise<PlanDocument> {
  const body = planBody(plan.body);
  const approval = plan.approval ?? null;
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [plan.conversationId]);
    const { rows } = await client.query<PlanDocumentRow>(
      `INSERT INTO plan_documents (id, conversation_id, task_id, version, status, source, body,
         source_run_id, source_message_id, tool_call_id, approved_at, approved_by,
         approved_option, approved_run_id, approved_commit)
       SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, $4, $5, $6, $7, $8, $9,
         CASE WHEN $4 = 'approved' THEN now() END, $10, $11, $12, $13
       FROM plan_documents WHERE conversation_id = $2
       RETURNING *`,
      [
        newId(),
        plan.conversationId,
        plan.taskId,
        approval ? 'approved' : 'proposed',
        plan.source,
        body,
        plan.sourceRunId,
        plan.sourceMessageId ?? null,
        plan.toolCallId ?? null,
        approval?.by ?? null,
        approval?.option ?? null,
        approval?.runId ?? null,
        approval?.commit ?? null,
      ],
    );
    const row = rows[0]!;
    if (approval) await supersedeApproved(client, plan.conversationId, row.id);
    return toPlanDocument(row);
  });
}

export async function approvePlanDocument(
  db: Db,
  id: string,
  approval: PlanApproval,
): Promise<PlanDocument> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<PlanDocumentRow>(
      `UPDATE plan_documents SET status = 'approved', approved_at = now(), approved_by = $2,
         approved_option = $3, approved_run_id = $4, approved_commit = $5, approval_id = $6
       WHERE id = $1 AND status = 'proposed'
       RETURNING *`,
      [
        id,
        approval.by,
        approval.option,
        approval.runId,
        approval.commit,
        approval.approvalId ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new PlanDocumentError('That plan is no longer waiting for approval.');
    await supersedeApproved(client, row.conversation_id, row.id);
    return toPlanDocument(row);
  });
}

export async function rejectPlanDocument(
  db: Queryable,
  id: string,
  approvalId: string | null,
): Promise<PlanDocument> {
  const { rows } = await db.query<PlanDocumentRow>(
    `UPDATE plan_documents SET status = 'rejected', approval_id = $2
     WHERE id = $1 AND status = 'proposed' RETURNING *`,
    [id, approvalId],
  );
  const row = rows[0];
  if (!row) throw new PlanDocumentError('That plan is no longer waiting for approval.');
  return toPlanDocument(row);
}

export async function latestApprovedPlan(
  db: Queryable,
  conversationId: string,
): Promise<PlanDocument | null> {
  const { rows } = await db.query<PlanDocumentRow>(
    `SELECT * FROM plan_documents WHERE conversation_id = $1 AND status = 'approved'
     ORDER BY approved_at DESC, version DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0] ? toPlanDocument(rows[0]) : null;
}

export async function planDocuments(
  db: Queryable,
  conversationId: string,
): Promise<PlanDocument[]> {
  const { rows } = await db.query<PlanDocumentRow>(
    'SELECT * FROM plan_documents WHERE conversation_id = $1 ORDER BY version',
    [conversationId],
  );
  return rows.map(toPlanDocument);
}

export async function proposedPlanFromRun(
  db: Queryable,
  runId: string,
): Promise<PlanDocument | null> {
  const { rows } = await db.query<PlanDocumentRow>(
    `SELECT * FROM plan_documents WHERE status = 'proposed' AND source_run_id IN (
       SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1
     ) ORDER BY version DESC LIMIT 1`,
    [runId],
  );
  return rows[0] ? toPlanDocument(rows[0]) : null;
}

export async function planForMessage(
  db: Queryable,
  messageId: string,
): Promise<PlanDocument | null> {
  const { rows } = await db.query<PlanDocumentRow>(
    `SELECT * FROM plan_documents WHERE source_message_id = $1
     ORDER BY version DESC LIMIT 1`,
    [messageId],
  );
  return rows[0] ? toPlanDocument(rows[0]) : null;
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  content: string;
  runId: string | null;
  taskId: string | null;
}

interface AssistantMessageRow {
  id: string;
  conversation_id: string;
  content: string;
  run_id: string | null;
  task_id: string | null;
}

function toAssistantMessage(row: AssistantMessageRow): AssistantMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    runId: row.run_id,
    taskId: row.task_id,
  };
}

export async function previousAssistantMessage(
  db: Queryable,
  runId: string,
): Promise<AssistantMessage | null> {
  const { rows } = await db.query<AssistantMessageRow>(
    `SELECT m.id, m.conversation_id, m.content, m.run_id, pr.task_id
     FROM runs r
     JOIN messages um ON um.id = r.user_message_id
     JOIN messages m ON m.conversation_id = r.conversation_id AND m.role = 'assistant'
       AND (m.created_at, m.id) < (um.created_at, um.id)
     LEFT JOIN runs pr ON pr.id = m.run_id
     WHERE r.id = $1
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
    [runId],
  );
  return rows[0] ? toAssistantMessage(rows[0]) : null;
}

export async function assistantMessage(
  db: Queryable,
  conversationId: string,
  messageId: string,
): Promise<AssistantMessage | null> {
  const { rows } = await db.query<AssistantMessageRow>(
    `SELECT m.id, m.conversation_id, m.content, m.run_id, r.task_id
     FROM messages m LEFT JOIN runs r ON r.id = m.run_id
     WHERE m.id = $1 AND m.conversation_id = $2 AND m.role = 'assistant'`,
    [messageId, conversationId],
  );
  return rows[0] ? toAssistantMessage(rows[0]) : null;
}

export async function conversationPlans(
  db: Queryable,
  conversationId: string,
): Promise<ConversationPlans> {
  const [saved, offers] = await Promise.all([
    db.query<{ message_id: string; version: number }>(
      `SELECT DISTINCT ON (source_message_id) source_message_id AS message_id, version
       FROM plan_documents
       WHERE conversation_id = $1 AND source_message_id IS NOT NULL
         AND status IN ('approved', 'superseded')
       ORDER BY source_message_id, version DESC`,
      [conversationId],
    ),
    db.query<{ run_id: string; message_id: string }>(
      `SELECT a.run_id, a.body->'answer'->>'messageId' AS message_id
       FROM run_advice a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1 AND a.purpose = 'plan_agreed' AND a.body->>'applied' = 'offer'
       ORDER BY a.created_at`,
      [conversationId],
    ),
  ]);
  const savedIds = new Set(saved.rows.map((row) => row.message_id));
  return {
    saved: saved.rows.map((row) => ({ messageId: row.message_id, version: row.version })),
    offers: offers.rows
      .filter((row) => !savedIds.has(row.message_id))
      .map((row) => ({ runId: row.run_id, messageId: row.message_id })),
  };
}
