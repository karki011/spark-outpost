import { describe, expect, it } from 'vitest';
import type { PullRequestStatus } from '@spark-outpost/contracts';
import {
  attentionPull,
  finishPulls,
  mergePulls,
  pullsToRead,
  reportedStatus,
} from './development-merge.ts';
import { pullsMatchingKey } from './github-pulls.ts';
import type { SourcePull } from './source.ts';

const url = (number: number) => `https://github.com/acme/web/pull/${number}`;

const sourcePull = (number: number, fields: Partial<SourcePull> = {}): SourcePull => ({
  url: url(number),
  title: `Change ${number}`,
  state: 'open',
  branch: `cp-1-change-${number}`,
  author: 'Sam Ortiz',
  updatedAt: `2026-09-2${number}T10:00:00.000Z`,
  repo: 'acme/web',
  number,
  ...fields,
});

const status = (number: number, fields: Partial<PullRequestStatus> = {}): PullRequestStatus => ({
  url: url(number),
  repo: 'acme/web',
  number,
  state: 'review',
  openedAt: '2026-09-20T10:00:00.000Z',
  mergedAt: null,
  checks: null,
  author: 'sam',
  ...fields,
});

const ME = new Set(['alex']);
const ref = (number: number) => ({ title: url(number), url: url(number) });

function finished(
  spark: number[],
  linked: SourcePull[],
  matched: SourcePull[],
  statuses: PullRequestStatus[],
) {
  const merged = mergePulls(spark.map(ref), linked, matched);
  return finishPulls(merged, new Map(statuses.map((entry) => [entry.url, entry])), ME);
}

describe('merging pull requests', () => {
  it("keeps Spark's record when the tracker links the same pull request", () => {
    const merged = mergePulls(
      [ref(1)],
      [sourcePull(1, { url: `${url(1)}/`, title: 'From Jira' }), sourcePull(2)],
      [sourcePull(2), sourcePull(3)],
    );
    expect(merged.map((pull) => [pull.number, pull.origin])).toEqual([
      [1, 'spark'],
      [2, 'linked'],
      [3, 'matched'],
    ]);
    expect(merged[0]).toMatchObject({ url: url(1), title: 'From Jira', state: 'open' });
  });

  it("reads Spark's latest pull request and a few live ones from elsewhere", () => {
    const merged = mergePulls(
      [ref(1)],
      [
        sourcePull(2, { state: 'merged' }),
        sourcePull(3),
        sourcePull(4, { url: 'https://bitbucket.org/acme/web/pull-requests/4' }),
        sourcePull(5),
        sourcePull(6),
      ],
      [],
    );
    expect(pullsToRead(merged, url(1), 2)).toEqual([url(1), url(3), url(5)]);
    expect(pullsToRead(merged, null, 1)).toEqual([url(3)]);
  });

  it('marks a pull request as mine by its GitHub author', () => {
    const pulls = finished(
      [1],
      [sourcePull(2), sourcePull(3)],
      [],
      [status(2, { author: 'Alex' }), status(3)],
    );
    expect(pulls.map((pull) => pull.mine)).toEqual([true, true, false]);
    const matched = finished([], [], [sourcePull(4, { author: 'ALEX' }), sourcePull(5)], []);
    expect(matched.map((pull) => pull.mine)).toEqual([true, false]);
  });
});

describe('the pull request the inbox follows', () => {
  it("follows Spark's latest pull request while it is open or merged", () => {
    const open = finished([1], [sourcePull(2)], [], [status(1), status(2, { author: 'alex' })]);
    expect(attentionPull(open, url(1))).toMatchObject({ pull: { number: 1 }, mine: true });
    const merged = finished([1], [sourcePull(2)], [], [status(1, { state: 'merged' }), status(2)]);
    expect(attentionPull(merged, url(1)).pull).toMatchObject({ number: 1, state: 'merged' });
  });

  it("moves to an open linked pull request when Spark's was closed", () => {
    const pulls = finished([1], [sourcePull(2)], [], [status(1, { state: 'closed' }), status(2)]);
    expect(attentionPull(pulls, url(1))).toMatchObject({ pull: { number: 2 }, mine: false });
    const only = finished([1], [], [], [status(1, { state: 'closed' })]);
    expect(attentionPull(only, url(1)).pull).toMatchObject({ number: 1, state: 'closed' });
  });

  it('prefers my open pull request, then linked over matched, then the newest', () => {
    const pulls = finished(
      [],
      [sourcePull(2), sourcePull(3), sourcePull(4)],
      [],
      [status(2), status(3, { author: 'alex' }), status(4)],
    );
    expect(attentionPull(pulls, null)).toMatchObject({ pull: { number: 3 }, mine: true });
    const teammates = finished([], [sourcePull(2), sourcePull(4)], [], [status(2), status(4)]);
    expect(attentionPull(teammates, null)).toMatchObject({ pull: { number: 4 }, mine: false });
  });

  it("ignores merged or declined linked pull requests and a teammate's key match", () => {
    const pulls = finished(
      [],
      [sourcePull(2, { state: 'merged' }), sourcePull(3, { state: 'declined' })],
      [],
      [],
    );
    expect(attentionPull(pulls, null)).toEqual({ pull: null, mine: true });
    const matched = finished([], [], [sourcePull(5)], [status(5)]);
    expect(attentionPull(matched, null).pull).toBeNull();
    const mine = finished([], [], [sourcePull(5, { author: 'alex' })], []);
    expect(attentionPull(mine, null)).toMatchObject({ pull: { number: 5 }, mine: true });
  });

  it('uses what the tracker reported when GitHub cannot read the pull request', () => {
    const [pull] = finished([], [sourcePull(2, { state: 'draft' })], [], []);
    expect(reportedStatus(pull!)).toMatchObject({ number: 2, state: 'draft', checks: null });
    expect(attentionPull([pull!], null)).toMatchObject({ pull: { state: 'draft' }, mine: false });
    const [unnumbered] = finished([], [sourcePull(2, { number: null })], [], []);
    expect(reportedStatus(unnumbered!)).toBeNull();
  });
});

describe('matching pull requests by ticket key', () => {
  const pulls = [
    sourcePull(1, { branch: 'feature/CP-49097-export', title: 'Export' }),
    sourcePull(2, { branch: 'fix', title: 'cp-49097: fix the header' }),
    sourcePull(3, { branch: 'CP-490970', title: 'Other' }),
    sourcePull(4, { branch: 'xcp-49097', title: 'ACP-49097 unrelated' }),
    sourcePull(5, { branch: 'cp-49097_retry', title: 'Retry' }),
  ];

  it('matches the key on word boundaries, in any case', () => {
    expect(pullsMatchingKey('CP-49097', pulls).map((pull) => pull.number)).toEqual([1, 2, 5]);
    expect(pullsMatchingKey('CP-4909', pulls)).toEqual([]);
  });
});
