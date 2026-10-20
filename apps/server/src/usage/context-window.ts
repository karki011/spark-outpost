import { aliasFamily, cardFor } from '../model-cards/cards.ts';
import type { ProviderOutput } from '../providers/provider.ts';

type UsageOutput = Extract<ProviderOutput, { kind: 'usage' }>;

export interface KnownWindow {
  model: string | null;
  size: number;
}

export interface ContextWindows {
  settle(output: UsageOutput): UsageOutput;
}

function sameModel(provider: string, known: string | null, reported: string): boolean {
  if (known === null) return false;
  if (known === reported) return true;
  const reportedCard = cardFor({ id: reported }, provider);
  if (!reportedCard) return false;
  const knownCard = cardFor({ id: known }, provider);
  if (knownCard) return knownCard.id === reportedCard.id;
  return aliasFamily(known, provider).includes(reportedCard);
}

export function windowFor(
  provider: string,
  model: string | null,
  known: KnownWindow | null,
): number | null {
  if (model === null) return known?.size ?? null;
  if (known && sameModel(provider, known.model, model)) return known.size;
  return cardFor({ id: model }, provider)?.contextTokens ?? null;
}

export function contextWindows(provider: string, stored: KnownWindow | null): ContextWindows {
  let known = stored;
  return {
    settle(output) {
      const { provisionalWindow, ...reading } = output;
      const model = output.model ?? null;
      if (!provisionalWindow) {
        if (reading.contextSize !== null) known = { model, size: reading.contextSize };
        return reading;
      }
      return { ...reading, contextSize: windowFor(provider, model, known) };
    },
  };
}
