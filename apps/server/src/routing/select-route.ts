import type { ChoiceDistribution } from '../advisor/choice-answer.ts';
import {
  ROUTE_ACCEPT_CONFIDENCE,
  ROUTE_CUMULATIVE_MASS,
  ROUTER_TIERS,
  type RouterTier,
} from '../advisor/policy.ts';
import type { RouteCandidate } from './candidates.ts';
import { UNCERTAIN } from './route-question.ts';

export type SelectionBasis = 'choice' | 'probability' | 'uncertain';

export interface RouteSelection {
  basis: SelectionBasis;
  candidate: RouteCandidate | null;
  routeProbability: number;
}

export interface RouteThresholds {
  confidence: number;
  mass: number;
}

export const ROUTE_THRESHOLDS: RouteThresholds = {
  confidence: ROUTE_ACCEPT_CONFIDENCE,
  mass: ROUTE_CUMULATIVE_MASS,
};

interface TierMass {
  candidate: RouteCandidate;
  mass: number;
}

function massByTier(
  candidates: readonly RouteCandidate[],
  probabilities: Readonly<Record<string, number>>,
): Map<RouterTier, TierMass> {
  const tiers = new Map<RouterTier, TierMass>();
  for (const candidate of candidates) {
    const mass = probabilities[candidate.id] ?? 0;
    const current = tiers.get(candidate.tier);
    const keepCurrent = current && (probabilities[current.candidate.id] ?? 0) >= mass;
    tiers.set(candidate.tier, {
      candidate: keepCurrent ? current.candidate : candidate,
      mass: (current?.mass ?? 0) + mass,
    });
  }
  return tiers;
}

function settled(entry: TierMass | undefined, cumulative: number): RouteSelection {
  const routeProbability = Math.min(1, cumulative);
  if (!entry) return { basis: 'uncertain', candidate: null, routeProbability };
  return { basis: 'probability', candidate: entry.candidate, routeProbability };
}

export function selectRoute(
  answer: ChoiceDistribution,
  candidates: readonly RouteCandidate[],
  baselineTier: RouterTier | null,
  thresholds: RouteThresholds = ROUTE_THRESHOLDS,
): RouteSelection {
  const uncertainMass = answer.probabilities[UNCERTAIN] ?? 0;
  const chosen = candidates.find((candidate) => candidate.id === answer.choice);
  if (!chosen) return { basis: 'uncertain', candidate: null, routeProbability: uncertainMass };
  if (answer.confidence >= thresholds.confidence) {
    return {
      basis: 'choice',
      candidate: chosen,
      routeProbability: answer.probabilities[chosen.id] ?? 0,
    };
  }
  const tiers = massByTier(candidates, answer.probabilities);
  const ascending = ROUTER_TIERS.filter((tier) => tiers.has(tier) || tier === baselineTier);
  let cumulative = 0;
  for (const tier of ascending) {
    cumulative += (tiers.get(tier)?.mass ?? 0) + (tier === baselineTier ? uncertainMass : 0);
    if (cumulative >= thresholds.mass) return settled(tiers.get(tier), cumulative);
  }
  const top = ascending.at(-1);
  return settled(top ? tiers.get(top) : undefined, cumulative);
}
