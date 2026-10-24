import { describe, expect, it } from 'vitest';
import type { PrCheckRun } from '@spark-outpost/contracts';
import { settledOnGitHub, type OnGitHub } from './sweep.ts';

const nothing: OnGitHub = {
  prAuthor: 'alice',
  resolved: null,
  inline: [],
  reviews: [],
  checkRuns: [],
};

const comment = (id: number, extra: Partial<OnGitHub['inline'][number]> = {}) => ({
  id,
  user: { login: 'bob' },
  body: 'Please fix',
  path: 'a.ts',
  ...extra,
});

const item = (
  id: string,
  kind: 'check' | 'review_comment' | 'review' | 'issue_comment',
  sourceKey: string,
  state: 'queued' | 'held' | 'needs_user' | 'in_round' | 'planned' | 'done' = 'needs_user',
) => ({ id, kind, sourceKey, githubId: sourceKey.split(':').at(-1)!, author: 'bob', state });

const run = (name: string, state: PrCheckRun['state']): PrCheckRun => ({
  name,
  state,
  url: null,
  summary: null,
});

describe('settledOnGitHub', () => {
  it('closes open items in a resolved thread, replies included, and leaves a round’s items alone', () => {
    const now = {
      ...nothing,
      resolved: new Set([1]),
      inline: [comment(1), comment(2, { in_reply_to_id: 1 }), comment(3)],
    };
    expect(
      settledOnGitHub(
        [
          item('a', 'review_comment', 'review_comment:1', 'held'),
          item('b', 'review_comment', 'review_comment:2', 'queued'),
          item('c', 'review_comment', 'review_comment:3'),
          item('d', 'review_comment', 'review_comment:1', 'in_round'),
          item('e', 'review_comment', 'review_comment:1', 'planned'),
        ],
        now,
      ),
    ).toEqual(['a', 'b']);
  });

  it('closes a reply the PR author wrote even when its thread is still open', () => {
    const now = {
      ...nothing,
      inline: [comment(2, { in_reply_to_id: 1, user: { login: 'Alice' } })],
    };
    expect(settledOnGitHub([item('a', 'review_comment', 'review_comment:2')], now)).toEqual(['a']);
  });

  it('changes nothing about threads when resolution is unknown', () => {
    const now = { ...nothing, inline: [comment(1)] };
    expect(settledOnGitHub([item('a', 'review_comment', 'review_comment:1')], now)).toEqual([]);
  });

  it('closes a check only when its latest run no longer fails or runs', () => {
    const now = {
      ...nothing,
      checkRuns: [run('unit', 'passing'), run('lint', 'running'), run('e2e', 'failing')],
    };
    const items = ['unit', 'lint', 'e2e', 'gone'].map((name) =>
      item(name, 'check', `check:${name}:sha-1`),
    );
    expect(settledOnGitHub(items, now)).toEqual(['unit']);
  });

  it('closes a review once the same reviewer submits a newer one, never for a pending one', () => {
    const later = (id: number, state: string) => ({ id, user: { login: 'BOB' }, body: '', state });
    expect(
      settledOnGitHub([item('a', 'review', 'review:5')], {
        ...nothing,
        reviews: [later(6, 'APPROVED')],
      }),
    ).toEqual(['a']);
    expect(
      settledOnGitHub([item('a', 'review', 'review:5')], {
        ...nothing,
        reviews: [later(6, 'PENDING')],
      }),
    ).toEqual([]);
  });

  it('never closes a top-level PR comment', () => {
    expect(settledOnGitHub([item('a', 'issue_comment', 'issue_comment:9')], nothing)).toEqual([]);
  });
});
