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
  SPEED_KEY,
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

  it('asks at Automatic and assumes only at Full auto', () => {
    expect(vagueHandling('hands-off')).toBe('ask');
    expect(vagueHandling('full-auto')).toBe('assume');
  });

  it('reads the rerun\'s "Make it faster." as vague by rule', () => {
    expect(vagueByRule('Make it faster.', 0)).toBe(true);
  });

  it('reads "fix the thing", "sort it out" and "clean it up" with no named target as vague', () => {
    for (const request of [
      'fix the thing',
      'do the thing',
      'sort it out',
      'clean it up',
      'Can you tidy this up?',
      'handle the stuff',
    ]) {
      expect(vagueByRule(request, 0), request).toBe(true);
    }
    for (const request of [
      'fix the typo in README line 3',
      'Fix the flaky parseDate test',
      'remove the unused imports in the parser',
      'sort the table by date',
      'fix the thing in src/report.ts',
    ]) {
      expect(vagueByRule(request, request.includes('src/') ? 1 : 0), request).toBe(false);
    }
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

describe('clarifying a vague "make it faster" (dev-day s08)', () => {
  const speed = (probabilities: Record<string, number>): SystemOneResponse => ({
    model: 'jev-test',
    answers: {
      intent: {
        type: 'choice',
        choice: 'refactor',
        probabilities: { refactor: 0.6 },
        confidence: 0.5,
      },
      [SPEED_KEY]: { type: 'choice', choice: 'page_load', probabilities, confidence: 0.4 },
    },
  });

  it('reads "make it faster" as vague unless it names what to speed up', () => {
    expect(vagueByRule('Make it faster.', 0)).toBe(true);
    expect(vagueByRule('Speed it up', 0)).toBe(true);
    expect(vagueByRule('Make the tests faster', 0)).toBe(false);
    expect(vagueByRule('Make the Spend page load faster', 0)).toBe(false);
  });

  it('offers performance choices, never the generic category readings', () => {
    const choices = interpretations(null, 'Make it faster.');
    expect(choices).toEqual([
      'Startup: make the app and dev server start faster',
      'Page load: make pages load and render faster',
      'Tests: make the test suite run faster',
      'Build: make builds and type checks faster',
    ]);
    expect(choices.join(' ')).not.toMatch(/Restructure|new behaviour/);
  });

  it('orders the choices by Jev, two to four of them, and names the project’s own checks', () => {
    const ranked = speed({
      page_load: 0.55,
      queries: 0.25,
      startup: 0.12,
      tests: 0.05,
      build: 0.03,
    });
    expect(interpretations(ranked, 'Make it faster.', ['pnpm test', 'pnpm typecheck'])).toEqual([
      'Page load: make pages load and render faster',
      'API and database: make slow requests and queries faster',
      'Startup: make the app and dev server start faster',
    ]);
    const sure = speed({ tests: 0.96, build: 0.02, startup: 0.01, page_load: 0.01 });
    expect(interpretations(sure, 'Make it faster.', ['pnpm test'])).toEqual([
      'Tests: make `pnpm test` run faster',
      'Build: make builds and type checks faster',
    ]);
  });

  it('keeps the free-text answer on the card', () => {
    const card = interpretationCard(interpretations(null, 'Make it faster.'), 'why');
    expect(card.options.map((option) => option.optionId)).toContain(CHECKPOINT_OPTION.answer);
    expect(card.options[0]!.name).toMatch(/^Startup/);
  });
});
