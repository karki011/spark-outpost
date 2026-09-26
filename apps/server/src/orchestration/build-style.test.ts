import { describe, expect, it } from 'vitest';
import {
  allowedStyles,
  buildStyleQuestions,
  chooseStyle,
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
    const asked = buildStyleQuestions('Add a cache', 'lite');
    expect(Object.keys(asked.questions.build_style!.criteria as object)).toEqual(['off', 'lite']);
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
});
