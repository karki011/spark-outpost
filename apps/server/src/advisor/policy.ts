import type { ModelTier } from '@spark-outpost/contracts';

export const POLICY_VERSION = 'lean-2';

export type ActingQuestion = 'question' | 'vague' | 'review' | 'destructive' | 'continues_task';

export type ObservedQuestion = 'tier' | 'policy' | 'verify';

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
export const LOOP_STREAK = 5;

export const FOLLOW_UP_WORDS = 15;
export const FOLLOW_UP_MINUTES = 10;

export const ROUTE_ACCEPT_CONFIDENCE = 0.65;
export const ROUTE_CUMULATIVE_MASS = 0.8;

export const RANK_PREDICTED_FILES = 12;

export const ROUTER_TIERS = ['micro', 'low', 'mid', 'top'] as const;
export type RouterTier = (typeof ROUTER_TIERS)[number];

export const ROUTER_TIER_OF_CARD: Readonly<Record<ModelTier, RouterTier | null>> = {
  small: 'low',
  mid: 'mid',
  top: 'top',
  frontier: null,
};
