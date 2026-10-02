import type { ModelTier } from '@spark-outpost/contracts';

export const POLICY_VERSION = 'laws-3-pinned-orchestrator';

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
export const CRITIC_REREVIEW_EFFORT = 'medium';
export const CRITIC_RECHECK_LINE_SLACK = 3;
export const CRITIC_SAME_CONCERN = 0.5;
export const CRITIC_SMALL_DIFF_LINES = 150;
export const CRITIC_SMALL_DIFF_SOURCE_FILES = 3;
export const CRITIC_SMALL_DIFF_EFFORT = 'medium';
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

export const RATING_ACT_AT = 0.5;

export const ROUTE_REPAIR_USD = 10;
export const ROUTE_STAKES_WEIGHT = [0.5, 1, 1.5, 3, 10] as const;
export const ROUTE_SIZE_WEIGHT = [0.25, 1, 1.5, 2, 3] as const;
export const ROUTE_TRAJECTORY_MTOK = [0.052, 0.09, 0.17, 0.32, 0.65] as const;
export const ROUTE_TOKEN_MIX = { cachedRead: 0.85, cacheWrite: 0.12, output: 0.03 } as const;
export const ROUTE_FAILURE: Readonly<Record<ModelTier, readonly number[]>> = {
  small: [0.02, 0.05, 0.18, 0.3, 0.45],
  mid: [0.003, 0.0045, 0.008, 0.04, 0.1],
  top: [0.003, 0.004, 0.007, 0.015, 0.04],
  frontier: [0.003, 0.004, 0.006, 0.01, 0.025],
};
export const ROUTE_UNCLEAR_STEP = 0.25;
export const ROUTE_ADEQUATE_LOSS = 0.0002;
export const TRIVIAL_OVERRIDE_AT = 3;
export const ROUTE_MEASURED_MIN = 10;
export const PROMPT_CACHE_TTL_MS = 5 * 60_000;
export const ESCALATE_AT = 4;
export const RAISE_EFFORT_AT = 3;
export const HANDOFF_CONTEXT_TOKENS = 100_000;
export const COMPACT_CONTEXT_DEPENDENCE = 4;
export const HANDOFF_TOKENS = 25_000;
export const LOST_REASONING_CAP_TOKENS = 32_000;

export const ROUTER_TIERS = ['micro', 'low', 'mid', 'top'] as const;
export type RouterTier = (typeof ROUTER_TIERS)[number];

export const ROUTER_TIER_OF_CARD: Readonly<Record<ModelTier, RouterTier | null>> = {
  small: 'low',
  mid: 'mid',
  top: 'top',
  frontier: null,
};

export const COORD_POLICY_VERSION = 'coord-5';
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
export const BUILDER_COUNT_AT = 0.7;
export const BUILDERS_MAX = 4;
export const BUILDER_TASKS_MAX = 12;
export const PIECE_SIGNAL_MIN_CONFIDENCE = 0.5;
export const PIECE_DEMAND_WEIGHTS = { reasoning: 0.45, coding: 0.35, context: 0.2 } as const;
export const PIECE_MID_AT = 2.5;
export const PIECE_TOP_AT = 3.5;
export const PIECE_DEEP_REASONING_AT = 4;
export const PIECE_RELIABILITY_TOP_AT = 0.6;
export const PIECE_KIND_MIN_CONFIDENCE = 0.5;
export const PIECE_CAPABILITY_LEAD = 0.75;
export const PIECE_PASS_RATE_MARGIN = 0.1;
export const PIECE_PRICE_MARGIN = 0.1;
export const PIECE_LARGE_CONTEXT_TOKENS = 500_000;
export const PIECE_WIDE_WORKTREE_AT = 0.5;
export const PIECE_SHARED_AT = 0.2;
export const PIECE_BELOW_CHAT_KINDS = ['docs', 'config', 'test'] as const;
export const PIECE_BELOW_CHAT_KIND_CONFIDENCE = 0.8;
export const PIECE_BELOW_CHAT_MAX_REASONING = 2;
export const PIECE_BELOW_CHAT_MAX_CODING = 2;
export const PIECE_BELOW_CHAT_MAX_RELIABILITY = 0.3;
export const PIECE_BELOW_CHAT_MIN_CONFIDENCE = 0.6;
export const PIECE_BELOW_CHAT_MEASURED_MIN = 10;
export const PIECE_BELOW_CHAT_PASS_MARGIN = 0.05;
export const TASK_BELOW_CHAT_MAX_STAKES = 2;
export const COORD_PIECE_FIX_TURNS = 2;
export const COORD_HANDOFF_SHARE = 0.75;
export const COORD_CARD_PIECES = 5;
export const COORD_INTEGRATOR_TRIES = 2;
export const COORD_OWNERSHIP_STRIKES = 2;
export const COORD_PROVIDER_HEALTH_MS = 10 * 60_000;
export const COORD_NOTE_TURNS = 3;
export const COMPACT_SELF_DROP = 0.4;
export const COMPACT_AGENT_WORKED = 0.8;

export const LAW_REMOVED_BLOCK_LINES = 30;
export const LAW_RENAMED_BODY_SHARE = 0.6;
export const LAW_ITEMS_SHOWN = 8;
export const LAW_SCOPE_ITEMS = 5;

export const LAW_ESTIMATE_MIN_RUNS = 5;
export const LAW_ESTIMATE_WINDOW = 20;
export const LAW_ESTIMATE_LOW = 0.2;
export const LAW_ESTIMATE_HIGH = 0.8;
export const LAW_ROUGH_MINUTES = [3, 6, 12, 20, 35] as const;
export const LAW_ROUGH_COST_PAD = 1.5;
export const LAW_ROUGH_RANGE = [0.5, 2] as const;
export const LAW_PAD_MIN_RUNS = 5;
export const LAW_PAD_MAX = 3;

export const LAW_BUDGET_SHARE = [0.3, 0.5, 0.75, 1, 1] as const;
export const LAW_BUDGET_MIN_TOOL_CALLS = 10;
export const LAW_BUDGET_MIN_MS = 3 * 60_000;

export const LAW_DEMOTE_WINDOW = 20;
export const LAW_DEMOTE_MIN_RUNS = 10;
export const LAW_DEMOTE_MARGIN = 0.15;
export const LAW_DEMOTE_FLOOR = 0.6;
