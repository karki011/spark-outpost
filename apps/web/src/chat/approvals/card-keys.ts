export type CardKeyTarget = 'card' | 'control' | 'field';

export interface CardKey {
  key: string;
  modifier: boolean;
  shift: boolean;
  composing: boolean;
  handled: boolean;
  target: CardKeyTarget;
  holds: boolean;
}

export type CardKeyAction = 'allow' | 'deny';

export function cardKeyAction(pressed: CardKey): CardKeyAction | null {
  if (pressed.composing || pressed.handled || pressed.modifier || pressed.shift) return null;
  if (pressed.key === 'Escape') return pressed.target === 'field' ? null : 'deny';
  if (pressed.key !== 'Enter') return null;
  return pressed.target === 'card' && !pressed.holds ? 'allow' : null;
}

export const CARD_FOCUS = 'data-card-focus';

export function keyTarget(target: EventTarget, card: EventTarget): CardKeyTarget {
  if (target === card) return 'card';
  if (!(target instanceof HTMLElement)) return 'control';
  if (target.hasAttribute(CARD_FOCUS)) return 'card';
  const field =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable;
  return field ? 'field' : 'control';
}
