import { describe, expect, it } from 'vitest';
import { fact } from './fact-fixture.ts';
import { rollups } from './rollups.ts';

describe('rollups', () => {
  it('rolls up by day in date order and by other keys by cost', () => {
    const facts = [
      fact({ day: '2026-09-21', reportedUsd: 0.5 }),
      fact({ day: '2026-09-20', project: 'docs', jevUsd: 0.01, retries: 1 }),
    ];
    expect(rollups(facts, 'day').map((row) => row.key)).toEqual(['2026-09-20', '2026-09-21']);
    const byProject = rollups(facts, 'project');
    expect(byProject.map((row) => [row.key, row.costUsd, row.retries])).toEqual([
      ['spark-outpost', 0.5, 0],
      ['docs', 0.11, 1],
    ]);
    expect(byProject[1]!.estimatedUsd).toBe(0.01);
  });
});
