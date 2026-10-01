import { describe, expect, it } from 'vitest';
import { acceleratorFromKey, matchesShortcut, shortcutLabel } from './shortcut-keys.ts';

const press = (
  code: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>,
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe('companion shortcut keys', () => {
  it('shows accelerators with Mac key symbols', () => {
    expect(shortcutLabel('Alt+Space')).toBe('⌥ Space');
    expect(shortcutLabel('Alt+Shift+Space')).toBe('⌥ ⇧ Space');
    expect(shortcutLabel('Command+Control+K')).toBe('⌘ ⌃ K');
  });

  it('records a pressed combination as an Electron accelerator', () => {
    expect(acceleratorFromKey(press('Space', { alt: true }))).toBe('Alt+Space');
    expect(acceleratorFromKey(press('KeyJ', { meta: true, shift: true }))).toBe('Command+Shift+J');
    expect(acceleratorFromKey(press('Digit3', { ctrl: true, alt: true }))).toBe('Control+Alt+3');
  });

  it('ignores bare keys, Shift alone and keys it cannot name', () => {
    expect(acceleratorFromKey(press('KeyJ', {}))).toBeNull();
    expect(acceleratorFromKey(press('KeyJ', { shift: true }))).toBeNull();
    expect(acceleratorFromKey(press('AltLeft', { alt: true }))).toBeNull();
  });

  it('matches the stand-in hotkeys in the browser', () => {
    expect(matchesShortcut('Alt+Shift+Space', press('Space', { alt: true, shift: true }))).toBe(
      true,
    );
    expect(matchesShortcut('Alt+Space', press('Space', { alt: true, shift: true }))).toBe(false);
  });
});
