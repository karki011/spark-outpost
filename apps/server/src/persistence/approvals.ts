import { createHash } from 'node:crypto';
import {
  CHECKPOINT_OPTION,
  NOTE_OPTIONS,
  SPARK_ACTION_KIND,
  agentContentSchema,
  applySparkEdits,
  editableFields,
  formContent,
  sparkActionEditsSchema,
  isCheckpointKind,
  type Approval,
  type ApprovalDecider,
  type ApprovalKind,
  type ApprovalOption,
  type ApprovalPayload,
  type ApprovalScope,
  type ApprovalStatus,
  type AgentContent,
  type QuestionAnswerInput,
  type SparkActionEdits,
  type SparkRuleAnswer,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface ApprovalRow {
  id: string;
  run_id: string;
  tool_call_id: string;
  kind: ApprovalKind;
  title: string;
  payload: ApprovalPayload;
  payload_hash: string;
  options: ApprovalOption[];
  status: ApprovalStatus;
  reason: string | null;
  decision_option_id: string | null;
  scope: ApprovalScope | null;
  decided_by: ApprovalDecider | null;
  decided_at: Date | null;
  created_at: Date;
  note?: string | null;
  auto_continue_at?: Date | null;
  edits?: SparkActionEdits | null;
  rule_answer?: SparkRuleAnswer | null;
}

export class ApprovalNotFoundError extends Error {
  constructor() {
    super('Approval not found.');
  }
}

export class ApprovalConflictError extends Error {}
export class ApprovalInputError extends Error {}

export function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    kind: row.kind,
    title: row.title,
    payload: row.payload,
    payloadHash: row.payload_hash,
    options: row.options,
    status: row.status,
    reason: row.reason,
    decisionOptionId: row.decision_option_id,
    scope: row.scope,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    note: row.note ?? null,
    autoContinueAt: row.auto_continue_at?.toISOString() ?? null,
    ...(row.edits ? { edits: row.edits } : {}),
    ...(row.payload.sparkRule ? { ruleAnswer: row.rule_answer ?? null } : {}),
  };
}

