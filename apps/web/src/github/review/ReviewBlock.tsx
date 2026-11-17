import { useId } from 'react';
import type { GithubInboxItem, GithubReview } from '@spark-outpost/contracts';
import { ReviewMarkdown } from '../../chat/markdown/ReviewMarkdown.tsx';
import { Glyph } from '../../tickets/ticket-icons.tsx';
import { useReviewSettings } from '../use-review-settings.ts';
import {
  isStale,
  postedLink,
  reviewAction,
  stateLabel,
  type ReviewAction,
} from './review-model.ts';
import { usePullReview } from './use-pull-review.ts';
import './review-block.css';

const ACTION_LABEL: Record<Exclude<ReviewAction, 'pick-reviewer'>, string> = {
  now: 'Review now',
  again: 'Review again',
  stop: 'Stop',
};

function StateWord({ review }: { review: GithubReview }) {
  const label = stateLabel(review.state);
  return (
    <span className={`gh-review-state ${review.state}`} role="status">
      <Glyph name={label.glyph} size={12} />
      {label.word}
    </span>
  );
}

function ReviewText({ review }: { review: GithubReview }) {
  if (!review.body?.trim()) {
    return <p className="gh-review-note">The reviewer returned no text.</p>;
  }
  return (
    <div className="gh-review-body">
      <ReviewMarkdown text={review.body} />
    </div>
  );
}

function Posted({ review }: { review: GithubReview }) {
  const posted = postedLink(review);
  if (!posted) return null;
  if (posted.kind === 'text') return <p className="gh-review-note">Posted to GitHub</p>;
  return (
    <a className="btn line sm gh-review-btn" href={posted.href} target="_blank" rel="noreferrer">
      <Glyph name="pr" size={13} />
      View on GitHub
    </a>
  );
}

function Outcome({ review, headSha }: { review: GithubReview; headSha: string }) {
  if (review.state === 'failed') {
    return (
      <p className="gh-review-error">{review.error ?? 'The reviewer stopped with an error.'}</p>
    );
  }
  if (review.state !== 'done') return null;
  return (
    <>
      {isStale(review, headSha) && (
        <p className="gh-review-note">
          <Glyph name="redo" size={13} />
          Reviewed an earlier commit
        </p>
      )}
      <ReviewText review={review} />
    </>
  );
}

export function ReviewBlock({ item }: { item: GithubInboxItem }) {
  const titleId = useId();
  const { settings } = useReviewSettings();
  const { reviews, latest, busy, actionError, start, stop } = usePullReview(item.id);
  const chosen = settings ? settings.reviewer !== null : undefined;
  const action = reviewAction(latest, chosen);
  const run = () => {
    if (busy || !action || action === 'pick-reviewer') return;
    if (action !== 'stop') start();
    else if (latest) stop(latest.id);
  };

  return (
    <section className="gh-review" aria-labelledby={titleId}>
      <div className="gh-review-head">
        <h4 id={titleId}>Review</h4>
        {latest && <StateWord review={latest} />}
      </div>
      {latest ? (
        <p className="gh-review-by">By {latest.reviewer.name}</p>
      ) : (
        reviews.isSuccess && <p className="gh-review-note">No review yet</p>
      )}
      {latest && <Outcome review={latest} headSha={item.headSha} />}
      {actionError && (
        <p className="gh-review-error" role="alert">
          {actionError}
        </p>
      )}
      {action === 'pick-reviewer' && (
        <p className="gh-review-note">
          Pick a reviewer under Auto-review at the top of the page to review here.
        </p>
      )}
      <div className="gh-review-actions">
        {action && action !== 'pick-reviewer' && (
          <button
            type="button"
            className="btn line sm gh-review-btn"
            aria-disabled={busy || undefined}
            onClick={run}
          >
            {ACTION_LABEL[action]}
          </button>
        )}
        {latest && <Posted review={latest} />}
      </div>
    </section>
  );
}
