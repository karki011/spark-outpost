import { describe, expect, it } from 'vitest';
import { browserShortcut, shortcutTabIndex, type ShortcutChord } from './browser-keys.ts';

const chord = (code: string, change: Partial<ShortcutChord> = {}): ShortcutChord => ({
  code,
  meta: true,
  ctrl: false,
  shift: false,
  alt: false,
  composing: false,
  ...change,
});

describe('Browser pane shortcuts', () => {
  it.each([
    ['KeyC', true, 'copy_url'],
    ['KeyT', false, 'new_tab'],
    ['KeyW', false, 'close_tab'],
    ['KeyT', true, 'reopen_tab'],
    ['KeyL', false, 'focus_address'],
    ['KeyR', false, 'reload'],
    ['KeyR', true, 'hard_reload'],
    ['BracketLeft', false, 'back'],
    ['BracketRight', false, 'forward'],
    ['Digit1', false, 'tab_1'],
    ['Digit8', false, 'tab_8'],
    ['Digit9', false, 'last_tab'],
    ['KeyF', false, 'find'],
  ] as const)('maps ⌘ %s (shift %s) to %s on a Mac', (code, shift, expected) => {
    expect(browserShortcut(chord(code, { shift }), true)).toBe(expected);
  });

  it('switches tabs with Control Tab and Control Shift Tab', () => {
    const ctrlTab = chord('Tab', { meta: false, ctrl: true });
    expect(browserShortcut(ctrlTab, true)).toBe('next_tab');
    expect(browserShortcut({ ...ctrlTab, shift: true }, true)).toBe('previous_tab');
    expect(browserShortcut({ ...ctrlTab, shift: true }, false)).toBe('previous_tab');
    expect(browserShortcut(chord('Tab'), true)).toBeNull();
  });

  it('leaves copy, cut, paste, select all and undo to the page or field', () => {
    for (const code of ['KeyC', 'KeyX', 'KeyV', 'KeyA', 'KeyZ']) {
      expect(browserShortcut(chord(code), true), code).toBeNull();
    }
  });

  it('ignores keys while an input method is composing', () => {
    expect(browserShortcut(chord('KeyT', { composing: true }), true)).toBeNull();
    expect(
      browserShortcut(chord('Tab', { meta: false, ctrl: true, composing: true }), true),
    ).toBeNull();
  });

  it('needs exactly the primary modifier', () => {
    expect(browserShortcut(chord('KeyT', { meta: false }), true)).toBeNull();
    expect(browserShortcut(chord('KeyT', { alt: true }), true)).toBeNull();
    expect(browserShortcut(chord('KeyT', { ctrl: true }), true)).toBeNull();
    expect(browserShortcut(chord('KeyF', { shift: true }), true)).toBeNull();
    expect(browserShortcut(chord('KeyT', { meta: false, ctrl: true }), false)).toBe('new_tab');
    expect(browserShortcut(chord('KeyT'), false)).toBeNull();
  });

  it('picks the tab a shortcut goes to', () => {
    expect(shortcutTabIndex('tab_1', 2, 4)).toBe(0);
    expect(shortcutTabIndex('tab_5', 0, 4)).toBeNull();
    expect(shortcutTabIndex('last_tab', 0, 4)).toBe(3);
    expect(shortcutTabIndex('next_tab', 3, 4)).toBe(0);
    expect(shortcutTabIndex('previous_tab', 0, 4)).toBe(3);
    expect(shortcutTabIndex('next_tab', 0, 0)).toBeNull();
    expect(shortcutTabIndex('reload', 0, 4)).toBeNull();
  });
});
