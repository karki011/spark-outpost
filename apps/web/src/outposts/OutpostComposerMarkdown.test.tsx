// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutpostComposer } from './OutpostComposer.tsx';
import type { ComposerTarget } from './composer-target.ts';
import { API_CHAT, FE_CHAT, memberView } from './test-fixtures.ts';

const MEMBERS = [memberView(FE_CHAT, 'fe'), memberView(API_CHAT, 'api')];

type Send = (target: ComposerTarget, text: string) => Promise<unknown>;

class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const onSend = vi.fn<Send>(() => Promise.resolve());
  render(
    <OutpostComposer
      members={MEMBERS}
      answering={null}
      paused={false}
      onCancelAnswer={() => undefined}
      onSend={onSend}
    />,
  );
  return onSend;
}

function box(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>('combobox');
}

function type(text: string, start = text.length, end = start): void {
  fireEvent.change(box(), { target: { value: text, selectionStart: start, selectionEnd: end } });
  box().setSelectionRange(start, end);
}

const SHORTCUT = { ctrlKey: true };

describe('the outpost box writes Markdown', () => {
  it('sends exactly the text that was typed, markers and spacing included', () => {
    const onSend = setup();
    const typed =
      '**Ship blocker:** the _export_  ignores `x()`\n\n- a\n> b\n```ts\nexpect(1)\n```\n ';
    type(typed);
    fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![1]).toBe(typed);
  });

  it('wraps and unwraps the selection with the bold, italic and strike shortcuts', () => {
    setup();
    type('make this bold', 5, 9);
    fireEvent.keyDown(box(), { key: 'b', code: 'KeyB', ...SHORTCUT });
    expect(box().value).toBe('make **this** bold');
    expect([box().selectionStart, box().selectionEnd]).toEqual([7, 11]);
    fireEvent.keyDown(box(), { key: 'b', code: 'KeyB', ...SHORTCUT });
    expect(box().value).toBe('make this bold');
    fireEvent.keyDown(box(), { key: 'i', code: 'KeyI', ...SHORTCUT });
    expect(box().value).toBe('make _this_ bold');
    box().setSelectionRange(6, 10);
    fireEvent.keyDown(box(), { key: 'x', code: 'KeyX', shiftKey: true, ...SHORTCUT });
    expect(box().value).toBe('make _~~this~~_ bold');
  });

  it('adds a line on Enter inside a code block and sends on Ctrl+Enter there', () => {
    const onSend = setup();
    type('```\nconst a = 1;');
    const enter = fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter' });
    expect(enter).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onSend.mock.calls[0]![1]).toBe('```\nconst a = 1;');
  });

  it('shows the formatting bar from the Aa button and formats from it', () => {
    setup();
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Formatting' }));
    const bar = screen.getByRole('toolbar', { name: 'Formatting' });
    type('item', 0, 4);
    fireEvent.click(bar.querySelector('[aria-label="Bulleted list"]')!);
    expect(box().value).toBe('- item');
    expect(screen.getByRole('button', { name: 'Formatting' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
