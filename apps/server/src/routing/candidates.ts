import type { AgentPick, ModelTier } from '@spark-outpost/contracts';
import type { AdvisorCandidate, AdvisorOption } from '../advisor/advice.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { ROUTER_TIER_OF_CARD, type RouterTier } from '../advisor/policy.ts';
import { tierInfo } from '../model-access/tiers.ts';

export interface RouteCandidate {
  id: string;
  provider: string;
  model: string;
  label: string;
  tier: RouterTier;
}

const CARD_TIER_BY_RANK: readonly ModelTier[] = ['small', 'mid', 'top', 'frontier'];

export function routerTier(provider: string, model: AdvisorOption): RouterTier | null {
  const rank = tierInfo(model, provider).tier;
  const cardTier = rank === null ? undefined : CARD_TIER_BY_RANK[rank];
  return cardTier ? ROUTER_TIER_OF_CARD[cardTier] : null;
}

function providerCandidates(candidate: AdvisorCandidate): RouteCandidate[] {
  return selectableModels(candidate).flatMap((model) => {
    const tier = routerTier(candidate.provider, model);
    if (!tier) return [];
    return [
      {
        id: `${candidate.provider}/${model.id}`,
        provider: candidate.provider,
        model: model.id,
        label: model.label,
        tier,
      },
    ];
  });
}

export function routeCandidates(candidates: readonly AdvisorCandidate[]): RouteCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.doAvailable !== false)
    .flatMap(providerCandidates)
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
}

export function candidateOf(
  candidates: readonly RouteCandidate[],
  pick: AgentPick,
): RouteCandidate | undefined {
  return candidates.find(
    (candidate) => candidate.provider === pick.provider && candidate.model === pick.model,
  );
}

export function pickOf(candidate: RouteCandidate, effort: string | null): AgentPick {
  return {
    provider: candidate.provider,
    model: candidate.model,
    modelLabel: candidate.label,
    effort,
  };
}
