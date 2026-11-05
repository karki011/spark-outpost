import {
  agentRoleSchema,
  outcomeVerdictSchema,
  type AgentRole,
  type OutcomeVerdict,
} from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';

export interface CheckFact {
  key: string;
  round: number;
  status: string;
}

export interface TurnFact {
  id: string;
  day: string;
  project: string;
  category: string;
  retries: number;
  roles: AgentRole[];
  provider: string;
  model: string;
  modelLabel: string;
  runs: number;
  tokens: number;
  reportedUsd: number;
  estimatedUsd: number;
  jevUsd: number;
  verdict: OutcomeVerdict | null;
  score: number | null;
  kept: boolean;
  reverted: boolean;
  corrected: boolean;
  jevAnswered: boolean;
  wouldApply: 'jev' | 'ask' | 'rules' | null;
  checks: CheckFact[];
}

export function turnCost(fact: Pick<TurnFact, 'reportedUsd' | 'estimatedUsd' | 'jevUsd'>): number {
  return fact.reportedUsd + fact.estimatedUsd + fact.jevUsd;
}

export function modelLabel(provider: string, model: string | null, label: string | null): string {
  if (!model) return label?.trim() || 'Default model';
  return cardFor({ id: model, label }, provider)?.label ?? (label?.trim() || model);
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function wouldApply(value: unknown): TurnFact['wouldApply'] {
  return value === 'jev' || value === 'ask' || value === 'rules' ? value : null;
}

export function checkFacts(value: unknown): CheckFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const check = asRecord(raw);
    const round = asNumber(check.round);
    const status = asText(check.status);
    if (round === null || status === null) return [];
    return [{ key: `${asText(check.name) ?? ''}:${asText(check.copy) ?? ''}`, round, status }];
  });
}

export function roleList(value: unknown): AgentRole[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((role) => {
    const parsed = agentRoleSchema.safeParse(role);
    return parsed.success ? [parsed.data] : [];
  });
}

export function verdictOf(value: unknown): OutcomeVerdict | null {
  const parsed = outcomeVerdictSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
