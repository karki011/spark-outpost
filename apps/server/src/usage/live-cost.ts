import type { ProviderOutput } from '../providers/provider.ts';
import { cardPriceFor, costAt, type ModelPrice } from './prices.ts';

export interface LiveCost {
  observe(output: ProviderOutput): boolean;
  unreported(): number;
}

interface Call {
  end: number;
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
  let call: Call | null = null;
  let toolFinished = false;

  const startCall = (known: ModelPrice, used: number) => {
    const carried = call ? (used >= call.end ? call.end : 0) : resumed ? used : 0;
    estimate +=
      perToken(known.cachedInputPerMillion, carried) +
      perToken(known.inputPerMillion, used - carried);
    call = { end: used };
    toolFinished = false;
  };

  const context = (used: number): boolean => {
    if (!price) return false;
    if (call === null || toolFinished || used < call.end) {
      startCall(price, used);
      return true;
    }
    if (used === call.end) return false;
    estimate += perToken(price.outputPerMillion, used - call.end);
    call.end = used;
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
        case 'step_finished':
          if (output.tool) toolFinished = true;
          return false;
        case 'usage':
          if (output.costUsd === null) return context(output.contextUsed);
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
