import { redactText } from '../audit/redact.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';
import { validNoul } from './intake-questions.ts';
import { capped, MAX_DIFF_CHARACTERS, MAX_REQUEST_CHARACTERS } from './policy-gate.ts';
import { ACT_AT } from './policy.ts';
import { noulQuestion } from './questions.ts';

export const MAX_REQUIREMENTS = 5;
const MIN_REQUIREMENT_WORDS = 3;

const SENTENCE = /(?<=[.!?])\s+|\n+|;\s+/;
const BULLET = /^\s*(?:[-*]|\d+[.)])\s+/;
const TAG = /\s*#\w+(?:\s+\d+)?/g;

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function requirementLines(request: string, planEntries: readonly string[] = []): string[] {
  const source =
    planEntries.length > 0
      ? planEntries
      : request
          .replace(TAG, '')
          .split(SENTENCE)
          .map((line) => line.replace(BULLET, '').trim());
  const kept = source
    .map((line) => line.trim())
    .filter((line) => words(line) >= MIN_REQUIREMENT_WORDS);
  const lines = kept.length > 0 ? kept : [request.replace(TAG, '').trim()];
  return lines.slice(0, MAX_REQUIREMENTS);
}

export interface VerifyFacts {
  request: string;
  requirements: readonly string[];
  diff: string;
}

export const unmetKey = (index: number) => `unmet_${index + 1}`;

export function buildVerifyQuestions(facts: VerifyFacts): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  facts.requirements.forEach((requirement, index) => {
    questions[unmetKey(index)] = noulQuestion(
      {
        question: 'Does `diff` fail to do this requirement from `request`?',
        requirement: capped(redactText(requirement), 500),
      },
      {
        true: 'The diff does not do it, or does only part of it',
        false: 'The diff clearly does it',
      },
    );
  });
  questions.weakens_tests = noulQuestion('Does `diff` weaken or delete tests to make them pass?', {
    true: 'It removes, skips or loosens tests or assertions',
    false: 'Tests and assertions are kept or strengthened',
  });
  return {
    state: {
      request: capped(redactText(facts.request), MAX_REQUEST_CHARACTERS),
      diff: capped(redactText(facts.diff), MAX_DIFF_CHARACTERS),
    },
    questions,
  };
}

export interface VerifyVerdict {
  unmet: { requirement: string; noul: number | null }[];
  weakensTests: number | null;
  invalid: string[];
  worst: number | null;
  would: 'pass' | 'flag' | 'review';
}

export function verifyVerdict(
  requirements: readonly string[],
  response: SystemOneResponse | null,
): VerifyVerdict {
  const invalid: string[] = [];
  const read = (key: string) => {
    const value = validNoul(response, key);
    if (value === null) invalid.push(key);
    return value;
  };
  const unmet = requirements.map((requirement, index) => ({
    requirement,
    noul: read(unmetKey(index)),
  }));
  const weakensTests = read('weakens_tests');
  const known = [...unmet.map((entry) => entry.noul), weakensTests].filter(
    (value): value is number => value !== null,
  );
  const worst = known.length > 0 ? Math.max(...known) : null;
  const would =
    worst !== null && worst >= ACT_AT.verify ? 'flag' : invalid.length > 0 ? 'review' : 'pass';
  return { unmet, weakensTests, invalid, worst, would };
}
