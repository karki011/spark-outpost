import { describe, expect, it } from 'vitest';
import { browserShortcut, type ShortcutChord } from './browser-keys.ts';
import { browserZoomPercent, movedTabs, nextBrowserZoom } from './browser-tab-basics.ts';

const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const order = (before: string | null, id = 'a') =>
  movedTabs(tabs, id, before)
    .map((tab) => tab.id)
    .join('');

function chord(code: string, change: Partial<ShortcutChord> = {}): ShortcutChord {
  return { code, meta: true, ctrl: false, shift: false, alt: false, composing: false, ...change };
}

describe('page zoom steps', () => {
  it('walks the steps and stops at the ends', () => {
    expect(nextBrowserZoom(1, 'in')).toBe(1.1);
    expect(nextBrowserZoom(1, 'out')).toBe(0.9);
    expect(nextBrowserZoom(3, 'in')).toBe(3);
    expect(nextBrowserZoom(0.5, 'out')).toBe(0.5);
    expect(nextBrowserZoom(2.5, 'reset')).toBe(1);
  });

  it('finds the next step from a value between steps', () => {
    expect(nextBrowserZoom(1.2, 'in')).toBe(1.25);
    expect(nextBrowserZoom(1.2, 'out')).toBe(1.1);
  });

  it('says the zoom as a percentage', () => {
    expect(browserZoomPercent(0.67)).toBe('67%');
    expect(browserZoomPercent(1.25)).toBe('125%');
  });
});

describe('moving a tab', () => {
  it('moves before another tab or to the end', () => {
    expect(order('c')).toBe('bac');
    expect(order(null)).toBe('bca');
    expect(order('a', 'c')).toBe('cab');
  });

  it('changes nothing for itself, or a tab that is gone', () => {
    expect(order('a')).toBe('abc');
    expect(order('x')).toBe('abc');
    expect(order('a', 'x')).toBe('abc');
  });
});

describe('the tab basics keys', () => {
  const key = (code: string, change?: Partial<ShortcutChord>) =>
    browserShortcut(chord(code, change), true);

  it('zoom with Command and plus, minus and zero on either key row', () => {
    expect(key('Equal')).toBe('zoom_in');
    expect(key('Equal', { shift: true })).toBe('zoom_in');
    expect(key('NumpadAdd')).toBe('zoom_in');
    expect(key('Minus')).toBe('zoom_out');
    expect(key('NumpadSubtract')).toBe('zoom_out');
    expect(key('Digit0')).toBe('zoom_reset');
    expect(key('Numpad0')).toBe('zoom_reset');
  });

  it('print with Command-P only', () => {
    expect(key('KeyP')).toBe('print');
    expect(key('KeyP', { shift: true })).toBeNull();
    expect(key('KeyP', { meta: false })).toBeNull();
    expect(key('KeyP', { alt: true })).toBeNull();
  });
});
