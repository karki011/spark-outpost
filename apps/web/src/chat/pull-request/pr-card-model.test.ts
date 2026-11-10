import { describe, expect, it } from 'vitest';
import type { FeedbackItem } from '@spark-outpost/contracts';
import {
  checkRuns,
  dismissKey,
  groupLine,
  otherChecksLine,
  reviewsLine,
  rowFacts,
  rowSummary,
  shownPulls,
  threadWhere,
} from './pr-card-model.ts';
import { watch } from './watch-fixture.ts';

const item = (state: FeedbackItem['state']): FeedbackItem => ({
  id: '0190d7a0-0000-7000-8000-0000000000cc',
  label: 'F1',
  kind: 'review_comment',
  author: 'alice',
  trusted: true,
  path: null,
  line: null,
  excerpt: '',
  url: null,
  triage: 'fix',
  triagedBy: 'rules',
  state,
  round: null,
  reply: null,
});

describe('the facts on a pull request row', () => {
  it('stays quiet when nothing needs attention', () => {
    expect(rowFacts(watch())).toEqual([]);
    expect(rowFacts(watch({ unknownReason: 'No access', checks: 'failing' }))).toEqual([]);
  });

  it('names failing or running checks, items left for the user, new comments and the round', () => {
    const busy = watch({
      checks: 'failing',
      newComments: 1,
      phase: 'fixing',
      rounds: 2,
      items: [item('needs_user'), item('needs_user'), item('done')],
    });
    expect(rowFacts(busy).map((fact) => fact.text)).toEqual([
      'Checks failing',
      '2 need you',
      '1 new comment',
      'Round 2',
    ]);
    expect(rowFacts(watch({ checks: 'pending' }))).toEqual([
      { key: 'ci', text: 'Checks running', tone: 'prog' },
    ]);
    expect(rowFacts(watch({ rounds: 1, phase: 'watching' }))).toEqual([]);
  });

  it('shows only the final state once the pull request ended', () => {
    const merged = watch({ prState: 'merged', checks: 'failing', newComments: 4 });
    expect(rowFacts(merged)).toEqual([]);
    expect(rowSummary(merged)).toBe('Pull request #7: Merged');
    expect(rowSummary(watch({ draft: true, checks: 'pending' }))).toBe(
      'Pull request #7: Draft, Checks running',
    );
  });
});

describe('which pull requests a chat shows', () => {
  const older = watch({ id: 'a', number: 7 });
  const newer = watch({
    id: 'b',
    number: 9,
    prState: 'merged',
    opened: { ...older.opened, at: '2026-10-06T10:00:00.000Z' },
  });

  it('puts the most recent first', () => {
    expect(shownPulls([older, newer], new Set()).map((pull) => pull.number)).toEqual([9, 7]);
  });

  it('hides a dismissed ended pull request until its state changes, and never an open one', () => {
    const dismissed = new Set([dismissKey(newer), dismissKey(older)]);
    expect(shownPulls([older, newer], dismissed).map((pull) => pull.number)).toEqual([7]);
    const reopened = { ...newer, prState: 'open' as const };
    expect(shownPulls([older, reopened], dismissed).map((pull) => pull.number)).toEqual([9, 7]);
    const closed = { ...newer, prState: 'closed' as const };
    expect(shownPulls([closed], dismissed)).toHaveLength(1);
  });

  it('sums up a group', () => {
    const failing = watch({ checks: 'failing', items: [item('needs_user')] });
    expect(groupLine([failing, older, newer])).toBe('2 open · 1 failing · 1 need you');
    expect(groupLine([newer])).toBe('');
  });
});

describe('pull request details', () => {
  const run = (name: string, state: 'passing' | 'running' | 'cancelled' | 'failing') => ({
    name,
    state,
    url: null,
    summary: null,
  });

  it('falls back to the failing check names before the first full read', () => {
    const early = watch({ failingChecks: [{ name: 'test', url: null }] });
    expect(checkRuns(early)).toEqual([run('test', 'failing')]);
  });

  it('counts the checks that did not fail, each under its own word', () => {
    expect(
      otherChecksLine([
        run('a', 'passing'),
        run('b', 'passing'),
        run('c', 'running'),
        run('d', 'cancelled'),
        run('e', 'failing'),
      ]),
    ).toBe('2 passing · 1 running · 1 cancelled');
  });

  it('counts reviews with changes requested first', () => {
    const reviewer = (state: 'approved' | 'changes_requested' | 'commented') => ({
      user: state,
      state,
      at: null,
      url: null,
    });
    expect(reviewsLine([reviewer('approved'), reviewer('changes_requested')])).toBe(
      '1 changes requested · 1 approved',
    );
  });

  it('says where a comment was left', () => {
    const thread = {
      key: 'k',
      author: 'alice',
      path: 'src/cents.ts',
      line: 12,
      excerpt: '',
      url: null,
      at: null,
      status: null,
    };
    expect(threadWhere(thread)).toBe('alice · src/cents.ts:12');
    expect(threadWhere({ ...thread, path: null, line: null })).toBe('alice');
  });
});
