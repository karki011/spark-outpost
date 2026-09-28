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

export function topTier<T extends TierModel>(
  models: readonly T[],
  provider: string | null = null,
): T | null {
  return tierLadder(models, provider).at(-1) ?? null;
}

export function oneTierUp<T extends TierModel>(
  models: readonly T[],
  currentId: string | null,
  provider: string | null = null,
  pool: readonly T[] = models,
): T | null {
  const ladder = tierLadder(pool, provider);
  const current = models.find((model) => model.id === currentId);
  const tier = current ? modelTier(current, provider) : null;
  if (tier === null) return null;
  return ladder.find((model) => (modelTier(model, provider) ?? -1) > tier) ?? null;
}

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

export function effortRank(effort: string | null): number {
  return effort === null ? -1 : EFFORT_ORDER.indexOf(effort);
}

export function middleTier<T extends TierModel>(
  models: readonly T[],
  provider: string | null = null,
): T | null {
  return tierLadder(models, provider).find((model) => modelTier(model, provider) === 1) ?? null;
}

export function strongerEffort(efforts: readonly string[], current: string | null): string | null {
  const index = current === null ? -1 : EFFORT_ORDER.indexOf(current);
  return (
    efforts.find((effort) => EFFORT_ORDER.indexOf(effort) > index && effort !== 'max') ?? current
  );
}

export function highEffort(efforts: readonly string[]): string | null {
  return efforts.includes('high') ? 'high' : (efforts.at(-1) ?? null);
}

const ESCALATION_FLOOR = 'medium';

export function escalatedEffort(efforts: readonly string[], current: string | null): string | null {
  const floor = effortRank(ESCALATION_FLOOR);
  if (effortRank(current) >= floor) return current;
  return efforts.find((effort) => effortRank(effort) >= floor) ?? current;
}
