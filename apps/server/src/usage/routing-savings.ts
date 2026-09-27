import type { ModelCard, RoutingSavings, TokenUsage } from '@spark-outpost/contracts';
import { cardFor, TIER_RANK, VENDOR_CARDS } from '../model-cards/cards.ts';
import { topTier, type TierModel } from '../orchestration/tiers.ts';
import { cardPrice, estimateCostUsd } from './prices.ts';

export type RoutedTokens = Pick<TokenUsage, 'input' | 'output' | 'cachedRead' | 'cachedWrite'>;

export interface RoutedRun {
  provider: string;
  model: string | null;
  modelLabel: string | null;
  tokens: RoutedTokens;
}

export type OfferedModels = ReadonlyMap<string, readonly TierModel[]>;

export interface SavingsTally {
  runs: number;
  grossUsd: number;
}

function cheapestTopCard(provider: string, cards: readonly ModelCard[]): ModelCard | null {
  const priced = cards.filter(
    (card) => card.provider === provider && card.price && card.tier !== 'frontier',
  );
  const best = Math.max(...priced.map((card) => TIER_RANK[card.tier]));
  const top = priced.filter((card) => TIER_RANK[card.tier] === best);
  top.sort((a, b) => a.price!.outputPerMillion - b.price!.outputPerMillion);
  return top[0] ?? null;
}

export function topModelCard(
  provider: string,
  offered: OfferedModels,
  cards: readonly ModelCard[] = VENDOR_CARDS.cards,
): ModelCard | null {
  const top = topTier(offered.get(provider) ?? [], provider);
  const card = top ? cardFor(top, provider, cards) : null;
  if (card?.price) return card;
  return cheapestTopCard(provider, cards);
}

function priceAt(card: ModelCard, tokens: RoutedTokens): number | null {
  const price = cardPrice(card);
  return price ? estimateCostUsd(card.provider, card.id, tokens, [price]) : null;
}

export function tallySavings(
  runs: readonly RoutedRun[],
  offered: OfferedModels,
  cards: readonly ModelCard[] = VENDOR_CARDS.cards,
): SavingsTally {
  let counted = 0;
  let grossUsd = 0;
  for (const run of runs) {
    if (!run.model) continue;
    const used = cardFor({ id: run.model, label: run.modelLabel }, run.provider, cards);
    const top = topModelCard(run.provider, offered, cards);
    if (!used || !top) continue;
    const actual = priceAt(used, run.tokens);
    const baseline = priceAt(top, run.tokens);
    if (actual === null || baseline === null) continue;
    counted += 1;
    grossUsd += baseline - actual;
  }
  return { runs: counted, grossUsd };
}

export function routingSavings(tally: SavingsTally, jevCostUsd: number): RoutingSavings | null {
  if (tally.runs === 0) return null;
  const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;
  return {
    runs: tally.runs,
    grossUsd: round(tally.grossUsd),
    jevCostUsd: round(jevCostUsd),
    netUsd: round(tally.grossUsd - jevCostUsd),
  };
}
