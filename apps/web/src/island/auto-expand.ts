import { useEffect, useRef } from 'react';
import type { Card } from './island-model.ts';

export function attentionKey(card: Card): string {
  return card.approval?.id ?? `chat:${card.chat.id}`;
}

export function nextToExpand(
  cards: readonly Card[],
  pending: readonly Card[],
  shown: Set<string>,
): Card | null {
  const waiting = new Set(pending.map(attentionKey));
  for (const key of shown) {
    if (!waiting.has(key)) shown.delete(key);
  }
  const next = cards.find((card) => !card.loading && !shown.has(attentionKey(card)));
  if (!next) return null;
  shown.add(attentionKey(next));
  return next;
}

interface AutoExpandOptions {
  enabled: boolean;
  idle: boolean;
  cards: readonly Card[];
  pending: readonly Card[];
  onExpand: (card: Card) => void;
}

export function useAutoExpand({ enabled, idle, cards, pending, onExpand }: AutoExpandOptions) {
  const shown = useRef(new Set<string>());
  const expand = useRef(onExpand);
  useEffect(() => {
    expand.current = onExpand;
  });
  useEffect(() => {
    if (!enabled || !idle) return;
    const next = nextToExpand(cards, pending, shown.current);
    if (next) expand.current(next);
  }, [enabled, idle, cards, pending]);
}
