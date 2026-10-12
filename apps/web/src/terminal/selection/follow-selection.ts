import type { Terminal } from '@xterm/xterm';
import type { Box } from '../../chat/quotes/toolbar-position.ts';
import { selectionBoxes } from './selection-boxes.ts';
import { SETTLE_IDLE, settle, type SettleEvent } from './selection-settle.ts';
import { cleanSelection, insertText, pasteText, type InsertKind } from './selection-text.ts';

export interface TerminalSelection {
  text: string;
  start: Box;
  end: Box;
  canInsert: boolean;
}

export type SelectionCause = 'select' | 'scroll' | 'input' | 'resize';

export type SelectionHandler = (selection: TerminalSelection | null, cause: SelectionCause) => void;

export interface SelectionActions {
  insertSelection(kind: InsertKind, selected: string, note?: string): boolean;
  clearSelection(): void;
}

type SelectionTerminal = Pick<
  Terminal,
  | 'getSelection'
  | 'getSelectionPosition'
  | 'onSelectionChange'
  | 'onScroll'
  | 'onData'
  | 'onResize'
  | 'buffer'
  | 'cols'
  | 'rows'
>;

type InsertTerminal = Pick<Terminal, 'paste' | 'focus' | 'clearSelection' | 'modes'>;

function readSelection(
  terminal: SelectionTerminal,
  element: HTMLElement,
  canInsert: () => boolean,
): TerminalSelection | null {
  const text = terminal.getSelection();
  const position = terminal.getSelectionPosition();
  const screen = element.querySelector('.xterm-screen')?.getBoundingClientRect();
  if (!position || !screen || !cleanSelection(text)) return null;
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

function selectionKey(selection: TerminalSelection | null): string | null {
  return selection ? JSON.stringify([selection.text, selection.start, selection.end]) : null;
}

export function followSelection(
  terminal: SelectionTerminal,
  element: HTMLElement,
  canInsert: () => boolean,
  onSelection: SelectionHandler | undefined,
): () => void {
  if (!onSelection) return () => undefined;
  const abort = new AbortController();
  const options = { capture: true, signal: abort.signal };
  let state = SETTLE_IDLE;
  let reported: string | null = null;

  const report = () => {
    const next = readSelection(terminal, element, canInsert);
    const key = selectionKey(next);
    if (key === reported) return;
    reported = key;
    onSelection(next, 'select');
  };
  const step = (event: SettleEvent) => {
    const next = settle(state, event);
    state = next.state;
    if (next.settled) report();
  };
  const dismiss = (cause: SelectionCause) => {
    if (reported !== null) onSelection(null, cause);
  };

  element.addEventListener('pointerdown', () => step('pointer-down'), options);
  document.addEventListener('pointerup', () => step('pointer-up'), options);
  document.addEventListener('pointercancel', () => step('pointer-up'), options);
  window.addEventListener('resize', () => dismiss('resize'), { signal: abort.signal });
  const subscriptions = [
    terminal.onSelectionChange(() => step('changed')),
    terminal.onScroll(() => dismiss('scroll')),
    terminal.onData(() => dismiss('input')),
    terminal.onResize(() => dismiss('resize')),
  ];
  return () => {
    abort.abort();
    for (const subscription of subscriptions) subscription.dispose();
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
