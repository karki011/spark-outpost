import { useEffect, useRef } from 'react';
import { cardKey, type Card, type IslandView } from './island-model.ts';

export function nextToExpand(
  cards: readonly Card[],
  pending: readonly Card[],
  shown: Set<string>,
): Card | null {
  const waiting = new Set(pending.map(cardKey));
  for (const key of shown) {
    if (!waiting.has(key)) shown.delete(key);
  }
  const next = cards.find((card) => !card.loading && !shown.has(cardKey(card)));
  if (!next) return null;
  shown.add(cardKey(next));
  return next;
}

export function opensByItself(
  view: IslandView,
  state: { sparkFocused: boolean; dragging: boolean; menuBarBusy: boolean },
): boolean {
  const resting = view.kind === 'peek' || view.kind === 'now';
  return resting && !state.sparkFocused && !state.dragging && !state.menuBarBusy;
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
