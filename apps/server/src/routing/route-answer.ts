import type { AgentPick, JevStatus } from '@spark-outpost/contracts';
import { readChoice, type ChoiceIssue } from '../advisor/choice-answer.ts';
import type { RouterTier } from '../advisor/policy.ts';
import type { JevCall } from '../orchestration/jev-calls.ts';
import type { RouteContext } from '../orchestration/routing.ts';
import { pickOf } from './candidates.ts';
import { routeOptions } from './route-question.ts';
import { POLICY_TEXT, withEffort, type RoutePolicy } from './route-policy.ts';
import { selectRoute, type SelectionBasis } from './select-route.ts';

export const ROUTE_KEY = 'route';

export interface VariantSelection {
  basis: SelectionBasis;
  candidateId: string | null;
  tier: RouterTier | null;
  routeProbability: number;
}

export interface VariantResult {
  status: JevStatus;
  error: string | null;
  issue: ChoiceIssue | null;
  jevModel: string | null;
  latencyMs: number | null;
  tokens: number | null;
  costUsd: number | null;
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  selection: VariantSelection | null;
  pick: AgentPick;
}

function base(call: JevCall, chat: AgentPick): VariantResult {
  return {
    status: call.status,
    error: call.error,
    issue: null,
    jevModel: call.model,
    latencyMs: call.latencyMs,
    tokens: call.usage?.inputTokens ?? null,
    costUsd: call.usage?.costUsd ?? null,
    choice: null,
    confidence: null,
    probabilities: null,
    selection: null,
    pick: chat,
  };
}

export function routeVariant(
  call: JevCall,
  policy: RoutePolicy,
  context: RouteContext,
): VariantResult {
  const result = base(call, policy.chat);
  if (call.status !== 'answered' || !call.response) return result;
  const answer = readChoice(call.response, ROUTE_KEY, routeOptions(policy.candidates));
  if (typeof answer === 'string') return { ...result, issue: answer };
  const selection = selectRoute(answer, policy.candidates, policy.baselineTier);
  return {
    ...result,
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    selection: {
      basis: selection.basis,
      candidateId: selection.candidate?.id ?? null,
      tier: selection.candidate?.tier ?? null,
      routeProbability: selection.routeProbability,
    },
    pick: selection.candidate
      ? withEffort(context, pickOf(selection.candidate, null))
      : policy.chat,
  };
}

function pickLabel(pick: AgentPick): string {
  return pick.modelLabel ?? pick.model ?? pick.provider;
}

export function variantLine(name: string, variant: VariantResult | null): string | null {
  if (!variant) return null;
  if (!variant.selection) {
    const why = variant.issue ?? variant.error ?? variant.status;
    return `Jev ${name} unavailable (${why}), the chat model`;
  }
  const { basis, routeProbability } = variant.selection;
  const how = basis === 'choice' ? 'chose' : basis === 'probability' ? 'cumulative' : 'uncertain';
  return `Jev ${name} ${pickLabel(variant.pick)} (${how} ${routeProbability.toFixed(2)})`;
}

export function shadowSummary(
  policy: RoutePolicy,
  text: VariantResult | null,
  evidence: VariantResult | null,
): string {
  const rule = `rules ${pickLabel(policy.rule.pick)}`;
  if (policy.kind !== 'ask') {
    const code = pickLabel(policy.codePick ?? policy.chat);
    return `Shadow route: ${rule}; policy ${code} (${POLICY_TEXT[policy.kind]})`;
  }
  const lines = [variantLine('text-only', text), variantLine('with evidence', evidence)];
  return `Shadow route: ${[rule, ...lines.filter((line): line is string => line !== null)].join(' · ')}`;
}
