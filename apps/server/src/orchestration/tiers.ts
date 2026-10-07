import { MODEL_TIERS, type ModelCard, type ModelTier } from '@spark-outpost/contracts';
import { cardFor, FRONTIER_RANK, TIER_RANK, VENDOR_CARDS } from '../model-cards/cards.ts';

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

function familyOf(model: TierModel): readonly [RegExp, number] | null {
  return (
    TIER_PATTERNS.find(([pattern]) => pattern.test(model.id) || pattern.test(model.label)) ?? null
  );
}

function patternTier(model: TierModel): number | null {
  return familyOf(model)?.[1] ?? null;
}

function versionOf(text: string): number | null {
  const found = /\d+(?:\.\d+)?/.exec(text);
  return found ? Number(found[0]) : null;
}

function versionGap(card: ModelCard, version: number | null): number {
  const own = versionOf(card.label);
  return version === null || own === null ? Number.MAX_VALUE : Math.abs(own - version);
}

export function familyCard(model: TierModel, provider: string): ModelCard | null {
  const family = familyOf(model);
  if (!family) return null;
  const [pattern, tier] = family;
  const version = versionOf(model.label) ?? versionOf(model.id);
  const kin = VENDOR_CARDS.cards.filter(
    (card) =>
      card.provider === provider &&
      TIER_RANK[card.tier] === tier &&
      (pattern.test(card.id) || pattern.test(card.label)),
  );
  return kin.sort((a, b) => versionGap(a, version) - versionGap(b, version))[0] ?? null;
}

export function scoringCard(model: TierModel, provider: string): ModelCard | null {
  return cardFor(model, provider) ?? familyCard(model, provider);
}

export function tierName(model: TierModel, provider: string | null = null): ModelTier | null {
  const tier = modelTier(model, provider);
  return tier === null ? null : (MODEL_TIERS[tier] ?? null);
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

export type LadderOrder = 'carded' | 'listed';

export function tierLadder<T extends TierModel>(
  models: readonly T[],
  provider: string | null = null,
  order: LadderOrder = 'carded',
): T[] {
  const byTier = new Map<number, { model: T; carded: boolean }>();
  for (const model of models) {
    const { tier, source } = tierInfo(model, provider);
    if (tier === null || tier >= FRONTIER_RANK) continue;
    const carded = source === 'card';
    const held = byTier.get(tier);
    if (!held || (order === 'carded' && carded && !held.carded))
      byTier.set(tier, { model, carded });
  }
  return [...byTier.entries()].sort(([a], [b]) => a - b).map(([, held]) => held.model);
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

function effortRank(effort: string | null): number {
  return effort === null ? -1 : EFFORT_ORDER.indexOf(effort);
}

export function strongerEffort(efforts: readonly string[], current: string | null): string | null {
  const index = effortRank(current);
  return efforts.find((effort) => effortRank(effort) > index && effort !== 'max') ?? current;
}

export function highEffort(efforts: readonly string[]): string | null {
  return efforts.includes('high') ? 'high' : (efforts.at(-1) ?? null);
}

export function loweredEffort(
  efforts: readonly string[],
  current: string | null,
  target: string,
): string | null {
  if (!efforts.includes(target)) return current;
  return effortRank(current) > effortRank(target) ? target : current;
}

const ESCALATION_FLOOR = 'medium';

export function escalatedEffort(efforts: readonly string[], current: string | null): string | null {
  const floor = effortRank(ESCALATION_FLOOR);
  if (effortRank(current) >= floor) return current;
  return efforts.find((effort) => effortRank(effort) >= floor) ?? current;
}
