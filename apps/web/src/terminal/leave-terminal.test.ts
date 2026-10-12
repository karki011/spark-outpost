// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusBeside } from './leave-terminal.ts';

function page() {
  document.body.innerHTML = `
    <button id="bar">Focus terminal</button>
    <button id="roving" tabindex="-1">Ask</button>
    <div id="terminal"><textarea id="input"></textarea></div>
    <button id="off" disabled>Stop</button>
    <div hidden><button id="hidden">Hidden</button></div>
    <textarea id="message"></textarea>`;
  const terminal = document.getElementById('terminal')!;
  document.getElementById('input')!.focus();
  return terminal;
}

afterEach(() => document.body.replaceChildren());

describe('focusBeside', () => {
  it('moves focus to the next control after the terminal', () => {
    expect(focusBeside(page(), false)).toBe(true);
    expect(document.activeElement?.id).toBe('message');
  });

  it('moves focus to the control before the terminal when going back', () => {
    focusBeside(page(), true);
    expect(document.activeElement?.id).toBe('bar');
  });

  it('wraps around when nothing follows the terminal', () => {
    const terminal = page();
    document.getElementById('message')!.remove();
    focusBeside(terminal, false);
    expect(document.activeElement?.id).toBe('bar');
  });

  it('stays put when the terminal is the only control', () => {
    document.body.innerHTML = '<div id="terminal"><textarea id="input"></textarea></div>';
    document.getElementById('input')!.focus();
    expect(focusBeside(document.getElementById('terminal')!, false)).toBe(false);
    expect(document.activeElement?.id).toBe('input');
  });
});
