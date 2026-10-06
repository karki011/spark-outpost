import {
  agentRoleLabel,
  agentRoleSchema,
  type OrchestrationTotals,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { formatDuration } from '../audit/audit-model.ts';
import { formatTokens, shortLabel } from '../chat/composer/model-options.ts';
import { formatCost } from '../usage/format.ts';

export type CrewState =
  'thinking' | 'working' | 'waiting' | 'done' | 'failed' | 'stopped' | 'queued';

export interface CrewAgent {
  id: string;
  role: string;
  name: string;
  provider: string;
  model: string | null;
  effort: string | null;
  state: CrewState;
  line: string;
  tokens: number | null;
  costUsd: number | null;
  costSource: TotalCostSource | null;
  durationMs: number | null;
  sameProvider?: boolean;
  routeNote?: string;
  title?: string;
  spark?: { id: string; role: string };
}

export const SAME_PROVIDER_REVIEW = 'same provider, no cross-model review';

const HUES: Record<string, number> = { claude: 24, codex: 205, zai: 112, jev: 318 };

const EXPRESSIONS: Record<CrewState, BlobExpression> = {
  thinking: 'thinking',
  working: 'idle',
  waiting: 'unsure',
  done: 'happy',
  failed: 'sad',
  stopped: 'sleepy',
  queued: 'sleepy',
};

const STATE_WORDS: Record<CrewState, string> = {
  thinking: 'Thinking',
  working: 'Working',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  queued: 'Queued',
};

export function crewHue(provider: string): number {
  return HUES[provider] ?? HUES.claude!;
}

export function crewExpression(state: CrewState): BlobExpression {
  return EXPRESSIONS[state];
}

export function crewStateWord(state: CrewState): string {
  return STATE_WORDS[state];
}

export function isBusy(state: CrewState): boolean {
  return state === 'working' || state === 'thinking';
}

export function isDispatcher(member: Pick<CrewAgent, 'role'>): boolean {
  return member.role === 'jev';
}

export function roleLabel(member: Pick<CrewAgent, 'role' | 'sameProvider' | 'spark'>): string {
  if (member.role === 'jev') return 'Dispatcher';
  if (member.spark?.role) return member.spark.role;
  const role = agentRoleSchema.safeParse(member.role);
  const label = role.success ? agentRoleLabel(role.data) : member.role;
  return member.sameProvider ? `${label} (${SAME_PROVIDER_REVIEW})` : label;
}

export function modelLabel(member: Pick<CrewAgent, 'role' | 'model' | 'effort'>): string {
  if (member.role === 'jev') return 'router';
  const model = member.model ? shortLabel(member.model) : 'default model';
  return [model, member.effort].filter(Boolean).join(' · ');
}

export function usageParts(member: CrewAgent): string[] {
  const parts: string[] = [];
  if (member.tokens !== null) parts.push(`${formatTokens(member.tokens)} tokens`);
  if (member.costUsd !== null) parts.push(formatCost(member.costUsd, member.costSource));
  if (member.durationMs !== null) parts.push(formatDuration(member.durationMs));
  return parts;
}

export function headerMeta(member: CrewAgent): string {
  return [modelLabel(member), member.routeNote, ...usageParts(member)].filter(Boolean).join(' · ');
}

export interface CrewTotals {
  agents: number;
  tokens: number;
  costUsd: number;
  jevCostUsd: number;
  estimated: boolean;
}

export function crewTotals(totals: OrchestrationTotals, agents: number): CrewTotals {
  return {
    agents,
    tokens: totals.tokens + totals.jevTokens,
    costUsd: totals.costUsd,
    jevCostUsd: totals.jevCostUsd,
    estimated: totals.costSource === 'estimated' || totals.costSource === 'mixed',
  };
}

export function totalsLine(totals: CrewTotals): string {
  const agents = `${totals.agents} ${totals.agents === 1 ? 'agent' : 'agents'}`;
  const cost = formatCost(totals.costUsd, totals.estimated ? 'estimated' : null);
  const parts = [agents, `${formatTokens(totals.tokens)} tokens`, cost];
  if (totals.jevCostUsd > 0) parts.push(`Jev ${formatCost(totals.jevCostUsd, 'estimated')}`);
  return parts.join(' · ');
}

export function busyCount(members: readonly CrewAgent[]): number {
  return members.filter((member) => isBusy(member.state)).length;
}
