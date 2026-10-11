import { describe, expect, it } from 'vitest';
import { planSavedText } from './plans.ts';

describe('the Plan saved line', () => {
  it("reads Plan saved for the agent's approved plan, with no step count", () => {
    expect(planSavedText({ items: 2, unit: 'steps' })).toBe('Plan saved');
    expect(planSavedText({ items: 0, unit: 'steps' })).toBe('Plan saved');
  });

  it('keeps the piece count of a line an older chat stored', () => {
    expect(planSavedText({ items: 4, unit: 'pieces' })).toBe('Plan saved · 4 pieces');
    expect(planSavedText({ items: 1, unit: 'pieces' })).toBe('Plan saved · 1 piece');
  });
});
