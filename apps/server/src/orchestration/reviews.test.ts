import { describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import { checkLines, combinedFindings, combinedVerdict, type ReviewDone } from './reviews.ts';
import type { MemberResult } from './session.ts';

function done(name: string, verdict: ReviewDone['verdict'], findings: string[]): ReviewDone {
  return {
    key: name,
    subject: { name, steps: [0] },
    result: {} as MemberResult,
    verdict,
    findings,
  };
}

describe('combining reviews of several Builders', () => {
  it('has concerns when any review has them, and is unclear when one is unclear', () => {
    expect(combinedVerdict(['looks_good', 'looks_good'])).toBe('looks_good');
    expect(combinedVerdict(['looks_good', 'unclear'])).toBe('unclear');
    expect(combinedVerdict(['unclear', 'concerns'])).toBe('concerns');
    expect(combinedVerdict([])).toBe('unclear');
  });

  it('names the Builder behind each concern when more than one review has concerns', () => {
    const one = [done('Bolt', 'concerns', ['No test']), done('Rivet', 'looks_good', ['Fine'])];
    expect(combinedFindings(one)).toEqual(['No test']);
    const two = [done('Bolt', 'concerns', ['No test']), done('Rivet', 'concerns', ['Typo'])];
    expect(combinedFindings(two)).toEqual(['Bolt: No test', 'Rivet: Typo']);
  });

  it('gives the Critic each check result and the output of failing ones', () => {
    const body: CheckBody = {
      runId: '00000000-0000-4000-8000-000000000000',
      name: 'Bolt',
      copy: null,
      round: 1,
      status: 'failed',
      results: [
        {
          command: 'npm run lint',
          kind: 'lint',
          outcome: 'passed',
          exitCode: 0,
          durationMs: 10,
          outputTail: '',
          truncated: false,
          note: null,
          approvalId: null,
        },
        {
          command: 'npm test',
          kind: 'test',
          outcome: 'failed',
          exitCode: 1,
          durationMs: 10,
          outputTail: 'not ok 1 - rounds',
          truncated: false,
          note: null,
          approvalId: null,
        },
      ],
    };
    expect(checkLines(body).join('\n')).toBe(
      '- `npm run lint` passed\n- `npm test` failed (exit 1)\n\n`npm test` exited 1:\n```text\nnot ok 1 - rounds\n```',
    );
    expect(checkLines(null)).toEqual([]);
  });
});
