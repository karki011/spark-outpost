import { describe, expect, it } from 'vitest';
import { OptionKey, shiftedLinkClick } from './link-gesture.ts';

const NOW = 100_000;
const SHIFT_CLICK = { disposition: 'new-window', features: '' };

describe('a Shift-click on a link', () => {
  it('is a new-window open with no features, just after the user clicked', () => {
    expect(shiftedLinkClick(SHIFT_CLICK, NOW - 5, NOW)).toBe(true);
  });

  it('leaves a page popup and other opens as ordinary tabs', () => {
    const popup = { disposition: 'new-window', features: 'width=500,height=600' };
    expect(shiftedLinkClick(popup, NOW - 5, NOW)).toBe(false);
    expect(shiftedLinkClick({ disposition: 'foreground-tab', features: '' }, NOW - 5, NOW)).toBe(
      false,
    );
    expect(shiftedLinkClick({ disposition: 'background-tab', features: '' }, NOW - 5, NOW)).toBe(
      false,
    );
  });

  it('needs a click just now', () => {
    expect(shiftedLinkClick(SHIFT_CLICK, null, NOW)).toBe(false);
    expect(shiftedLinkClick(SHIFT_CLICK, NOW - 5000, NOW)).toBe(false);
  });
});

describe('the Option key', () => {
  const key = (type: string, name: string, alt: boolean) => ({ type, key: name, alt });

  it('is held from its key down to its key up', () => {
    const option = new OptionKey();
    expect(option.held(NOW)).toBe(false);
    option.note(key('rawKeyDown', 'Alt', true), NOW);
    expect(option.held(NOW + 50)).toBe(true);
    option.note(key('keyUp', 'Alt', false), NOW + 60);
    expect(option.held(NOW + 70)).toBe(false);
  });

  it('forgets a key up it never saw', () => {
    const option = new OptionKey();
    option.note(key('rawKeyDown', 'Alt', true), NOW);
    option.note(key('rawKeyDown', 'a', false), NOW + 10);
    expect(option.held(NOW + 20)).toBe(false);
    option.note(key('rawKeyDown', 'Alt', true), NOW);
    expect(option.held(NOW + 60_000)).toBe(false);
  });

  it('stays held through other keys pressed with it', () => {
    const option = new OptionKey();
    option.note(key('rawKeyDown', 'Alt', true), NOW);
    option.note(key('rawKeyDown', 'Shift', true), NOW + 10);
    expect(option.held(NOW + 20)).toBe(true);
  });
});
