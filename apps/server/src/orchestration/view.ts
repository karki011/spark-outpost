import { z } from 'zod';
import {
  UNSET_RUN_LEVEL,
  MAX_REPAIR_RETRIES,
  adviceSummarySchema,
  agentLabel,
  agentName,
  crewMemberSchema,
  modelSwitchSchema,
  depthLabel,
  mergeCostSource,
  orchestrationDecisionSchema,
  type AdviceSummary,
  type AgentPick,
  type AgentRole,
  type Approval,
  type CostSource,
  type CrewSpark,
  type CrewMember,
  type IntakeCall,
  type Orchestration,
  type OrchestrationDecision,
  type OrchestrationTotals,
  type PieceList,
  type ModelTier,
  type RouteSource,
  type ReviewVerdict,
  type RunMode,
  type RunStatus,
  type TotalCostSource,
} from '@spark-outpost/contracts';

export interface StoredRoute {
  name?: string;
  routedBy?: RouteSource;
  rule?: string;
  tier?: ModelTier | null;
  autoWouldUse?: AgentPick | null;
  planStep?: string | null;
  modelLabel?: string | null;
  quality?: number | null;
  verdict?: ReviewVerdict | null;
  copy?: string | null;
  sameProvider?: boolean;
  fileReads?: number;
  routeNote?: string;
  answers?: string;
  spark?: CrewSpark;
}

export interface MemberRow {
  id: string;
  role: AgentRole;
  step_index: number | null;
  attempt: number | null;
  agent_label: string | null;
  provider: string;
  model: string | null;
  effort: string | null;
  mode: RunMode | null;
  route: StoredRoute | null;
  status: RunStatus;
  error: string | null;
  model_switch?: unknown;
  error_details?: string | null;
  tokens: number | null;
  cost_usd: string | null;
  cost_source: CostSource | null;
  duration_ms: number | null;
  tool_call_count: number | null;
  context_used?: number | null;
  context_size?: number | null;
  started_at: Date | null;
  finished_at: Date | null;
}

const crew = crewMemberSchema.shape;
const routeFieldsSchema = z.object({
  name: crew.name.optional().catch(undefined),
  routedBy: crew.routedBy.optional().catch(undefined),
  autoWouldUse: crew.autoWouldUse.optional().catch(undefined),
  planStep: crew.planStep.optional().catch(undefined),
  modelLabel: crew.modelLabel.optional().catch(undefined),
  quality: crew.quality.optional().catch(undefined),
  verdict: crew.verdict.optional().catch(undefined),
  copy: crew.copy.catch(undefined),
  sameProvider: crew.sameProvider.catch(undefined),
  routeNote: crew.routeNote.catch(undefined),
  answers: crew.answers.catch(undefined),
  pieceKey: crew.pieceKey.catch(undefined),
  placement: crew.placement.catch(undefined),
  spark: crew.spark.catch(undefined),
});
const storedRouteSchema = routeFieldsSchema.catch(() => routeFieldsSchema.parse({}));

const decision = orchestrationDecisionSchema.shape;
const decisionBodySchema = z
  .object({
    summary: decision.summary.catch(''),
    applied: decision.applied.catch('rules'),
    gate: decision.gate.catch(null),
    jevError: decision.jevError.catch(null),
    latencyMs: decision.latencyMs.catch(null),
    answer: decision.answer.catch({}),
  })
  .catch(() => ({
    summary: '',
    applied: 'rules' as const,
    gate: null,
    jevError: null,
    latencyMs: null,
    answer: {},
  }));

