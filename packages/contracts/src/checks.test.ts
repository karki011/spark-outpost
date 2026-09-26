import { describe, expect, it } from 'vitest';
import { checkLine, failingChecks, type CheckBody, type CheckResult } from './checks.ts';

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
  it('says what passed, and only what failed when something failed', () => {
    expect(checkLine(body('passed', [result({})]))).toBe(
      'Checks passed for Rivet: npm test passed in 1.2 s',
    );
    const failed = body(
      'failed',
      [result({ command: 'npm run lint' }), result({ outcome: 'failed', exitCode: 1 })],
      'spark/abc/rivet',
    );
    expect(checkLine(failed)).toBe("Checks failed for Rivet's copy: npm test exited 1");
    expect(failingChecks(failed).map((check) => check.command)).toEqual(['npm test']);
    expect(checkLine(body('skipped', [result({ outcome: 'denied', exitCode: null })]))).toBe(
      'Checks skipped for Rivet: npm test was not allowed',
    );
  });
});
