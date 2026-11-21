import { describe, expect, it } from 'vitest';
import { inboxPull, inboxPulls, seenFlags } from './group.ts';
import type { FoundPull } from './search.ts';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ME = 'hazel';

function found(fields: Partial<FoundPull> = {}): FoundPull {
  return {
    repo: 'acme/widgets',
    number: 7,
    title: 'Fix the widget',
    url: 'https://github.com/acme/widgets/pull/7',
    author: ME,
    authorIsBot: false,
    draft: false,
    updatedAt: '2026-11-15T10:00:00Z',
    createdAt: '2026-11-14T10:00:00Z',
    headRef: 'spark/fix',
    baseRef: 'main',
    labels: [],
    assignees: [],
    comments: 0,
    bodyPreview: '',
    headSha: HEAD,
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeState: 'CLEAN',
    requestedReviewers: [],
    reviews: [],
    unresolvedThreads: 0,
    checks: 'passing',
    failingChecks: 0,
    reviewRequested: false,
    reviewedByViewer: false,
    ...fields,
  };
}

const groupOf = (fields: Partial<FoundPull>) => inboxPull(found(fields), ME)?.group;

describe('pull requests you already reviewed', () => {
  it('puts one you approved in approved and one you only commented on in reviewed', () => {
    const approved = found({
      author: 'alice',
      reviewedByViewer: true,
      reviews: [{ login: ME, state: 'APPROVED' }],
    });
    const commented = found({
      author: 'alice',
      reviewedByViewer: true,
      reviews: [
        { login: ME, state: 'CHANGES_REQUESTED' },
        { login: 'bob', state: 'APPROVED' },
      ],
    });
    expect(inboxPull(approved, ME)?.group).toBe('approved');
    expect(inboxPull(commented, ME)?.group).toBe('reviewed');
  });

  it('keeps a pull request that asks for your review again in review requested', () => {
    const base = { author: 'alice', reviews: [{ login: ME, state: 'APPROVED' }] };
    const pulls = inboxPulls(
      [found({ ...base, reviewedByViewer: true }), found({ ...base, reviewRequested: true })],
      ME,
    );
    expect(pulls.map((pull) => pull.group)).toEqual(['review_requested']);
  });

  it("leaves out someone else's pull request you neither reviewed nor were asked to", () => {
    expect(inboxPull(found({ author: 'alice' }), ME)).toBeNull();
  });
});

describe('inbox grouping', () => {
  it('carries the branches, labels, assignees and description preview', () => {
    const pull = inboxPull(
      found({
        baseRef: 'release',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        assignees: ['lee'],
        comments: 4,
        bodyPreview: 'Fixes the widget',
      }),
      ME,
    );
    expect(pull).toMatchObject({
      headRef: 'spark/fix',
      baseRef: 'release',
      createdAt: '2026-11-14T10:00:00Z',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: ['lee'],
      comments: 4,
      bodyPreview: 'Fixes the widget',
    });
  });

  it('puts a pull request that asks for my review in review requested', () => {
    const pull = inboxPull(found({ author: 'alice', reviewRequested: true }), ME);
    expect(pull).toMatchObject({ group: 'review_requested', mine: false, id: 'acme/widgets#7' });
  });

  it('marks a bot author and still asks for review', () => {
    const pull = inboxPull(
      found({ author: 'dependabot', authorIsBot: true, reviewRequested: true, checks: 'failing' }),
      ME,
    );
    expect(pull).toMatchObject({ group: 'review_requested', authorIsBot: true });
  });

  it('drops a pull request that is neither mine nor asking for my review', () => {
    expect(inboxPull(found({ author: 'alice' }), ME)).toBeNull();
  });

  it('matches my login without regard to case', () => {
    expect(inboxPull(found({ author: 'Hazel' }), ME)?.mine).toBe(true);
  });

  it('is ready to merge when clean and approved or not needing review', () => {
    expect(groupOf({})).toBe('ready_to_merge');
    expect(
      groupOf({ reviewDecision: 'APPROVED', reviews: [{ login: 'bob', state: 'APPROVED' }] }),
    ).toBe('ready_to_merge');
    expect(
      inboxPull(found({ reviews: [{ login: 'bob', state: 'APPROVED' }] }), ME)?.approvedBy,
    ).toEqual(['bob']);
  });

  it('waits while a required review is missing or checks are pending or absent', () => {
    expect(groupOf({ reviewDecision: 'REVIEW_REQUIRED' })).toBe('waiting');
    expect(groupOf({ checks: 'pending' })).toBe('waiting');
    expect(groupOf({ checks: null })).toBe('waiting');
  });

  it('needs fixes for failing checks', () => {
    expect(groupOf({ checks: 'failing', failingChecks: 2 })).toBe('needs_fixes');
  });

  it('needs fixes when changes are requested, by decision or by a latest review', () => {
    expect(groupOf({ reviewDecision: 'CHANGES_REQUESTED' })).toBe('needs_fixes');
    const pull = inboxPull(found({ reviews: [{ login: 'bob', state: 'CHANGES_REQUESTED' }] }), ME);
    expect(pull).toMatchObject({ group: 'needs_fixes', changesRequested: true });
  });

  it('needs fixes for unresolved review threads', () => {
    expect(groupOf({ unresolvedThreads: 1 })).toBe('needs_fixes');
    expect(groupOf({ unresolvedThreads: null })).toBe('ready_to_merge');
  });

  it('needs fixes when behind or conflicting', () => {
    expect(inboxPull(found({ mergeState: 'BEHIND' }), ME)).toMatchObject({
      group: 'needs_fixes',
      behind: true,
      conflict: false,
    });
    expect(inboxPull(found({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' }), ME)).toMatchObject({
      group: 'needs_fixes',
      conflict: true,
    });
  });

  it('keeps my drafts waiting even when something is wrong', () => {
    expect(groupOf({ draft: true })).toBe('waiting');
    expect(groupOf({ draft: true, checks: 'failing', mergeState: 'DIRTY' })).toBe('waiting');
  });

  it('lists each pull request once, preferring it as mine', () => {
    const pulls = inboxPulls(
      [
        found({ author: 'alice', reviewRequested: true }),
        found({ number: 8 }),
        found({ number: 8 }),
      ],
      ME,
    );
    expect(pulls.map((pull) => pull.id)).toEqual(['acme/widgets#7', 'acme/widgets#8']);
  });
});

describe('seen flags', () => {
  const seenAt = new Date('2026-11-15T09:00:00Z');

  it('is unseen only for a review request never marked seen', () => {
    expect(seenFlags('review_requested', HEAD, undefined)).toEqual({
      unseen: true,
      updatedSinceSeen: false,
    });
    expect(seenFlags('needs_fixes', HEAD, undefined)).toEqual({
      unseen: false,
      updatedSinceSeen: false,
    });
  });

  it('is updated since seen when the head moved after the mark', () => {
    expect(seenFlags('review_requested', HEAD, { headSha: HEAD, seenAt })).toEqual({
      unseen: false,
      updatedSinceSeen: false,
    });
    expect(seenFlags('review_requested', OTHER, { headSha: HEAD, seenAt })).toEqual({
      unseen: false,
      updatedSinceSeen: true,
    });
  });
});
