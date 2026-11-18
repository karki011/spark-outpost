import { describe, expect, it } from 'vitest';
import {
  NO_REPLY,
  OUTCOME_UNKNOWN,
  POST_REFUSALS,
  REVIEW_DEBOUNCE_MS,
  autoReviewWanted,
  debouncedDue,
  postRefusal,
  reviewEnd,
  reviewSummary,
  type PostGrant,
} from './decide.ts';
import { NO_REVIEW_SETTINGS, type StoredReviewSettings } from './settings.ts';

const on: StoredReviewSettings = {
  ...NO_REVIEW_SETTINGS,
  reviewer: { kind: 'spark', id: 'a1' },
  autoReview: true,
};

const item = {
  id: 'acme/widgets#4',
  group: 'review_requested' as const,
  draft: false,
  authorIsBot: false,
  headSha: 'h2',
};

describe('who gets reviewed automatically', () => {
  it('reviews a requested, ready, human pull request at a head not reviewed yet', () => {
    expect(autoReviewWanted(item, on, new Set(['h1']))).toBe(true);
  });

  it('leaves it alone when auto-review is off or no reviewer is picked', () => {
    expect(autoReviewWanted(item, { ...on, autoReview: false }, new Set())).toBe(false);
    expect(autoReviewWanted(item, { ...on, reviewer: null }, new Set())).toBe(false);
  });

  it('skips drafts, bots, the user’s own pull requests and heads already reviewed', () => {
    expect(autoReviewWanted({ ...item, draft: true }, on, new Set())).toBe(false);
    expect(autoReviewWanted({ ...item, authorIsBot: true }, on, new Set())).toBe(false);
    expect(autoReviewWanted({ ...item, group: 'needs_fixes' }, on, new Set())).toBe(false);
    expect(autoReviewWanted(item, on, new Set(['h2']))).toBe(false);
  });

  it('waits the debounce before a queued review is due', () => {
    const now = new Date('2026-11-17T10:00:00Z');
    expect(debouncedDue(now).getTime() - now.getTime()).toBe(REVIEW_DEBOUNCE_MS);
  });
});

describe('the review summary on an inbox row', () => {
  it('is stale when the review was for an older head and names an approval first', () => {
    expect(
      reviewSummary({ state: 'done', headSha: 'h1', posted: ['comment', 'approve'] }, 'h2'),
    ).toEqual({ state: 'done', headSha: 'h1', stale: true, posted: 'approve' });
    expect(reviewSummary({ state: 'running', headSha: 'h2', posted: [] }, 'h2')).toEqual({
      state: 'running',
      headSha: 'h2',
      stale: false,
      posted: null,
    });
    expect(reviewSummary(undefined, 'h2')).toBeNull();
  });
});

const grant: PostGrant = {
  pull: 'acme/widgets#4',
  state: 'running',
  stopping: false,
  mayPost: true,
  mayApprove: false,
};

describe('what the reviewer may post', () => {
  it('allows a comment and a thread reply on the reviewed pull request', () => {
    expect(postRefusal({ action: 'comment' }, grant)).toBeNull();
    expect(postRefusal({ action: 'comment', pull: 'ACME/widgets#4' }, grant)).toBeNull();
    expect(postRefusal({ action: 'reply', replyTo: 12 }, grant)).toBeNull();
  });

  it('refuses another pull request', () => {
    expect(postRefusal({ action: 'comment', pull: 'acme/widgets#5' }, grant)).toContain(
      POST_REFUSALS.otherPull,
    );
  });

  it('refuses an approval unless the user allows approving', () => {
    expect(postRefusal({ action: 'approve' }, grant)).toBe(POST_REFUSALS.noApprove);
    expect(postRefusal({ action: 'approve' }, { ...grant, mayApprove: true })).toBeNull();
  });

  it('never requests changes, merges or dismisses', () => {
    const all = { ...grant, mayApprove: true };
    for (const action of ['request_changes', 'REQUEST_CHANGES', 'merge', 'dismiss', 'resolve']) {
      expect(postRefusal({ action }, all)).toBe(POST_REFUSALS.action);
    }
  });

  it('refuses everything with posting off, outside a review run or once it ends', () => {
    expect(postRefusal({ action: 'comment' }, { ...grant, mayPost: false })).toBe(
      POST_REFUSALS.noPost,
    );
    expect(postRefusal({ action: 'comment' }, null)).toBe(POST_REFUSALS.notReview);
    expect(postRefusal({ action: 'comment' }, { ...grant, state: 'done' })).toBe(
      POST_REFUSALS.finished,
    );
    expect(postRefusal({ action: 'comment' }, { ...grant, stopping: true })).toBe(
      POST_REFUSALS.finished,
    );
  });

  it('needs the thread for a reply', () => {
    expect(postRefusal({ action: 'reply' }, grant)).toBe(POST_REFUSALS.replyTo);
  });
});

describe('what a finished run leaves as the review', () => {
  const chain = [
    { id: 'look', dependsOn: [] },
    { id: 'write', dependsOn: ['look'] },
  ];

  it('keeps the last step’s reply verbatim', () => {
    const steps = [
      { stepId: 'look', state: 'succeeded' as const, note: 'notes' },
      { stepId: 'write', state: 'succeeded' as const, note: '<details>ok</details>' },
    ];
    expect(reviewEnd('succeeded', chain, steps, false)).toEqual({
      state: 'done',
      body: '<details>ok</details>',
      error: null,
    });
  });

  it('joins the replies of parallel last steps', () => {
    const parallel = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: [] },
    ];
    const steps = [
      { stepId: 'a', state: 'succeeded' as const, note: 'A' },
      { stepId: 'b', state: 'succeeded' as const, note: 'B' },
    ];
    expect(reviewEnd('succeeded', parallel, steps, false).body).toBe('A\n\n---\n\nB');
  });

  it('fails without a reply, on a failed step and when the outcome is unknown', () => {
    const silent = [{ stepId: 'write', state: 'succeeded' as const, note: ' ' }];
    expect(reviewEnd('succeeded', chain, silent, false)).toMatchObject({ error: NO_REPLY });
    const failed = [{ stepId: 'look', state: 'failed' as const, note: 'boom' }];
    expect(reviewEnd('failed', chain, failed, false)).toMatchObject({
      state: 'failed',
      error: 'boom',
    });
    expect(reviewEnd('outcome_unknown', chain, [], false)).toMatchObject({
      error: OUTCOME_UNKNOWN,
    });
  });

  it('is stopped when the user stopped it', () => {
    expect(reviewEnd('cancelled', chain, [], false).state).toBe('stopped');
    expect(reviewEnd('outcome_unknown', chain, [], true).state).toBe('stopped');
  });
});
