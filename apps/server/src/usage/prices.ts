import type { ModelCard, TokenUsage } from '@spark-outpost/contracts';
import { VENDOR_CARDS } from '../model-cards/cards.ts';

export interface ModelPrice {
  provider: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  cacheOutsideInput?: boolean;
}

const ESTIMATED_PROVIDERS = new Set(['codex', 'zai']);
const CACHE_OUTSIDE_INPUT = new Set(['zai']);

export function cardPrice(card: ModelCard): ModelPrice | null {
  if (!card.price) return null;
  return {
    provider: card.provider,
    model: card.id,
    inputPerMillion: card.price.inputPerMillion,
    cachedInputPerMillion: card.price.cachedInputPerMillion,
    outputPerMillion: card.price.outputPerMillion,
    ...(CACHE_OUTSIDE_INPUT.has(card.provider) ? { cacheOutsideInput: true } : {}),
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
  source:
    'OpenAI API pricing, Standard processing, https://developers.openai.com/api/docs/pricing, checked 2026-09-26. Long-context, priority, regional, and FedRAMP rates are higher and not modelled. Z.ai GLM pay-as-you-go pricing, https://docs.z.ai/guides/overview/pricing, checked 2026-09-26; GLM Coding Plan usage is a subscription quota, so the estimate overstates it.',
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

export function estimateCostUsd(
  provider: string,
  model: string | null,
  tokens: Pick<TokenUsage, 'input' | 'output' | 'cachedRead'> &
    Partial<Pick<TokenUsage, 'cachedWrite'>>,
  table: readonly ModelPrice[] = PRICE_TABLE.prices,
): number | null {
  const price = priceFor(provider, model, table);
  if (!price) return null;
  const cached = price.cacheOutsideInput
    ? (tokens.cachedRead ?? 0)
    : Math.min(tokens.cachedRead ?? 0, tokens.input);
  const uncached = price.cacheOutsideInput
    ? tokens.input + (tokens.cachedWrite ?? 0)
    : tokens.input - cached;
  const cost =
    uncached * price.inputPerMillion +
    cached * price.cachedInputPerMillion +
    tokens.output * price.outputPerMillion;
  return Math.round(cost) / 1_000_000;
}
