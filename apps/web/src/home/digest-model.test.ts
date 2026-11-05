import { describe, expect, it } from 'vitest';
import type { Digest, DigestState } from '@spark-outpost/contracts';
import { canRefresh, digestMeta, digestView, refreshHint } from './digest-model.ts';

const NOW = Date.parse('2026-09-26T15:00:00.000Z');

function digest(overrides: Partial<Digest> = {}): Digest {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'ready',
    createdAt: '2026-09-26T14:41:00.000Z',
    finishedAt: '2026-09-26T14:42:00.000Z',
    since: '2026-09-25T14:42:00.000Z',
    body: { headline: 'Quiet day.', lines: [], suggestions: [], items: [], structured: true },
    error: null,
    provider: 'claude',
    modelLabel: 'Haiku 4.5',
    costUsd: 0.0021,
    costSource: 'reported',
    conversationId: null,
    stats: { finished: 0, waiting: 0, failedOrStalled: 0, costUsd: null },
    ...overrides,
  };
}

const state = (overrides: Partial<DigestState> = {}): DigestState => ({
  available: true,
  digest: digest(),
  newActivity: false,
  refreshableAt: null,
  ...overrides,
});

describe('digestMeta', () => {
  it('names when, which model and what it cost', () => {
    expect(digestMeta(digest(), 'UTC')).toMatch(
      /^Generated \d{2}:42( PM)? · Haiku 4\.5 · \$0\.002$/,
    );
    expect(
      digestMeta(digest({ modelLabel: null, costUsd: 0.004, costSource: 'estimated' }), 'UTC'),
    ).toMatch(/· ~\$0\.004$/);
  });
});

describe('digestView', () => {
  it('hides without a provider and follows the digest status', () => {
    expect(digestView(undefined)).toBe('loading');
    expect(digestView(state({ available: false }))).toBe('hidden');
    expect(digestView(state({ digest: digest({ status: 'running' }) }))).toBe('writing');
    expect(digestView(state({ digest: digest({ status: 'failed' }) }))).toBe('failed');
    expect(digestView(state())).toBe('ready');
    expect(digestView(state({ digest: null }))).toBe('quiet');
  });
});

describe('refresh', () => {
  it('waits for the ten-minute gap and never while writing', () => {
    expect(canRefresh(state(), NOW)).toBe(true);
    expect(canRefresh(state({ refreshableAt: '2026-09-26T15:07:00.000Z' }), NOW)).toBe(false);
    expect(refreshHint(state({ refreshableAt: '2026-09-26T15:06:30.000Z' }), NOW)).toBe(
      'You can refresh in 7 min',
    );
    expect(canRefresh(state({ digest: digest({ status: 'running' }) }), NOW)).toBe(false);
    expect(canRefresh(state({ available: false }), NOW)).toBe(false);
  });
});
