import { describe, expect, it, vi } from 'vitest';
import { createAppLockGate } from './app-lock-gate.ts';

const view = (locked: boolean, available = true, hideNotifications = true) => ({
  locked,
  available,
  hideNotifications,
});

describe('the lock seam other windows read', () => {
  it('starts open, unavailable and with nothing to lock', () => {
    const gate = createAppLockGate();
    expect(gate.locked()).toBe(false);
    expect(gate.available()).toBe(false);
    expect(gate.hidesNotices()).toBe(false);
    expect(() => gate.lockNow()).not.toThrow();
  });

  it('tells lock listeners only when the lock flips', () => {
    const gate = createAppLockGate();
    const flips: boolean[] = [];
    gate.onLockedChange((locked) => flips.push(locked));
    gate.publish(view(false));
    gate.publish(view(true));
    gate.publish(view(true, true, false));
    gate.publish(view(false));
    expect(flips).toEqual([true, false]);
  });

  it('tells change listeners about every change and nothing for a repeat', () => {
    const gate = createAppLockGate();
    const changed = vi.fn();
    gate.onChange(changed);
    gate.publish(view(false));
    gate.publish(view(false));
    gate.publish(view(false, false));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(gate.available()).toBe(false);
  });

  it('hides notification details only while locked with that setting on', () => {
    const gate = createAppLockGate();
    gate.publish(view(true));
    expect(gate.hidesNotices()).toBe(true);
    gate.publish(view(true, true, false));
    expect(gate.hidesNotices()).toBe(false);
    gate.publish(view(false));
    expect(gate.hidesNotices()).toBe(false);
  });

  it('stops telling a listener that left, and one failing listener does not silence the rest', () => {
    const gate = createAppLockGate();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const left = vi.fn();
    const stayed = vi.fn();
    gate.onLockedChange(left)();
    gate.onLockedChange(() => {
      throw new Error('broken');
    });
    gate.onLockedChange(stayed);
    gate.publish(view(true));
    expect(left).not.toHaveBeenCalled();
    expect(stayed).toHaveBeenCalledWith(true);
    error.mockRestore();
  });

  it('passes Lock Spark Outpost to whoever serves it', () => {
    const gate = createAppLockGate();
    const lockNow = vi.fn();
    gate.serve(lockNow);
    gate.lockNow();
    gate.serve(null);
    gate.lockNow();
    expect(lockNow).toHaveBeenCalledTimes(1);
  });
});
