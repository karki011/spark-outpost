import { describe, expect, it } from 'vitest';
import type { CheckBody, CheckResult } from '@spark-outpost/contracts';
import { checkTally } from './result-facts.ts';

const RUN = '00000000-0000-4000-8000-000000000001';

function result(partial: Partial<CheckResult>): CheckResult {
  return {
    command: 'pnpm test',
    kind: 'test',
    outcome: 'passed',
    exitCode: 0,
    durationMs: 10,
    outputTail: '',
    truncated: false,
    note: null,
    approvalId: null,
    ...partial,
  };
}

function body(round: number, results: CheckResult[], name = 'Bolt'): CheckBody {
  const failed = results.some((entry) => entry.outcome === 'failed');
  return { runId: RUN, name, copy: null, round, status: failed ? 'failed' : 'passed', results };
}

describe('checkTally', () => {
  it('has nothing to say when no check ran', () => {
    expect(checkTally([])).toBeNull();
    expect(checkTally([body(1, [result({ outcome: 'skipped' })])])).toBeNull();
  });

  it('counts the latest round of each agent', () => {
    const first = body(1, [result({ outcome: 'failed', exitCode: 1 })]);
    const fixed = body(2, [result({}), result({ command: 'pnpm lint', kind: 'lint' })]);
    expect(checkTally([first, fixed])).toEqual({ passed: 2, failed: 0, unsettled: 0 });
  });

  it('tells a failure caused by the change from one that was there before', () => {
    const bodies = [
      body(1, [
        result({ outcome: 'failed', exitCode: 1 }),
        result({ outcome: 'failed', exitCode: 1, cause: 'baseline' }),
        result({ outcome: 'timed_out', exitCode: null }),
      ]),
      body(1, [result({})], 'Nova'),
    ];
    expect(checkTally(bodies)).toEqual({ passed: 1, failed: 1, unsettled: 2 });
  });
});
