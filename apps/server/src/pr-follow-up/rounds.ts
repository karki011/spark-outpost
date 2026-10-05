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

export interface RoundItem {
  id: string;
  kind: FeedbackKind;
  sourceKey: string;
  author: string;
  path: string | null;
  line: number | null;
  body: string;
  state: FeedbackState;
  round: number | null;
  reply: string | null;
}

const PUSHED_BACK_REPLY = /^\W*push(?:ed|ing)? back\b/i;

const checkName = (item: RoundItem) => item.sourceKey.split(':').slice(1, -1).join(':');

function sameFailure(item: RoundItem, earlier: readonly RoundItem[], lastRound: number): boolean {
  return earlier.some(
    (old) =>
      old.kind === 'check' &&
      old.round === lastRound &&
      old.state === 'done' &&
      checkName(old) === checkName(item) &&
      old.body === item.body,
  );
}

function repeatsPushBack(item: RoundItem, earlier: readonly RoundItem[]): boolean {
  return earlier.some(
    (old) =>
      old.kind !== 'check' &&
      old.state === 'done' &&
      old.reply !== null &&
      PUSHED_BACK_REPLY.test(old.reply) &&
      old.author === item.author &&
      old.path === item.path &&
      (old.path === null || old.line === item.line),
  );
}

export interface RoundSplit<T extends RoundItem> {
  run: T[];
  unchanged: T[];
  repeated: T[];
}

export function splitRound<T extends RoundItem>(
  queued: readonly T[],
  all: readonly RoundItem[],
  lastRound: number,
): RoundSplit<T> {
  const earlier = all.filter((item) => !queued.some((entry) => entry.id === item.id));
  const split: RoundSplit<T> = { run: [], unchanged: [], repeated: [] };
  for (const item of queued) {
    if (item.kind === 'check' && sameFailure(item, earlier, lastRound)) split.unchanged.push(item);
    else if (item.kind !== 'check' && repeatsPushBack(item, earlier)) split.repeated.push(item);
    else split.run.push(item);
  }
  return split;
}

export function heldBackLine(unchanged: readonly RoundItem[], repeated: number): string {
  const parts: string[] = [];
  if (unchanged.length > 0) {
    const names = unchanged.map(checkName).join(', ');
    parts.push(`CI still fails the same way after the fix (${names}), so Spark stopped trying.`);
  }
  if (repeated > 0) {
    const what = repeated === 1 ? 'A reviewer repeated a request' : 'Reviewers repeated requests';
    parts.push(`${what} the agent already pushed back on; that is your call.`);
  }
  return parts.join(' ');
}

export const CHAT_BUSY_LINE = 'New feedback is waiting for the chat’s current turn to finish.';
