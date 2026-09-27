import { checkBodySchema, checkLine } from '../../packages/contracts/src/index.ts';
import type { Orchestration } from '../../packages/contracts/src/index.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { loadOrchestration, waitedMs } from '../../apps/server/src/persistence/orchestrations.ts';
import { agentUsage, routingOf } from '../bench/metrics.ts';
import type { AgentUsage, Routing } from '../bench/results.ts';

export interface ApprovalRecord {
  kind: string;
  title: string;
  status: string;
  decidedBy: string | null;
  option: string | null;
  scope: string | null;
  waitedMs: number;
}

export interface LaneRecord {
  worktrees: number;
  depsMethods: string[];
  depsMs: number[];
  depsWaitedMs: number[];
  depsNotes: string[];
  builderMs: number[];
  parallelBuilders: number;
}

export interface ReviewRecord {
  reviewer: string;
  verdict: string;
  findings: string[];
  net: number | null;
}

export interface Observation {
  source: string;
  kind: string;
  summary: string | null;
  body: string;
}

const KNOWN_ARTIFACTS = ['plan', 'review', 'check', 'shortcuts'];

async function observations(db: Db, ids: string[], taskId: string | null): Promise<Observation[]> {
  const advice = await db.query<{ purpose: string; body: Record<string, unknown> }>(
    `SELECT purpose, body || jsonb_build_object('row', to_jsonb(a) - 'body') AS body
     FROM run_advice a WHERE run_id = ANY($1) ORDER BY created_at`,
    [ids],
  );
  const artifacts = taskId
    ? await db.query<{ kind: string; body: Record<string, unknown> }>(
        'SELECT kind, body FROM run_artifacts WHERE task_id = $1 AND NOT (kind = ANY($2)) ORDER BY version',
        [taskId, KNOWN_ARTIFACTS],
      )
    : { rows: [] };
  const toObservation = (source: string, kind: string, body: Record<string, unknown>) => ({
    source,
    kind,
    summary: typeof body.summary === 'string' ? body.summary : null,
    body: JSON.stringify(body).slice(0, 4_000),
  });
  return [
    ...advice.rows.map((row) => toObservation('advice', row.purpose, row.body)),
    ...artifacts.rows.map((row) => toObservation('artifact', row.kind, row.body)),
  ];
}

export interface MemberReads {
  name: string | null;
  role: string | null;
  fileReads: number | null;
  rereads: number | null;
  outputTokens: number;
  durationMs: number;
}

export interface TurnMetrics {
  runId: string;
  status: string;
  error: string | null;
  wallMs: number;
  waitedMs: number;
  activeMs: number;
  costUsd: number;
  agentCostUsd: number;
  jevCostUsd: number;
  jevCalls: number;
  agents: AgentUsage[];
  toolCalls: number;
  routing: Routing | null;
  approvals: ApprovalRecord[];
  checks: string[];
  fixTurns: number;
  sessionNotes: string[];
  reviews: ReviewRecord[];
  lanes: LaneRecord;
  shortcuts: number;
  reply: string;
  members?: MemberReads[];
  observations?: Observation[];
}

async function runIds(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1',
    [runId],
  );
  return rows.map((row) => row.id);
}

async function approvals(db: Db, ids: string[]): Promise<ApprovalRecord[]> {
  const { rows } = await db.query<{
    kind: string;
    title: string;
    status: string;
    decided_by: string | null;
    decision_option_id: string | null;
    scope: string | null;
    waited: string | null;
  }>(
    `SELECT kind, title, status, decided_by, decision_option_id, scope,
       EXTRACT(EPOCH FROM (COALESCE(decided_at, now()) - created_at)) * 1000 AS waited
     FROM approvals WHERE run_id = ANY($1) ORDER BY created_at`,
    [ids],
  );
  return rows.map((row) => ({
    kind: row.kind,
    title: row.title.slice(0, 160),
    status: row.status,
    decidedBy: row.decided_by,
    option: row.decision_option_id,
    scope: row.scope,
    waitedMs: Math.round(Number(row.waited ?? 0)),
  }));
}

async function artifacts(db: Db, taskId: string | null, kind: string) {
  if (!taskId) return [];
  const { rows } = await db.query<{ body: Record<string, unknown> }>(
    'SELECT body FROM run_artifacts WHERE task_id = $1 AND kind = $2 ORDER BY version',
    [taskId, kind],
  );
  return rows.map((row) => row.body);
}

async function sessionNotes(db: Db, ids: string[]): Promise<string[]> {
  const { rows } = await db.query<{ note: string }>(
    `SELECT DISTINCT substring(payload::text from '(Continued session|Fresh session[^"]*)') AS note
     FROM run_events WHERE run_id = ANY($1)
       AND payload::text ~ '(Continued session|Fresh session)'`,
    [ids],
  );
  return rows.map((row) => row.note).filter(Boolean);
}

