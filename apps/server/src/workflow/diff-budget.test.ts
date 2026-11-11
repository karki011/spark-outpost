import { describe, expect, it } from 'vitest';
import { createDiffBudget } from './diff-budget.ts';

describe('the diff budget', () => {
  it('never cuts between the two halves of one character', () => {
    const budget = createDiffBudget(4);
    const kept = budget.cut('abc😀def');
    expect(kept).toBe('abc');
    expect(budget.truncated).toBe(true);
    expect(() => encodeURIComponent(kept)).not.toThrow();
  });

  it('keeps a whole character that ends exactly at the limit', () => {
    expect(createDiffBudget(5).cut('abc😀def')).toBe('abc😀');
  });
});
