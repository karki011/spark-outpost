import { describe, expect, it } from 'vitest';
import { islandVisibility, type VisibilityTimers } from './island-visibility.ts';

function setup() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: VisibilityTimers = {
    set: (run) => {
      next += 1;
      pending.set(next, run);
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const calls: string[] = [];
  const visibility = islandVisibility(
    { show: () => calls.push('show'), hide: () => calls.push('hide') },
    180,
    timers,
  );
  const settle = () => {
    for (const [id, run] of [...pending]) {
      pending.delete(id);
      run();
    }
  };
  return { visibility, calls, settle, pending };
}

describe('hiding the island while Spark is focused', () => {
  it('hides once focus has settled on Spark and shows again when it leaves', () => {
    const { visibility, calls, settle } = setup();
    visibility.sparkFocus(true);
    expect(calls).toEqual([]);
    settle();
    expect(calls).toEqual(['hide']);
    expect(visibility.hidden()).toBe(true);
    visibility.sparkFocus(false);
    settle();
    expect(calls).toEqual(['hide', 'show']);
    expect(visibility.hidden()).toBe(false);
  });

  it('does nothing when focus only flickers', () => {
    const { visibility, calls, settle, pending } = setup();
    visibility.sparkFocus(true);
    visibility.sparkFocus(false);
    expect(pending.size).toBe(0);
    settle();
    expect(calls).toEqual([]);
    visibility.sparkFocus(true);
    settle();
    visibility.sparkFocus(false);
    visibility.sparkFocus(true);
    settle();
    expect(calls).toEqual(['hide']);
  });

  it('shows at once when a shortcut asks for it, and hides again on the next focus', () => {
    const { visibility, calls, settle } = setup();
    visibility.sparkFocus(true);
    settle();
    visibility.summon();
    expect(calls).toEqual(['hide', 'show']);
    visibility.summon();
    expect(calls).toEqual(['hide', 'show']);
    visibility.sparkFocus(true);
    settle();
    expect(calls).toEqual(['hide', 'show', 'hide']);
  });

  it('drops a pending change when the window goes away', () => {
    const { visibility, calls, settle } = setup();
    visibility.sparkFocus(true);
    visibility.cancel();
    settle();
    expect(calls).toEqual([]);
  });
});