export function toCrewMember(row: MemberRow): CrewMember {
  const route = storedRouteSchema.parse(row.route ?? {});
  const modelLabel = route.modelLabel ?? null;
  return {
    runId: row.id,
    role: row.role,
    stepIndex: row.step_index ?? 0,
    attempt: row.attempt ?? 1,
    name: route.name ?? agentName(row.role),
    agentLabel:
      row.agent_label ?? agentLabel(row.role, modelLabel ?? row.model, row.effort, route.name),
    provider: row.provider,
    model: row.model,
    modelLabel,
    effort: row.effort,
    mode: row.mode,
    routedBy: route.routedBy ?? 'rules',
    autoWouldUse: route.autoWouldUse ?? null,
    planStep: route.planStep ?? null,
    status: row.status,
    error: row.error,
    tokens: row.tokens,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    costSource: row.cost_usd === null ? null : (row.cost_source ?? 'reported'),
    durationMs: row.duration_ms,
    toolCalls: row.tool_call_count,
    ...(row.context_used != null && row.context_size != null
      ? { contextUsed: row.context_used, contextSize: row.context_size }
      : {}),
    quality: route.quality ?? null,
    verdict: route.verdict ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    copy: route.copy ?? null,
    ...(route.sameProvider ? { sameProvider: true } : {}),
    ...(route.routeNote ? { routeNote: route.routeNote } : {}),
    ...(route.answers ? { answers: route.answers } : {}),
    ...(route.pieceKey ? { pieceKey: route.pieceKey } : {}),
    ...(route.placement ? { placement: route.placement } : {}),
    ...(route.spark ? { spark: route.spark } : {}),
    ...memberAccess(row),
  };
}

function memberAccess(row: MemberRow): Pick<CrewMember, 'modelSwitch' | 'errorDetails'> {
  const change = modelSwitchSchema.safeParse(row.model_switch);
  return {
    ...(change.success ? { modelSwitch: change.data } : {}),
    ...(row.error_details ? { errorDetails: row.error_details } : {}),
  };
}

interface Totals {
  runs: number;
  tokens: number;
  costUsd: number;
  costSource: TotalCostSource | null;
  durationMs: number;
  toolCalls: number;
}

const emptyTotals = (): Totals => ({
  runs: 0,
  tokens: 0,
  costUsd: 0,
  costSource: null,
  durationMs: 0,
  toolCalls: 0,
});

function add(totals: Totals, member: CrewMember): Totals {
  return {
    runs: totals.runs + 1,
    tokens: totals.tokens + (member.tokens ?? 0),
    costUsd: totals.costUsd + (member.costUsd ?? 0),
    costSource: mergeCostSource(totals.costSource, member.costSource),
    durationMs: totals.durationMs + (member.durationMs ?? 0),
    toolCalls: totals.toolCalls + (member.toolCalls ?? 0),
  };
}

function grouped<K extends string>(crew: readonly CrewMember[], key: (member: CrewMember) => K) {
  const groups = new Map<K, { member: CrewMember; totals: Totals }>();
  for (const member of crew) {
    const id = key(member);
    const current = groups.get(id);
    groups.set(id, {
      member: current?.member ?? member,
      totals: add(current?.totals ?? emptyTotals(), member),
    });
  }
  return [...groups.values()];
}

export function orchestrationTotals(
  crew: readonly CrewMember[],
  decisions: readonly OrchestrationDecision[],
): OrchestrationTotals {
  const jev = decisions.filter(
    (decision) => decision.jevStatus !== 'not_connected' && decision.jevStatus !== 'not_asked',
  );
  return {
    ...crew.reduce(add, emptyTotals()),
    jevCalls: jev.length,
    jevTokens: jev.reduce((total, decision) => total + (decision.tokens ?? 0), 0),
    jevCostUsd: jev.reduce((total, decision) => total + (decision.costUsd ?? 0), 0),
    byRole: grouped(crew, (member) => member.role).map(({ member, totals }) => ({
      role: member.role,
      ...totals,
    })),
    byModel: grouped(crew, (member) => `${member.provider}\u0000${member.model ?? ''}`).map(
      ({ member, totals }) => ({ provider: member.provider, model: member.model, ...totals }),
    ),
  };
}

export interface DecisionRow {
  id: string;
  purpose: OrchestrationDecision['kind'];
  child_run_id: string | null;
  role: AgentRole | null;
  step_index: number | null;
  jev_status: OrchestrationDecision['jevStatus'];
  jev_input_tokens: number | null;
  jev_cost_usd: string | null;
  body: Record<string, unknown>;
  created_at: Date;
}

