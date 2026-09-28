import { describe, expect, it } from 'vitest';
import { percent } from '../analytics/analytics-model.ts';

describe('analytics percent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(percent(2, 3)).toBe('67%');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(1, 8)).toBe('13%');
    expect(percent(199, 200)).toBe('100%');
  });

  it('keeps the edge cases', () => {
    expect(percent(0, 5)).toBe('0%');
    expect(percent(3, 0)).toBe('—');
  });
});
