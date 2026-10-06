import { describe, expect, it } from 'vitest';
import { ClientFocus } from './client-focus.ts';

function clocked() {
  const clock = { at: 0 };
  return { clock, focus: new ClientFocus(() => clock.at, 45_000) };
}

describe('client focus', () => {
  it('stays focused while another client is, after one blurs', () => {
    const { focus } = clocked();
    focus.set('local:window', true);
    focus.set('device:phone', true);
    focus.set('local:window', false);
    expect(focus.anyFocused()).toBe(true);
    expect(focus.focusedClients()).toEqual(['device:phone']);

    focus.set('device:phone', false);
    expect(focus.anyFocused()).toBe(false);
  });

  it('ignores a blur from a client that was never focused', () => {
    const { focus } = clocked();
    focus.set('local:window', true);
    focus.set('device:phone', false);
    expect(focus.anyFocused()).toBe(true);
  });

  it('forgets a client that stops reporting', () => {
    const { clock, focus } = clocked();
    focus.set('local:window', true);
    clock.at = 30_000;
    focus.set('device:phone', true);
    clock.at = 45_000;
    expect(focus.focusedClients()).toEqual(['device:phone']);
    clock.at = 75_000;
    expect(focus.anyFocused()).toBe(false);
  });
});
