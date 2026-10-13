import { describe, expect, it } from 'vitest';
import { lineEditingSequence, tabAction } from './terminal-keys.ts';

const key = (overrides: Partial<Parameters<typeof lineEditingSequence>[0]>) => ({
  type: 'keydown',
  key: 'a',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  ...overrides,
});

describe('lineEditingSequence', () => {
  it('maps Mac line editing shortcuts to readline control keys', () => {
    expect(lineEditingSequence(key({ metaKey: true, key: 'Backspace' }))).toBe('\u0015');
    expect(lineEditingSequence(key({ metaKey: true, key: 'ArrowLeft' }))).toBe('\u0001');
    expect(lineEditingSequence(key({ metaKey: true, key: 'ArrowRight' }))).toBe('\u0005');
  });

  it('leaves ordinary keys, other modifiers, and IME composition to the terminal', () => {
    expect(lineEditingSequence(key({ key: 'Backspace' }))).toBeNull();
    expect(lineEditingSequence(key({ metaKey: true, ctrlKey: true, key: 'ArrowLeft' }))).toBeNull();
    expect(lineEditingSequence(key({ metaKey: true, key: 'c' }))).toBeNull();
    expect(
      lineEditingSequence(key({ metaKey: true, key: 'Backspace', isComposing: true })),
    ).toBeNull();
    expect(lineEditingSequence(key({ metaKey: true, key: 'Backspace', keyCode: 229 }))).toBeNull();
  });
});

describe('tabAction', () => {
  const tab = { key: 'Tab', altKey: false, ctrlKey: false, metaKey: false };

  it('sends Tab and Shift+Tab to the agent', () => {
    expect(tabAction(tab)).toBe('send');
    expect(tabAction({ ...tab, ctrlKey: true })).toBe('send');
  });

  it('leaves the terminal on Option+Tab', () => {
    expect(tabAction({ ...tab, altKey: true })).toBe('leave');
    expect(tabAction({ ...tab, altKey: true, metaKey: true })).toBe('send');
  });

  it('has nothing to say about other keys', () => {
    expect(tabAction({ ...tab, key: 'a' })).toBeNull();
  });
});
