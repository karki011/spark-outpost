import { describe, expect, it } from 'vitest';
import type { InboxTicket, TicketDevelopment, TicketPull } from '@spark-outpost/contracts';
import { buildsText, commitsText, developmentPulls, rowPull } from './development-model.ts';

const pull = (number: number, fields: Partial<TicketPull> = {}): TicketPull => ({
  url: `https://github.com/acme/web/pull/${number}`,
  repo: 'acme/web',
  number,
  title: `Change ${number}`,
  origin: 'linked',
  branch: null,
  author: null,
  updatedAt: null,
  reported: 'open',
  status: null,
  mine: false,
  ...fields,
});

const development = (pullRequests: TicketPull[]): TicketDevelopment => ({
  availability: 'ok',
  pullRequests,
  branches: [],
  commits: null,
  builds: null,
});

describe('development pull requests', () => {
  it('says where each pull request came from and whose status it shows', () => {
    const entries = developmentPulls(
      development([
        pull(1, { origin: 'spark', reported: 'unknown' }),
        pull(2, { reported: 'merged' }),
        pull(3, { origin: 'matched', reported: 'draft' }),
        pull(4, {
          status: {
            url: 'https://github.com/acme/web/pull/4',
            repo: 'acme/web',
            number: 4,
            state: 'approved',
            openedAt: '2026-09-20T10:00:00Z',
            mergedAt: null,
            checks: 'failing',
            failedChecks: ['unit'],
          },
        }),
      ]),
      'Jira',
    );
    expect(entries.map((entry) => [entry.origin, entry.badge.label, entry.note])).toEqual([
      ['Spark chat', 'status not available', null],
      ['Linked in Jira', 'merged', 'Status from Jira'],
      ['Matched by key', 'draft', 'Status from Jira'],
      ['Linked in Jira', 'approved', null],
    ]);
    expect(entries[3]).toMatchObject({ checks: 'failing', failedChecks: ['unit'] });
  });

  it('describes commits and builds', () => {
    expect(commitsText({ count: 1, lastAt: null })).toBe('1 commit');
    expect(commitsText({ count: 2, lastAt: null })).toBe('2 commits');
    expect(buildsText({ count: 1, failed: 0, passed: 1 })).toEqual({
      text: '1 build passing',
      failing: false,
    });
    expect(buildsText({ count: 3, failed: 2, passed: 1 })).toEqual({
      text: '2 of 3 builds failing',
      failing: true,
    });
    expect(buildsText({ count: 2, failed: 0, passed: 1 }).text).toBe('2 builds');
  });

  it('counts the other pull requests for the row badge', () => {
    const ticket = {
      pullRequest: null,
      development: development([pull(1, { reported: 'merged' }), pull(2), pull(3)]),
    } as InboxTicket;
    expect(rowPull(ticket, 'https://github.com/acme/web/pull/1')).toMatchObject({
      number: 1,
      more: 2,
      origin: 'linked',
      badge: { label: 'merged' },
    });
    expect(rowPull({ pullRequest: null } as InboxTicket, 'https://x.test/pull/9').more).toBe(0);
  });
});
