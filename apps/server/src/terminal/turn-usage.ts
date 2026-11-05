import { countsCacheOutsideInput, type TokenUsage } from '@spark-outpost/contracts';
import { cardPriceFor, costAt, type ModelPrice } from '../usage/prices.ts';
import type { TokenCounts, TranscriptRecord } from './native-transcript.ts';

const LONG_CACHE_WRITE_FACTOR = 2;

export interface TurnTotals {
  model: string | null;
  tokens: TokenUsage;
  costUsd: number | null;
}

type Response = Extract<TranscriptRecord, { kind: 'response' }>;
type PriceFor = (provider: string, model: string | null) => ModelPrice | null;

const COUNTS = [
  'input',
  'output',
  'cachedRead',
  'cachedWrite',
  'cachedWriteLong',
  'thought',
] as const;

function sum(all: readonly TokenCounts[]): TokenCounts {
  const total = {
    input: 0,
    output: 0,
    cachedRead: 0,
    cachedWrite: 0,
    cachedWriteLong: 0,
    thought: 0,
  };
  for (const tokens of all) for (const key of COUNTS) total[key] += tokens[key];
  return total;
}

function used(tokens: TokenCounts): boolean {
  return COUNTS.some((key) => tokens[key] > 0);
}

export function estimatedCost(price: ModelPrice, tokens: TokenCounts): number {
  const long = Math.min(tokens.cachedWriteLong, tokens.cachedWrite);
  const standard = costAt(price, { ...tokens, cachedWrite: tokens.cachedWrite - long });
  const extended = (long * price.inputPerMillion * LONG_CACHE_WRITE_FACTOR) / 1_000_000;
  return Math.round((standard + extended) * 1_000_000) / 1_000_000;
}

export function createTurnUsage(provider: string, priceFor: PriceFor = cardPriceFor) {
  const responses = new Map<string, Response>();
  let latest: string | null = null;
  const byModel = () => {
    const models = new Map<string | null, TokenCounts[]>();
    for (const response of responses.values())
      models.set(response.model, [...(models.get(response.model) ?? []), response.tokens]);
    return [...models].map(([model, tokens]) => ({ model, tokens: sum(tokens) }));
  };
  return {
    add(response: Response): boolean {
      if (!used(response.tokens)) return false;
      const known = responses.get(response.responseId);
      if (known && COUNTS.every((key) => known.tokens[key] === response.tokens[key])) return false;
      responses.set(response.responseId, response);
      latest = response.model ?? latest;
      return true;
    },
    longWrites(): { model: string; tokens: number }[] {
      return byModel().flatMap(({ model, tokens }) =>
        model && tokens.cachedWriteLong > 0 ? [{ model, tokens: tokens.cachedWriteLong }] : [],
      );
    },
    take(): Response[] {
      const taken = [...responses.values()];
      responses.clear();
      latest = null;
      return taken;
    },
    clear() {
      responses.clear();
      latest = null;
    },
    totals(): TurnTotals | null {
      if (responses.size === 0) return null;
      const models = byModel();
      const all = sum(models.map((entry) => entry.tokens));
      const cached = countsCacheOutsideInput(provider) ? all.cachedRead + all.cachedWrite : 0;
      const costs = models.map(({ model, tokens }) => {
        const price = priceFor(provider, model);
        return price ? estimatedCost(price, tokens) : null;
      });
      return {
        model: latest,
        tokens: {
          input: all.input,
          output: all.output,
          total: all.input + all.output + cached,
          cachedRead: all.cachedRead,
          cachedWrite: all.cachedWrite,
          thought: all.thought,
        },
        costUsd: costs.some((cost) => cost === null)
          ? null
          : Math.round(costs.reduce<number>((total, cost) => total + cost!, 0) * 1_000_000) /
            1_000_000,
      };
    },
  };
}

export type TurnUsage = ReturnType<typeof createTurnUsage>;
