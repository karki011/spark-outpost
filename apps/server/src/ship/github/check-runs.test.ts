import { describe, expect, it } from 'vitest';
import { checkRunsState, failedCheckRuns } from './check-runs.ts';

const run = (name: string, status: string, conclusion: string | null) => ({
  name,
  status,
  conclusion,
});

describe('checkRunsState', () => {
  it('is none without check runs', () => {
    expect(checkRunsState([])).toBe('none');
  });

  it('stays pending while any run has not completed, even when another already failed', () => {
    expect(
      checkRunsState([run('test', 'completed', 'failure'), run('build', 'in_progress', null)]),
    ).toBe('pending');
  });

  it('is failing only when every run completed and at least one failed', () => {
    expect(
      checkRunsState([
        run('test', 'completed', 'startup_failure'),
        run('lint', 'completed', 'success'),
      ]),
    ).toBe('failing');
  });

  it('passes when every run completed without failing, skipped and neutral included', () => {
    expect(
      checkRunsState([run('docs', 'completed', 'skipped'), run('info', 'completed', 'neutral')]),
    ).toBe('passing');
  });
});

describe('failedCheckRuns', () => {
  it('keeps the runs that ended badly', () => {
    const runs = [
      run('lint', 'completed', 'success'),
      run('test', 'completed', 'timed_out'),
      run('e2e', 'completed', 'cancelled'),
    ];
    expect(failedCheckRuns(runs).map((entry) => entry.name)).toEqual(['test', 'e2e']);
  });
});
