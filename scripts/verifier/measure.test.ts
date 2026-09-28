import type { SpawnSyncReturns } from 'node:child_process';
import { expect, it } from 'vitest';
import { readCriticRun } from './measure.ts';

function run(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    ...overrides,
  };
}

it('reads the verdict, cost and text from a successful critic run', () => {
  const parsed = readCriticRun(
    run({ stdout: JSON.stringify({ result: 'Verdict: approve', total_cost_usd: 0.02 }) }),
  );
  expect(parsed).toEqual({ result: 'Verdict: approve', total_cost_usd: 0.02 });
});

it('fails with the exit status and stderr when the critic exits non-zero', () => {
  expect(() => readCriticRun(run({ status: 1, stderr: 'Not logged in\n' }))).toThrow(
    'The critic exited with status 1: Not logged in',
  );
});

it('fails clearly when the critic could not start or timed out', () => {
  const error = Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' });
  expect(() => readCriticRun(run({ status: null, signal: 'SIGTERM', error }))).toThrow(
    'The critic did not run: spawnSync claude ETIMEDOUT',
  );
});
