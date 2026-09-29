import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  clarifyOptionId,
} from '@spark-outpost/contracts';
import type { CheckpointCard } from './checkpoint.ts';
import { NO_TARGET } from './clarify.ts';
import { wordCount } from './risk-rules.ts';

export const FOLLOW_UP_QUESTION = 'Want me to answer, plan it, or make the change?';
export const FOLLOW_UP_REASON = "The request doesn't say what it refers to.";

const FOLLOW_UP_MAX_WORDS = 6;

const GENERIC_FOLLOW_UP =
  /^\s*(?:(?:ok(?:ay)?|now|so|then|please|pls|just|alright|yes)[,\s]+)*(?:do (?:it|that|this|the rest)|fix (?:it|that|this|them)|continue|go on|carry on|keep going|proceed|wrap (?:it |this |that )?up|finish (?:it|up|this|that|off)|make it work|same again|next|again)\b/i;

const OFFERS_NEXT_STEP =
  /\b(?:want me to|should I|shall I|would you like(?: me)? to|I can also|next steps?|here'?s (?:a|the|my) plan)\b|^\s*(?:\d+[.)]|[-*+])\s+\S/im;

export type FollowUpStart = 'answer' | 'plan' | 'build';

const CHOICES: readonly { text: string; start: FollowUpStart }[] = [
  { text: 'Answer it; change nothing', start: 'answer' },
  { text: 'Plan it first', start: 'plan' },
  { text: 'Make the change', start: 'build' },
];

export interface FollowUpFacts {
  request: string;
  namedFiles: number;
  previousReply: string | null;
  recentTask: boolean;
}

export function offersNextStep(reply: string | null): boolean {
  return reply !== null && OFFERS_NEXT_STEP.test(reply);
}

export function vagueFollowUpByRule(facts: FollowUpFacts): boolean {
  if (facts.namedFiles > 0 || wordCount(facts.request) > FOLLOW_UP_MAX_WORDS) return false;
  if (!GENERIC_FOLLOW_UP.test(facts.request) && !NO_TARGET.test(facts.request)) return false;
  return !facts.recentTask && !offersNextStep(facts.previousReply);
}

export function followUpCard(reason: string): CheckpointCard {
  const choices = CHOICES.map((choice) => choice.text);
  const payload = checkpointPayloadSchema.parse({
    kind: 'clarify',
    question: FOLLOW_UP_QUESTION,
    reason,
    choices,
  });
  return {
    kind: 'clarify',
    title: FOLLOW_UP_QUESTION,
    payload,
    options: [
      ...choices.map((choice, index) => ({
        optionId: clarifyOptionId(index),
        name: choice,
        kind: 'allow_once' as const,
      })),
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export interface ChosenFollowUp {
  start: FollowUpStart;
  note: string | null;
}

export function chosenFollowUp(
  card: CheckpointCard,
  optionId: string,
  note: string | null,
): ChosenFollowUp | null {
  if (optionId === CHECKPOINT_OPTION.stop) return null;
  const written = note?.trim();
  if (optionId === CHECKPOINT_OPTION.answer && written) return { start: 'build', note: written };
  const index = card.options.findIndex((option) => option.optionId === optionId);
  return { start: CHOICES[index]?.start ?? 'answer', note: null };
}
