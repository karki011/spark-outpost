import type { ModelCard, ModelCardView, ModelTier } from '@spark-outpost/contracts';
import { formatPrice, statLines } from './model-card-stats.ts';

export const ALL_PROVIDERS = 'all';

const PROVIDER_KEY = 'spark-outpost.models.provider';

export function readSavedProvider(): string {
  try {
    return localStorage.getItem(PROVIDER_KEY) ?? ALL_PROVIDERS;
  } catch {
    return ALL_PROVIDERS;
  }
}

export function writeSavedProvider(provider: string): void {
  try {
    localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    return;
  }
}

export function shownProvider(saved: string, providers: readonly string[]): string {
  return providers.includes(saved) ? saved : ALL_PROVIDERS;
}

export type ModelSort = 'tier' | 'price' | 'speed';

const TIER_ORDER: Record<ModelTier, number> = { small: 0, mid: 1, top: 2, frontier: 3 };
const SPEED_ORDER: Record<ModelCard['speed'], number> = {
  fastest: 0,
  fast: 1,
  moderate: 2,
  slower: 3,
};

function blendedPrice(card: ModelCard): number {
  return card.price
    ? card.price.inputPerMillion + card.price.outputPerMillion
    : Number.POSITIVE_INFINITY;
}

const SORT_KEYS: Record<ModelSort, (card: ModelCard) => number> = {
  tier: (card) => TIER_ORDER[card.tier],
  price: blendedPrice,
  speed: (card) => SPEED_ORDER[card.speed],
};

export function sortModels(models: readonly ModelCardView[], sort: ModelSort): ModelCardView[] {
  const key = SORT_KEYS[sort];
  return models.toSorted(
    (a, b) => key(a.card) - key(b.card) || TIER_ORDER[a.card.tier] - TIER_ORDER[b.card.tier],
  );
}

const TIER_NOTES: Partial<Record<ModelTier, string>> = {
  small: 'The rules use it as Builder only for trivial requests.',
  top: 'The rules move up to it for destructive work.',
  frontier: 'The rules never pick it; it runs only when you choose it for a chat.',
};

export function tierNote(tier: ModelTier): string | null {
  return TIER_NOTES[tier] ?? null;
}

export function shortPrice(card: ModelCard): string {
  if (!card.price) return 'No price listed';
  return `${formatPrice(card.price.inputPerMillion)} / ${formatPrice(card.price.outputPerMillion)} per M`;
}

export function effortRange(card: ModelCard): string {
  const efforts = card.reasoning.efforts;
  if (efforts.length === 0) return 'none';
  if (efforts.length === 1) return efforts[0]!;
  return `${efforts[0]}–${efforts.at(-1)}`;
}

export interface Headline {
  text: string;
  anecdotal: boolean;
}

export function benchmarkHeadline(view: ModelCardView): Headline | null {
  const best = statLines(view.stats).toSorted(
    (a, b) => b.passed / b.n - a.passed / a.n || b.n - a.n,
  )[0];
  if (!best) return null;
  const cost = `${best.estimated ? '~' : ''}$${best.meanCostUsd.toFixed(3)}`;
  return {
    text: `Best ${best.passed}/${best.n} passed, ${cost} mean · ${best.label}`,
    anecdotal: best.anecdotal,
  };
}

export function retirementNote(view: ModelCardView): string | null {
  const date = view.card.retiresNotBefore;
  if (!date) return null;
  return view.staleness.retiring ? `Past its retirement date (${date})` : `Retires ${date}`;
}
