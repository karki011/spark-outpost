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
        text: "Bolt said the checks pass. Spark's own run differs: `pnpm test` exited 1 (in files this change touches).",
      },
    ]);
  });

  it('flags a claim Spark could not confirm because the checks were skipped', () => {
    const note =
      'The package.json script this check runs changed during this run, so it was not run automatically.';
    const skipped = body('b1', [result({ outcome: 'skipped', exitCode: null, note })], 'skipped');
    expect(claimFindings([reply('All tests pass.')], [skipped])[0]?.text).toBe(
      `Bolt said the checks pass, but Spark could not confirm it: ${note}`,
    );
  });

  it('names the command and the failing tasks, and says what ties them to the change', () => {
    const failures = ['task dates:test', 'test libs/a/src/a.test.ts'];
    const mine = result({
      outcome: 'failed',
      exitCode: 1,
      cause: 'change',
      failures,
      blamed: ['test libs/a/src/a.test.ts'],
      baseline: {
        base: 'abc',
        outcome: 'passed',
        cached: false,
        trusted: true,
        durationMs: 5,
        shared: [],
        added: [],
      },
    });
    expect(claimFindings([reply('All tests pass.')], [body('b1', [mine], 'failed')])[0]?.text).toBe(
      "Bolt said the checks pass. Spark's own run differs: `pnpm test` failed in test libs/a/src/a.test.ts (it passes without this change).",
    );
  });

  it('does not say the Builder is wrong about failures the change did not cause', () => {
    const failures = ['task dates:test', 'task node-compat:test'];
    const old = result({ outcome: 'failed', exitCode: 1, cause: 'baseline', failures });
    const unsure = result({
      command: 'pnpm lint',
      outcome: 'failed',
      exitCode: 1,
      cause: 'unknown',
    });
    const slow = result({ command: 'pnpm run e2e', outcome: 'timed_out', exitCode: null });
    const found = claimFindings(
      [reply('All tests pass.')],
      [body('b1', [old, unsure, slow], 'skipped')],
    );
    expect(found.map((finding) => finding.text)).toEqual([
      'Bolt said the checks pass. Spark could not confirm it, and none of this is counted against the change: `pnpm test` failed in task dates:test, task node-compat:test, as it does without this change; `pnpm lint` exited 1; nothing ties that to this change; `pnpm run e2e` could not finish in time.',
    ]);
    expect(found[0]!.text).not.toContain('own run failed');
  });

  it('stays quiet when Spark agrees or there is no claim', () => {
    const passing = body('b1', [result({})], 'passed');
    const failing = body('b1', [result({ outcome: 'failed', exitCode: 1 })], 'failed');
    expect(claimFindings([reply('All tests pass.')], [passing])).toEqual([]);
    expect(claimFindings([reply('Changed the parser.')], [failing])).toEqual([]);
  });
});
