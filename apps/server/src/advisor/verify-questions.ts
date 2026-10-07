import { redactText } from '../audit/redact.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';
import { validChoice, validNoul } from './intake-questions.ts';
import { ACT_AT } from './policy.ts';
import { capped, MAX_DIFF_CHARACTERS, MAX_REQUEST_CHARACTERS, noulQuestion } from './questions.ts';

export const MAX_REQUIREMENTS = 5;
export const MAX_PLAN_ENTRIES = 12;
export const MAX_CHECK_CHARACTERS = 3_000;
const MIN_REQUIREMENT_WORDS = 3;
const UNMET_REASON_AT = 0.5;

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

export const VERDICTS = ['supported', 'unsupported', 'declined'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_QUESTION = {
  question: 'Does `diff` do what `task` asks?',
  how: 'Check every requirement `task` states, including named cases, values, formats and edge cases, against the lines in `diff`. Passing `checks` only show the project’s own tests pass; they do not show that a requirement is met.',
  ignore: 'Do not judge by the size of the diff, its style, or how many tests it adds.',
};

export const VERDICT_CRITERIA: Record<Verdict, Record<string, string>> = {
  supported: {
    what: 'Every requirement stated in `task` is visibly done by the lines in `diff`',
    not_for: 'a diff that does most of the task but skips or gets wrong one stated case',
  },
  unsupported: {
    what: 'At least one stated requirement is missing, only partly done, or done differently from what `task` says, even if the checks pass',
    not_for: 'work that is complete but written in a style you would not choose',
  },
  declined: {
    what: 'The evidence cannot settle it: `diff` is empty or cut off, or the work was refused or deliberately left unfinished',
    not_for: 'a complete diff that simply misses a requirement (unsupported)',
  },
};

export interface VerdictFacts {
  request: string;
  plan: readonly string[];
  requirements: readonly string[];
  diff: string;
  checks: readonly string[];
}

export const unmetKey = (index: number) => `unmet_${index + 1}`;

export function buildVerdictQuestions(facts: VerdictFacts): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {
    verdict: { type: 'choice', instructions: VERDICT_QUESTION, criteria: VERDICT_CRITERIA },
  };
  facts.requirements.forEach((requirement, index) => {
    questions[unmetKey(index)] = noulQuestion(
      {
        question: 'Does `diff` fail to do this requirement from `task`?',
        requirement: capped(redactText(requirement), 500),
      },
      {
        true: 'The diff does not do it, or does only part of it',
        false: 'The diff clearly does it',
      },
    );
  });
  const plan = facts.plan.slice(0, MAX_PLAN_ENTRIES).map((entry) => capped(entry, 300));
  return {
    state: {
      task: capped(redactText(facts.request), MAX_REQUEST_CHARACTERS),
      plan: plan.length > 0 ? plan : 'No plan was made.',
      checks: capped(
        redactText(facts.checks.length > 0 ? facts.checks.join('\n') : 'No checks ran.'),
        MAX_CHECK_CHARACTERS,
      ),
      diff: capped(redactText(facts.diff), MAX_DIFF_CHARACTERS),
    },
    questions,
  };
}

export function diffIsCut(diff: string): boolean {
  return redactText(diff).length > MAX_DIFF_CHARACTERS;
}

export interface VerdictReading {
  cut: boolean;
  verdict: Verdict | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  accepted: Verdict | null;
  unmet: { requirement: string; noul: number | null }[];
  reasons: string[];
  invalid: string[];
}

export function readVerdict(
  requirements: readonly string[],
  response: SystemOneResponse | null,
  cut = false,
): VerdictReading {
  const invalid: string[] = [];
  const choice = validChoice(response, 'verdict', VERDICTS);
  if (!choice) invalid.push('verdict');
  const unmet = requirements.map((requirement, index) => {
    const noul = validNoul(response, unmetKey(index));
    if (noul === null) invalid.push(unmetKey(index));
    return { requirement, noul };
  });
  const sure = choice && choice.confidence >= ACT_AT.verify ? choice.value : null;
  const accepted = cut && sure === 'supported' ? null : sure;
  return {
    cut,
    verdict: choice?.value ?? null,
    confidence: choice?.confidence ?? null,
    probabilities: choice?.probabilities ?? null,
    accepted,
    unmet,
    reasons: unmet
      .filter((entry) => (entry.noul ?? 0) >= UNMET_REASON_AT)
      .map((entry) => entry.requirement),
    invalid,
  };
}
