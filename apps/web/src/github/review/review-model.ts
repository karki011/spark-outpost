import type {
  GithubInboxReviewSummary,
  GithubReview,
  GithubReviewState,
} from '@spark-outpost/contracts';
import { SOURCE_WORDS } from '../../crew-flows/run-model.ts';
import { webLink } from '../../links/web-link.ts';
import type { GlyphName } from '../../tickets/ticket-icons.tsx';

export type ReviewAction = 'now' | 'again' | 'stop' | 'pick-reviewer';

interface StateLabel {
  glyph: GlyphName;
  word: string;
}

const STATE_LABEL: Record<GithubReviewState, StateLabel> = {
  queued: { glyph: 'clock', word: 'Queued' },
  running: { glyph: 'clock', word: 'Reviewing' },
  done: { glyph: 'check', word: 'Done' },
  failed: { glyph: 'x-circle', word: 'Failed' },
  stopped: { glyph: 'blocked', word: 'Stopped' },
};

const ROW_LABEL: Record<GithubReviewState, StateLabel> = {
  queued: { glyph: 'clock', word: 'Review queued' },
  running: { glyph: 'clock', word: 'Reviewing' },
  done: { glyph: 'eye', word: 'Reviewed' },
  failed: { glyph: 'x-circle', word: 'Review failed' },
  stopped: { glyph: 'blocked', word: 'Review stopped' },
};

export function isWorking(state: GithubReviewState): boolean {
  return state === 'queued' || state === 'running';
}

export function latestReview(reviews: readonly GithubReview[] | undefined): GithubReview | null {
  return reviews?.[0] ?? null;
}

export function reviewMark(reviews: readonly GithubReview[] | undefined): string | undefined {
  if (reviews === undefined) return undefined;
  const latest = latestReview(reviews);
  return latest ? `${latest.id}:${latest.state}` : '';
}

export function stateLabel(state: GithubReviewState): StateLabel {
  return STATE_LABEL[state];
}

export function rowLabel(summary: GithubInboxReviewSummary | null | undefined): StateLabel | null {
  return summary ? ROW_LABEL[summary.state] : null;
}

export function reviewAction(
  review: GithubReview | null,
  reviewerChosen: boolean | undefined,
): ReviewAction | null {
  if (review && isWorking(review.state)) return review.chatId ? null : 'stop';
  if (reviewerChosen === undefined) return null;
  if (!reviewerChosen) return 'pick-reviewer';
  return review ? 'again' : 'now';
}

export function isStale(review: GithubReview, headSha: string): boolean {
  return review.state === 'done' && review.headSha !== headSha;
}

export type PostedLink = { kind: 'link'; href: string } | { kind: 'text' } | null;

export function postedLink(review: GithubReview): PostedLink {
  if (review.posted.length === 0) return null;
  const newest = [...review.posted].reverse();
  for (const post of newest) {
    const href = post.url ? webLink(post.url) : undefined;
    if (href) return { kind: 'link', href };
  }
  return { kind: 'text' };
}

export function reviewerLine(review: Pick<GithubReview, 'reviewer'>): string {
  const kind = review.reviewer.kind === 'workflow' ? 'workflow' : 'Spark';
  return `By ${kind} ${review.reviewer.name}`;
}

export function startedFromLine(review: Pick<GithubReview, 'startedFrom'>): string | null {
  return review.startedFrom ? `Started from: ${SOURCE_WORDS[review.startedFrom]}` : null;
}

export function notPostedNote(
  review: Pick<GithubReview, 'state' | 'posted' | 'reviewer'>,
  mayPost: boolean | undefined,
): string | null {
  if (!mayPost || review.state !== 'done' || review.posted.length > 0) return null;
  return `Nothing posted to GitHub. ${review.reviewer.name} posts or approves only when its instructions say to, and only if posting was on when the review started.`;
}
