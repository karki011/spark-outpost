import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import { parseRatings, ratingQuestions } from './rating-questions.ts';

const score = (value: number, confidence = 0.8) => ({
  type: 'score' as const,
  score: value,
  confidence,
});

function response(answers: Record<string, unknown>): SystemOneResponse {
  return { model: 'jev-1.13.0', answers: answers as SystemOneResponse['answers'] };
}

describe('rating questions', () => {
  it('asks four five-level scores, each level a situation', () => {
    const asked = ratingQuestions();
    expect(Object.keys(asked)).toEqual(['complexity', 'ambiguity', 'stakes', 'context_dependence']);
    for (const question of Object.values(asked)) {
      expect(question).toMatchObject({ type: 'score' });
      expect(question.criteria).toHaveLength(5);
    }
  });

  it('turns a zero-based score into a 1–5 rating, rounding a fractional score', () => {
    const parsed = parseRatings(
      ratingQuestions(),
      response({
        complexity: score(3.4),
        ambiguity: score(0, 0.2),
        stakes: score(4),
        context_dependence: score(1.6),
      }),
    );
    expect(parsed).toEqual({
      ratings: {
        complexity: { value: 4, confidence: 0.8 },
        ambiguity: { value: 1, confidence: 0.2 },
        stakes: { value: 5, confidence: 0.8 },
        contextDependence: { value: 3, confidence: 0.8 },
      },
      invalid: [],
    });
  });

  it('drops a missing, out-of-range or wrongly typed answer and names it', () => {
    const parsed = parseRatings(
      ratingQuestions(),
      response({
        complexity: score(5),
        ambiguity: { type: 'noul', noul: 0.4 },
        stakes: score(2, 1.3),
      }),
    );
    expect(parsed.ratings).toEqual({});
    expect(parsed.invalid).toEqual(['complexity', 'ambiguity', 'stakes', 'context_dependence']);
  });

  it('ignores ratings that were not asked', () => {
    expect(parseRatings({}, response({ complexity: score(1) }))).toEqual({
      ratings: {},
      invalid: [],
    });
  });
});
