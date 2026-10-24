import type { FeedbackState, PrCheckRun } from '@spark-outpost/contracts';
import type { StoredFeedback } from '../persistence/pr-watches.ts';
import { authorReply, type InlineComment, type ReviewEntry } from './gather.ts';
import { checkName } from './rounds.ts';

const OPEN: ReadonlySet<FeedbackState> = new Set(['queued', 'held', 'needs_user']);
const CHECK_SETTLED: ReadonlySet<PrCheckRun['state']> = new Set(['passing', 'skipped', 'neutral']);

export interface OnGitHub {
  prAuthor: string | null;
  resolved: ReadonlySet<number> | null;
  inline: readonly InlineComment[];
  reviews: readonly ReviewEntry[];
  checkRuns: readonly PrCheckRun[];
}

type Item = Pick<StoredFeedback, 'kind' | 'sourceKey' | 'githubId' | 'author'>;

function threadSettled(item: Item, now: OnGitHub): boolean {
  const id = Number(item.githubId);
  const comment = now.inline.find((entry) => entry.id === id);
  if (comment && authorReply(comment, now.prAuthor)) return true;
  const root = comment?.in_reply_to_id ?? id;
  return now.resolved?.has(root) ?? false;
}

function checkSettled(item: Item, now: OnGitHub): boolean {
  const run = now.checkRuns.find((entry) => entry.name === checkName(item));
  return run !== undefined && CHECK_SETTLED.has(run.state);
}

function reviewSettled(item: Item, now: OnGitHub): boolean {
  const id = Number(item.githubId);
  const author = item.author.toLowerCase();
  return now.reviews.some(
    (review) =>
      review.id > id &&
      review.state !== 'PENDING' &&
      (review.user?.login ?? 'ghost').toLowerCase() === author,
  );
}

export function settledNow(item: Item, now: OnGitHub): boolean {
  if (item.kind === 'review_comment') return threadSettled(item, now);
  if (item.kind === 'check') return checkSettled(item, now);
  if (item.kind === 'review') return reviewSettled(item, now);
  return false;
}

export function settledOnGitHub(
  items: readonly (Item & Pick<StoredFeedback, 'id' | 'state'>)[],
  now: OnGitHub,
): string[] {
  return items
    .filter((item) => OPEN.has(item.state) && settledNow(item, now))
    .map((item) => item.id);
}
