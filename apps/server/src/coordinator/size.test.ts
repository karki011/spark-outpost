import { describe, expect, it } from 'vitest';
import { builderBudget, sizeEstimate } from './size.ts';

const lines = (counts: Record<string, number>) => (path: string) => counts[path] ?? null;

describe('sizeEstimate', () => {
  it('counts owned files twice, reads once, plus a base and a per-file allowance', () => {
    const size = sizeEstimate(
      { owns: ['a.ts', 'b.ts'], reads: ['c.ts'] },
      lines({ 'a.ts': 100, 'b.ts': 50, 'c.ts': 200 }),
    );
    expect(size).toBe(12_000 + 2 * (150 * 12) + 200 * 12 + 2 * 6_000);
  });

  it('treats new files as empty', () => {
    expect(sizeEstimate({ owns: ['new.ts'], reads: [] }, lines({}))).toBe(18_000);
  });
});

describe('builderBudget', () => {
  it('is half the context window, capped at 150K', () => {
    expect(builderBudget(200_000)).toBe(100_000);
    expect(builderBudget(1_000_000)).toBe(150_000);
    expect(builderBudget(null)).toBe(150_000);
  });
});
