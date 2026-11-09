import { describe, expect, it } from 'vitest';
import type { TrackedPull } from '../persistence/tracked-pulls.ts';
import { NO_DETAILS } from './details.ts';
import { isClean, shownClean, withCleanState } from './clean.ts';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-11-09T10:00:00Z');

function pull(fields: Partial<TrackedPull> = {}): TrackedPull {
  return {
    prState: 'open',
    followUp: true,
    draft: false,
    headSha: HEAD,
    checks: 'passing',
    review: 'none',
    phase: 'watching',
    details: NO_DETAILS,
    cleanHeadSha: null,
    cleanSince: null,
    ...fields,
  } as TrackedPull;
}

const thread = (key: string) => ({
  key,
  author: 'alice',
  path: null,
  line: null,
  excerpt: 'Please rename',
  url: null,
  at: null,
});

describe('isClean', () => {
  it('needs passing checks, no review thread and no open follow-up item', () => {
    expect(isClean(pull(), 0)).toBe(true);
    expect(isClean(pull({ checks: 'none' }), 0)).toBe(false);
    expect(isClean(pull({ checks: 'pending' }), 0)).toBe(false);
    expect(isClean(pull(), 1)).toBe(false);
    expect(isClean(pull({ review: 'changes_requested' }), 0)).toBe(false);
    expect(isClean(pull({ draft: true }), 0)).toBe(false);
    expect(isClean(pull({ phase: 'fixing' }), 0)).toBe(false);
    expect(isClean(pull({ followUp: false }), 0)).toBe(false);
  });

  it('counts unresolved review threads but not plain PR comments', () => {
    const comment = { ...NO_DETAILS, threads: [thread('issue_comment:1')], threadCount: 1 };
    const review = { ...NO_DETAILS, threads: [thread('review_comment:2')], threadCount: 1 };
    expect(isClean(pull({ details: comment }), 0)).toBe(true);
    expect(isClean(pull({ details: review }), 0)).toBe(false);
    expect(isClean(pull({ details: { ...comment, threadCount: 60 } }), 0)).toBe(false);
  });
});

describe('withCleanState', () => {
  it('marks a head clean once and never again for the same head', () => {
    const first = withCleanState(pull(), true, NOW);
    expect(first).toMatchObject({ cleanHeadSha: HEAD, cleanSince: NOW });
    expect(shownClean(first)).toBe(true);

    const later = new Date(NOW.getTime() + 60_000);
    expect(withCleanState(first, true, later).cleanSince).toBe(NOW);

    const broken = withCleanState(first, false, later);
    expect(shownClean(broken)).toBe(false);
    expect(shownClean(withCleanState(broken, true, later))).toBe(false);

    const pushed = withCleanState({ ...broken, headSha: 'b'.repeat(40) }, true, later);
    expect(pushed).toMatchObject({ cleanHeadSha: 'b'.repeat(40), cleanSince: later });
  });

  it('is not shown once the pull request is merged', () => {
    expect(shownClean({ ...withCleanState(pull(), true, NOW), prState: 'merged' })).toBe(false);
  });
});
