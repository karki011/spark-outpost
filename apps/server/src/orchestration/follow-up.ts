import { NO_TARGET } from './clarify.ts';
import { wordCount } from './risk-rules.ts';

const FOLLOW_UP_MAX_WORDS = 6;

const GENERIC_FOLLOW_UP =
  /^\s*(?:(?:ok(?:ay)?|now|so|then|please|pls|just|alright|yes)[,\s]+)*(?:do (?:it|that|this|the rest)|fix (?:it|that|this|them)|continue|go on|carry on|keep going|proceed|wrap (?:it |this |that )?up|finish (?:it|up|this|that|off)|make it work|same again|next|again)\b/i;

const OFFERS_NEXT_STEP =
  /\b(?:want me to|should I|shall I|would you like(?: me)? to|I can also|next steps?|here'?s (?:a|the|my) plan)\b|^\s*(?:\d+[.)]|[-*+])\s+\S/im;

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
