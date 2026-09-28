import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, clarifyOptionId } from '@spark-outpost/contracts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { autoContinueOption } from './checkpoint-policy.ts';
import {
  MAX_INTERPRETATIONS,
  assumptionLine,
  chosenInterpretation,
  interpretationCard,
  interpretations,
  vagueByRule,
  vagueHandling,
} from './clarify.ts';

const response = (probabilities: Record<string, number>): SystemOneResponse => ({
  model: 'jev-test',
  answers: {
    intent: { type: 'choice', choice: 'docs', probabilities, confidence: 0.68 },
  },
});

describe('vague requests', () => {
  it('reads a short request with a vague goal and no files as vague', () => {
    expect(vagueByRule('Make the reports better.', 0)).toBe(true);
    expect(vagueByRule('Make src/report.ts better', 1)).toBe(false);
    expect(
      vagueByRule('The divider shows the wrong day after midnight. Fix it and add a test.', 0),
    ).toBe(false);
  });

  it('asks at Ask before edits, and assumes at Auto-edit and Full auto', () => {
    expect(vagueHandling('balanced')).toBe('ask');
    expect(vagueHandling('hands-off')).toBe('assume');
    expect(vagueHandling('full-auto')).toBe('assume');
  });
});

describe('the interpretation question', () => {
  it('offers the likeliest readings from Jev’s intent, two to four of them', () => {
    const many = response({ docs: 0.5, feature: 0.2, refactor: 0.15, bug_fix: 0.1, chat: 0.05 });
    expect(interpretations(many)).toEqual([
      'Improve its documentation',
      'Add new behaviour or features',
      'Restructure the code without changing what it does',
      'Fix what is broken in it',
    ]);
    expect(interpretations(many).length).toBeLessThanOrEqual(MAX_INTERPRETATIONS);
    expect(interpretations(response({ docs: 0.97, chat: 0.03 }))).toEqual([
      'Improve its documentation',
      'Add new behaviour or features',
    ]);
    expect(interpretations(null)).toHaveLength(2);
  });

  it('builds one short card that auto-continues with the most likely reading', () => {
    const card = interpretationCard(['Improve its documentation', 'Add new behaviour'], 'why');
    expect(card.title).toBe('What should change?');
    expect(card.options.map((option) => option.name)).toEqual([
      'Improve its documentation',
      'Add new behaviour',
      'Answer in your own words',
      'Go with the most likely',
      'Stop',
    ]);
    expect(autoContinueOption('clarify', true)).toBe(CHECKPOINT_OPTION.clarifyRules);
    expect(chosenInterpretation(card, clarifyOptionId(1), null)).toEqual({
      type: 'chosen',
      text: 'Add new behaviour',
    });
    expect(chosenInterpretation(card, CHECKPOINT_OPTION.answer, 'Faster CSV export')).toEqual({
      type: 'chosen',
      text: 'Faster CSV export',
    });
    expect(chosenInterpretation(card, CHECKPOINT_OPTION.clarifyRules, null)).toEqual({
      type: 'assumed',
      text: 'Improve its documentation',
    });
    expect(chosenInterpretation(card, CHECKPOINT_OPTION.stop, null)).toEqual({ type: 'stopped' });
    expect(assumptionLine('Improve its documentation')).toBe(
      'Assumed you meant: Improve its documentation. Say so if you meant something else.',
    );
  });
});
