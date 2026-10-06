import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStallWatch, quietNotice } from './stall-watch.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('stall watch', () => {
  it('trips once after the quiet time and not while output keeps arriving', () => {
    const onStall = vi.fn();
    const watch = createStallWatch(1_000, onStall);
    vi.advanceTimersByTime(900);
    watch.touch();
    vi.advanceTimersByTime(900);
    expect(watch.stalled()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(watch.stalled()).toBe(true);
    watch.touch();
    vi.advanceTimersByTime(5_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('never trips once stopped, or when no time is set', () => {
    const onStall = vi.fn();
    const watch = createStallWatch(1_000, onStall);
    watch.stop();
    const off = createStallWatch(null, onStall);
    vi.advanceTimersByTime(10_000);
    expect(watch.stalled()).toBe(false);
    expect(off.stalled()).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('says how long the member was quiet, without saying it stopped', () => {
    expect(quietNotice('Hawk', 600_000)).toBe(
      'Hawk has shown no progress for 10 minutes; still waiting',
    );
    expect(quietNotice('Hawk', 50)).toBe('Hawk has shown no progress for 1 minute; still waiting');
  });
});
