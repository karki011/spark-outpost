import {
  advisorLabel,
  cacheHitCounts,
  cacheHitRate,
  agentRoleLabel,
  agentRoleSchema,
  mergeCostSource,
  providerLabel,
  type Run,
  type TaskDetail,
  type TaskRun,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import type { ModelNamer } from './model-names.ts';

export interface AgentIdentity {
  name: string;
  role: string | null;
}

export interface CostRow {
  key: string;
  name: string;
  role: string | null;
  provider: string;
  crew: boolean;
  model: string | null;
  modelId: string | null;
  effort: string | null;
  turns: number;
  tokens: number | null;
  costUsd: number | null;
  source: TotalCostSource | null;
  estimated: boolean;
}

export interface CostSlice {
  key: string;
  label: string;
  provider: string;
  tier: number | null;
  costUsd: number;
}

export interface TokenSplit {
  input: number;
  output: number;
  cached: number;
  cacheWrites: number;
  subagents: number;
  cacheHit: number | null;
}

export interface CostSummary {
  rows: CostRow[];
  slices: CostSlice[];
  costUsd: number | null;
  source: TotalCostSource | null;
  tokens: number | null;
  split: TokenSplit | null;
}

export interface DispatcherUsage {
  tokens: number | null;
  costUsd: number | null;
}

export interface CostInputs {
  task: TaskDetail;
  runs: readonly Run[];
  identities: ReadonlyMap<string, AgentIdentity>;
  modelName: ModelNamer;
  dispatcher?: DispatcherUsage | null;
}

const TIERS: readonly (readonly [RegExp, number])[] = [
  [/^glm-[\d.]+-flash/i, 0],
  [/^glm-/i, 2],
  [/haiku|luna/i, 0],
  [/sonnet|\bsol\b|-sol/i, 1],
  [/opus|astra|fable/i, 2],
];

export function modelTier(...names: (string | null)[]): number | null {
  for (const [pattern, tier] of TIERS) {
    if (names.some((name) => name !== null && pattern.test(name))) return tier;
  }
  return null;
}

function addNullable(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

function roleName(role: string | null | undefined): string | null {
  if (!role) return null;
  if (role === 'jev') return 'Dispatcher';
  const known = agentRoleSchema.safeParse(role);
  return known.success ? agentRoleLabel(known.data) : role;
}

export function runIdentities(
  task: TaskDetail,
  runs: readonly Run[],
  agents: readonly { id: string; name: string; role: string }[],
): Map<string, AgentIdentity> {
  const identities = new Map<string, AgentIdentity>();
  for (const run of runs) {
    if (run.agentLabel) identities.set(run.id, { name: run.agentLabel, role: roleName(run.role) });
  }
  for (const item of task.items) {
    if (item.runId && item.name) {
      identities.set(item.runId, { name: item.name, role: roleName(item.role) });
    }
  }
  for (const agent of agents) {
    identities.set(agent.id, { name: agent.name, role: roleName(agent.role) });
  }
  return identities;
}

function runRow(run: TaskRun, identity: AgentIdentity | undefined, modelName: ModelNamer): CostRow {
  const source = run.costUsd === null ? null : (run.costSource ?? 'reported');
  return {
    key: identity ? `agent:${identity.name}` : `solo:${run.provider}|${run.model}|${run.effort}`,
    name: identity?.name ?? providerLabel(run.provider),
    role: identity?.role ?? null,
    provider: run.provider,
    crew: identity !== undefined,
    model: modelName(run.provider, run.model),
    modelId: run.model,
    effort: run.effort,
    turns: 1,
    tokens: run.tokens,
    costUsd: run.costUsd,
    source,
    estimated: source === 'estimated',
  };
}

function mergeRows(current: CostRow, next: CostRow): CostRow {
  const source = mergeCostSource(current.source, next.source);
  return {
    ...current,
    effort: current.effort ?? next.effort,
    turns: current.turns + next.turns,
    tokens: addNullable(current.tokens, next.tokens),
    costUsd: addNullable(current.costUsd, next.costUsd),
    source,
    estimated: source === 'estimated',
  };
}

function dispatcherRow(usage: DispatcherUsage): CostRow {
  return {
    key: 'advisor:jev',
    name: advisorLabel('jev'),
    role: 'Dispatcher',
    provider: 'jev',
    crew: true,
    model: null,
    modelId: null,
    effort: null,
    turns: 1,
    tokens: usage.tokens,
    costUsd: usage.costUsd,
    source: 'estimated',
    estimated: true,
  };
}

function advisorRows(task: TaskDetail, dispatcher: DispatcherUsage | null): CostRow[] {
  const advisors = task.advisors ?? [];
  if (advisors.length === 0) {
    return dispatcher && dispatcher.tokens !== null ? [dispatcherRow(dispatcher)] : [];
  }
  return advisors.map((entry) => ({
    key: `advisor:${entry.advisor}`,
    name: advisorLabel(entry.advisor),
    role: 'Dispatcher',
    provider: entry.advisor,
    crew: true,
    model: null,
    modelId: null,
    effort: null,
    turns: entry.calls,
    tokens: entry.inputTokens,
    costUsd: entry.costUsd,
    source: 'estimated',
    estimated: true,
  }));
}

function modelSlices(rows: readonly CostRow[]): CostSlice[] {
  const slices = new Map<string, CostSlice>();
  for (const row of rows) {
    if (!row.costUsd) continue;
    const label = row.model ?? row.name;
    const key = `${row.provider}|${label}`;
    const current = slices.get(key);
    if (current) current.costUsd += row.costUsd;
    else {
      const tier = row.model ? modelTier(row.modelId, row.model) : null;
      slices.set(key, { key, label, provider: row.provider, tier, costUsd: row.costUsd });
    }
  }
  return [...slices.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function tokenSplit(task: TaskDetail, runs: readonly Run[]): TokenSplit | null {
  const ids = new Set(task.runs.map((run) => run.id));
  const counted = runs.flatMap((run) =>
    ids.has(run.id) && run.usage?.tokens
      ? [{ provider: run.provider, tokens: run.usage.tokens }]
      : [],
  );
  if (counted.length === 0) return null;
  const usages = counted.map((entry) => entry.tokens);
  return {
    input: usages.reduce((sum, tokens) => sum + tokens.input, 0),
    output: usages.reduce((sum, tokens) => sum + tokens.output, 0),
    cached: usages.reduce((sum, tokens) => sum + (tokens.cachedRead ?? 0), 0),
    cacheWrites: usages.reduce((sum, tokens) => sum + (tokens.cachedWrite ?? 0), 0),
    subagents: usages.reduce((sum, tokens) => sum + (tokens.subagents ?? 0), 0),
    cacheHit: cacheHitRate(counted.map((entry) => cacheHitCounts(entry.provider, entry.tokens))),
  };
}

export function costSummary({
  task,
  runs,
  identities,
  modelName,
  dispatcher = null,
}: CostInputs): CostSummary {
  const grouped = new Map<string, CostRow>();
  for (const run of task.runs) {
    if (run.tokens === null && run.costUsd === null && run.status !== 'running') continue;
    const row = runRow(run, identities.get(run.id), modelName);
    const current = grouped.get(row.key);
    grouped.set(row.key, current ? mergeRows(current, row) : row);
  }
  const rows = [...grouped.values(), ...advisorRows(task, dispatcher)];
  return {
    rows,
    slices: modelSlices(rows),
    costUsd: rows.reduce<number | null>((sum, row) => addNullable(sum, row.costUsd), null),
    source: rows.reduce<TotalCostSource | null>(
      (source, row) => mergeCostSource(source, row.costUsd === null ? null : row.source),
      null,
    ),
    tokens: rows.reduce<number | null>((sum, row) => addNullable(sum, row.tokens), null),
    split: tokenSplit(task, runs),
  };
}
