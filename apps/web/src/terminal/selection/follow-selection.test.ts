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
  const events = { selection: emitter(), scroll: emitter(), data: emitter(), resize: emitter() };
  const model = { text: '', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
  const terminal = {
    cols: 80,
    rows: 24,
    buffer: { active: { viewportY: 0 } },
    getSelection: () => model.text,
    getSelectionPosition: () => (model.text ? { start: model.start, end: model.end } : undefined),
    onSelectionChange: events.selection.on,
    onScroll: events.scroll.on,
    onData: events.data.on,
    onResize: events.resize.on,
  };
  const select = (text: string, row = 2) => {
    model.text = text;
    model.start = { x: 0, y: row };
    model.end = { x: text.length, y: row };
    events.selection.fire();
  };
  return { terminal: terminal as never, events, select };
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
  const stop = followSelection(
    fake.terminal,
    element,
    () => live.value,
    (selection, cause) => reports.push([selection, cause]),
  );
  const pointer = (type: string, target: EventTarget = element) =>
    target.dispatchEvent(new Event(type, { bubbles: true }));
  return { ...fake, element, reports, live, stop, pointer };
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

  it('dismisses on scroll, typing and resize while a selection is reported', () => {
    const { select, events, reports } = mount();
    events.scroll.fire();
    expect(reports).toEqual([]);
    select('pnpm check');
    events.scroll.fire();
    events.data.fire();
    events.resize.fire();
    window.dispatchEvent(new Event('resize'));
    expect(reports.slice(1)).toEqual([
      [null, 'scroll'],
      [null, 'input'],
      [null, 'resize'],
      [null, 'resize'],
    ]);
  });

  it('marks a selection in a session that cannot take input', () => {
    const { select, reports, live } = mount();
    live.value = false;
    select('last output');
    expect(reports[0]![0]).toMatchObject({ text: 'last output', canInsert: false });
  });

  it('stops listening when unfollowed, and does nothing without a handler', () => {
    const { select, reports, stop, terminal, element } = mount();
    stop();
    select('pnpm check');
    expect(reports).toEqual([]);
    expect(() => followSelection(terminal, element, () => true, undefined)()).not.toThrow();
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
