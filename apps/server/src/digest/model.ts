import type { ModelCard } from '@spark-outpost/contracts';
import { cardFor, TIER_RANK, VENDOR_CARDS } from '../model-cards/cards.ts';

export interface DigestModel {
  model: string | null;
  label: string | null;
  effort: string | null;
}

export interface OfferedModel {
  id: string;
  label?: string | null;
}

function cheapestFirst(provider: string, cards: readonly ModelCard[]): ModelCard[] {
  return cards
    .filter((card) => card.provider === provider && card.tier !== 'frontier' && card.price)
    .toSorted(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        a.price!.outputPerMillion - b.price!.outputPerMillion,
    );
}

export function digestModel(
  provider: string,
  offered: readonly OfferedModel[],
  efforts: readonly string[],
  cards: readonly ModelCard[] = VENDOR_CARDS.cards,
): DigestModel {
  const effort = efforts.includes('low') ? 'low' : null;
  const ranked = cheapestFirst(provider, cards);
  if (offered.length === 0) {
    const card = ranked[0];
    return card
      ? { model: card.match.ids[0] ?? card.id, label: card.label, effort }
      : { model: null, label: null, effort };
  }
  for (const card of ranked) {
    const option = offered.find((model) => cardFor(model, provider, cards)?.id === card.id);
    if (option) return { model: option.id, label: card.label, effort };
  }
  return { model: null, label: null, effort };
}
