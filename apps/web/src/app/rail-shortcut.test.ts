import { describe, expect, it } from 'vitest';
import { railShortcutNumber } from './rail-shortcut.ts';

type Chord = Parameters<typeof railShortcutNumber>[0];

function chord(overrides: Partial<Chord> = {}): Chord {
  return {
    code: 'Digit2',
    metaKey: false,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: () => false,
    ...overrides,
  };
}

describe('railShortcutNumber', () => {
  it('reads Option+Command+digit on a Mac', () => {
    expect(railShortcutNumber(chord({ metaKey: true }), true)).toBe(2);
    expect(railShortcutNumber(chord({ metaKey: true, code: 'Digit9' }), true)).toBe(9);
  });

  it('reads Ctrl+Alt+digit elsewhere', () => {
    expect(railShortcutNumber(chord({ ctrlKey: true }), false)).toBe(2);
  });

  it('does not mix the platform modifiers', () => {
    expect(railShortcutNumber(chord({ ctrlKey: true }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true }), false)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, ctrlKey: true }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it('needs Alt', () => {
    expect(railShortcutNumber(chord({ metaKey: true, altKey: false }), true)).toBeNull();
    expect(railShortcutNumber(chord({ ctrlKey: true, altKey: false }), false)).toBeNull();
  });

  it('matches the physical key, not the typed character', () => {
    expect(railShortcutNumber(chord({ metaKey: true, code: 'Digit3' }), true)).toBe(3);
    expect(railShortcutNumber(chord({ metaKey: true, code: 'Numpad2' }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, code: 'Digit0' }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, code: 'KeyA' }), true)).toBeNull();
  });

  it('ignores Shift, repeats, composition and AltGr', () => {
    expect(railShortcutNumber(chord({ metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, repeat: true }), true)).toBeNull();
    expect(railShortcutNumber(chord({ metaKey: true, isComposing: true }), true)).toBeNull();
    const altGraph = chord({
      ctrlKey: true,
      getModifierState: (key: string) => key === 'AltGraph',
    });
    expect(railShortcutNumber(altGraph, false)).toBeNull();
  });
});
