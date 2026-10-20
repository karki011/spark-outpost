import { aliasFamily, cardFor } from '../model-cards/cards.ts';
import type { ModelCard } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../providers/provider.ts';

type UsageOutput = Extract<ProviderOutput, { kind: 'usage' }>;

export interface KnownWindow {
  model: string | null;
  size: number;
}

export interface ContextWindows {
  settle(output: UsageOutput): UsageOutput;
}

function cardsOf(provider: string, model: string): ModelCard[] {
  const card = cardFor({ id: model }, provider);
  return card ? [card] : aliasFamily(model, provider);
}

export function sameModel(provider: string, known: string | null, other: string): boolean {
  if (known === null || known === other) return true;
  const knownCards = cardsOf(provider, known);
  const otherCards = cardsOf(provider, other);
  if (knownCards.length === 0 || otherCards.length === 0) return true;
  return knownCards.some((card) => otherCards.includes(card));
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
