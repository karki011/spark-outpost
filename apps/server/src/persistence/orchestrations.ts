import { checkpointKindSchema, translateMode, type ConfigValues } from '@spark-outpost/contracts';
import type {
  AgentRole,
  CheckpointKind,
  Depth,
  JevStatus,
  Orchestration,
  OrchestrationPhase,
  Risk,
  RunMode,
} from '@spark-outpost/contracts';
import {
  buildOrchestration,
  toCrewMember,
  toDecision,
  type DecisionRow,
  type MemberRow,
  type OrchestrationRow,
  type StoredRoute,
} from '../orchestration/view.ts';
import { toApproval, type ApprovalRow } from './approvals.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { pieceListsForRuns } from './pieces.ts';
import { newId } from './ids.ts';
import type { Lease } from './jobs.ts';

export interface NewOrchestration {
  runId: string;
  depth: Depth;
  depthSource: 'jev' | 'rules' | 'user';
  risk: Risk;
}

export async function insertOrchestration(db: Queryable, row: NewOrchestration): Promise<void> {
  await db.query(
    `INSERT INTO orchestrations (run_id, phase, depth, depth_source, risk)
     VALUES ($1, 'intake', $2, $3, $4)
     ON CONFLICT (run_id) DO NOTHING`,
    [row.runId, row.depth, row.depthSource, row.risk],
  );
}

export interface OrchestrationPatch {
  phase?: OrchestrationPhase;
  depth?: Depth;
  depthSource?: 'jev' | 'rules' | 'user';
  risk?: Risk;
  retries?: number;
  activeMs?: number;
  toolCalls?: number;
  error?: string | null;
}

const PATCH_COLUMNS: Record<keyof OrchestrationPatch, string> = {
  phase: 'phase',
  depth: 'depth',
  depthSource: 'depth_source',
  risk: 'risk',
  retries: 'retries',
  activeMs: 'active_ms',
  toolCalls: 'tool_calls',
  error: 'error',
};

export async function updateOrchestration(
  db: Queryable,
  runId: string,
  patch: OrchestrationPatch,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(
    ([key], index) => `${PATCH_COLUMNS[key as keyof OrchestrationPatch]} = $${index + 2}`,
  );
  await db.query(
    `UPDATE orchestrations SET ${sets.join(', ')}, updated_at = now() WHERE run_id = $1`,
    [runId, ...entries.map(([, value]) => value)],
  );
}

export interface MemberFields {
  role: AgentRole;
  stepIndex: number;
  attempt: number;
  agentLabel: string;
  provider: string;
  model: string | null;
  effort: string | null;
  route: StoredRoute;
}

export interface NewChild extends MemberFields {
  parentRunId: string;
  mode: RunMode;
  prompt: string;
  agentMode?: string | null;
}

export async function insertChildRun(
  db: Db,
  child: NewChild,
  leaseSeconds: number,
): Promise<Lease> {
  const runId = newId();
  const jobId = newId();
  const token = newId();
  await withTransaction(db, async (client) => {
    const parent = await client.query<{
      provider: string;
      agent_mode: string | null;
      config_values: ConfigValues;
    }>('SELECT provider, agent_mode, config_values FROM runs WHERE id = $1', [child.parentRunId]);
    const from = parent.rows[0];
    const sameAgent = from?.provider === child.provider;
    await client.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
         task_id, plan_version, mode, level, parent_run_id, role, step_index, attempt,
         agent_label, prompt, route, agent_mode, config_values)
       SELECT $1, p.conversation_id, p.user_message_id, $3, $4, $5, 'queued', p.task_id,
         (SELECT MAX(version) FROM run_artifacts a WHERE a.task_id = p.task_id AND a.kind = 'plan'),
         $6, p.level, p.id, $7, $8, $9, $10, $11, $12, $13, $14
       FROM runs p WHERE p.id = $2`,
      [
        runId,
        child.parentRunId,
        child.provider,
        child.model,
        child.effort,
        child.mode,
        child.role,
        child.stepIndex,
        child.attempt,
        child.agentLabel,
        child.prompt,
        JSON.stringify(child.route),
        child.agentMode ??
          (from ? translateMode(from.provider, from.agent_mode, child.provider) : null),
        JSON.stringify(sameAgent ? from.config_values : {}),
      ],
    );
    await client.query(
      `INSERT INTO jobs (id, run_id, status, attempts, lease_token, lease_expires_at)
       VALUES ($1, $2, 'leased', 1, $3, now() + make_interval(secs => $4))`,
      [jobId, runId, token, leaseSeconds],
    );
  });
  return { jobId, runId, token, attempt: 1 };
}

export interface NewDecision {
  runId: string;
  purpose:
    | 'route'
    | 'policy'
    | 'verify'
    | 'finding'
    | 'scan'
    | 'rank'
    | 'rank_content'
    | 'route_shadow'
    | 'plan_agreed'
    | 'parallel'
    | 'clarify'
    | 'piece_route'
    | 'chat_update'
    | 'law';
  childRunId: string | null;
  role: AgentRole | null;
  stepIndex: number | null;
  jevStatus: JevStatus;
  inputTokens: number | null;
  costUsd: number | null;
  body: Record<string, unknown>;
  policyVersion?: string | null;
}

export async function insertDecision(db: Queryable, decision: NewDecision): Promise<void> {
  await db.query(
    `INSERT INTO run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body,
       child_run_id, role, step_index, policy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      decision.runId,
      decision.purpose,
      decision.jevStatus,
      decision.inputTokens,
      decision.costUsd,
      JSON.stringify(decision.body),
      decision.childRunId,
      decision.role,
      decision.stepIndex,
      decision.policyVersion ?? null,
    ],
  );
}

