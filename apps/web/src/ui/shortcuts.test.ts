import { describe, expect, it } from 'vitest';
import { hasModifier, shortcutParts, shortcutText } from './shortcuts.ts';

describe('shortcut formatter', () => {
  it('keeps the Mac glyphs and order', () => {
    expect(shortcutText(['shift', 'mod', 'L'], true)).toBe('⇧⌘L');
    expect(shortcutText(['alt', 'mod', 'I'], true)).toBe('⌥⌘I');
    expect(shortcutText(['mod', 'J'], true, ' ')).toBe('⌘ J');
    expect(shortcutParts(['shift', 'mod', 'L'], true)).toEqual(['⇧', '⌘', 'L']);
  });

  it('names Ctrl, Alt and Shift on Windows in Windows order', () => {
    expect(shortcutText(['shift', 'mod', 'L'], false)).toBe('Ctrl+Shift+L');
    expect(shortcutText(['alt', 'mod', 'I'], false)).toBe('Ctrl+Alt+I');
    expect(shortcutText(['mod', 'J'], false, ' ')).toBe('Ctrl+J');
    expect(shortcutText(['mod', ','], false)).toBe('Ctrl+,');
    expect(shortcutParts(['shift', 'Enter'], false)).toEqual(['Shift', 'Enter']);
  });

  it('accepts Command on the Mac and Ctrl on Windows', () => {
    expect(hasModifier({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(hasModifier({ metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(hasModifier({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(hasModifier({ metaKey: true, ctrlKey: false }, false)).toBe(false);
  });
});
