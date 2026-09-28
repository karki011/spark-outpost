import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import {
  buildFindingQuestions,
  FINDING_QUESTION,
  findingKey,
  isCorrectnessFinding,
  readFindings,
} from './finding-questions.ts';

const PARENS_FINDING =
  '`src/money.ts:14`: `"((5.00)"` is accepted because `hasParens` only looks at the first and last characters; `parseCents(\'((5.00)\')` returns -500 when it should throw.';
const ABS_FINDING =
  "Critical regression: the unconditional `Math.abs` in `parseCents` turns `-$50` positive, so `parseCents('-$5.00')` now returns 500 instead of -500.";

const NITS = [
  'Nit: `parseCents` could be named `toCents` to match the other helpers.',
  'Consider extracting the parentheses regex into a named constant for readability.',
  'Typo in the comment above `hasParens` ("paranthesis").',
  'Formatting: the new lines use 4-space indentation instead of 2.',
  'The variable name `v` is unclear; `value` would read better.',
  'The change matches the request.',
];

const answered = (nouls: Record<string, number>): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(nouls).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
  ),
});

describe('correctness finding rules', () => {
  it('counts the two Critic findings that caught real money-parsing bugs', () => {
    expect(isCorrectnessFinding(PARENS_FINDING)).toBe(true);
    expect(isCorrectnessFinding(ABS_FINDING)).toBe(true);
  });

  it('counts a missed requirement and an uncovered edge case', () => {
    expect(isCorrectnessFinding('The divider test the request asked for is missing')).toBe(true);
    expect(
      isCorrectnessFinding(
        '`(+$5)` is accepted; a plus sign inside parentheses should be rejected',
      ),
    ).toBe(true);
    expect(isCorrectnessFinding('No test covers the cent-sharing loop')).toBe(true);
  });

  it('ignores style, naming, readability nits and praise', () => {
    for (const nit of NITS) expect(isCorrectnessFinding(nit), nit).toBe(false);
  });

  it('ignores empty findings', () => {
    expect(isCorrectnessFinding('   ')).toBe(false);
  });
});

describe('asking Jev about findings', () => {
  it('asks one yes/no question per finding with the task and diff as state', () => {
    const asked = buildFindingQuestions({
      request: 'Accept amounts in parentheses as negative.',
      diff: '+const hasParens = text.startsWith("(")',
      findings: [PARENS_FINDING, NITS[0]!],
    });
    expect(Object.keys(asked.questions)).toEqual([findingKey(0), findingKey(1)]);
    expect(asked.questions.finding_1).toMatchObject({
      type: 'noul',
      instructions: { question: FINDING_QUESTION, finding: PARENS_FINDING },
    });
    expect(asked.state).toEqual({
      task: 'Accept amounts in parentheses as negative.',
      diff: '+const hasParens = text.startsWith("(")',
    });
  });

  it('uses the rules when Jev is missing or unsure', () => {
    const findings = [PARENS_FINDING, NITS[0]!];
    expect(readFindings(findings, null).map((reading) => [reading.correct, reading.by])).toEqual([
      [true, 'rules'],
      [false, 'rules'],
    ]);
    const unsure = readFindings(findings, answered({ finding_1: 0.4, finding_2: 0.7 }));
    expect(unsure.map((reading) => [reading.correct, reading.by, reading.noul])).toEqual([
      [true, 'rules', 0.4],
      [false, 'rules', 0.7],
    ]);
  });

  it('follows Jev at 0.8 or more either way', () => {
    const findings = [PARENS_FINDING, 'The helper could be shorter'];
    const readings = readFindings(findings, answered({ finding_1: 0.15, finding_2: 0.8 }));
    expect(readings.map((reading) => [reading.correct, reading.by])).toEqual([
      [false, 'jev'],
      [true, 'jev'],
    ]);
    expect(readings[0]!.rules).toBe(true);
  });
});
