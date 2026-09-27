import type { ProviderOutput, UsageReadings } from '../providers/provider.ts';
import { cardPriceFor, costAt, type ModelPrice } from './prices.ts';

export interface LiveCost {
  observe(output: ProviderOutput): boolean;
  unreported(): number;
}

const perToken = (usdPerMillion: number, tokens: number) => (tokens * usdPerMillion) / 1_000_000;

export function createLiveCost(
  provider: string,
  model: string | null,
  resolvePrice: (provider: string, model: string | null) => ModelPrice | null = cardPriceFor,
): LiveCost {
  let price = resolvePrice(provider, model);
  let estimate = 0;
  let reported = false;
  let resumed = false;
  let last: number | null = null;
  let callOpen = false;

  const startCall = (known: ModelPrice, used: number) => {
    const carried = last === null ? (resumed ? used : 0) : Math.min(last, used);
    const fresh = known.cacheWritePerMillion ?? known.inputPerMillion;
    estimate += perToken(known.cachedInputPerMillion, carried) + perToken(fresh, used - carried);
  };

  const context = (used: number, readings: UsageReadings): boolean => {
    if (!price || used === last) return false;
    const endsCall = readings === 'start_and_end' && callOpen && last !== null && used > last;
    if (endsCall) estimate += perToken(price.outputPerMillion, used - last!);
    else startCall(price, used);
    callOpen = readings === 'start_and_end' && !endsCall;
    last = used;
    return true;
  };

  return {
    observe(output) {
      switch (output.kind) {
        case 'session':
          resumed = output.continued;
          return false;
        case 'session_settings':
          price = resolvePrice(provider, output.model) ?? price;
          return false;
        case 'usage':
          if (output.costUsd === null) return context(output.contextUsed, output.readings ?? 'end');
          reported = true;
          estimate = 0;
          return true;
        case 'tokens':
          if (reported || !price) return false;
          estimate = costAt(price, output.tokens);
          return true;
        default:
          return false;
      }
    },
    unreported: () => Math.round(estimate * 1_000_000) / 1_000_000,
  };
}
