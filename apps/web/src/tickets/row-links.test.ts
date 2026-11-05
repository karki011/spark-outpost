import { describe, expect, it } from 'vitest';
import type { InboxTicket, PullRequestStatus } from '@spark-outpost/contracts';
import { pullBadge, reviewBadge, ticketPulls } from './row-links.ts';

const pull = (fields: Partial<PullRequestStatus> = {}): PullRequestStatus => ({
  url: 'https://github.com/acme/web/pull/88',
  repo: 'acme/web',
  number: 88,
  state: 'review',
  openedAt: '2026-09-25T09:00:00Z',
  mergedAt: null,
  checks: null,
  ...fields,
});

const label = (fields?: Partial<PullRequestStatus>) => pullBadge(pull(fields)).label;

describe('pull request badge', () => {
  it('names each state with its own glyph', () => {
    expect(label({ state: 'draft' })).toBe('draft');
    expect(label()).toBe('open');
    expect(label({ state: 'changes_requested' })).toBe('changes requested');
    expect(label({ state: 'approved' })).toBe('approved');
    expect(label({ state: 'merged' })).toBe('merged');
    expect(label({ state: 'closed' })).toBe('closed');
    const glyphs = ['draft', 'review', 'changes_requested', 'approved', 'merged', 'closed'].map(
      (state) => pullBadge(pull({ state: state as PullRequestStatus['state'] })).glyph,
    );
    expect(new Set([...glyphs, pullBadge(pull({ checks: 'failing' })).glyph]).size).toBe(7);
  });

  it('puts failing checks ahead of the review state until the PR is merged or closed', () => {
    expect(label({ checks: 'failing' })).toBe('checks failing');
    expect(label({ state: 'draft', checks: 'failing' })).toBe('checks failing');
    expect(label({ state: 'approved', checks: 'passing' })).toBe('approved');
    expect(label({ state: 'merged', checks: 'failing' })).toBe('merged');
    expect(label({ state: 'closed', checks: 'failing' })).toBe('closed');
  });

  it('keeps the review state apart from the checks for the detail pane', () => {
    expect(reviewBadge(pull({ checks: 'failing' })).label).toBe('open');
    expect(reviewBadge(pull({ state: 'approved', checks: 'failing' })).label).toBe('approved');
  });

  it('says so when the pull request cannot be read', () => {
    expect(pullBadge(null)).toEqual({ label: 'status not available', tone: 'muted', glyph: 'pr' });
  });
});

describe('pull requests on a ticket', () => {
  const work = (url: string, title = url) => ({
    taskId: null,
    conversationId: '00000000-0000-4000-8000-000000000001',
    startedAt: '2026-09-25T09:00:00Z',
    pullRequests: [{ title, url }],
  });
  const inbox = (fields: Partial<InboxTicket>) =>
    ({ pullRequest: null, work: [], ...fields }) as InboxTicket;

  it('lists the PR Spark opened once, with its status, checks and title', () => {
    const status = pull({ checks: 'failing', failedChecks: ['unit', 'lint'] });
    const pulls = ticketPulls(inbox({ pullRequest: status, work: [work(status.url, 'Fix CSV')] }), [
      { title: 'acme/web#88', url: status.url },
    ]);
    expect(pulls).toEqual([
      {
        url: status.url,
        number: 88,
        repo: 'acme/web',
        title: 'Fix CSV',
        badge: reviewBadge(status),
        checks: 'failing',
        failedChecks: ['unit', 'lint'],
      },
    ]);
  });

  it("adds pull requests the tracker links, and skips the tracker's other links", () => {
    const pulls = ticketPulls(null, [
      { title: 'Design doc', url: 'https://docs.example.test/doc/1' },
      { title: 'Retry uploads', url: 'https://github.com/acme/api/pull/12' },
      { title: 'MR', url: 'https://gitlab.example.test/acme/api/-/merge_requests/7' },
    ]);
    expect(pulls.map((entry) => [entry.repo, entry.number, entry.badge.label])).toEqual([
      ['acme/api', 12, 'status not available'],
      ['acme/api', 7, 'status not available'],
    ]);
  });

  it('has nothing to show for a ticket without pull requests', () => {
    expect(ticketPulls(inbox({}), [])).toEqual([]);
    expect(ticketPulls(null, [])).toEqual([]);
  });

  it('drops the checks once a pull request is merged', () => {
    const merged = pull({ state: 'merged', checks: 'passing', mergedAt: '2026-09-26T09:00:00Z' });
    expect(ticketPulls(inbox({ pullRequest: merged }), [])[0]).toMatchObject({
      checks: null,
      title: null,
      badge: { label: 'merged' },
    });
  });
});
