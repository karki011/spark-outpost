import type { AgentUsage } from './usage.ts';

export interface AuditCounts {
  modelCalls: number;
  ranWithoutReview: number;
  sparkToolMarks: number;
  railFlags: number;
}

export interface Decision {
  status: string;
  decidedBy: string | null;
}

export type CostSource = 'spark' | 'list-price-estimate' | 'none';

export interface Metrics {
  status: string;
  runs: number;
  models: string[];
  modelCalls: number;
  toolCalls: number;
  wallMs: number;
  agentMs: number;
  tokens: { input: number; cached: number; output: number };
  costUsd: number | null;
  costSource: CostSource;
  cards: number;
  decisions: Record<string, number>;
  ranWithoutReview: number;
  sparkToolMarks: number;
  railFlags: number;
}

export type Estimate = (model: string | null, agent: AgentUsage) => number | null;

const CARD_DECIDERS = new Set(['user', 'stop', 'timeout']);

function sum(agents: readonly AgentUsage[], pick: (agent: AgentUsage) => number): number {
  return agents.reduce((total, agent) => total + pick(agent), 0);
}

export function isCard(decision: Decision): boolean {
  return decision.decidedBy === null || CARD_DECIDERS.has(decision.decidedBy);
}

function tally(decisions: readonly Decision[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const decision of decisions) {
    const key = `${decision.status} by ${decision.decidedBy ?? 'nobody'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function costOf(agents: readonly AgentUsage[], estimate: Estimate) {
  if (agents.length === 0) return { costUsd: null, costSource: 'none' as const };
  const reported = agents.every((agent) => agent.costSource !== null);
  if (reported)
    return { costUsd: sum(agents, (agent) => agent.costUsd), costSource: 'spark' as const };
  const estimates = agents.map((agent) => estimate(agent.model, agent));
  if (estimates.some((value) => value === null))
    return { costUsd: null, costSource: 'none' as const };
  const costUsd = estimates.reduce<number>((total, value) => total + (value ?? 0), 0);
  return { costUsd, costSource: 'list-price-estimate' as const };
}

export function metricsOf(
  status: string,
  wallMs: number,
  agents: readonly AgentUsage[],
  audit: AuditCounts,
  decisions: readonly Decision[],
  estimate: Estimate,
): Metrics {
  return {
    status,
    runs: agents.length,
    models: [...new Set(agents.flatMap((agent) => (agent.model ? [agent.model] : [])))],
    modelCalls: audit.modelCalls,
    toolCalls: sum(agents, (agent) => agent.toolCalls),
    wallMs,
    agentMs: sum(agents, (agent) => agent.durationMs),
    tokens: {
      input: sum(agents, (agent) => agent.inputTokens),
      cached: sum(agents, (agent) => agent.cachedReadTokens),
      output: sum(agents, (agent) => agent.outputTokens),
    },
    ...costOf(agents, estimate),
    cards: decisions.filter(isCard).length,
    decisions: tally(decisions),
    ranWithoutReview: audit.ranWithoutReview,
    sparkToolMarks: audit.sparkToolMarks,
    railFlags: audit.railFlags,
  };
}