const CALL_LABELS: Record<string, [string, string]> = {
  question: ['answer only', 'make changes'],
  plan_only: ['plan only', 'no plan asked'],
  vague: ['vague', 'clear'],
  review: ['review wanted', 'no review asked'],
  destructive: ['destructive', 'not destructive'],
  continues_task: ['same task', 'new task'],
};

function callLine(key: string, call: IntakeCall): string {
  const [yes, no] = CALL_LABELS[key] ?? [key, `not ${key}`];
  const jev = call.jev === null ? '' : ` ${call.jev.toFixed(2)}`;
  return `${call.value ? yes : no} (${call.source}${jev})`;
}

function intakeSummary(
  body: AdviceSummary,
): Pick<OrchestrationDecision, 'summary' | 'applied' | 'gate' | 'answer'> {
  const answer = body.jev ?? body.rules;
  const applied = body.wouldApply === 'jev' ? 'jev' : body.wouldApply === 'ask' ? 'asked' : 'rules';
  const calls = Object.entries(body.calls ?? {}).map(([key, call]) => callLine(key, call));
  const head =
    calls.length > 0 ? calls.join(' · ') : `${depthLabel(answer.depth)} · ${answer.risk}`;
  const tier = body.jev?.tier ? ` · Jev tier ${body.jev.tier}` : '';
  return {
    summary: `${head}${tier}`,
    applied,
    gate: body.gate,
    answer: { ...answer, ...(body.calls ? { calls: body.calls } : {}) },
  };
}

export function toDecision(row: DecisionRow): OrchestrationDecision {
  const body = row.body;
  const shared = {
    id: row.id,
    kind: row.purpose,
    role: row.role,
    stepIndex: row.step_index,
    childRunId: row.child_run_id,
    jevStatus: row.jev_status,
    tokens: row.jev_input_tokens,
    costUsd: row.jev_cost_usd === null ? null : Number(row.jev_cost_usd),
    createdAt: row.created_at.toISOString(),
  };
  const advice = row.purpose === 'intake' ? adviceSummarySchema.safeParse(body) : null;
  if (advice?.success) {
    return {
      ...shared,
      ...intakeSummary(advice.data),
      jevError: advice.data.jevError,
      latencyMs: advice.data.latencyMs,
    };
  }
  return { ...shared, ...decisionBodySchema.parse(body) };
}

export interface OrchestrationRow {
  run_id: string;
  conversation_id: string;
  task_id: string | null;
  status: RunStatus;
  run_error: string | null;
  level: Orchestration['level'] | null;
  provider: string;
  plan_version: number | null;
  phase: Orchestration['phase'];
  depth: Orchestration['depth'];
  depth_source: Orchestration['depthSource'];
  risk: Orchestration['risk'];
  routing: Orchestration['routing'];
  retries: number;
  active_ms: number;
  tool_calls: number;
  error: string | null;
  updated_at: Date;
}

const LIVE: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'awaiting_approval']);

export function buildOrchestration(
  row: OrchestrationRow,
  crew: readonly CrewMember[],
  checkpoints: readonly Approval[],
  decisions: readonly OrchestrationDecision[],
  pieces: PieceList | null = null,
): Orchestration {
  const totals = orchestrationTotals(crew, decisions);
  const live = LIVE.has(row.status);
  return {
    runId: row.run_id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    status: row.status,
    phase: live ? row.phase : 'finished',
    depth: row.depth,
    depthSource: row.depth_source,
    risk: row.risk,
    level: row.level ?? UNSET_RUN_LEVEL,
    routing: row.routing,
    provider: row.provider,
    planVersion: row.plan_version,
    retries: row.retries,
    maxRetries: MAX_REPAIR_RETRIES,
    crew: [...crew],
    checkpoints: [...checkpoints],
    pendingCheckpoint: checkpoints.find((checkpoint) => checkpoint.status === 'pending') ?? null,
    decisions: [...decisions],
    ...(pieces ? { pieces } : {}),
    usage: { activeMs: row.active_ms, toolCalls: row.tool_calls, costUsd: totals.costUsd },
    totals,
    error: row.error ?? (live ? null : row.run_error),
    updatedAt: row.updated_at.toISOString(),
  };
}
