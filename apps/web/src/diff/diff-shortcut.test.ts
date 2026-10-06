import { describe, expect, it } from 'vitest';
import { matchesDiffShortcut } from './diff-shortcut.ts';

const press = (keys: Partial<KeyboardEventInit> & { code?: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  code: 'KeyD',
  ...keys,
});

describe('matchesDiffShortcut', () => {
  it('matches Command+D on a Mac, with or without Shift', () => {
    expect(matchesDiffShortcut(press({ metaKey: true }), true)).toBe(true);
    expect(matchesDiffShortcut(press({ metaKey: true, shiftKey: true }), true)).toBe(true);
  });

  it('leaves Control+D alone on a Mac so text fields and shells keep it', () => {
    expect(matchesDiffShortcut(press({ ctrlKey: true }), true)).toBe(false);
    expect(matchesDiffShortcut(press({ ctrlKey: true, metaKey: true }), true)).toBe(false);
  });

  it('matches Control+D off a Mac, with or without Shift', () => {
    expect(matchesDiffShortcut(press({ ctrlKey: true }), false)).toBe(true);
    expect(matchesDiffShortcut(press({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(matchesDiffShortcut(press({ metaKey: true }), false)).toBe(false);
  });

  it('ignores a bare D, Alt chords and other keys', () => {
    expect(matchesDiffShortcut(press({}), true)).toBe(false);
    expect(matchesDiffShortcut(press({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(matchesDiffShortcut(press({ metaKey: true, code: 'KeyB' }), true)).toBe(false);
  });

  it('matches by key position, not by the letter the layout types', () => {
    expect(matchesDiffShortcut(press({ metaKey: true, code: 'KeyD', key: 'e' }), true)).toBe(true);
  });
});
