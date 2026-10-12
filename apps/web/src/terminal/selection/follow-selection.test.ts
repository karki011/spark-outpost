// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  followSelection,
  selectionActions,
  type SelectionCause,
  type TerminalSelection,
} from './follow-selection.ts';

type Listener = () => void;

function emitter() {
  const listeners = new Set<Listener>();
  return {
    on: (listener: Listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: () => listeners.forEach((listener) => listener()),
  };
}

function fakeTerminal() {
  const events = {
    selection: emitter(),
    scroll: emitter(),
    write: emitter(),
    data: emitter(),
    resize: emitter(),
  };
  const model = { text: '', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
  const terminal = {
    cols: 80,
    rows: 24,
    buffer: { active: { viewportY: 0 } },
    getSelection: () => model.text,
    getSelectionPosition: () => (model.text ? { start: model.start, end: model.end } : undefined),
    onSelectionChange: events.selection.on,
    onScroll: events.scroll.on,
    onWriteParsed: events.write.on,
    onData: events.data.on,
    onResize: events.resize.on,
  };
  const select = (text: string, row = 2) => {
    model.text = text;
    model.start = { x: 0, y: row };
    model.end = { x: text.length, y: row };
    events.selection.fire();
  };
  const scrollTo = (viewportY: number) => {
    terminal.buffer.active.viewportY = viewportY;
    events.scroll.fire();
    events.write.fire();
  };
  return { terminal: terminal as never, events, select, scrollTo };
}

function mount() {
  const element = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  screen.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480 }) as DOMRect;
  element.append(screen);
  document.body.append(element);
  const fake = fakeTerminal();
  const reports: [TerminalSelection | null, SelectionCause][] = [];
  const live = { value: true };
  const follower = followSelection(
    fake.terminal,
    element,
    () => live.value,
    (selection, cause) => reports.push([selection, cause]),
  );
  const pointer = (type: string, target: EventTarget = element) =>
    target.dispatchEvent(new Event(type, { bubbles: true }));
  return { ...fake, element, reports, live, follower, pointer };
}

afterEach(() => document.body.replaceChildren());

