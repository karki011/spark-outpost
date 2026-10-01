import type { RatingKey, Ratings } from '@spark-outpost/contracts';
import type { SystemOneResponse } from './intake-questions.ts';

export const RATING_LEVELS = 5;

export const RATING_QUESTION_KEYS: Readonly<Record<RatingKey, string>> = {
  complexity: 'complexity',
  ambiguity: 'ambiguity',
  stakes: 'stakes',
  contextDependence: 'context_dependence',
};

interface RatingQuestion {
  instructions: string;
  levels: readonly [string, string, string, string, string];
}

export const RATING_QUESTIONS: Readonly<Record<RatingKey, RatingQuestion>> = {
  complexity: {
    instructions: 'How much work is `task` for a coding agent?',
    levels: [
      'A one-line change: a typo, a renamed variable, a changed constant',
      'One small, well-defined change in one place',
      'Several steps or files, with a few choices along the way',
      'Design decisions across many files or packages, or a migration',
      'A large, open-ended change to how the system is built',
    ],
  },
  ambiguity: {
    instructions: 'How clearly does `task` say what to change and what done looks like?',
    levels: [
      'Exact: names the place and the expected result',
      'Clear: a competent developer would build the same thing',
      'Some reading needed: a few details are left open',
      'Underspecified: reasonable people would build different things',
      'Unclear: the goal itself needs to be worked out first',
    ],
  },
  stakes: {
    instructions: 'What would a subtle mistake in doing `task` cost?',
    levels: [
      'Nothing much: wording, docs, comments or formatting',
      'An ordinary bug that tests or review would catch and git can undo',
      'Wrong behaviour users would see, or a bug in code many places rely on',
      'Security, authentication, money, stored data or a public interface',
      'Lost data or history that cannot be restored',
    ],
  },
  contextDependence: {
    instructions:
      'How much does doing `task` depend on context it does not state: earlier turns, `previous_request`, or code it does not name?',
    levels: [
      'None: everything needed is in `task`',
      'Little: the named files are enough',
      'Some: needs to read nearby code or one earlier turn',
      'Much: builds on earlier turns or on code spread across the project',
      'Almost all: only makes sense with the whole conversation or codebase',
    ],
  },
};

export function ratingQuestions(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(RATING_QUESTIONS).map(([key, question]) => [
      RATING_QUESTION_KEYS[key as RatingKey],
      { type: 'score', instructions: question.instructions, criteria: [...question.levels] },
    ]),
  );
}

export function validScore(response: SystemOneResponse, key: string) {
  const answer = response.answers[key];
  if (answer?.type !== 'score') return null;
  const { score, confidence } = answer;
  if (!Number.isFinite(score) || score < 0 || score > RATING_LEVELS - 1) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { value: Math.round(score) + 1, confidence };
}

export interface ParsedRatings {
  ratings: Ratings;
  invalid: string[];
}

export function parseRatings(
  asked: Readonly<Record<string, unknown>>,
  response: SystemOneResponse,
): ParsedRatings {
  const ratings: Ratings = {};
  const invalid: string[] = [];
  for (const [key, question] of Object.entries(RATING_QUESTION_KEYS)) {
    if (!asked[question]) continue;
    const rating = validScore(response, question);
    if (rating) ratings[key as RatingKey] = rating;
    else invalid.push(question);
  }
  return { ratings, invalid };
}
