import { cardFor } from '../../model-cards/cards.ts';

export const LONG_CONTEXT_TOKENS = 1_000_000;

export function kilo(tokens: number): string {
  const thousands = Math.round(tokens / 1_000);
  return thousands < 1_000 ? `${thousands}K` : `${Number((tokens / 1_000_000).toFixed(1))}M`;
}

export function reportedModel(meta: unknown): string | null {
  if (meta === null || typeof meta !== 'object') return null;
  const model = (meta as Record<string, unknown>)['_claude/model'];
  return typeof model === 'string' ? model : null;
}

export function shortWindowNote(meta: unknown, size: number): string | null {
  const model = reportedModel(meta);
  const card = model ? cardFor({ id: model }, 'claude') : null;
  if (!card) return null;
  const window = card.contextTokens;
  if (window < LONG_CONTEXT_TOKENS || size <= 0 || size >= window) return null;
  return `${card.label} is using a ${kilo(size)} context window on this account, not ${kilo(window)}`;
}
