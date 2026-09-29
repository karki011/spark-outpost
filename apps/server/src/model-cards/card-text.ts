import {
  JEV_CARD_CHARACTERS,
  type CardCategory,
  type CardStaleness,
  type ModelCard,
  type ModelStat,
} from '@spark-outpost/contracts';
import { cardRetiring, DAY_MS, utcDayStart } from './cards.ts';

export const MIN_STAT_SAMPLES = 3;
export const STAT_MAX_AGE_DAYS = 90;
export const CHECK_STALE_DAYS = 60;
export const FACTS_EXPIRE_DAYS = 120;

export interface StatSummary {
  category: CardCategory;
  n: number;
  passed: number;
  meanCostUsd: number;
  meanWallMs: number;
}

function daysBetween(from: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - utcDayStart(from)) / DAY_MS));
}

function oldestCheck(card: ModelCard): string {
  return card.sources.map((source) => source.checkedAt).sort()[0]!;
}

export function staleness(card: ModelCard, now: Date): CardStaleness {
  const checkedDaysAgo = daysBetween(oldestCheck(card), now);
  return {
    checkedDaysAgo,
    checkStale: checkedDaysAgo > CHECK_STALE_DAYS,
    factsExpired: checkedDaysAgo > FACTS_EXPIRE_DAYS,
    retiring: cardRetiring(card, now),
  };
}

function rowsFor(stats: readonly ModelStat[], card: ModelCard, category: CardCategory) {
  return stats.filter(
    (stat) =>
      stat.provider === card.provider &&
      stat.model === card.id &&
      stat.category === category &&
      (category === 'plan' ? stat.role === 'architect' : stat.role !== 'architect'),
  );
}

function summarise(rows: readonly ModelStat[], category: CardCategory): StatSummary | null {
  const n = rows.reduce((sum, row) => sum + row.n, 0);
  if (n === 0) return null;
  const weighted = (pick: (row: ModelStat) => number) =>
    rows.reduce((sum, row) => sum + pick(row) * row.n, 0) / n;
  return {
    category,
    n,
    passed: rows.reduce((sum, row) => sum + row.passed, 0),
    meanCostUsd: weighted((row) => row.meanCostUsd),
    meanWallMs: weighted((row) => row.meanWallMs),
  };
}

export function usableStats(stats: readonly ModelStat[], now: Date): ModelStat[] {
  return stats.filter((stat) => daysBetween(stat.measuredOn, now) <= STAT_MAX_AGE_DAYS);
}

export function statFor(
  stats: readonly ModelStat[],
  card: ModelCard,
  category: CardCategory | null,
): StatSummary | null {
  if (category !== null) {
    const summary = summarise(rowsFor(stats, card, category), category);
    return summary && summary.n >= MIN_STAT_SAMPLES ? summary : null;
  }
  const categories = [...new Set(stats.map((stat) => stat.category))].filter(
    (candidate) => candidate !== 'plan',
  );
  const summaries = categories
    .map((candidate) => summarise(rowsFor(stats, card, candidate), candidate))
    .filter((summary): summary is StatSummary => summary !== null && summary.n >= MIN_STAT_SAMPLES)
    .sort((a, b) => b.n - a.n);
  return summaries[0] ?? null;
}

function money(value: number): string {
  return `$${Number(value.toFixed(2))}`;
}

function statPiece(stat: StatSummary): string {
  const cost = stat.meanCostUsd < 0.01 ? '<$0.01' : `~$${stat.meanCostUsd.toFixed(2)}`;
  return `bench ${stat.category} ${stat.passed}/${stat.n} ${cost} ${Math.round(stat.meanWallMs / 1000)}s`;
}

export function fitPieces(head: string, pieces: readonly string[]): string {
  let text = head.slice(0, JEV_CARD_CHARACTERS);
  for (const piece of pieces) {
    const next = `${text}; ${piece}`;
    if (next.length > JEV_CARD_CHARACTERS) continue;
    text = next;
  }
  return text;
}

export function cardText(card: ModelCard, stat: StatSummary | null, now: Date): string {
  const stale = staleness(card, now);
  const price = stale.factsExpired ? null : card.price;
  const priceText = price
    ? `, ${money(price.inputPerMillion)}/${money(price.outputPerMillion)} per M`
    : '';
  const head = `${card.label}: ${card.tier} tier, ${card.speed}${priceText}`;
  const pieces = [
    ...(stale.factsExpired ? [] : [card.blurb]),
    ...(stat ? [statPiece(stat)] : []),
    ...(stale.retiring ? ['retiring'] : []),
  ];
  return fitPieces(head, pieces);
}

export function effortNote(cards: readonly ModelCard[]): string {
  const defaults = cards
    .filter((card) => card.reasoning.defaultEffort !== null)
    .map((card) => `${card.label} ${card.reasoning.defaultEffort}`);
  const ignores = cards
    .filter((card) => card.reasoning.efforts.length === 0)
    .map((card) => `${card.label} has no effort setting`);
  const pieces = [...(defaults.length > 0 ? [`Defaults: ${defaults.join(', ')}`] : []), ...ignores];
  if (pieces.length === 0) return '';
  return fitPieces(pieces[0]!, pieces.slice(1));
}
