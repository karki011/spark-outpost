import type { ModelTier } from '@spark-outpost/contracts';

export const POLICY_VERSION = 'intent-3-tagged-findings-prose-plans';

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
export const FIX_ROUND_TOOL_SHARE = 0.25;
export const FIX_ROUND_MIN_TOOL_CALLS = 20;
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

export const COORD_POLICY_VERSION = 'coord-2';
export const COORD_MAX_PIECES = 8;
export const COORD_ENGAGE_PLAN_ITEMS = 4;
export const COORD_ENGAGE_PLAN_AREAS = 2;
export const COORD_ENGAGE_SCAN_FILES = 12;
export const COORD_ENGAGE_SCAN_PACKAGES = 3;
export const COORD_TOO_BIG_BAND = 0.2;
export const COORD_BUILDER_BUDGET_SHARE = 0.5;
export const COORD_BUILDER_BUDGET_CAP = 150_000;
export const COORD_LARGE_PIECE_TOKENS = 40_000;
export const COORD_LARGE_PIECE_FILES = 5;
export const COORD_LONG_PIECE_TOKENS = 90_000;
export const COORD_CRITICAL_PATH_SAVING = 0.35;
export const COORD_SPLIT_UNSURE_AT = 0.2;
export const COORD_JEV_ACT_AT = 0.8;
export const COORD_PIECE_FIX_TURNS = 2;
export const COORD_HANDOFF_SHARE = 0.75;
export const COORD_CARD_PIECES = 5;
export const COORD_INTEGRATOR_TRIES = 2;
