import {
  vendorCardsFileSchema,
  type ModelCard,
  type ModelTier,
  type ProviderCard,
} from '@spark-outpost/contracts';
import vendorJson from './vendor-cards.json' with { type: 'json' };

export const VENDOR_CARDS = vendorCardsFileSchema.parse(vendorJson);

export const TIER_RANK: Readonly<Record<ModelTier, number>> = {
  small: 0,
  mid: 1,
  top: 2,
  frontier: 3,
};
export const FRONTIER_RANK = TIER_RANK.frontier;

export interface CardModel {
  id: string;
  label?: string | null;
}

function bareId(id: string): string {
  return id.replace(/\[[^\]]*\]$/, '');
}

export function cardFor(
  model: CardModel,
  provider: string | null = null,
  cards: readonly ModelCard[] = VENDOR_CARDS.cards,
): ModelCard | null {
  const pool = provider ? cards.filter((card) => card.provider === provider) : cards;
  const label = model.label?.trim() ?? '';
  if (label) {
    const byLabel = pool.find((card) => card.match.labels.includes(label));
    if (byLabel) return byLabel;
  }
  const byId = pool.find(
    (card) => card.match.ids.includes(model.id) || card.match.ids.includes(bareId(model.id)),
  );
  if (!byId) return null;
  if (label && !byId.match.labels.includes(label)) return null;
  return byId;
}

export function cardById(id: string): ModelCard | null {
  return VENDOR_CARDS.cards.find((card) => card.id === id) ?? null;
}

export function providerCard(provider: string): ProviderCard | null {
  return VENDOR_CARDS.providers.find((card) => card.provider === provider) ?? null;
}

export function isFrontier(model: CardModel, provider: string | null = null): boolean {
  return cardFor(model, provider)?.tier === 'frontier';
}

export function effectiveDefaultModel(
  provider: string,
  models: readonly CardModel[],
  adapterDefault: string | null,
): string | null {
  const everyday = providerCard(provider)?.everydayModel ?? null;
  if (everyday) {
    const offered = models.find((model) => cardFor(model, provider)?.id === everyday);
    if (offered) return offered.id;
  }
  const fallback = models.find((model) => model.id === adapterDefault);
  if (!fallback || !isFrontier(fallback, provider)) return adapterDefault;
  const nonFrontier = models
    .map((model) => ({ model, card: cardFor(model, provider) }))
    .filter(({ card }) => card !== null && card.tier !== 'frontier')
    .sort((a, b) => TIER_RANK[b.card!.tier] - TIER_RANK[a.card!.tier]);
  return nonFrontier[0]?.model.id ?? adapterDefault;
}
