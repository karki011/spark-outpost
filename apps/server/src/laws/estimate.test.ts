import { describe, expect, it } from 'vitest';
import { estimateTask, paddingFrom, type PastRun } from './estimate.ts';

const key = { kind: 'bug_fix', size: 2, model: 'sonnet' };

function run(minutes: number, usd: number, overrides: Partial<PastRun> = {}): PastRun {
  return { ...key, minutes, usd, baseMinutes: null, baseUsd: null, ...overrides };
}

describe('Hofstadter estimates', () => {
  it('gives a rough rule estimate before five similar runs', () => {
    const estimate = estimateTask(key, [run(4, 0.3), run(5, 0.4)], 0.1);
    expect(estimate.source).toBe('rough');
    expect(estimate.minutes).toEqual({ typical: 6, low: 3, high: 12 });
    expect(estimate.usd.typical).toBeCloseTo(0.15);
    expect(estimate.text).toBe(
      'Rough estimate: ~6 min, ~$0.15 (3–12 min, $0.08–$0.30); fewer than 5 similar runs to learn from yet',
    );
  });

  it("learns from the user's own runs once there are five", () => {
    const history = [run(4, 0.3), run(5, 0.4), run(6, 0.4), run(8, 0.5), run(7, 0.45)];
    const estimate = estimateTask(key, history, 0.1);
    expect(estimate.source).toBe('history');
    expect(estimate.runs).toBe(5);
    expect(estimate.minutes.typical).toBe(6);
    expect(estimate.usd.typical).toBeCloseTo(0.4);
    expect(estimate.text).toBe(
      'Usually ~6 min, ~$0.40 for a task like this (5–7 min, $0.38–$0.46 over 5 similar runs)',
    );
  });

  it('falls back to the same kind and size on any model, and ignores other kinds', () => {
    const other = { model: 'opus[1m]' };
    const history = [
      ...Array.from({ length: 5 }, () => run(10, 1, other)),
      ...Array.from({ length: 9 }, () => run(1, 0.01, { kind: 'feature' })),
    ];
    const estimate = estimateTask(key, history, 0.1);
    expect(estimate.source).toBe('history');
    expect(estimate.minutes.typical).toBe(10);
  });

  it('pads by how much longer tasks really took than estimated, within limits', () => {
    expect(paddingFrom([1.5, 1.5, 2, 1.2, 1.4])).toBe(1.5);
    expect(paddingFrom([0.5, 0.6, 0.7, 0.8, 0.9])).toBe(1);
    expect(paddingFrom([5, 6, 7, 8, 9])).toBe(3);
    expect(paddingFrom([2, 2, 2, 2])).toBe(1);
    const padded = Array.from({ length: 5 }, () =>
      run(9, 0.3, { kind: 'feature', baseMinutes: 6, baseUsd: 0.3 }),
    );
    const estimate = estimateTask(key, padded, 0.1);
    expect(estimate.padding).toEqual({ minutes: 1.5, usd: 1 });
    expect(estimate.minutes.typical).toBe(9);
    expect(estimate.text).toContain('padded ×1.5');
  });
});
