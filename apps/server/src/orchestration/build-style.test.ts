import { describe, expect, it } from 'vitest';
import type { IntakeRequest } from '../advisor/advice.ts';
import { buildStyleQuestion } from '../advisor/build-style-question.ts';
import { buildIntakeQuestions } from '../advisor/intake-questions.ts';
import {
  allowedStyles,
  chooseStyle,
  intakeStyle,
  parseStyleAnswer,
  styleSummary,
} from './build-style.ts';
import type { Session } from './session.ts';

const session = { flow: { risk: 'edits', level: 'balanced' } } as unknown as Session;
const rule = { style: 'lean' as const, reason: 'project setting' };

function answer(choice: string, confidence: number) {
  return {
    model: 'jev',
    answers: { build_style: { type: 'choice' as const, choice, probabilities: {}, confidence } },
  };
}

describe('Jev’s build style choice', () => {
  it('only offers styles up to the project setting', () => {
    expect(allowedStyles('lite')).toEqual(['off', 'lite']);
    expect(Object.keys(buildStyleQuestion('lite').criteria)).toEqual(['off', 'lite']);
    expect(parseStyleAnswer(answer('lean', 0.99), 'lite')).toBeNull();
  });

  it('acts at 0.8 or more and otherwise keeps the rule', () => {
    const sure = parseStyleAnswer(answer('lite', 0.86), 'lean');
    const acted = chooseStyle(rule, sure, session);
    expect(acted).toMatchObject({ style: 'lite', applied: 'jev' });
    expect(acted.gate).toMatchObject({ decision: 'act', actAt: 0.8 });
    expect(styleSummary(acted, rule, sure)).toBe(
      'Build style lite · rule would have used lean (project setting) · Jev said lite at 0.86',
    );
    const unsure = parseStyleAnswer(answer('off', 0.62), 'lean');
    expect(chooseStyle(rule, unsure, session)).toMatchObject({ style: 'lean', applied: 'rules' });
    expect(chooseStyle(rule, null, session)).toEqual({
      style: 'lean',
      applied: 'rules',
      gate: null,
    });
  });

  it('reuses the intake batch’s answer instead of asking again', () => {
    const response = answer('lite', 0.9);
    const outcome = { status: 'answered', response } as unknown as Parameters<
      typeof intakeStyle
    >[0];
    expect(intakeStyle(outcome)).toEqual({
      status: 'not_asked',
      response,
      model: 'jev',
      error: null,
    });
    expect(intakeStyle({ status: 'not_connected' })).toMatchObject({ response: null });
    const failed = {
      status: 'timed_out',
      error: 'late',
      model: 'jev-1.13.0',
      asked: null,
      latencyMs: 3000,
    } as const;
    expect(intakeStyle(failed)).toMatchObject({
      status: 'timed_out',
      error: 'late',
      response: null,
    });
  });

  it('joins the intake batch as a speculative question only for a Do turn in a styled project', () => {
    const request: IntakeRequest = {
      task: 'Add a cache',
      mode: 'do',
      reposLinked: true,
      untrusted: [],
      candidates: [{ provider: 'claude', name: 'Claude', models: [], efforts: [] }],
      current: { provider: 'claude', model: null, modelLabel: null, effort: null },
      level: 'balanced',
      routing: 'pinned',
    };
    const asked = (overrides: Partial<IntakeRequest>) =>
      buildIntakeQuestions({ ...request, ...overrides }).questions.build_style;
    expect(asked({ buildStyle: 'lean' })).toEqual(buildStyleQuestion('lean'));
    expect(asked({ buildStyle: 'off' })).toBeUndefined();
    expect(asked({})).toBeUndefined();
    expect(asked({ mode: 'ask', buildStyle: 'lean' })).toBeUndefined();
  });
});
