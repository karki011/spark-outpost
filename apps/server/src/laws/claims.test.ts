import { describe, expect, it } from 'vitest';
import type { CheckBody, CheckResult } from '@spark-outpost/contracts';
import { claimFindings, claimsChecksPass } from './claims.ts';

const result = (overrides: Partial<CheckResult>): CheckResult => ({
  command: 'pnpm test',
  kind: 'test',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 10,
  outputTail: '',
  truncated: false,
  note: null,
  approvalId: null,
  ...overrides,
});

const body = (runId: string, results: CheckResult[], status: CheckBody['status']): CheckBody => ({
  runId,
  name: 'Bolt',
  copy: null,
  round: 1,
  status,
  results,
});

const reply = (text: string) => ({ runId: 'b1', name: 'Bolt', text });

describe('check claims', () => {
  it('reads a pass claim and ignores negated or failing sentences', () => {
    expect(claimsChecksPass('Done. All tests pass.')).toBe(true);
    expect(claimsChecksPass('Lint and typecheck are clean now.')).toBe(true);
    expect(claimsChecksPass("I couldn't get the tests to pass.")).toBe(false);
    expect(claimsChecksPass('Two tests fail on main as well.')).toBe(false);
    expect(claimsChecksPass('Updated the parser.')).toBe(false);
  });

  it("flags a claim that Spark's own run contradicts", () => {
    const failing = body('b1', [result({ outcome: 'failed', exitCode: 1 })], 'failed');
    expect(claimFindings([reply('All tests pass.')], [failing])).toEqual([
      {
        law: 'goodhart',
        kind: 'claim',
        path: null,
        text: "Bolt said the checks pass, but Spark's own run failed: `pnpm test` exited 1.",
      },
    ]);
  });

  it('flags a claim Spark could not confirm because the checks were skipped', () => {
    const note =
      'The package.json scripts changed during this run, so this check was not run automatically.';
    const skipped = body('b1', [result({ outcome: 'skipped', exitCode: null, note })], 'skipped');
    expect(claimFindings([reply('All tests pass.')], [skipped])[0]?.text).toBe(
      `Bolt said the checks pass, but Spark could not confirm it: ${note}`,
    );
  });

  it('stays quiet when Spark agrees or there is no claim', () => {
    const passing = body('b1', [result({})], 'passed');
    const failing = body('b1', [result({ outcome: 'failed', exitCode: 1 })], 'failed');
    expect(claimFindings([reply('All tests pass.')], [passing])).toEqual([]);
    expect(claimFindings([reply('Changed the parser.')], [failing])).toEqual([]);
  });
});
