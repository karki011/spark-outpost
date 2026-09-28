import type { ModelTier } from '@spark-outpost/contracts';

export const POLICY_VERSION = 'fixturn-3-devday-rerun';

export type ActingQuestion =
  | 'question'
  | 'plan_only'
  | 'vague'
  | 'review'
  | 'destructive'
  | 'continues_task'
  | 'verify'
  | 'finding';

export type ObservedQuestion = 'tier' | 'policy';

export const ACT_AT: Record<ActingQuestion | ObservedQuestion, number> = {
  question: 0.8,
  plan_only: 0.8,
  vague: 0.8,
  review: 0.8,
  destructive: 0.8,
  continues_task: 0.8,
  tier: 0.9,
  policy: 0.85,
  verify: 0.8,
  finding: 0.8,
};

export const ASK_AT = 0.5;

export const PLAN_AGREED_ACT_AT = 0.85;
export const PLAN_AGREED_OFFER_AT = 0.6;

export const POLICY_BLOCK_AT = 0.85;
export const POLICY_REVIEW_AT = 0.5;

export const LARGE_DIFF_LINES = 400;
export const LARGE_DIFF_FILES = 10;

export const CHECK_FIXES = 2;
export const CRITIC_FIX_ROUNDS = 3;
/** One Critic fix round (fix turn, its check fixes and the re-review) gets this share of the run's tool calls… */
export const FIX_ROUND_TOOL_SHARE = 0.25;
/** …but never fewer than this many… */
export const FIX_ROUND_MIN_TOOL_CALLS = 20;
/** …and at most this much active time. */
export const FIX_ROUND_ACTIVE_MS = 4 * 60 * 1000;
export const PLAN_CONTINUES = 2;
export const MAX_VERDICTS = 2;
export const LOOP_STREAK = 5;

export const FOLLOW_UP_WORDS = 15;
export const FOLLOW_UP_MINUTES = 10;

export const ROUTE_ACCEPT_CONFIDENCE = 0.65;
export const ROUTE_CUMULATIVE_MASS = 0.8;

export const RANK_PREDICTED_FILES = 12;

export const COMPLEX_JEV_AT = 0.8;
export const BROAD_SCAN_FILES = 15;
export const BROAD_SCAN_PACKAGES = 3;
export const BROAD_SCAN_SCORE = 0.35;
export const SMALL_JEV_AT = 0.8;

export const ROUTER_TIERS = ['micro', 'low', 'mid', 'top'] as const;
export type RouterTier = (typeof ROUTER_TIERS)[number];

export const ROUTER_TIER_OF_CARD: Readonly<Record<ModelTier, RouterTier | null>> = {
  small: 'low',
  mid: 'mid',
  top: 'top',
  frontier: null,
};
