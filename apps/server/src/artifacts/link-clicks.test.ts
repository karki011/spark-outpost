import { describe, expect, it } from 'vitest';
import { LINK_CLICKS, withLinkClicks } from './link-clicks.ts';

describe('withLinkClicks', () => {
  it('goes after a leading doctype so the page keeps standards mode', () => {
    expect(withLinkClicks('  <!DOCTYPE html><p>x</p>')).toBe(
      `  <!DOCTYPE html>${LINK_CLICKS}<p>x</p>`,
    );
  });

  it('goes first in a page without a doctype', () => {
    expect(withLinkClicks('<p>x</p>')).toBe(`${LINK_CLICKS}<p>x</p>`);
  });
});
