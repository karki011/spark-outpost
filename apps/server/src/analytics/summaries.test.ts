import { describe, expect, it } from 'vitest';
import { fact } from './fact-fixture.ts';
import { loopSummary, waitSummary } from './summaries.ts';
import { checkRollup } from './tally.ts';

describe('check, loop and wait summaries', () => {
  it('rolls check rounds per Builder and counts fix loops', () => {
    expect(checkRollup([])).toBeNull();
    expect(checkRollup([{ key: 'Bolt:', round: 1, status: 'skipped' }])).toBeNull();
    expect(
      checkRollup([
        { key: 'Bolt:', round: 1, status: 'failed' },
        { key: 'Rivet:', round: 1, status: 'passed' },
        { key: 'Bolt:', round: 2, status: 'passed' },
      ]),
    ).toEqual({ firstPassed: false, finalPassed: true, fixLoop: true, rounds: 3 });
    const loops = loopSummary([
      fact({ retries: 2 }),
      fact({ checks: [{ key: 'Bolt:', round: 2, status: 'passed' }] }),
      fact({ roles: [] }),
    ]);
    expect(loops).toEqual({ turns: 2, withRetries: 2, retries: 2, fixLoops: 1 });
  });

  it('summarises approval waits per kind', () => {
    const summary = waitSummary([
      { kind: 'execute', waitMs: 10_000 },
      { kind: 'execute', waitMs: 30_000 },
      { kind: 'plan', waitMs: 90_000 },
    ]);
    expect(summary).toEqual({
      count: 3,
      medianMs: 30_000,
      byKind: [
        { kind: 'execute', count: 2, medianMs: 20_000, p90Ms: 28_000 },
        { kind: 'plan', count: 1, medianMs: 90_000, p90Ms: 90_000 },
      ],
    });
  });
});