export function payloadHash(kind: ApprovalKind, title: string, payload: ApprovalPayload): string {
  const canonical = JSON.stringify({
    kind,
    title,
    command: payload.command,
    cwd: payload.cwd,
    paths: payload.paths,
    diffs: payload.diffs.map((diff) => [diff.path, diff.oldText, diff.newText]),
    ...(payload.checkpoint ? { checkpoint: payload.checkpoint } : {}),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export interface NewApproval {
  runId: string;
  toolCallId: string;
  rpcId: string | null;
  kind: ApprovalKind;
  title: string;
  payload: ApprovalPayload;
  options: ApprovalOption[];
  reason: string | null;
  autoContinueMs?: number | null;
}

export interface Settlement {
  status: Exclude<ApprovalStatus, 'pending'>;
  decidedBy: ApprovalDecider;
  optionId: string | null;
  scope?: ApprovalScope | null;
  note?: string | null;
  edits?: SparkActionEdits | null;
  answerContent?: AgentContent | null;
}

export function defaultOption(approval: Pick<NewApproval, 'payload' | 'options'>): string | null {
  const auto = approval.payload.checkpoint?.autoOption;
  if (auto) return auto;
  const allow = approval.options.find((option) => option.kind.startsWith('allow'));
  return (allow ?? approval.options[0])?.optionId ?? null;
}

export async function insertApproval(
  db: Queryable,
  approval: NewApproval,
  settled: Settlement | null = null,
): Promise<Approval> {
  const { rows } = await db.query<ApprovalRow>(
    `INSERT INTO approvals (id, run_id, tool_call_id, rpc_id, kind, title, payload, payload_hash,
       options, status, reason, decision_option_id, scope, decided_by, decided_at, auto_continue_at,
       default_option_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       CASE WHEN $10 = 'pending' THEN NULL ELSE now() END,
       CASE WHEN $10 = 'pending' AND $15::integer IS NOT NULL
         THEN now() + make_interval(secs => $15::integer / 1000.0) END,
       $16)
     RETURNING *`,
    [
      newId(),
      approval.runId,
      approval.toolCallId,
      approval.rpcId,
      approval.kind,
      approval.title,
      JSON.stringify(approval.payload),
      payloadHash(approval.kind, approval.title, approval.payload),
      JSON.stringify(approval.options),
      settled?.status ?? 'pending',
      approval.reason,
      settled?.optionId ?? null,
      settled ? (settled.scope ?? 'once') : null,
      settled?.decidedBy ?? null,
      approval.autoContinueMs ?? null,
      defaultOption(approval),
    ],
  );
  return toApproval(rows[0]!);
}

export async function getApproval(db: Queryable, id: string): Promise<Approval | null> {
  const { rows } = await db.query<ApprovalRow>('SELECT * FROM approvals WHERE id = $1', [id]);
  return rows[0] ? toApproval(rows[0]) : null;
}

export async function approvalAnswerContent(
  db: Queryable,
  id: string,
): Promise<AgentContent | null> {
  const { rows } = await db.query<{ answer_content: unknown }>(
    'SELECT answer_content FROM approvals WHERE id = $1',
    [id],
  );
  const parsed = agentContentSchema.safeParse(rows[0]?.answer_content);
  return parsed.success ? parsed.data : null;
}

export async function notifyApprovalChanged(db: Queryable, id: string): Promise<void> {
  await db.query(`SELECT pg_notify('approvals', $1)`, [id]);
}

export async function settlePending(
  db: Queryable,
  id: string,
  settlement: Settlement,
): Promise<Approval | null> {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE approvals SET status = $2, decided_by = $3, decision_option_id = $4,
       scope = COALESCE($5, 'once'), note = $6, edits = $7, answer_content = $8, decided_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [
      id,
      settlement.status,
      settlement.decidedBy,
      settlement.optionId,
      settlement.scope ?? null,
      settlement.note ?? null,
      settlement.edits ? JSON.stringify(settlement.edits) : null,
      settlement.answerContent ? JSON.stringify(settlement.answerContent) : null,
    ],
  );
  if (rows[0]) await notifyApprovalChanged(db, id);
  return rows[0] ? toApproval(rows[0]) : null;
}

export async function settleIfDue(
  db: Queryable,
  id: string,
  optionId: string,
): Promise<Approval | null> {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE approvals SET decided_by = 'auto', decision_option_id = $2, scope = 'once',
       decided_at = now(),
       status = CASE WHEN EXISTS (
         SELECT 1 FROM jsonb_array_elements(options) o
         WHERE o->>'optionId' = $2 AND o->>'kind' LIKE 'allow%'
       ) THEN 'allowed' ELSE 'denied' END
     WHERE id = $1 AND status = 'pending' AND auto_continue_at <= now()
     RETURNING *`,
    [id, optionId],
  );
  if (rows[0]) await notifyApprovalChanged(db, id);
  return rows[0] ? toApproval(rows[0]) : null;
}

export async function holdApproval(db: Queryable, workspaceId: string, id: string) {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE approvals a SET auto_continue_at = NULL
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE a.id = $1 AND r.id = a.run_id AND c.workspace_id = $2
     RETURNING a.*`,
    [id, workspaceId],
  );
  if (!rows[0]) throw new ApprovalNotFoundError();
  return toApproval(rows[0]);
}

export interface UserDecision {
  optionId: string;
  scope: ApprovalScope;
  payloadHash?: string | undefined;
  note?: string | undefined;
  edits?: SparkActionEdits | undefined;
  answers?: QuestionAnswerInput[] | undefined;
}

function validateDecision(approval: Approval, decision: UserDecision): ApprovalOption {
  if (approval.status !== 'pending') {
    throw new ApprovalConflictError('This approval was already answered.');
  }
  if (decision.payloadHash !== undefined && decision.payloadHash !== approval.payloadHash) {
    throw new ApprovalConflictError('The request changed. Review it again before deciding.');
  }
  const option = approval.options.find((candidate) => candidate.optionId === decision.optionId);
  if (!option) throw new ApprovalInputError('That option is not offered for this approval.');
  const allowing = option.kind.startsWith('allow');
  if (!allowing && decision.scope === 'project') {
    throw new ApprovalInputError('A denial applies to this run at most.');
  }
  if (option.kind === 'reject_once' && decision.scope !== 'once') {
    throw new ApprovalInputError('A denial applies once.');
  }
  if (approval.payload.forcePush && decision.scope !== 'once') {
    throw new ApprovalInputError('A force push is allowed one at a time.');
  }
  if (approval.payload.gitControl && decision.scope !== 'once') {
    throw new ApprovalInputError('A change to git hooks or git config is allowed one at a time.');
  }
  if (decision.scope === 'chat' && !(approval.payload.instructionFiles && allowing)) {
    throw new ApprovalInputError(
      'Only changes to agent instruction files can be allowed for a chat.',
    );
  }
  if (approval.payload.secretSend && allowing && decision.scope !== 'once') {
    throw new ApprovalInputError('Sending a value from a secret file is allowed one at a time.');
  }
  if (decision.scope === 'project' && (approval.kind !== 'execute' || !approval.payload.command)) {
    throw new ApprovalInputError('Only commands can be allowed for the whole project.');
  }
  if (approval.kind === SPARK_ACTION_KIND) validateSparkDecision(approval, option, decision);
  else if (decision.edits) throw new ApprovalInputError('Only Spark actions take edits.');
  if (decision.answers && !approval.payload.form) {
    throw new ApprovalInputError('Only an agent question takes answers.');
  }
  const needsNote = NOTE_OPTIONS.includes(option.optionId) && !approval.payload.form;
  if (isCheckpointKind(approval.kind) && needsNote) {
    if (!decision.note?.trim()) throw new ApprovalInputError('This answer needs a note.');
  }
  return option;
}

function answerContent(approval: Approval, decision: UserDecision): AgentContent | null {
  const form = approval.payload.form;
  if (!form || decision.optionId !== CHECKPOINT_OPTION.answer) return null;
  if (!decision.answers) throw new ApprovalInputError('This answer needs your answers.');
  const content = formContent(form, decision.answers);
  if (!content.ok) throw new ApprovalInputError(content.error);
  return content.value;
}

function validateSparkDecision(
  approval: Approval,
  option: ApprovalOption,
  decision: UserDecision,
): void {
  if (decision.scope !== 'once') throw new ApprovalInputError('Spark actions are allowed once.');
  if (!decision.edits) return;
  if (!option.kind.startsWith('allow')) {
    throw new ApprovalInputError('Edits apply only when you confirm.');
  }
  const action = approval.payload.sparkAction!;
  const edits = sparkActionEditsSchema.safeParse(decision.edits);
  const allowed = editableFields(action.action);
  const valid =
    edits.success &&
    Object.keys(edits.data).every((field) => allowed.includes(field as keyof SparkActionEdits));
  try {
    if (!valid) throw new Error('not editable');
    applySparkEdits(action, edits.data);
  } catch {
    throw new ApprovalInputError('Check the edited fields.');
  }
}

async function addToAllowlist(db: Queryable, runId: string, command: string): Promise<void> {
  await db.query(
    `UPDATE projects p SET command_allowlist = array_append(p.command_allowlist, $2)
     WHERE p.id = (
       SELECT cp.project_id FROM runs r
       JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
       WHERE r.id = $1 ORDER BY cp.position, cp.created_at LIMIT 1
     ) AND NOT ($2 = ANY (p.command_allowlist))`,
    [runId, command],
  );
}

export async function decideApproval(
  db: Db,
  workspaceId: string,
  id: string,
  decision: UserDecision,
): Promise<Approval> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<ApprovalRow>(
      `SELECT a.* FROM approvals a
       JOIN runs r ON r.id = a.run_id
       JOIN conversations c ON c.id = r.conversation_id
       WHERE a.id = $1 AND c.workspace_id = $2
       FOR UPDATE OF a`,
      [id, workspaceId],
    );
    if (!rows[0]) throw new ApprovalNotFoundError();
    const approval = toApproval(rows[0]);
    const option = validateDecision(approval, decision);
    const content = answerContent(approval, decision);
    const settled = await settlePending(client, id, {
      status: option.kind.startsWith('allow') ? 'allowed' : 'denied',
      decidedBy: 'user',
      optionId: option.optionId,
      scope: scopeFor(option, decision.scope),
      note: decision.note?.trim() || null,
      edits: decision.edits ?? null,
      answerContent: content,
    });
    if (!settled) throw new ApprovalConflictError('This approval was already answered.');
    if (decision.scope === 'project') {
      await addToAllowlist(client, approval.runId, approval.payload.command!.trim());
    }
    return settled;
  });
}

