import { describe, expect, it } from 'vitest';
import { STEP_DIFF_BUDGET, stepDiffs } from './step-diffs.ts';

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `const value${index} = compute(${index});`);

describe('step diffs', () => {
  it('keeps a small edit in a large file visible instead of an empty new side', () => {
    const before = lines(4000);
    const after = [...before];
    after[2500] = 'const value2500 = changed();';
    const [diff] = stepDiffs(
      [{ path: '/work/big.ts', oldText: before.join('\n'), newText: after.join('\n') }],
      [],
    );
    expect(diff?.truncated).toBe(true);
    expect(diff?.newText).toContain('changed()');
    expect(diff?.oldText).toContain('compute(2500)');
    expect(diff?.oldText).toContain('compute(2497)');
    expect(diff?.oldText).not.toContain('compute(100)');
    expect(diff).toMatchObject({ added: 1, removed: 1 });
  });

  it('gives both sides room when the changed part alone is over the budget', () => {
    const before = lines(3000).join('\n');
    const after = lines(3000)
      .map((line) => `${line} // touched`)
      .join('\n');
    const [diff] = stepDiffs([{ path: '/work/all.ts', oldText: before, newText: after }], []);
    expect(diff?.truncated).toBe(true);
    expect(diff?.oldText?.length).toBeGreaterThan(1000);
    expect(diff?.newText?.length).toBeGreaterThan(1000);
    expect((diff?.oldText?.length ?? 0) + (diff?.newText?.length ?? 0)).toBeLessThanOrEqual(
      STEP_DIFF_BUDGET,
    );
  });

  it('leaves a file that fits whole and unmarked', () => {
    const [diff] = stepDiffs(
      [{ path: '/work/a.ts', oldText: 'one\ntwo\n', newText: 'one\n2\n' }],
      [],
    );
    expect(diff).toEqual({
      path: '/work/a.ts',
      added: 1,
      removed: 1,
      oldText: 'one\ntwo\n',
      newText: 'one\n2\n',
    });
  });
});
