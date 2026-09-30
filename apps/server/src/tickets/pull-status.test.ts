import { describe, expect, it } from 'vitest';
import type { PullRequestDetail } from '../ship/github/connection.ts';
import { parsePullUrl, pullRequestState } from './pull-status.ts';

const pull = (fields: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  url: 'https://github.com/acme/web/pull/88',
  number: 88,
  draft: false,
  state: 'open',
  merged: false,
  createdAt: '2026-09-24T09:00:00Z',
  mergedAt: null,
  reviews: [],
  checks: null,
  ...fields,
});

describe('pull request status', () => {
  it('reads the repository and number from a pull request link', () => {
    expect(parsePullUrl('https://github.com/acme/web/pull/88')).toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'web',
      number: 88,
    });
    expect(parsePullUrl('https://github.com/acme/web/pull/88/files')?.number).toBe(88);
    expect(parsePullUrl('https://github.com/acme/web/issues/88')).toBeNull();
  });

  it('maps GitHub state and reviews to one status', () => {
    expect(pullRequestState(pull({ merged: true, state: 'closed' }))).toBe('merged');
    expect(pullRequestState(pull({ state: 'closed' }))).toBe('closed');
    expect(pullRequestState(pull({ draft: true }))).toBe('draft');
    expect(pullRequestState(pull())).toBe('review');
    expect(
      pullRequestState(
        pull({
          reviews: [
            { user: 'sam', state: 'CHANGES_REQUESTED' },
            { user: 'sam', state: 'APPROVED' },
            { user: 'riley', state: 'COMMENTED' },
          ],
        }),
      ),
    ).toBe('approved');
    expect(
      pullRequestState(
        pull({
          reviews: [
            { user: 'sam', state: 'APPROVED' },
            { user: 'riley', state: 'CHANGES_REQUESTED' },
          ],
        }),
      ),
    ).toBe('changes_requested');
  });
});
