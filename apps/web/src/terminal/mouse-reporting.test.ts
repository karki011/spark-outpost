import { describe, expect, it } from 'vitest';
import { followMouseReporting, MOUSE_REPORTING_OFF } from './mouse-reporting.ts';

function fakeTerminal() {
  const listeners = new Set<() => void>();
  const terminal = {
    modes: { mouseTrackingMode: 'none' },
    onWriteParsed: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const wrote = (mode: string) => {
    terminal.modes.mouseTrackingMode = mode;
    listeners.forEach((listener) => listener());
  };
  return { terminal: terminal as never, wrote, listeners };
}

describe('followMouseReporting', () => {
  it('says when the agent turns mouse reporting on and off, once per change', () => {
    const { terminal, wrote } = fakeTerminal();
    const seen: boolean[] = [];
    followMouseReporting(terminal, (on) => seen.push(on));
    wrote('none');
    wrote('vt200');
    wrote('any');
    wrote('none');
    expect(seen).toEqual([true, false]);
  });

  it('stops listening when unfollowed, and listens to nothing without a handler', () => {
    const { terminal, wrote, listeners } = fakeTerminal();
    const seen: boolean[] = [];
    followMouseReporting(terminal, (on) => seen.push(on))();
    wrote('vt200');
    expect(seen).toEqual([]);
    followMouseReporting(terminal, undefined);
    expect(listeners.size).toBe(0);
  });

  it('turns off every mouse mode and focus reporting for an ended session', () => {
    for (const mode of ['1000', '1002', '1003', '1004', '1006']) {
      expect(MOUSE_REPORTING_OFF).toContain(`\x1b[?${mode}l`);
    }
  });
});
