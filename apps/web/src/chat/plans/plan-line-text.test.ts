import { describe, expect, it } from 'vitest';
import { planLineText } from './plan-line-text.ts';

describe('the Plan saved line', () => {
  it("reads Plan saved for the agent's approved plan, with no step count", () => {
    expect(planLineText({ items: 2, unit: 'steps' })).toBe('Plan saved');
    expect(planLineText({ items: 0, unit: 'steps' })).toBe('Plan saved');
  });

  it('keeps the piece count of a line an older chat stored', () => {
    expect(planLineText({ items: 4, unit: 'pieces' })).toBe('Plan saved · 4 pieces');
    expect(planLineText({ items: 1, unit: 'pieces' })).toBe('Plan saved · 1 piece');
  });
});
