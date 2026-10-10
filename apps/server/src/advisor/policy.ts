import type { ModelTier } from '@spark-outpost/contracts';

export const POLICY_VERSION = 'intake-3-plan-presence';

export const ROUTE_ACCEPT_CONFIDENCE = 0.65;
export const ROUTE_CUMULATIVE_MASS = 0.8;

export const RANK_PREDICTED_FILES = 12;

export const PROMPT_CACHE_TTL_MS = 5 * 60_000;
export const LOST_REASONING_CAP_TOKENS = 32_000;

export const ROUTER_TIERS = ['micro', 'low', 'mid', 'top'] as const;
export type RouterTier = (typeof ROUTER_TIERS)[number];

export const ROUTER_TIER_OF_CARD: Readonly<Record<ModelTier, RouterTier | null>> = {
  small: 'low',
  mid: 'mid',
  top: 'top',
  frontier: null,
};

export const COORD_POLICY_VERSION = 'coord-6';
export const COMPACT_SELF_DROP = 0.4;
export const COMPACT_AGENT_WORKED = 0.8;
