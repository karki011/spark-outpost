import { describe, expect, it, vi } from 'vitest';
import { escapeGuard, ESCAPE } from './island-escape.ts';

function fakeKeys(free = true) {
  const held = new Map<string, () => void>();
  const keys = {
    register: vi.fn((accelerator: string, run: () => void) => {
      if (!free) return false;
      held.set(accelerator, run);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => held.delete(accelerator)),
  };
  return { keys, held };
}

describe('island Escape key', () => {
  it('holds Escape only while the island is open and hands it back on close', () => {
    const { keys, held } = fakeKeys();
    const onEscape = vi.fn();
    const guard = escapeGuard(keys, onEscape);
    expect(held.size).toBe(0);

    guard.arm(true);
    guard.arm(true);
    expect(keys.register).toHaveBeenCalledTimes(1);
    expect(guard.armed()).toBe(true);
    held.get(ESCAPE)!();
    expect(onEscape).toHaveBeenCalledTimes(1);

    guard.arm(false);
    guard.arm(false);
    expect(keys.unregister).toHaveBeenCalledTimes(1);
    expect(held.size).toBe(0);
    expect(guard.armed()).toBe(false);
  });

  it('stays disarmed when another app holds Escape', () => {
    const { keys } = fakeKeys(false);
    const guard = escapeGuard(keys, vi.fn());
    guard.arm(true);
    expect(guard.armed()).toBe(false);
    guard.arm(false);
    expect(keys.unregister).not.toHaveBeenCalled();
  });

  it('survives a register call that throws', () => {
    const guard = escapeGuard(
      {
        register: () => {
          throw new Error('bad accelerator');
        },
        unregister: vi.fn(),
      },
      vi.fn(),
    );
    guard.arm(true);
    expect(guard.armed()).toBe(false);
  });
});
