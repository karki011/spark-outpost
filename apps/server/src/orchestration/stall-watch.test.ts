import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStallWatch, stallText } from './stall-watch.ts';

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

  it('says how long the member was quiet', () => {
    expect(stallText('Hawk', 600_000)).toBe('Hawk made no progress for 10 minutes');
    expect(stallText('Hawk', 50)).toBe('Hawk made no progress for 1 minute');
  });
});
