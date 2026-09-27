import {
  MAX_REPAIR_RETRIES,
  agentLabel,
  agentName,
  depthLabel,
  mergeCostSource,
  type AdviceBody,
  type AgentPick,
  type AgentRole,
  type Approval,
  type CostSource,
  type CrewMember,
  type Orchestration,
  type OrchestrationDecision,
  type OrchestrationTotals,
  type RouteSource,
  type ReviewVerdict,
  type RunMode,
  type RunStatus,
  type TotalCostSource,
} from '@spark-outpost/contracts';

export interface StoredRoute {
  name?: string;
  routedBy?: RouteSource;
  autoWouldUse?: AgentPick | null;
  planStep?: string | null;
  modelLabel?: string | null;
  quality?: number | null;
  verdict?: ReviewVerdict | null;
  parallelGroup?: string | null;
  copy?: string | null;
  sameProvider?: boolean;
  fileReads?: number;
  rereads?: number;
  extraReads?: string;
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
  tokens: number | null;
  cost_usd: string | null;
  cost_source: CostSource | null;
  duration_ms: number | null;
  tool_call_count: number | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export function toCrewMember(row: MemberRow): CrewMember {
  const route = row.route ?? {};
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
    quality: route.quality ?? null,
    verdict: route.verdict ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    parallelGroup: route.parallelGroup ?? null,
    copy: route.copy ?? null,
    ...(route.sameProvider ? { sameProvider: true } : {}),
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

export function orderCrew(crew: readonly CrewMember[]): CrewMember[] {
  const ordered: CrewMember[] = [];
  const placed = new Set<string>();
  for (const member of crew) {
    const group = member.parallelGroup ?? null;
    if (group === null) {
      ordered.push(member);
      continue;
    }
    if (placed.has(group)) continue;
    placed.add(group);
    ordered.push(
      ...crew
        .filter((other) => other.parallelGroup === group)
        .sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt),
    );
  }
  return ordered;
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

function intakeSummary(
  body: AdviceBody,
): Pick<OrchestrationDecision, 'summary' | 'applied' | 'gate' | 'answer'> {
  const answer = body.jev ?? body.rules;
  const applied = body.wouldApply === 'jev' ? 'jev' : body.wouldApply === 'ask' ? 'asked' : 'rules';
  const note = body.depthNote
    ? ` → ${depthLabel(body.depthNote.depth)}: ${body.depthNote.reason}`
    : '';
  const mechanical = body.mechanical ? ` · ${body.mechanical.summary}` : '';
  return {
    summary: `${depthLabel(answer.depth)} · ${answer.risk}${note}${mechanical}`,
    applied,
    gate: body.gate,
    answer: {
      ...answer,
      ...(body.depthNote ? { depthNote: body.depthNote } : {}),
      ...(body.mechanical ? { mechanical: body.mechanical } : {}),
    },
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
  if (row.purpose === 'intake') {
    const advice = body as unknown as AdviceBody;
    return {
      ...shared,
      ...intakeSummary(advice),
      jevError: advice.jevError,
      latencyMs: advice.latencyMs,
    };
  }
  return {
    ...shared,
    summary: String(body.summary ?? ''),
    applied: (body.applied as OrchestrationDecision['applied']) ?? 'rules',
    gate: (body.gate as OrchestrationDecision['gate']) ?? null,
    jevError: (body.jevError as string | null) ?? null,
    latencyMs: (body.latencyMs as number | null) ?? null,
    answer: (body.answer as Record<string, unknown>) ?? {},
  };
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
  active_limit_ms: number;
  tool_call_limit: number;
  cost_cap_usd: string | null;
  exceeded: Orchestration['budget']['exceeded'];
  error: string | null;
  updated_at: Date;
  parallel_note: string | null;
}

const LIVE: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'awaiting_approval']);

export function buildOrchestration(
  row: OrchestrationRow,
  crew: readonly CrewMember[],
  checkpoints: readonly Approval[],
  decisions: readonly OrchestrationDecision[],
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
    level: row.level ?? 'balanced',
    routing: row.routing,
    provider: row.provider,
    planVersion: row.plan_version,
    retries: row.retries,
    maxRetries: MAX_REPAIR_RETRIES,
    crew: orderCrew(crew),
    checkpoints: [...checkpoints],
    pendingCheckpoint: checkpoints.find((checkpoint) => checkpoint.status === 'pending') ?? null,
    decisions: [...decisions],
    budget: {
      activeMs: row.active_ms,
      activeLimitMs: row.active_limit_ms,
      toolCalls: row.tool_calls,
      toolCallLimit: row.tool_call_limit,
      costUsd: totals.costUsd,
      costCapUsd: row.cost_cap_usd === null ? null : Number(row.cost_cap_usd),
      exceeded: row.exceeded,
    },
    totals,
    error: row.error ?? (live ? null : row.run_error),
    updatedAt: row.updated_at.toISOString(),
    parallelNote: row.parallel_note,
  };
}