describe('followSelection', () => {
  it('reports a dragged selection once, when the pointer lifts', () => {
    const { select, reports, pointer } = mount();
    pointer('pointerdown');
    select('pn');
    select('pnpm');
    select('pnpm check');
    expect(reports).toEqual([]);
    pointer('pointerup', document);
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toMatchObject({ text: 'pnpm check', canInsert: true });
    expect(reports[0]![0]!.end).toEqual({ left: 90, right: 100, top: 40, bottom: 60 });
  });

  it('reports the same settled selection only once', () => {
    const { select, events, reports, pointer } = mount();
    pointer('pointerdown');
    select('pnpm check');
    pointer('pointerup', document);
    events.selection.fire();
    expect(reports).toHaveLength(1);
  });

  it('reports a keyboard selection at once', () => {
    const { select, reports } = mount();
    select('whole screen');
    expect(reports.map(([selection]) => selection?.text)).toEqual(['whole screen']);
  });

  it('never reports an empty or whitespace selection', () => {
    const { select, reports, pointer } = mount();
    select('   ');
    pointer('pointerdown');
    pointer('pointerup', document);
    expect(reports).toEqual([]);
  });

  it('reports the selection clearing', () => {
    const { select, reports, pointer } = mount();
    select('pnpm check');
    pointer('pointerdown');
    select('');
    pointer('pointerup', document);
    expect(reports.at(-1)).toEqual([null, 'select']);
  });

  it('dismisses on typing and resize while a selection is reported', () => {
    const { select, events, reports } = mount();
    events.data.fire();
    expect(reports).toEqual([]);
    select('pnpm check');
    events.data.fire();
    select('pnpm test');
    events.resize.fire();
    select('pnpm lint');
    window.dispatchEvent(new Event('resize'));
    expect(reports.filter(([selection]) => selection === null)).toEqual([
      [null, 'input'],
      [null, 'resize'],
      [null, 'resize'],
    ]);
  });

  it('keeps the selection when output scrolls it, and reports where it is now', () => {
    const { select, scrollTo, reports } = mount();
    select('pnpm check', 10);
    scrollTo(4);
    expect(reports).toHaveLength(2);
    const first = reports[0]![0]!;
    const moved = reports[1]![0]!;
    expect(reports[1]![1]).toBe('update');
    expect(moved.text).toBe('pnpm check');
    expect(moved.start.top).toBe(first.start.top - 4 * 20);
  });

  it('reports nothing new when output arrives without moving the selection', () => {
    const { select, events, reports } = mount();
    select('pnpm check', 10);
    events.write.fire();
    events.write.fire();
    expect(reports).toHaveLength(1);
  });

  it('dismisses once output scrolls the selection out of view', () => {
    const { select, scrollTo, reports } = mount();
    select('pnpm check', 10);
    scrollTo(11);
    expect(reports.at(-1)).toEqual([null, 'scroll']);
    scrollTo(12);
    expect(reports).toHaveLength(2);
  });

  it('dismisses when the user scrolls with the wheel, the keyboard or the scrollbar', () => {
    const { select, scrollTo, element, reports, pointer } = mount();
    const scrollbar = document.createElement('div');
    scrollbar.className = 'scrollbar';
    element.append(scrollbar);
    select('pnpm check', 10);
    element.dispatchEvent(new Event('wheel', { bubbles: true }));
    scrollTo(3);
    select('pnpm test', 10);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', shiftKey: true }));
    select('pnpm lint', 10);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
    pointer('pointerdown', scrollbar);
    expect(reports.map(([selection, cause]) => [selection?.text ?? null, cause])).toEqual([
      ['pnpm check', 'select'],
      [null, 'scroll'],
      ['pnpm test', 'select'],
      [null, 'scroll'],
      ['pnpm lint', 'select'],
      [null, 'scroll'],
    ]);
  });

  it('shows the same selection again when it is made again after a dismissal', () => {
    const { select, events, reports } = mount();
    select('pnpm check');
    events.data.fire();
    select('pnpm check');
    expect(reports.map(([selection]) => selection?.text ?? null)).toEqual([
      'pnpm check',
      null,
      'pnpm check',
    ]);
  });

  it('stops offering insertion when the session ends while the selection is shown', () => {
    const { select, reports, live, follower } = mount();
    select('last output');
    live.value = false;
    follower.refresh();
    expect(reports.at(-1)).toEqual([expect.objectContaining({ canInsert: false }), 'update']);
    follower.refresh();
    expect(reports).toHaveLength(2);
  });

  it('marks a selection in a session that cannot take input', () => {
    const { select, reports, live } = mount();
    live.value = false;
    select('last output');
    expect(reports[0]![0]).toMatchObject({ text: 'last output', canInsert: false });
  });

  it('stops listening when unfollowed, and does nothing without a handler', () => {
    const { select, reports, follower, terminal, element } = mount();
    follower.stop();
    select('pnpm check');
    expect(reports).toEqual([]);
    expect(() => followSelection(terminal, element, () => true, undefined).stop()).not.toThrow();
  });
});

describe('selectionActions', () => {
  function target(bracketedPasteMode: boolean) {
    const terminal = {
      paste: vi.fn<(text: string) => void>(),
      focus: vi.fn<() => void>(),
      clearSelection: vi.fn<() => void>(),
      modes: { bracketedPasteMode },
    };
    return terminal;
  }

  it('pastes the cleaned text and returns focus to the terminal', () => {
    const terminal = target(true);
    const actions = selectionActions(terminal as never, () => true);
    expect(actions.insertSelection('ask', 'one\u001b[201~\r\ntwo')).toBe(true);
    expect(terminal.paste).toHaveBeenCalledWith('> one[201~\n> two\n\n');
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('pastes one line when the terminal has no bracketed paste', () => {
    const terminal = target(false);
    selectionActions(terminal as never, () => true).insertSelection('add', 'one\ntwo\n');
    expect(terminal.paste).toHaveBeenCalledWith('one two');
  });

  it('inserts nothing into a session that cannot take input', () => {
    const terminal = target(true);
    const actions = selectionActions(terminal as never, () => false);
    expect(actions.insertSelection('add', 'one')).toBe(false);
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it('clears the terminal selection', () => {
    const terminal = target(true);
    selectionActions(terminal as never, () => true).clearSelection();
    expect(terminal.clearSelection).toHaveBeenCalled();
  });
});
