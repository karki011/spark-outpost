import { countsCacheOutsideInput, type ModelCard, type TokenUsage } from '@spark-outpost/contracts';
import { VENDOR_CARDS, cardFor } from '../model-cards/cards.ts';

export interface ModelPrice {
  provider: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  cacheOutsideInput?: boolean;
  cacheWritePerMillion?: number;
}

const ESTIMATED_PROVIDERS = new Set(['codex', 'zai']);
const BILLED_CACHE_WRITES = new Set(['claude']);

function cardPrice(card: ModelCard): ModelPrice | null {
  if (!card.price) return null;
  return {
    provider: card.provider,
    model: card.id,
    inputPerMillion: card.price.inputPerMillion,
    cachedInputPerMillion: card.price.cachedInputPerMillion,
    outputPerMillion: card.price.outputPerMillion,
    ...(countsCacheOutsideInput(card.provider) ? { cacheOutsideInput: true } : {}),
    ...(BILLED_CACHE_WRITES.has(card.provider) && card.price.cacheWritePerMillion !== null
      ? { cacheWritePerMillion: card.price.cacheWritePerMillion }
      : {}),
  };
}

function cardPrices(): readonly ModelPrice[] {
  return VENDOR_CARDS.cards.flatMap((card) => {
    const price = ESTIMATED_PROVIDERS.has(card.provider) ? cardPrice(card) : null;
    return price ? [price] : [];
  });
}

export const PRICE_TABLE = {
  label:
    'Estimated prices in USD per million tokens at the standard short-context rate. Not a bill; prices come from the model cards (apps/server/src/model-cards/vendor-cards.json).',
  asOf: VENDOR_CARDS.checkedAt,
  source: `OpenAI API pricing, Standard processing, https://developers.openai.com/api/docs/pricing, checked ${VENDOR_CARDS.checkedAt}. Long-context, priority, regional, and FedRAMP rates are higher and not modelled. Z.ai GLM pay-as-you-go pricing, https://docs.z.ai/guides/overview/pricing, checked ${VENDOR_CARDS.checkedAt}; GLM Coding Plan usage is a subscription quota, so the estimate overstates it.`,
  prices: cardPrices(),
};

export function priceFor(
  provider: string,
  model: string | null,
  table: readonly ModelPrice[] = PRICE_TABLE.prices,
): ModelPrice | null {
  if (!model) return null;
  const base = model.split('/')[0];
  return table.find((entry) => entry.provider === provider && entry.model === base) ?? null;
}

type PricedTokens = Pick<TokenUsage, 'input' | 'output' | 'cachedRead'> &
  Partial<Pick<TokenUsage, 'cachedWrite'>>;

export function costAt(price: ModelPrice, tokens: PricedTokens): number {
  const cached = price.cacheOutsideInput
    ? (tokens.cachedRead ?? 0)
    : Math.min(tokens.cachedRead ?? 0, tokens.input);
  const written = price.cacheOutsideInput ? (tokens.cachedWrite ?? 0) : 0;
  const uncached = price.cacheOutsideInput ? tokens.input : tokens.input - cached;
  const cost =
    uncached * price.inputPerMillion +
    written * (price.cacheWritePerMillion ?? price.inputPerMillion) +
    cached * price.cachedInputPerMillion +
    tokens.output * price.outputPerMillion;
  return Math.round(cost) / 1_000_000;
}

export function estimateCostUsd(
  provider: string,
  model: string | null,
  tokens: PricedTokens,
  table: readonly ModelPrice[] = PRICE_TABLE.prices,
): number | null {
  const price = priceFor(provider, model, table);
  return price ? costAt(price, tokens) : null;
}

export function cardPriceFor(provider: string, model: string | null): ModelPrice | null {
  if (!model) return null;
  const card = cardFor({ id: model.split('/')[0]! }, provider);
  return card ? cardPrice(card) : null;
}
