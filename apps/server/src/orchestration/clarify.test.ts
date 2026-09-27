import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, clarifyOptionId, type JevIntake } from '@spark-outpost/contracts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { autoContinueOption } from './checkpoint-policy.ts';
import {
  MAX_INTERPRETATIONS,
  VAGUE_REASON,
  assumptionLine,
  chosenInterpretation,
  interpretationCard,
  interpretations,
  isVagueRequest,
  vagueHandling,
} from './clarify.ts';
import { initialFlow, nextStep } from './transitions.ts';

const intake = (extra: Partial<JevIntake> = {}): JevIntake => ({
  intent: 'docs',
  complexity: 2.8,
  risk: 'edits',
  injection: null,
  depth: 'plan_execute',
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
  confidence: 0.66,
  routeConfidence: 0.75,
  scope: 'codebase',
  confidences: { intent: 0.68, depth: 0.66, scope: 0.29 },
  ...extra,
});

const response = (probabilities: Record<string, number>): SystemOneResponse => ({
  model: 'jev-test',
  answers: {
    intent: { type: 'choice', choice: 'docs', probabilities, confidence: 0.68 },
  },
});

describe('vague requests', () => {
  it('reads "Make the reports better" as vague from its unsure, broad scope', () => {
    expect(isVagueRequest('Make the reports better.', 0, intake())).toBe(true);
    expect(isVagueRequest('Make the reports better.', 0, null)).toBe(true);
  });

  it('follows Jev’s vague question when it is sure', () => {
    expect(isVagueRequest('Make the reports better.', 0, intake({ vague: 0.1 }))).toBe(false);
    expect(isVagueRequest('Handle the new invoice states', 0, intake({ vague: 0.9 }))).toBe(true);
  });

  it('never calls a request that names its files vague', () => {
    expect(isVagueRequest('Make src/report.ts better', 1, intake({ vague: 0.95 }))).toBe(false);
  });

  it('does not call a specific request vague just because it names no files', () => {
    const clear = 'The divider shows the wrong day after midnight. Fix it and add a test.';
    const sure = intake({ scope: 'one_module', confidences: { scope: 0.8 } });
    expect(isVagueRequest(clear, 0, sure)).toBe(false);
    expect(isVagueRequest(clear, 0, null)).toBe(false);
  });

  it('asks at Balanced and Hands-on, and assumes at Hands-off and Full auto', () => {
    expect(vagueHandling('hands-on')).toBe('ask');
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
    expect(autoContinueOption({ kind: 'clarify', fromJev: true, agentAsked: false })).toBe(
      CHECKPOINT_OPTION.clarifyRules,
    );
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

  it('asks the interpretation question before any agent starts', () => {
    const asked = nextStep(initialFlow('plan_execute', 'edits', 'balanced'), {
      type: 'start',
      intake: 'interpret',
    });
    expect(asked.action).toEqual({
      type: 'ask',
      kind: 'clarify',
      reason: VAGUE_REASON,
      suggestion: null,
      fromJev: true,
      interpret: true,
    });
    expect(
      nextStep(asked.state, { type: 'clarified', depth: 'plan_execute' }).action,
    ).toMatchObject({ type: 'spawn', role: 'architect' });
  });
});
