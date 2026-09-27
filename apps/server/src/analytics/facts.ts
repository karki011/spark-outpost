import {
  agentRoleSchema,
  buildStyleSchema,
  outcomeVerdictSchema,
  type AgentRole,
  type BuildStyle,
  type OutcomeVerdict,
} from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';

export interface PickDifference {
  field: string;
  rule: string;
  jev: string;
}

export interface ReviewFact {
  verdict: string;
  findings: number;
  net: number | null;
}

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
  depth: string;
  retries: number;
  roles: AgentRole[];
  builders: number;
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
  jevConfidence: number | null;
  gateDecision: 'act' | 'ask' | 'fallback' | null;
  actAt: number | null;
  wouldApply: 'jev' | 'ask' | 'rules' | null;
  differences: PickDifference[];
  buildStyle: BuildStyle;
  reviews: ReviewFact[];
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

function pickValue(answer: Json, field: string): string {
  if (field === 'model') return asText(answer.modelLabel) ?? asText(answer.model) ?? 'default';
  const value = answer[field];
  return value === null || value === undefined ? 'none' : String(value);
}

export function pickDifferences(
  rules: unknown,
  jev: unknown,
  differences: unknown,
): PickDifference[] {
  if (!Array.isArray(differences)) return [];
  const ruleAnswer = asRecord(rules);
  const jevAnswer = asRecord(jev);
  return differences
    .filter((field): field is string => typeof field === 'string')
    .map((field) => ({
      field,
      rule: pickValue(ruleAnswer, field),
      jev: pickValue(jevAnswer, field),
    }));
}

export function gateDecision(gate: unknown): TurnFact['gateDecision'] {
  const decision = asRecord(gate).decision;
  return decision === 'act' || decision === 'ask' || decision === 'fallback' ? decision : null;
}

export function wouldApply(value: unknown): TurnFact['wouldApply'] {
  return value === 'jev' || value === 'ask' || value === 'rules' ? value : null;
}

export function reviewFacts(value: unknown): ReviewFact[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const review = asRecord(raw);
    return {
      verdict: asText(review.verdict) ?? 'unclear',
      findings: asNumber(review.findings) ?? 0,
      net: asNumber(review.net),
    };
  });
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

export function buildStyleOf(value: unknown): BuildStyle {
  return buildStyleSchema.catch('off').parse(value ?? 'off');
}

export function jevConfidence(jev: unknown): number | null {
  const confidence = asNumber(asRecord(jev).confidence);
  return confidence === null ? null : Math.min(1, Math.max(0, confidence));
}

export function actAt(gate: unknown): number | null {
  return asNumber(asRecord(gate).actAt);
}
