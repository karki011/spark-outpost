import type { Terminal } from '@xterm/xterm';
import type { Box } from '../../chat/quotes/toolbar-position.ts';
import { selectionBoxes } from './selection-boxes.ts';
import {
  followOutcome,
  holdsPointerMove,
  isScrollbar,
  isScrollKey,
  isSelectionGesture,
  rowsInView,
  type FollowEvent,
} from './selection-follow.ts';
import { SETTLE_IDLE, settle, type SettleEvent } from './selection-settle.ts';
import { cleanSelection, insertText, pasteText, type InsertKind } from './selection-text.ts';

export interface TerminalSelection {
  text: string;
  start: Box;
  end: Box;
  canInsert: boolean;
}

export type SelectionCause = 'select' | 'update' | 'changed' | 'scroll' | 'input' | 'resize';

export type SelectionHandler = (selection: TerminalSelection | null, cause: SelectionCause) => void;

export interface SelectionActions {
  insertSelection(kind: InsertKind, selected: string, note?: string): boolean;
  clearSelection(): void;
}

export interface SelectionFollower {
  refresh(): void;
  stop(): void;
}

type SelectionTerminal = Pick<
  Terminal,
  | 'getSelection'
  | 'getSelectionPosition'
  | 'onSelectionChange'
  | 'onScroll'
  | 'onWriteParsed'
  | 'onKey'
  | 'onResize'
  | 'buffer'
  | 'cols'
  | 'rows'
  | 'modes'
  | 'clearSelection'
>;

type InsertTerminal = Pick<Terminal, 'paste' | 'focus' | 'clearSelection' | 'modes'>;

function readSelection(
  terminal: SelectionTerminal,
  element: HTMLElement,
  canInsert: () => boolean,
): TerminalSelection | null {
  const text = cleanSelection(terminal.getSelection());
  const position = terminal.getSelectionPosition();
  const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
  if (!position || !screen || !text) return null;
  const boxes = selectionBoxes({
    start: position.start,
    end: position.end,
    viewportY: terminal.buffer.active.viewportY,
    cols: terminal.cols,
    rows: terminal.rows,
    screen,
  });
  return boxes ? { text, ...boxes, canInsert: canInsert() } : null;
}

function selectionInView(terminal: SelectionTerminal): boolean {
  const position = terminal.getSelectionPosition();
  if (!position) return false;
  const { viewportY } = terminal.buffer.active;
  return rowsInView(position.start.y, position.end.y, viewportY, terminal.rows);
}

function selectionKey(selection: TerminalSelection | null): string | null {
  if (!selection) return null;
  return JSON.stringify([selection.text, selection.start, selection.end, selection.canInsert]);
}

const HIDE_CAUSE: Record<Exclude<FollowEvent, 'output'>, SelectionCause> = {
  'user-scroll': 'scroll',
  input: 'input',
  resize: 'resize',
};

export function followSelection(
  terminal: SelectionTerminal,
  element: HTMLElement,
  canInsert: () => boolean,
  onSelection: SelectionHandler | undefined,
): SelectionFollower {
  if (!onSelection) return { refresh: () => undefined, stop: () => undefined };
  const abort = new AbortController();
  const options = { capture: true, signal: abort.signal };
  let state = SETTLE_IDLE;
  let reported: string | null = null;
  let copied: string | null = null;
  let selecting = false;

  const report = () => {
    const next = readSelection(terminal, element, canInsert);
    const key = selectionKey(next);
    if (key === reported) return;
    reported = key;
    copied = next?.text ?? null;
    onSelection(next, 'select');
  };
  const step = (event: SettleEvent) => {
    const next = settle(state, event);
    state = next.state;
    if (next.settled) report();
  };
  const hide = (event: Exclude<FollowEvent, 'output'>) => {
    if (followOutcome(event, { shown: reported !== null, selected: true, inView: true }) !== 'hide')
      return;
    reported = null;
    onSelection(null, HIDE_CAUSE[event]);
  };
  const follow = () => {
    if (reported === null || terminal.modes.synchronizedOutputMode) return;
    const next = readSelection(terminal, element, canInsert);
    if (next && next.text !== copied) {
      reported = null;
      terminal.clearSelection();
      onSelection(null, 'changed');
      return;
    }
    const facts = { shown: true, selected: next !== null, inView: selectionInView(terminal) };
    if (followOutcome('output', facts) === 'hide' || !next) {
      reported = null;
      onSelection(null, 'scroll');
      return;
    }
    const key = selectionKey(next);
    if (key === reported) return;
    reported = key;
    onSelection(next, 'update');
  };
  const pointerDown = (event: Event) => {
    const onScrollbar = isScrollbar(event.target);
    if (onScrollbar) hide('user-scroll');
    selecting =
      !onScrollbar && isSelectionGesture(event as MouseEvent, terminal.modes.mouseTrackingMode);
    step('pointer-down');
  };
  const pointerUp = () => {
    const reselected = state.pointerDown && selecting;
    selecting = false;
    step('pointer-up');
    if (reselected && reported === null) report();
  };
  const pointerMove = (event: Event) => {
    if (holdsPointerMove(reported !== null, (event as MouseEvent).buttons)) event.stopPropagation();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (isScrollKey(event)) hide('user-scroll');
  };

  element.addEventListener('pointerdown', pointerDown, options);
  element.addEventListener('wheel', () => hide('user-scroll'), { ...options, passive: true });
  element.addEventListener('keydown', keyDown, options);
  element.addEventListener('mousemove', pointerMove, options);
  element.addEventListener('paste', () => hide('input'), options);
  element.addEventListener('compositionend', () => hide('input'), options);
  document.addEventListener('pointerup', pointerUp, options);
  document.addEventListener('pointercancel', pointerUp, options);
  window.addEventListener('resize', () => hide('resize'), { signal: abort.signal });
  const subscriptions = [
    terminal.onSelectionChange(() => step('changed')),
    terminal.onScroll(follow),
    terminal.onWriteParsed(follow),
    terminal.onKey(() => hide('input')),
    terminal.onResize(() => hide('resize')),
  ];
  return {
    refresh: follow,
    stop: () => {
      abort.abort();
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}

export function selectionActions(
  terminal: InsertTerminal,
  canInsert: () => boolean,
): SelectionActions {
  return {
    insertSelection: (kind, selected, note) => {
      const text = insertText(kind, selected, note);
      if (!text || !canInsert()) return false;
      terminal.paste(pasteText(text, terminal.modes.bracketedPasteMode));
      terminal.focus();
      return true;
    },
    clearSelection: () => terminal.clearSelection(),
  };
}
