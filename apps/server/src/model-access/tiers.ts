import { cardFor, FRONTIER_RANK, TIER_RANK } from '../model-cards/cards.ts';

export interface TierModel {
  id: string;
  label: string;
}

export type TierSource = 'card' | 'pattern' | 'none';

const TIER_PATTERNS: readonly (readonly [RegExp, number])[] = [
  [/haiku|luna/i, 0],
  [/sonnet|\bsol\b|-sol/i, 1],
  [/opus|astra/i, 2],
];

function patternTier(model: TierModel): number | null {
  for (const [pattern, tier] of TIER_PATTERNS) {
    if (pattern.test(model.id) || pattern.test(model.label)) return tier;
  }
  return null;
}

export function tierInfo(
  model: TierModel,
  provider: string | null = null,
): { tier: number | null; source: TierSource } {
  const card = cardFor(model, provider);
  if (card) return { tier: TIER_RANK[card.tier], source: 'card' };
  const tier = patternTier(model);
  return { tier, source: tier === null ? 'none' : 'pattern' };
}

export function modelTier(model: TierModel, provider: string | null = null): number | null {
  return tierInfo(model, provider).tier;
}

export function tierLadder<T extends TierModel>(
  models: readonly T[],
  provider: string | null = null,
): T[] {
  const byTier = new Map<number, T>();
  for (const model of models) {
    const tier = modelTier(model, provider);
    if (tier !== null && tier < FRONTIER_RANK && !byTier.has(tier)) byTier.set(tier, model);
  }
  return [...byTier.entries()].sort(([a], [b]) => a - b).map(([, model]) => model);
}
