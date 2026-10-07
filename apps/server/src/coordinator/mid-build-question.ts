import {
  ANSWER_INTENTS,
  validChoice,
  type SystemOneResponse,
} from '../advisor/intake-questions.ts';
import { NEED_ACT_AT } from '../advisor/need-question.ts';
import { intentByRule } from '../orchestration/intent-rules.ts';
import { redactedExcerpt } from '../routing/route-state.ts';

export const MID_BUILD_KEY = 'mid_build';
export const MID_BUILD_OPTIONS = ['question', 'requirement', 'unrelated'] as const;
export type MidBuildKind = (typeof MID_BUILD_OPTIONS)[number];

const TASK_LIMIT = 4_000;
const BUILD_LIMIT = 2_000;

export interface MidBuildRead {
  kind: MidBuildKind;
  source: 'jev' | 'rules';
  confidence: number | null;
}

export function midBuildQuestions(message: string, request: string) {
  return {
    state: {
      task: redactedExcerpt(message, TASK_LIMIT),
      build: redactedExcerpt(request, BUILD_LIMIT),
    },
    questions: {
      [MID_BUILD_KEY]: {
        type: 'choice' as const,
        instructions:
          'Agents are building `build` right now. What is `task`, which the user just sent? Pick one.',
        criteria: {
          question: {
            what: 'It asks for an answer, an explanation or a status report, and asks for nothing to be changed',
            not_for: 'Any request to change, add, fix or remove something',
          },
          requirement: {
            what: 'It adds to, narrows or corrects what `build` should produce',
            not_for: 'Work that has nothing to do with `build`, or a question',
          },
          unrelated: {
            what: 'It asks for separate work that is not part of `build`',
            not_for: 'A change to what `build` produces, or a question',
          },
        },
      },
    },
  };
}

const ADDS = /^\s*(?:also|and also|plus|add|make sure|don't forget|do not forget)\b/i;

export function midBuildByRule(message: string): MidBuildKind {
  if (ADDS.test(message)) return 'requirement';
  return ANSWER_INTENTS.includes(intentByRule(message, 'do')) ? 'question' : 'unrelated';
}

export function readMidBuild(message: string, response: SystemOneResponse | null): MidBuildRead {
  const jev = validChoice(response, MID_BUILD_KEY, MID_BUILD_OPTIONS);
  if (jev && jev.confidence >= NEED_ACT_AT) {
    return { kind: jev.value, source: 'jev', confidence: jev.confidence };
  }
  return { kind: midBuildByRule(message), source: 'rules', confidence: jev?.confidence ?? null };
}
