import { describe, expect, it } from 'vitest';
import { createAppLockGate } from './app-lock-gate.ts';
import { hideWhileLocked } from './app-lock-windows.ts';

function fakeWindow(visible = true) {
  const listeners = new Map<string, () => void>();
  const window = {
    visible,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    isVisible: () => window.visible,
    hide: () => {
      window.visible = false;
    },
    showInactive: () => {
      window.visible = true;
      listeners.get('show')?.();
    },
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    close: () => {
      window.destroyed = true;
      listeners.get('closed')?.();
    },
  };
  return window;
}

const lock = (gate: ReturnType<typeof createAppLockGate>, locked: boolean) =>
  gate.publish({ locked, available: true, hideNotifications: true });

describe('a window the lock screen cannot cover', () => {
  it('is hidden while locked and comes back on unlock', () => {
    const gate = createAppLockGate();
    const window = fakeWindow();
    hideWhileLocked(window, gate);
    lock(gate, true);
    expect(window.visible).toBe(false);
    lock(gate, false);
    expect(window.visible).toBe(true);
  });

  it('is hidden at once when it opens while locked', () => {
    const gate = createAppLockGate();
    lock(gate, true);
    const window = fakeWindow();
    hideWhileLocked(window, gate);
    expect(window.visible).toBe(false);
    lock(gate, false);
    expect(window.visible).toBe(true);
  });

  it('is hidden again when something shows it while locked', () => {
    const gate = createAppLockGate();
    const window = fakeWindow(false);
    hideWhileLocked(window, gate);
    lock(gate, true);
    window.showInactive();
    expect(window.visible).toBe(false);
    lock(gate, false);
    expect(window.visible).toBe(true);
  });

  it('stays hidden after unlock when it was hidden before the lock', () => {
    const gate = createAppLockGate();
    const window = fakeWindow(false);
    hideWhileLocked(window, gate);
    lock(gate, true);
    lock(gate, false);
    expect(window.visible).toBe(false);
  });

  it('is left alone once it has closed', () => {
    const gate = createAppLockGate();
    const window = fakeWindow();
    hideWhileLocked(window, gate);
    lock(gate, true);
    window.close();
    lock(gate, false);
    expect(window.visible).toBe(false);
  });
});
