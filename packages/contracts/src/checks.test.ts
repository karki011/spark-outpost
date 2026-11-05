import { describe, expect, it } from 'vitest';
import {
  checkCause,
  checkDetails,
  checkLine,
  failingChecks,
  type CheckBody,
  type CheckResult,
} from './checks.ts';

const result = (overrides: Partial<CheckResult>): CheckResult => ({
  command: 'npm test',
  kind: 'test',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 1234,
  outputTail: '',
  truncated: false,
  note: null,
  approvalId: null,
  ...overrides,
});

const body = (status: CheckBody['status'], results: CheckResult[], copy: string | null = null) => ({
  runId: '00000000-0000-4000-8000-000000000000',
  name: 'Rivet',
  copy,
  round: 1,
  status,
  results,
});

describe('check lines', () => {
  it('summarises a round in one line and blames only what the change caused', () => {
    expect(checkLine(body('passed', [result({})]))).toBe('Checks for Rivet: tests passed');
    const round = body(
      'failed',
      [
        result({ command: 'npm run lint', kind: 'lint' }),
        result({
          command: 'npm run typecheck',
          kind: 'typecheck',
          outcome: 'failed',
          exitCode: 1,
          cause: 'baseline',
        }),
        result({ outcome: 'failed', exitCode: 1 }),
      ],
      'spark/abc/rivet',
    );
    expect(checkLine(round)).toBe(
      "Checks for Rivet's copy: lint passed · typecheck already failing before this change · tests failed",
    );
    expect(failingChecks(round).map((check) => check.command)).toEqual(['npm test']);
  });

  it('never counts a timeout, a setup problem or an old failure against the change', () => {
    const results = [
      result({ outcome: 'timed_out', exitCode: null }),
      result({ command: 'npm run lint', kind: 'lint', outcome: 'failed', cause: 'environment' }),
      result({
        command: 'npm run typecheck',
        kind: 'typecheck',
        outcome: 'failed',
        cause: 'baseline',
      }),
    ];
    expect(results.map(checkCause)).toEqual(['timeout', 'environment', 'baseline']);
    expect(checkLine(body('skipped', results))).toBe(
      'Checks for Rivet: tests could not finish in time · lint could not run · typecheck already failing before this change',
    );
  });

  it('shows a failure nothing ties to the change as one calm phrase, not as failed', () => {
    const unsure = result({
      outcome: 'failed',
      exitCode: 1,
      cause: 'unknown',
      failures: ['task dates:test'],
      blamed: [],
      baseline: {
        base: '0123456789abcdef',
        outcome: 'passed',
        cached: true,
        trusted: false,
        durationMs: 17600,
        shared: [],
        added: [],
      },
    });
    const round = body('skipped', [unsure]);
    expect(failingChecks(round)).toEqual([]);
    expect(checkLine(round)).toBe(
      "Checks for Rivet: tests failed before this change or can't tell",
    );
    expect(checkDetails(round)[0]).toBe(
      '`npm test` · exit 1 in 1.2 s · passes before this change (01234567, remembered result, not relied on) · nothing ties this to the change: it fails in files the change does not touch, and no comparable run on the base commit passed',
    );
  });

  it('says in one phrase when a fix turn left the same failure for the user', () => {
    const mine = result({
      outcome: 'failed',
      exitCode: 1,
      cause: 'change',
      blamed: ['test a.test.ts'],
    });
    const round = { ...body('failed', [mine]), leftForUser: true };
    expect(checkLine(round)).toBe(
      'Checks for Rivet: tests failed · left for you: a fix turn did not change what fails',
    );
    expect(checkDetails(round)[0]).toContain('from this change: test a.test.ts');
  });

  it('reads a failure recorded before causes existed as caused by the change', () => {
    expect(checkCause(result({ outcome: 'failed', exitCode: 1 }))).toBe('change');
    expect(checkLine(body('skipped', [result({ outcome: 'denied', exitCode: null })]))).toBe(
      'Checks for Rivet: tests not allowed',
    );
  });

  it('says when a narrowed run stood in for the whole repository, and names commands that share a kind', () => {
    const scoped = result({
      command: 'pnpm exec nx affected -t test --files=a.ts',
      scope: { whole: 'pnpm run test', label: 'affected projects' },
    });
    expect(checkLine(body('passed', [scoped]))).toBe(
      'Checks for Rivet: tests for affected projects passed (whole-repo run skipped)',
    );
    const two = [
      result({ command: 'node a.mjs', kind: 'custom' }),
      result({ command: 'node b.mjs', kind: 'custom' }),
    ];
    expect(checkLine(body('passed', two))).toBe(
      'Checks for Rivet: node a.mjs passed · node b.mjs passed',
    );
  });

  it('lists the command, time and base comparison for the expanded row', () => {
    const failed = result({
      outcome: 'failed',
      exitCode: 1,
      cause: 'baseline',
      baseline: {
        base: '0123456789abcdef',
        outcome: 'failed',
        cached: true,
        durationMs: 5000,
        shared: ['test a.test.ts'],
        added: [],
      },
    });
    expect(checkDetails(body('skipped', [failed]))).toEqual([
      '`npm test` · exit 1 in 1.2 s · also fails before this change (01234567, remembered result); same failures: test a.test.ts',
    ]);
  });
});
