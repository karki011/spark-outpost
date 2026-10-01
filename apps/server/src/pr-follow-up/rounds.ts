import {
  PR_FOLLOW_UP_MAX_ROUNDS,
  type FeedbackKind,
  type FeedbackState,
  type FeedbackTriage,
} from '@spark-outpost/contracts';
import type { PrFollowUpSettings } from '../persistence/pr-settings.ts';

export const BASE_INTERVAL_SECONDS = 120;
export const MAX_INTERVAL_SECONDS = 30 * 60;
export const BUSY_INTERVAL_SECONDS = 20;

export function stateFor(
  item: { kind: FeedbackKind; trusted: boolean },
  triage: FeedbackTriage,
  settings: PrFollowUpSettings,
): FeedbackState {
  if (triage === 'disagree') return 'needs_user';
  if (triage === 'addressed' || triage === 'info') return 'done';
  if (!item.trusted) return 'held';
  if (item.kind === 'check' ? !settings.fixChecks : !settings.handleReviews) return 'held';
  if (triage === 'question' && !settings.reply) return 'needs_user';
  return 'queued';
}

export type RoundDecision = 'none' | 'limit' | 'start';

export function roundDecision(rounds: number, queued: number, requested: boolean): RoundDecision {
  if (queued === 0) return 'none';
  if (rounds >= PR_FOLLOW_UP_MAX_ROUNDS && !requested) return 'limit';
  return 'start';
}

export function nextInterval(current: number, active: boolean): number {
  if (active) return BASE_INTERVAL_SECONDS;
  return Math.min(Math.max(current, BASE_INTERVAL_SECONDS) * 2, MAX_INTERVAL_SECONDS);
}

export function newSourceKeys<T extends { sourceKey: string }>(
  gathered: readonly T[],
  known: ReadonlySet<string>,
): T[] {
  const seen = new Set(known);
  return gathered.filter((item) => {
    if (seen.has(item.sourceKey)) return false;
    seen.add(item.sourceKey);
    return true;
  });
}

export function roundLine(count: number, round: number): string {
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  return `Fixing ${items} (round ${round} of ${PR_FOLLOW_UP_MAX_ROUNDS}).`;
}

export const LIMIT_LINE = `Spark made ${PR_FOLLOW_UP_MAX_ROUNDS} rounds on this PR. The rest is yours; ask Spark in the chat for another round.`;
