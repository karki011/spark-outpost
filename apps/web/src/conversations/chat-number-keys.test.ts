// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { chatAtNumber, chatNumber, chatNumbers, listedChatIds } from './chat-number-keys.ts';

type Chord = Parameters<typeof chatNumber>[0];

function chord(overrides: Partial<Chord> = {}): Chord {
  return {
    code: 'Digit2',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: () => false,
    ...overrides,
  };
}

describe('chatNumber', () => {
  it('reads Command+digit on a Mac and Ctrl+digit elsewhere', () => {
    expect(chatNumber(chord({ metaKey: true }), true)).toBe(2);
    expect(chatNumber(chord({ metaKey: true, code: 'Digit9' }), true)).toBe(9);
    expect(chatNumber(chord({ ctrlKey: true }), false)).toBe(2);
  });

  it('leaves other chords alone', () => {
    expect(chatNumber(chord({ ctrlKey: true }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true }), false)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, altKey: true }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, repeat: true }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, isComposing: true }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, code: 'Digit0' }), true)).toBeNull();
    expect(chatNumber(chord({ metaKey: true, code: 'KeyA' }), true)).toBeNull();
    const altGraph = chord({ ctrlKey: true, getModifierState: (key) => key === 'AltGraph' });
    expect(chatNumber(altGraph, false)).toBeNull();
  });
});

describe('chatAtNumber', () => {
  const ids = ['a', 'b', 'c'];

  it('opens the chat at that place and 9 opens the last one', () => {
    expect(chatAtNumber(ids, 1)).toBe('a');
    expect(chatAtNumber(ids, 3)).toBe('c');
    expect(chatAtNumber(ids, 9)).toBe('c');
  });

  it('does nothing past the end of the list', () => {
    expect(chatAtNumber(ids, 4)).toBeNull();
    expect(chatAtNumber([], 9)).toBeNull();
  });
});

describe('chatNumbers', () => {
  it('numbers the first eight and gives 9 to the last only past eight chats', () => {
    expect([...chatNumbers(['a', 'b', 'c'])]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    const many = Array.from({ length: 11 }, (_, index) => `c${index + 1}`);
    const numbers = chatNumbers(many);
    expect(numbers.get('c8')).toBe(8);
    expect(numbers.has('c9')).toBe(false);
    expect(numbers.get('c11')).toBe(9);
  });
});

describe('listedChatIds', () => {
  it('lists rows in order, skipping folded groups even when the sidebar is hidden', () => {
    const side = document.createElement('nav');
    side.setAttribute('inert', '');
    side.innerHTML = `
      <div class="list">
        <div data-chat="pinned"></div>
        <div class="pbody" inert><div data-chat="folded"></div></div>
        <div class="pbody"><div data-chat="open"></div></div>
        <div data-chat="loose"></div>
        <div data-chat="open"></div>
      </div>`;
    document.body.append(side);
    const list = side.querySelector<HTMLElement>('.list')!;
    expect(listedChatIds(list)).toEqual(['pinned', 'open', 'loose']);
    side.remove();
  });
});
