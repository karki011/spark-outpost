import { describe, expect, it } from 'vitest';
import type { GithubReview } from '@spark-outpost/contracts';
import {
  isStale,
  isWorking,
  latestReview,
  notPostedNote,
  postedLink,
  reviewAction,
  reviewerLine,
  reviewMark,
  rowLabel,
  stateLabel,
} from './review-model.ts';

function review(overrides: Partial<GithubReview> = {}): GithubReview {
  return {
    id: 'r1',
    pull: 'acme/api#7',
    headSha: 'a'.repeat(40),
    reviewer: { kind: 'spark', id: 's1', name: 'PR Reviewer' },
    state: 'done',
    body: 'Looks good.',
    error: null,
    requestedAt: '2026-11-17T10:00:00.000Z',
    startedAt: '2026-11-17T10:00:01.000Z',
    finishedAt: '2026-11-17T10:02:00.000Z',
    posted: [],
    costUsd: null,
    tokens: null,
    ...overrides,
  };
}

describe('reviewAction', () => {
  it('offers Stop while a review is queued or running, whatever the reviewer setting', () => {
    expect(reviewAction(review({ state: 'queued' }), false)).toBe('stop');
    expect(reviewAction(review({ state: 'running' }), undefined)).toBe('stop');
  });

  it('offers nothing while the reviewer setting is still loading', () => {
    expect(reviewAction(null, undefined)).toBeNull();
    expect(reviewAction(review(), undefined)).toBeNull();
  });

  it('points to the reviewer setting when none is chosen', () => {
    expect(reviewAction(null, false)).toBe('pick-reviewer');
    expect(reviewAction(review({ state: 'failed' }), false)).toBe('pick-reviewer');
  });

  it('offers Review now with no review and Review again after one ends', () => {
    expect(reviewAction(null, true)).toBe('now');
    for (const state of ['done', 'failed', 'stopped'] as const) {
      expect(reviewAction(review({ state }), true)).toBe('again');
    }
  });
});

describe('labels', () => {
  it('names every state with a glyph and a word', () => {
    expect(stateLabel('queued').word).toBe('Queued');
    expect(stateLabel('running').word).toBe('Reviewing');
    expect(stateLabel('done').word).toBe('Done');
    expect(stateLabel('failed').word).toBe('Failed');
    expect(stateLabel('stopped').word).toBe('Stopped');
  });

  it('gives rows a short word and none without a review', () => {
    const summary = { headSha: 'a', stale: false, posted: null };
    expect(rowLabel(null)).toBeNull();
    expect(rowLabel(undefined)).toBeNull();
    expect(rowLabel({ ...summary, state: 'done' })?.word).toBe('Reviewed');
    expect(rowLabel({ ...summary, state: 'running' })?.word).toBe('Reviewing');
    expect(rowLabel({ ...summary, state: 'failed' })?.word).toBe('Review failed');
  });

  it('knows which states are still working', () => {
    expect(isWorking('queued')).toBe(true);
    expect(isWorking('running')).toBe(true);
    expect(isWorking('done')).toBe(false);
  });
});

describe('latestReview', () => {
  it('takes the first review, which the server sends newest first', () => {
    expect(latestReview(undefined)).toBeNull();
    expect(latestReview([])).toBeNull();
    expect(latestReview([review({ id: 'new' }), review({ id: 'old' })])?.id).toBe('new');
  });
});

describe('reviewMark', () => {
  it('is unknown before loading, empty with no review, and changes with the state', () => {
    expect(reviewMark(undefined)).toBeUndefined();
    expect(reviewMark([])).toBe('');
    expect(reviewMark([review({ state: 'running' })])).toBe('r1:running');
    expect(reviewMark([review()])).toBe('r1:done');
  });
});

describe('isStale', () => {
  it('marks a done review of an earlier commit only', () => {
    expect(isStale(review(), 'a'.repeat(40))).toBe(false);
    expect(isStale(review(), 'b'.repeat(40))).toBe(true);
    expect(isStale(review({ state: 'failed' }), 'b'.repeat(40))).toBe(false);
  });
});

describe('postedLink', () => {
  it('is nothing when the review was not posted', () => {
    expect(postedLink(review())).toBeNull();
  });

  it('links the newest post with a web address', () => {
    const posted = [
      { kind: 'comment' as const, url: 'https://github.com/acme/api/pull/7#c1', at: 'x' },
      { kind: 'approve' as const, url: 'https://github.com/acme/api/pull/7#r2', at: 'y' },
    ];
    expect(postedLink(review({ posted }))).toEqual({
      kind: 'link',
      href: 'https://github.com/acme/api/pull/7#r2',
    });
  });

  it('falls back to an earlier post when the newest has no address', () => {
    const posted = [
      { kind: 'comment' as const, url: 'https://github.com/acme/api/pull/7#c1', at: 'x' },
      { kind: 'approve' as const, url: null, at: 'y' },
    ];
    expect(postedLink(review({ posted }))).toEqual({
      kind: 'link',
      href: 'https://github.com/acme/api/pull/7#c1',
    });
  });

  it('says posted as text when no post has a web address', () => {
    const posted = [{ kind: 'comment' as const, url: 'javascript:alert(1)', at: 'x' }];
    expect(postedLink(review({ posted }))).toEqual({ kind: 'text' });
    expect(postedLink(review({ posted: [{ kind: 'comment', url: null, at: 'x' }] }))).toEqual({
      kind: 'text',
    });
  });
});

describe('reviewerLine', () => {
  it('names whether a Spark or a workflow reviewed', () => {
    expect(reviewerLine(review())).toBe('By Spark PR Reviewer');
    expect(
      reviewerLine(review({ reviewer: { kind: 'workflow', id: 'g', name: 'The Gauntlet' } })),
    ).toBe('By workflow The Gauntlet');
  });
});

describe('notPostedNote', () => {
  it('explains a finished review that posted nothing while posting is allowed', () => {
    expect(notPostedNote(review(), true)).toContain(
      'PR Reviewer posts or approves only when its instructions say to',
    );
  });

  it('stays quiet when posting is off, the review posted, or it is not finished', () => {
    const posted = { kind: 'comment' as const, url: null, at: '2026-11-17T10:03:00.000Z' };
    expect(notPostedNote(review(), false)).toBeNull();
    expect(notPostedNote(review(), undefined)).toBeNull();
    expect(notPostedNote(review({ posted: [posted] }), true)).toBeNull();
    expect(notPostedNote(review({ state: 'running' }), true)).toBeNull();
  });
});
