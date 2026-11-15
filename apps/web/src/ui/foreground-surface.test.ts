// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { escapeBelongsToSurface } from './foreground-surface.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function escapeOn(target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('escapeBelongsToSurface', () => {
  it('leaves Escape to an open modal dialog', () => {
    document.body.innerHTML = '<aside id="own"></aside><div role="dialog" aria-modal="true"></div>';
    const own = document.getElementById('own')!;
    expect(escapeBelongsToSurface(escapeOn(document.body), own)).toBe(true);
  });

  it('leaves Escape to a menu the key came from', () => {
    document.body.innerHTML =
      '<aside id="own"></aside><div role="menu"><button>Item</button></div>';
    const item = document.querySelector('button')!;
    expect(escapeBelongsToSurface(escapeOn(item), document.getElementById('own'))).toBe(true);
  });

  it('keeps Escape for a surface inside its own panel or with no surface open', () => {
    document.body.innerHTML = '<aside id="own"><div role="listbox"><i></i></div></aside><p></p>';
    const own = document.getElementById('own')!;
    expect(escapeBelongsToSurface(escapeOn(document.querySelector('i')!), own)).toBe(false);
    expect(escapeBelongsToSurface(escapeOn(document.querySelector('p')!), own)).toBe(false);
  });
});
