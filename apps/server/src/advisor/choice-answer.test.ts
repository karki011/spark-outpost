import { describe, expect, it } from 'vitest';
import { byProbability, readChoice } from './choice-answer.ts';
import type { SystemOneResponse } from './intake-questions.ts';

const OFFERED = ['a', 'b', 'uncertain'];

function response(answer: unknown): SystemOneResponse {
  return { model: 'jev-1.13.0', answers: { route: answer } } as SystemOneResponse;
}

function choice(choice: string, probabilities: Record<string, number>, confidence = 0.8) {
  return response({ type: 'choice', choice, confidence, probabilities });
}

describe('Choice answer validation', () => {
  it('fills omitted options with zero mass', () => {
    expect(readChoice(choice('a', { a: 0.9, uncertain: 0.1 }), 'route', OFFERED)).toEqual({
      choice: 'a',
      confidence: 0.8,
      probabilities: { a: 0.9, b: 0, uncertain: 0.1 },
    });
  });

  it('accepts two-decimal rounding', () => {
    expect(
      readChoice(choice('a', { a: 0.34, b: 0.33, uncertain: 0.34 }), 'route', OFFERED),
    ).not.toBeTypeOf('string');
  });

  it.each([
    ['missing-answer', { model: 'jev-1.13.0', answers: {} } as SystemOneResponse],
    ['unexpected-answer-type', response({ type: 'noul', noul: 0.4 })],
    ['unknown-choice', choice('foreign-route', { 'foreign-route': 1 })],
    ['invalid-confidence', choice('a', { a: 1 }, 1.4)],
    ['distribution-keys', choice('a', { a: 0.9, foreign: 0.1 })],
    ['distribution-keys', choice('a', { a: 1.2 })],
    ['distribution-sum', choice('a', { a: 0.5, b: 0.2 })],
    ['distribution-argmax', choice('a', { a: 0.3, b: 0.7 })],
  ] as const)('names the failing check: %s', (issue, raw) => {
    expect(readChoice(raw, 'route', OFFERED)).toBe(issue);
  });

  it('orders options by probability and drops empty ones', () => {
    expect(byProbability({ a: 0.2, b: 0.7, c: 0, d: 0.2 })).toEqual([
      ['b', 0.7],
      ['a', 0.2],
      ['d', 0.2],
    ]);
  });
});
