import { describe, expect, it } from 'vitest';
import type { CheckBody } from '@spark-outpost/contracts';
import type { FindingReading } from '../advisor/finding-questions.ts';
import { checksPhrase, findingSummary, suggestionsLine } from './critic-fix.ts';

const body = (status: CheckBody['status']): CheckBody =>
  ({ name: 'Bolt', copy: null, round: 1, status, results: [] }) as unknown as CheckBody;

const reading = (
  correct: boolean,
  by: FindingReading['by'],
  kind: FindingReading['kind'] = correct ? 'bug' : 'style',
): FindingReading => ({
  finding: 'x',
  rules: correct,
  kind,
  noul: null,
  correct,
  by,
});

describe('critic fix wording', () => {
  it('reads the latest checks', () => {
    expect(checksPhrase([body('failed'), body('passed')])).toBe('checks pass');
    expect(checksPhrase([body('failed')])).toBe('checks still fail');
    expect(checksPhrase([])).toBe('no project checks ran');
  });

  it('summarises the classification for the decision log', () => {
    expect(findingSummary(1, [reading(true, 'jev'), reading(false, 'rules')], 'fix', false)).toBe(
      'Review 1: correctness bugs 1 of 2 findings (jev and rules) → fix turn',
    );
    expect(findingSummary(1, [reading(true, 'rules')], 'offer', true)).toBe(
      'Review 1: correctness bugs 1 of 1 finding (rules, Jev skipped: diffs off) → offered on the keep card',
    );
    expect(findingSummary(3, [reading(true, 'jev')], 'repeated', false)).toBe(
      'Review 3: correctness bugs 1 of 1 finding (jev) → stop: the same findings came back',
    );
    expect(
      findingSummary(
        2,
        [reading(false, 'rules', 'suggestion'), reading(false, 'rules')],
        'clean',
        false,
      ),
    ).toBe(
      'Review 2: correctness bugs 0 of 2 findings (rules), 1 reported as suggestions → no fix turn',
    );
  });

  it('lists hardening suggestions it did not fix', () => {
    expect(suggestionsLine([])).toBeNull();
    expect(suggestionsLine(['Neutralize formulas in project names'])).toBe(
      "Not fixed automatically: 1 AI review suggestion about hardening or robustness that the request didn't ask for: Neutralize formulas in project names. Ask if you want it done.",
    );
  });
});