function scopeFor(option: ApprovalOption, requested: ApprovalScope): ApprovalScope {
  if (requested === 'project' || requested === 'chat') return requested;
  return option.kind.endsWith('_always') ? 'run' : requested;
}

function memberApprovals(status: 'allowed' | 'denied') {
  return async (
    db: Queryable,
    runId: string,
  ): Promise<Pick<Approval, 'kind' | 'title' | 'payload'>[]> => {
    const { rows } = await db.query<Pick<ApprovalRow, 'kind' | 'title' | 'payload'>>(
      `WITH me AS (
         SELECT id, parent_run_id, role, route->>'name' AS name, route->>'resumeKey' AS resume_key
         FROM runs WHERE id = $1
       ),
       same_member AS (
         SELECT me.id FROM me
         UNION
         SELECT r.id FROM runs r JOIN me
           ON me.parent_run_id IS NOT NULL AND me.resume_key IS NOT NULL
          AND r.parent_run_id = me.parent_run_id AND r.route->>'resumeKey' = me.resume_key
         UNION
         SELECT r.id FROM runs r JOIN me
           ON me.resume_key IS NOT NULL AND r.id = me.parent_run_id
          AND r.role = me.role AND r.route->>'name' = me.name
       )
       SELECT kind, title, payload FROM approvals
       WHERE run_id IN (SELECT id FROM same_member) AND status = $2 AND scope = 'run'
       ORDER BY created_at`,
      [runId, status],
    );
    return rows;
  };
}

