import { describe, expect, it, vi } from 'vitest';
import { assistiveTechOn, parseDefaultsFlag } from './assistive-tech.ts';

vi.mock('electron', () => ({ app: {}, systemPreferences: {} }));

const NONE = { axClient: false, keyboardUIMode: 0, fullKeyboardAccess: false, fake: false };

describe('assistive technology detection', () => {
  it('is off for a plain mouse and trackpad setup', () => {
    expect(assistiveTechOn(NONE)).toBe(false);
  });

  it('turns on for VoiceOver or another accessibility client', () => {
    expect(assistiveTechOn({ ...NONE, axClient: true })).toBe(true);
  });

  it('turns on for Full Keyboard Access', () => {
    expect(assistiveTechOn({ ...NONE, fullKeyboardAccess: true })).toBe(true);
  });

  it('turns on for the system keyboard navigation setting', () => {
    expect(assistiveTechOn({ ...NONE, keyboardUIMode: 2 })).toBe(true);
    expect(assistiveTechOn({ ...NONE, keyboardUIMode: 3 })).toBe(true);
    expect(assistiveTechOn({ ...NONE, keyboardUIMode: 1 })).toBe(false);
  });

  it('can be simulated in a dev app', () => {
    expect(assistiveTechOn({ ...NONE, fake: true })).toBe(true);
  });

  it('reads the defaults flag only when it is exactly on', () => {
    expect(parseDefaultsFlag('1\n')).toBe(true);
    expect(parseDefaultsFlag('0\n')).toBe(false);
    expect(parseDefaultsFlag('')).toBe(false);
  });
});
