export type FollowEvent = 'user-scroll' | 'input' | 'resize' | 'output';

export type FollowOutcome = 'keep' | 'move' | 'hide';

export interface FollowFacts {
  shown: boolean;
  selected: boolean;
  inView: boolean;
}

export function followOutcome(event: FollowEvent, facts: FollowFacts): FollowOutcome {
  if (!facts.shown) return 'keep';
  if (event !== 'output') return 'hide';
  return facts.selected && facts.inView ? 'move' : 'hide';
}

export function rowsInView(
  startRow: number,
  endRow: number,
  viewportY: number,
  rows: number,
): boolean {
  return endRow >= viewportY && startRow < viewportY + rows;
}

const SCROLL_KEYS: readonly string[] = ['PageUp', 'PageDown', 'Home', 'End'];

export function isScrollKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  return event.shiftKey && SCROLL_KEYS.includes(event.key);
}

export function isScrollbar(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.scrollbar') !== null;
}
