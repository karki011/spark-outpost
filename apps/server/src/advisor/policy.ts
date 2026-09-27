export const POLICY_VERSION = 'cascade-1';

export type ActingQuestion =
  'question' | 'vague' | 'review' | 'destructive' | 'continues_task' | 'verify';

export type ObservedQuestion = 'tier' | 'policy';

export const ACT_AT: Record<ActingQuestion | ObservedQuestion, number> = {
  question: 0.8,
  vague: 0.8,
  review: 0.8,
  destructive: 0.8,
  continues_task: 0.8,
  tier: 0.9,
  policy: 0.85,
  verify: 0.8,
};

export const ASK_AT = 0.5;

export const POLICY_BLOCK_AT = 0.85;
export const POLICY_REVIEW_AT = 0.5;

export const LARGE_DIFF_LINES = 400;
export const LARGE_DIFF_FILES = 10;

export const CHECK_FIXES = 2;
export const PLAN_CONTINUES = 2;
export const MAX_VERDICTS = 2;
export const LOOP_STREAK = 5;

export const FOLLOW_UP_WORDS = 15;
export const FOLLOW_UP_MINUTES = 10;
