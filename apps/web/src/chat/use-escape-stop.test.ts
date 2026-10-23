// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { stopsOnEscape } from './use-escape-stop.ts';

function press(target: Element, init: KeyboardEventInit = {}): boolean {
  let stops = false;
  const listen = (event: Event) => {
    stops = stopsOnEscape(event as KeyboardEvent);
  };
  window.addEventListener('keydown', listen);
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...init }));
  window.removeEventListener('keydown', listen);
  return stops;
}

function mount(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Escape stops the turn', () => {
  it('stops from the composer and from the thread', () => {
    mount(
      '<div class="thread"><button id="row">Row</button></div><form class="composer"><textarea></textarea></form>',
    );
    expect(press(document.querySelector('textarea')!)).toBe(true);
    expect(press(document.getElementById('row')!)).toBe(true);
  });

  it('leaves Escape to a card, a dialog, a menu or another field', () => {
    mount(
      '<div class="thread"><section class="appr"><button id="deny">Deny</button></section><input id="field"></div><div role="dialog"><button id="close">Close</button></div><div role="menu"><button id="item">Item</button></div>',
    );
    for (const id of ['deny', 'field', 'close', 'item']) {
      expect(press(document.getElementById(id)!)).toBe(false);
    }
  });

  it('ignores Escape that something else already handled, or with a modifier', () => {
    mount('<form class="composer"><textarea></textarea></form>');
    const textarea = document.querySelector('textarea')!;
    textarea.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    expect(press(textarea, { cancelable: true })).toBe(false);
    expect(press(textarea, { shiftKey: true })).toBe(false);
  });
});
