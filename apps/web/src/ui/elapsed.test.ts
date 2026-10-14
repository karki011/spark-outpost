import { describe, expect, it } from 'vitest';
import { formatElapsed } from './elapsed.ts';

describe('Elapsed time', () => {
  it('shows seconds, then minutes with padded seconds, then hours with padded minutes', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(-500)).toBe('0s');
    expect(formatElapsed(42_900)).toBe('42s');
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(20 * 60_000 + 5_000)).toBe('20m 05s');
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 59_000)).toBe('1h 02m');
  });
});
