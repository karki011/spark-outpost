import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import {
  buildVerifyQuestions,
  MAX_REQUIREMENTS,
  requirementLines,
  verifyVerdict,
} from './verify-questions.ts';

const answered = (values: Record<string, number>): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(values).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
  ),
});

describe('requirement lines', () => {
  it('prefers the Builder’s own plan entries', () => {
    expect(requirementLines('Do it all', ['Write the parser', 'Add a test for dates'])).toEqual([
      'Write the parser',
      'Add a test for dates',
    ]);
  });

  it('splits the request into up to five sentences, dropping tags and tiny fragments', () => {
    const request =
      'Fix the divider after midnight. Add a test for it. Update the README heading. Ok. Rename the helper file. Tidy the CSS classes. Bump the version number. #build';
    const lines = requirementLines(request);
    expect(lines).toHaveLength(MAX_REQUIREMENTS);
    expect(lines[0]).toBe('Fix the divider after midnight.');
    expect(lines.join(' ')).not.toContain('#build');
  });

  it('falls back to the whole request when nothing splits out', () => {
    expect(requirementLines('Fix it')).toEqual(['Fix it']);
  });
});

describe('verifier', () => {
  it('asks one noul per requirement plus the weakened-tests check, with the diff as evidence', () => {
    const asked = buildVerifyQuestions({
      request: 'Fix the divider. Add a test.',
      requirements: ['Fix the divider.', 'Add a test.'],
      diff: '+fixed',
    });
    expect(Object.keys(asked.questions)).toEqual(['unmet_1', 'unmet_2', 'weakens_tests']);
    expect(asked.state).toEqual({ request: 'Fix the divider. Add a test.', diff: '+fixed' });
  });

  it('flags when any check passes the line, and asks for review when an answer is missing', () => {
    const requirements = ['Fix the divider.', 'Add a test.'];
    expect(
      verifyVerdict(requirements, answered({ unmet_1: 0.05, unmet_2: 0.92, weakens_tests: 0.1 })),
    ).toMatchObject({ would: 'flag', worst: 0.92 });
    expect(
      verifyVerdict(requirements, answered({ unmet_1: 0.05, unmet_2: 0.1, weakens_tests: 0.1 }))
        .would,
    ).toBe('pass');
    expect(verifyVerdict(requirements, answered({ unmet_1: 0.05 }))).toMatchObject({
      would: 'review',
      invalid: ['unmet_2', 'weakens_tests'],
    });
  });
});
