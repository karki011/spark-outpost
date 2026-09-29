import type { ModelCard, ModelCardView, ModelTier } from '@spark-outpost/contracts';
import { formatPrice, formatTokenCount, statLines } from './model-card-stats.ts';

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

const TIER_ORDER: Record<ModelTier, number> = { small: 0, mid: 1, top: 2, frontier: 3 };

const ROLES: Partial<Record<ModelTier, string>> = {
  mid: 'Everyday Builder, Critic, answers',
  top: 'Complex and risky work',
};

const RETIREMENT_SHOWN_DAYS = 90;
const DAY_MS = 86_400_000;

export function usedBySpark(view: ModelCardView): boolean {
  return ROLES[view.card.tier] !== undefined && !view.staleness.retiring;
}

export function orderModels(models: readonly ModelCardView[]): ModelCardView[] {
  const rank = (view: ModelCardView) => (usedBySpark(view) ? 0 : 10) + TIER_ORDER[view.card.tier];
  return models.toSorted((a, b) => rank(a) - rank(b));
}

export function roleLine(view: ModelCardView): string | null {
  return usedBySpark(view) ? (ROLES[view.card.tier] ?? null) : null;
}

function shortDate(date: string, now: number): string {
  const sameYear = date.slice(0, 4) === String(new Date(now).getUTCFullYear());
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

function retiresSoon(card: ModelCard, now: number): boolean {
  if (!card.retiresNotBefore) return false;
  return Date.parse(card.retiresNotBefore) - now <= RETIREMENT_SHOWN_DAYS * DAY_MS;
}

export function modelTag(view: ModelCardView, now: number = Date.now()): string | null {
  if (retiresSoon(view.card, now)) return `Retiring ${shortDate(view.card.retiresNotBefore!, now)}`;
  return usedBySpark(view) ? null : 'Only when you pick it';
}

export function retirementDetail(card: ModelCard): string | null {
  return card.retiresNotBefore ? `Retires ${card.retiresNotBefore}` : null;
}

export function shortPrice(card: ModelCard): string {
  if (!card.price) return 'No price listed';
  return `${formatPrice(card.price.inputPerMillion)} / ${formatPrice(card.price.outputPerMillion)}`;
}

export function metaLine(card: ModelCard): string[] {
  return [shortPrice(card), `${formatTokenCount(card.contextTokens)} context`, card.speed];
}

export function effortRange(card: ModelCard): string {
  const efforts = card.reasoning.efforts;
  if (efforts.length === 0) return 'none';
  if (efforts.length === 1) return efforts[0]!;
  return `${efforts[0]}–${efforts.at(-1)}`;
}

export interface BenchmarkBadge {
  text: string;
  detail: string;
  anecdotal: boolean;
}

export function benchmarkBadge(view: ModelCardView): BenchmarkBadge | null {
  const best = statLines(view.stats).toSorted(
    (a, b) => b.passed / b.n - a.passed / a.n || b.n - a.n,
  )[0];
  if (!best) return null;
  const cost = `${best.estimated ? '~' : ''}$${best.meanCostUsd.toFixed(3)}`;
  return {
    text: `${best.passed}/${best.n} passed`,
    detail: `Best at ${best.label}, ${cost} mean`,
    anecdotal: best.anecdotal,
  };
}
