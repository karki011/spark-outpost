import { describe, expect, it } from 'vitest';
import {
  ariaShortcut,
  codeBlockEnter,
  formatShortcut,
  shortcutLabel,
  type KeyPress,
} from './md-keys.ts';

function press(code: string, keys: Partial<KeyPress> = {}): KeyPress {
  return {
    key: code.replace('Key', '').toLowerCase(),
    code,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...keys,
  };
}

describe('format shortcuts', () => {
  it('maps ⌘B, ⌘I and ⌘⇧X on a Mac and Ctrl on other systems', () => {
    expect(formatShortcut(press('KeyB', { metaKey: true }), true)).toBe('bold');
    expect(formatShortcut(press('KeyI', { metaKey: true }), true)).toBe('italic');
    expect(formatShortcut(press('KeyX', { metaKey: true, shiftKey: true }), true)).toBe('strike');
    expect(formatShortcut(press('KeyB', { ctrlKey: true }), false)).toBe('bold');
    expect(formatShortcut(press('KeyB', { ctrlKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyB', { metaKey: true }), false)).toBeNull();
  });

  it('leaves code, links and other chords to the app and the system', () => {
    expect(formatShortcut(press('KeyE', { metaKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyK', { metaKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyX', { metaKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyB', { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyB', { metaKey: true, altKey: true }), true)).toBeNull();
    expect(formatShortcut(press('KeyB'), true)).toBeNull();
  });

  it('labels the keys for people and for screen readers', () => {
    expect(shortcutLabel('bold', true)).toBe('⌘B');
    expect(shortcutLabel('strike', true)).toBe('⌘⇧X');
    expect(shortcutLabel('strike', false)).toBe('Ctrl+Shift+X');
    expect(shortcutLabel('link', true)).toBeNull();
    expect(ariaShortcut('italic', true)).toBe('Meta+I');
    expect(ariaShortcut('code', true)).toBeUndefined();
  });
});

describe('Enter in a code block', () => {
  const box = (value: string, selectionStart: number) => ({ value, selectionStart });
  const enter = (keys: Partial<KeyPress> = {}) => ({ ...press('Enter'), key: 'Enter', ...keys });

  it('adds a line inside a block and sends with ⌘Enter or Ctrl+Enter', () => {
    const text = '```\ncode';
    expect(codeBlockEnter(enter(), box(text, text.length))).toBe('newline');
    expect(codeBlockEnter(enter({ metaKey: true }), box(text, text.length))).toBe('send');
    expect(codeBlockEnter(enter({ ctrlKey: true }), box(text, text.length))).toBe('send');
  });

  it('leaves Enter alone outside a block and for Shift+Enter', () => {
    expect(codeBlockEnter(enter(), box('plain', 5))).toBeNull();
    expect(codeBlockEnter(enter(), box('```\na\n```', 9))).toBeNull();
    expect(codeBlockEnter(enter({ shiftKey: true }), box('```\na', 5))).toBeNull();
    expect(codeBlockEnter(press('KeyA'), box('```\na', 5))).toBeNull();
  });
});
