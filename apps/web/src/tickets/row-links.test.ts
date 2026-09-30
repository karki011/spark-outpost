import { describe, expect, it } from 'vitest';
import type { PullRequestStatus } from '@spark-outpost/contracts';
import { pullBadge } from './row-links.ts';

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

  it('says so when the pull request cannot be read', () => {
    expect(pullBadge(null)).toEqual({ label: 'status not available', tone: 'muted', glyph: 'pr' });
  });
});