export const allowedForRun = memberApprovals('allowed');

export async function chatInstructionGrants(db: Queryable, runId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ file: string }>(
    `SELECT DISTINCT jsonb_array_elements_text(a.payload->'instructionFiles') AS file
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = (SELECT conversation_id FROM runs WHERE id = $1)
       AND a.scope = 'chat' AND a.status = 'allowed'`,
    [runId],
  );
  return new Set(rows.map((row) => row.file));
}
export const rejectedForRun = memberApprovals('denied');

export async function projectAllowlistForRun(db: Queryable, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ command_allowlist: string[] }>(
    `SELECT p.command_allowlist FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     JOIN projects p ON p.id = cp.project_id
     WHERE r.id = $1 ORDER BY cp.position, cp.created_at LIMIT 1`,
    [runId],
  );
  return rows[0]?.command_allowlist ?? [];
}

export async function expirePendingApprovals(
  db: Queryable,
  runId: string,
  decidedBy: ApprovalDecider,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE approvals SET status = 'expired', decided_by = $2, decided_at = now()
     WHERE run_id = $1 AND status = 'pending' RETURNING id`,
    [runId, decidedBy],
  );
  for (const row of rows) await notifyApprovalChanged(db, row.id);
  return rows.length;
}

export async function shownApprovalsForConversation(
  db: Queryable,
  conversationId: string,
): Promise<Approval[]> {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT a.* FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1
       AND (a.status = 'pending' OR a.decided_by IN ('user', 'timeout')
         OR (a.kind = $2 AND a.payload ? 'sparkResult')
         OR (a.decided_by = 'policy' AND a.payload ? 'sparkRule')
         OR (a.kind = 'accept' AND a.decided_by = 'level'
           AND NOT EXISTS (SELECT 1 FROM orchestrations o WHERE o.run_id = a.run_id)))
     ORDER BY a.created_at`,
    [conversationId, SPARK_ACTION_KIND],
  );
  return rows.map(toApproval);
}
