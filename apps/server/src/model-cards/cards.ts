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

export const RETIRING_WITHIN_DAYS = 30;
const DAY_MS = 86_400_000;

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

export function cardRetiring(card: ModelCard, now: Date = new Date()): boolean {
  if (card.retiresNotBefore === null) return false;
  const horizon = now.getTime() + RETIRING_WITHIN_DAYS * DAY_MS;
  return Date.parse(`${card.retiresNotBefore}T00:00:00Z`) <= horizon;
}

export function retiringOn(
  model: CardModel,
  provider: string | null = null,
  now: Date = new Date(),
): string | null {
  const card = cardFor(model, provider);
  return card && cardRetiring(card, now) ? card.retiresNotBefore : null;
}

export function usableDefault(
  provider: string,
  model: string | null,
  now: Date = new Date(),
): string | null {
  return model !== null && retiringOn({ id: model }, provider, now) !== null ? null : model;
}

export function isFrontier(model: CardModel, provider: string | null = null): boolean {
  return cardFor(model, provider)?.tier === 'frontier';
}

export function effectiveDefaultModel(
  provider: string,
  models: readonly CardModel[],
  adapterDefault: string | null,
  now: Date = new Date(),
): string | null {
  const everyday = providerCard(provider)?.everydayModel ?? null;
  if (everyday) {
    const offered = models.find((model) => {
      const card = cardFor(model, provider);
      return card?.id === everyday && !cardRetiring(card, now);
    });
    if (offered) return offered.id;
  }
  if (adapterDefault === null) return null;
  const fallback = models.find((model) => model.id === adapterDefault);
  const retiring = retiringOn(fallback ?? { id: adapterDefault }, provider, now) !== null;
  if (!retiring && (!fallback || !isFrontier(fallback, provider))) return adapterDefault;
  const usable = models
    .map((model) => ({ model, card: cardFor(model, provider) }))
    .filter(({ card }) => card !== null && card.tier !== 'frontier' && !cardRetiring(card, now))
    .sort((a, b) => TIER_RANK[b.card!.tier] - TIER_RANK[a.card!.tier]);
  return usable[0]?.model.id ?? adapterDefault;
}
