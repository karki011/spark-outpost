import {
  retirementState,
  type ModelCard,
  type ModelCardView,
  type ModelTier,
} from '@spark-outpost/contracts';
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

export function purposeLine(view: ModelCardView): string | null {
  return roleLine(view) ?? view.card.strengths[0] ?? null;
}

export interface ModelGroup {
  id: 'spark' | 'manual';
  title: string;
  models: ModelCardView[];
}

export function groupModels(models: readonly ModelCardView[]): ModelGroup[] {
  const ordered = orderModels(models);
  const groups: ModelGroup[] = [
    { id: 'spark', title: 'Spark picks from these', models: ordered.filter(usedBySpark) },
    {
      id: 'manual',
      title: 'Only when you pick it',
      models: ordered.filter((view) => !usedBySpark(view)),
    },
  ];
  return groups.filter((group) => group.models.length > 0);
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

function retired(card: ModelCard, now: number): boolean {
  return retirementState(card, new Date(now)) === 'retired';
}

export function retirementTag(view: ModelCardView, now: number = Date.now()): string | null {
  const date = view.card.retiresNotBefore;
  if (retired(view.card, now)) return date ? `Retired ${shortDate(date, now)}` : 'Retired';
  if (retiresSoon(view.card, now)) return `Retiring ${shortDate(date!, now)}`;
  return null;
}

export function retirementDetail(card: ModelCard, now: number = Date.now()): string | null {
  const date = card.retiresNotBefore;
  if (retired(card, now)) return date ? `Retired ${date}` : 'Retired';
  return date ? `Retires ${date}` : null;
}

export function fullPrice(card: ModelCard): string {
  if (!card.price) return 'No price listed';
  const { inputPerMillion, cachedInputPerMillion, outputPerMillion } = card.price;
  return `${formatPrice(inputPerMillion)} in · ${formatPrice(cachedInputPerMillion)} cached · ${formatPrice(outputPerMillion)} out per million tokens`;
}

export function effortRange(card: ModelCard): string {
  const efforts = card.reasoning.efforts;
  if (efforts.length === 0) return 'none';
  if (efforts.length === 1) return efforts[0]!;
  return `${efforts[0]}–${efforts.at(-1)}`;
}

export function modelFacts(card: ModelCard, now: number = Date.now()): [string, string][] {
  const defaultEffort = card.reasoning.defaultEffort;
  const retirement = retirementDetail(card, now);
  const facts: [string, string][] = [
    ['Tier', card.tier],
    ['Price', fullPrice(card)],
    [
      'Context',
      `${formatTokenCount(card.contextTokens)} · ${formatTokenCount(card.maxOutputTokens)} max output`,
    ],
    ['Speed', card.speed],
    ['Effort', `${effortRange(card)}${defaultEffort ? ` (default ${defaultEffort})` : ''}`],
  ];
  if (retirement) facts.push(['Retirement', retirement]);
  return facts;
}

export interface StaleNote {
  short: string;
  full: string;
}

export function staleNote(view: ModelCardView): StaleNote | null {
  const { staleness } = view;
  if (staleness.factsExpired) {
    return {
      short: 'Facts out of date',
      full: 'Facts are over 120 days old: Jev no longer sees its price',
    };
  }
  if (!staleness.checkStale) return null;
  const checked = `Checked ${staleness.checkedDaysAgo} days ago`;
  return { short: checked, full: checked };
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
