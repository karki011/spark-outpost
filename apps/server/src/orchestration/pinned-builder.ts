import type { AgentPick, Ratings } from '@spark-outpost/contracts';
import {
  PIECE_BELOW_CHAT_MAX_REASONING,
  PIECE_BELOW_CHAT_MIN_CONFIDENCE,
  RATING_ACT_AT,
  TASK_BELOW_CHAT_MAX_STAKES,
} from '../advisor/policy.ts';
import { modelTier } from './tiers.ts';

export type PinnedStep = 'below' | 'above' | 'same';

function sure(rating: { confidence: number } | undefined, at: number): boolean {
  return rating !== undefined && rating.confidence >= at;
}

export function jevRated(ratings: Ratings | null | undefined): boolean {
  return sure(ratings?.complexity, RATING_ACT_AT) && sure(ratings?.stakes, RATING_ACT_AT);
}

export function taskClearlySimple(ratings: Ratings | null | undefined): boolean {
  const complexity = ratings?.complexity;
  const stakes = ratings?.stakes;
  return (
    sure(complexity, PIECE_BELOW_CHAT_MIN_CONFIDENCE) &&
    sure(stakes, PIECE_BELOW_CHAT_MIN_CONFIDENCE) &&
    complexity!.value <= PIECE_BELOW_CHAT_MAX_REASONING &&
    stakes!.value <= TASK_BELOW_CHAT_MAX_STAKES
  );
}

function tierOf(pick: AgentPick): number | null {
  return modelTier({ id: pick.model ?? '', label: pick.modelLabel ?? '' }, pick.provider);
}

export function pinnedStep(pinned: AgentPick, picked: AgentPick): PinnedStep {
  const from = tierOf(pinned);
  const to = tierOf(picked);
  if (from === null || to === null || from === to) return 'same';
  return to < from ? 'below' : 'above';
}

function label(pick: AgentPick): string {
  return pick.modelLabel ?? pick.model ?? 'model';
}

export function pinnedRule(step: Exclude<PinnedStep, 'same'>, pinned: AgentPick): string {
  return step === 'below'
    ? `Jev: clearly simple, below your pinned ${label(pinned)}`
    : `Jev: hard work, above your pinned ${label(pinned)}`;
}
