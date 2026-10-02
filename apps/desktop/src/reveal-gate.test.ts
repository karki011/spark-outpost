import { describe, expect, it } from 'vitest';
import { revealGate, type RevealTimers } from './reveal-gate.ts';

function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: RevealTimers = {
    set: (run) => {
      next += 1;
      pending.set(next, run);
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fire = () => {
    for (const [id, run] of [...pending]) {
      pending.delete(id);
      run();
    }
  };
  return { timers, fire, pending };
}

describe('revealGate', () => {
  it('stays hidden until the page says it has painted', () => {
    const { timers } = manualTimers();
    let shown = 0;
    const gate = revealGate(() => (shown += 1), 8_000, timers);
    expect(shown).toBe(0);
    expect(gate.revealed()).toBe(false);
    gate.ready();
    expect(shown).toBe(1);
    expect(gate.revealed()).toBe(true);
  });

  it('shows only once however often the page reports ready', () => {
    const { timers, fire } = manualTimers();
    let shown = 0;
    const gate = revealGate(() => (shown += 1), 8_000, timers);
    gate.ready();
    gate.ready();
    fire();
    expect(shown).toBe(1);
  });

  it('cancels the fallback once shown', () => {
    const { timers, pending } = manualTimers();
    const gate = revealGate(() => undefined, 8_000, timers);
    expect(pending.size).toBe(1);
    gate.ready();
    expect(pending.size).toBe(0);
  });

  it('falls back to showing when the page never reports', () => {
    const { timers, fire } = manualTimers();
    let shown = 0;
    const gate = revealGate(() => (shown += 1), 8_000, timers);
    fire();
    expect(shown).toBe(1);
    expect(gate.revealed()).toBe(true);
  });

  it('never shows a window that closed before it was ready', () => {
    const { timers, fire } = manualTimers();
    let shown = 0;
    const gate = revealGate(() => (shown += 1), 8_000, timers);
    gate.cancel();
    gate.ready();
    fire();
    expect(shown).toBe(0);
  });
});
