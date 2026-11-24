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
    expect(shortcutLabel('Alt+Space', true)).toBe('⌥ Space');
    expect(shortcutLabel('Alt+Shift+Space', true)).toBe('⌥ ⇧ Space');
    expect(shortcutLabel('Command+Control+K', true)).toBe('⌘ ⌃ K');
  });

  it('names the keys on Windows', () => {
    expect(shortcutLabel('Control+Shift+Space', false)).toBe('Ctrl+Shift+Space');
    expect(shortcutLabel('Alt+Shift+Space', false)).toBe('Alt+Shift+Space');
    expect(shortcutLabel('CommandOrControl+K', false)).toBe('Ctrl+K');
    expect(shortcutLabel('Super+K', false)).toBe('Win+K');
  });

  it('records the Windows key as Super on Windows and Command on the Mac', () => {
    expect(acceleratorFromKey(press('KeyJ', { meta: true }), false)).toBe('Super+J');
    expect(acceleratorFromKey(press('KeyJ', { meta: true }), true)).toBe('Command+J');
  });

  it('records a pressed combination as an Electron accelerator', () => {
    expect(acceleratorFromKey(press('Space', { alt: true }))).toBe('Alt+Space');
    expect(acceleratorFromKey(press('KeyJ', { meta: true, shift: true }), true)).toBe(
      'Command+Shift+J',
    );
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