const CHECKPOINT_KINDS: readonly CheckpointKind[] = checkpointKindSchema.options;

const MEMBER_COLUMNS = `r.id, r.role, r.step_index, r.attempt, r.agent_label, r.provider, r.model,
  r.effort, r.mode, r.route, r.status, r.error, r.model_switch, r.error_details,
  COALESCE(r.total_tokens, r.input_tokens + r.output_tokens) AS tokens,
  r.cost_usd, r.cost_source, r.duration_ms, r.tool_call_count, r.context_used, r.context_size, r.started_at, r.finished_at`;

async function orchestrationRows(db: Queryable, where: string, id: string) {
  const { rows } = await db.query<OrchestrationRow>(
    `SELECT o.*, r.id AS run_id, r.conversation_id, r.task_id, r.status, r.error AS run_error,
       r.level, r.provider,
       (SELECT MAX(version) FROM run_artifacts a WHERE a.task_id = r.task_id AND a.kind = 'plan')
         AS plan_version
     FROM orchestrations o JOIN runs r ON r.id = o.run_id WHERE ${where} ORDER BY r.created_at`,
    [id],
  );
  return rows;
}

async function assembleOrchestrations(db: Queryable, rows: readonly OrchestrationRow[]) {
  const ids = rows.map((row) => row.run_id);
  if (ids.length === 0) return [];
  const [members, approvals, decisions] = await Promise.all([
    db.query<MemberRow & { owner: string }>(
      `SELECT ${MEMBER_COLUMNS}, COALESCE(r.parent_run_id, r.id) AS owner FROM runs r
       WHERE r.role IS NOT NULL AND (r.id = ANY($1::uuid[]) OR r.parent_run_id = ANY($1::uuid[]))
       ORDER BY r.role = 'spark' DESC, r.created_at`,
      [ids],
    ),
    db.query<ApprovalRow>(
      `SELECT * FROM approvals WHERE run_id = ANY($1::uuid[]) AND kind = ANY($2::text[])
       ORDER BY created_at`,
      [ids, CHECKPOINT_KINDS],
    ),
    db.query<DecisionRow & { run_id: string }>(
      `SELECT * FROM run_advice WHERE run_id = ANY($1::uuid[])
       AND purpose NOT IN ('scan', 'rank', 'rank_content', 'route_shadow', 'plan_agreed', 'clarify',
         'piece_route', 'chat_update', 'law')
       AND NOT (purpose = 'parallel' AND COALESCE(body->'answer'->>'shadow', '') = 'true')
       ORDER BY created_at`,
      [ids],
    ),
  ]);
  const pieces = await pieceListsForRuns(db, ids);
  return rows.map((row) =>
    buildOrchestration(
      row,
      members.rows.filter((member) => member.owner === row.run_id).map(toCrewMember),
      approvals.rows.filter((approval) => approval.run_id === row.run_id).map(toApproval),
      decisions.rows.filter((decision) => decision.run_id === row.run_id).map(toDecision),
      pieces.get(row.run_id) ?? null,
    ),
  );
}

export async function loadOrchestration(
  db: Queryable,
  runId: string,
): Promise<Orchestration | null> {
  const [orchestration] = await assembleOrchestrations(
    db,
    await orchestrationRows(db, 'o.run_id = $1', runId),
  );
  return orchestration ?? null;
}

export async function conversationOrchestrations(
  db: Queryable,
  conversationId: string,
): Promise<Record<string, Orchestration>> {
  const rows = await orchestrationRows(db, 'r.conversation_id = $1', conversationId);
  const all = await assembleOrchestrations(db, rows);
  return Object.fromEntries(all.map((orchestration) => [orchestration.runId, orchestration]));
}