async function lanes(db: Db, runId: string, agents: AgentUsage[]): Promise<LaneRecord> {
  const { rows } = await db.query<{
    deps_method: string | null;
    deps_ms: number | null;
    deps_waited_ms: number | null;
    deps_note: string | null;
  }>(
    `SELECT deps_method, deps_ms, deps_waited_ms, deps_note FROM run_worktrees
     WHERE orchestration_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  const builders = agents.filter((agent) => agent.role === 'builder');
  return {
    worktrees: rows.length,
    depsMethods: rows.map((row) => row.deps_method ?? 'none'),
    depsMs: rows.map((row) => row.deps_ms ?? 0),
    depsWaitedMs: rows.map((row) => row.deps_waited_ms ?? 0),
    depsNotes: rows.flatMap((row) => (row.deps_note ? [row.deps_note] : [])),
    builderMs: builders.map((agent) => agent.durationMs),
    parallelBuilders: builders.filter((agent) => agent.parallelGroup !== null).length,
  };
}

async function basicLanes(db: Db, runId: string, agents: AgentUsage[]): Promise<LaneRecord> {
  const { rows } = await db
    .query<{ count: string }>(
      'SELECT count(*) FROM run_worktrees WHERE orchestration_run_id = $1',
      [runId],
    )
    .catch(() => ({ rows: [{ count: '0' }] }));
  const builders = agents.filter((agent) => agent.role === 'builder');
  return {
    worktrees: Number(rows[0]?.count ?? 0),
    depsMethods: [],
    depsMs: [],
    depsWaitedMs: [],
    depsNotes: [],
    builderMs: builders.map((agent) => agent.durationMs),
    parallelBuilders: builders.filter((agent) => agent.parallelGroup !== null).length,
  };
}

async function memberReads(db: Db, runId: string): Promise<MemberReads[]> {
  const { rows } = await db.query<{
    name: string | null;
    role: string | null;
    file_reads: number | null;
    rereads: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
  }>(
    `SELECT route->>'name' AS name, role, (route->>'fileReads')::int AS file_reads,
       (route->>'rereads')::int AS rereads, output_tokens, duration_ms
     FROM runs WHERE id = $1 OR parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({
    name: row.name,
    role: row.role,
    fileReads: row.file_reads,
    rereads: row.rereads,
    outputTokens: row.output_tokens ?? 0,
    durationMs: row.duration_ms ?? 0,
  }));
}

async function fixTurns(db: Db, runId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM runs WHERE parent_run_id = $1 AND route ? 'followUp'
       AND route->>'followUp' IS NOT NULL`,
    [runId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function replyOf(db: Db, runId: string): Promise<string> {
  const { rows } = await db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [runId],
  );
  if (rows[0]) return rows[0].content;
  const streamed = await db.query<{ text: string | null }>(
    `SELECT string_agg(payload->>'delta', '' ORDER BY seq) AS text FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
    [runId],
  );
  return streamed.rows[0]?.text ?? '';
}

function reviewOf(body: Record<string, unknown>): ReviewRecord {
  const reviewer = body.reviewer as { provider?: string; model?: string } | undefined;
  return {
    reviewer: [reviewer?.provider, reviewer?.model].filter(Boolean).join(' '),
    verdict: String(body.verdict ?? 'unclear'),
    findings: Array.isArray(body.findings) ? body.findings.map(String) : [],
    net: typeof body.net === 'number' ? body.net : null,
  };
}

export type OrchestrationLoader = (runId: string) => Promise<Orchestration | null>;

async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  return work().catch(() => fallback);
}

function routingSafely(orchestration: Orchestration | null) {
  try {
    return routingOf(orchestration);
  } catch {
    return null;
  }
}

async function runRow(db: Db, runId: string) {
  const { rows } = await db.query<{ status: string; error: string | null }>(
    'SELECT status, error FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0] ?? null;
}

export async function collectTurn(
  db: Db,
  runId: string,
  wallMs: number,
  load: OrchestrationLoader = (id) => loadOrchestration(db, id),
): Promise<TurnMetrics> {
  const ids = await runIds(db, runId);
  const run = await runRow(db, runId);
  const orchestration = await safely(() => load(runId), null);
  const agents = await agentUsage(db, runId);
  const waited = await safely(() => waitedMs(db, runId), 0);
  const taskId = orchestration?.taskId ?? null;
  const checkBodies = await safely(() => artifacts(db, taskId, 'check'), []);
  const shortcutBodies = await safely(() => artifacts(db, taskId, 'shortcuts'), []);
  const agentCostUsd = agents.reduce((sum, agent) => sum + agent.costUsd, 0);
  const jevCostUsd = orchestration?.totals.jevCostUsd ?? 0;
  return {
    runId,
    status: run?.status ?? 'unknown',
    error: run?.error ?? null,
    wallMs,
    waitedMs: waited,
    activeMs: Math.max(0, wallMs - waited),
    costUsd: agentCostUsd + jevCostUsd,
    agentCostUsd,
    jevCostUsd,
    jevCalls: orchestration?.totals.jevCalls ?? 0,
    agents,
    toolCalls: agents.reduce((sum, agent) => sum + agent.toolCalls, 0),
    routing: routingSafely(orchestration),
    approvals: await approvals(db, ids),
    checks: checkBodies.flatMap((body) => {
      const parsed = checkBodySchema.safeParse(body);
      return parsed.success ? [checkLine(parsed.data)] : [];
    }),
    fixTurns: await safely(() => fixTurns(db, runId), 0),
    sessionNotes: await safely(() => sessionNotes(db, ids), []),
    reviews: (await safely(() => artifacts(db, taskId, 'review'), [])).map(reviewOf),
    lanes: await safely(() => lanes(db, runId, agents), await basicLanes(db, runId, agents)),
    shortcuts: shortcutBodies.reduce(
      (sum, body) => sum + ((body.entries as unknown[] | undefined)?.length ?? 0),
      0,
    ),
    reply: await replyOf(db, runId),
    members: await safely(() => memberReads(db, runId), []),
    observations: await safely(() => observations(db, ids, taskId), []),
  };
}
