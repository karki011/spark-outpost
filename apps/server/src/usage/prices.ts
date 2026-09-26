import type { TokenUsage } from '@spark-outpost/contracts';

export interface ModelPrice {
  provider: string;
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export const PRICE_TABLE = {
  label:
    'Estimated prices in USD per million tokens at the standard short-context rate. Not a bill; edit when prices change.',
  asOf: '2026-09-26',
  source:
    'OpenAI API pricing, Standard processing, https://developers.openai.com/api/docs/pricing, checked 2026-09-26. Long-context, priority, regional, and FedRAMP rates are higher and not modelled.',
  prices: [
    {
      provider: 'codex',
      model: 'gpt-6-astra',
      inputPerMillion: 10,
      cachedInputPerMillion: 1,
      outputPerMillion: 50,
    },
    {
      provider: 'codex',
      model: 'gpt-6-sol',
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 10,
    },
    {
      provider: 'codex',
      model: 'gpt-6-luna',
      inputPerMillion: 0.1,
      cachedInputPerMillion: 0.01,
      outputPerMillion: 0.5,
    },
    {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      outputPerMillion: 20,
    },
    {
      provider: 'codex',
      model: 'gpt-5.6-terra',
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 12,
    },
    {
      provider: 'codex',
      model: 'gpt-5.6-luna',
      inputPerMillion: 0.2,
      cachedInputPerMillion: 0.02,
      outputPerMillion: 1.2,
    },
    {
      provider: 'codex',
      model: 'gpt-5.5',
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 30,
    },
  ] satisfies ModelPrice[],
} as const;

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
  tokens: Pick<TokenUsage, 'input' | 'output' | 'cachedRead'>,
  table: readonly ModelPrice[] = PRICE_TABLE.prices,
): number | null {
  const price = priceFor(provider, model, table);
  if (!price) return null;
  const cached = Math.min(tokens.cachedRead ?? 0, tokens.input);
  const uncached = tokens.input - cached;
  const cost =
    uncached * price.inputPerMillion +
    cached * price.cachedInputPerMillion +
    tokens.output * price.outputPerMillion;
  return Math.round(cost) / 1_000_000;
}
