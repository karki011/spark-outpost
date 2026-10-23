import { describe, expect, it } from 'vitest';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { cacheBadge } from './cache-badge.ts';

const AT = Date.parse('2026-10-17T12:00:00Z');
const MINUTE = 60_000;

const last = (extra: Partial<PromptCacheLast> = {}): PromptCacheLast => ({
  at: new Date(AT).toISOString(),
  contextTokens: 182_000,
  ttlSeconds: 3600,
  rewriteUsd: 1.46,
  expired: null,
  estimateBy: 'spark',
  ...extra,
});

describe('cacheBadge', () => {
  it('is warm with the minutes left and how much of the lifetime remains', () => {
    const badge = cacheBadge(last(), AT + 18 * MINUTE);
    expect(badge.kind).toBe('warm');
    expect(badge.status).toBe('Warm · 42 min left');
    expect(badge.sentence).toBe('Prompt cache warm · 42 min left');
    expect(badge.left).toBeCloseTo(0.7);
    expect(badge.tip).toContain('1 hour after the last request');
  });

  it('starts expiring 5 minutes before a 1-hour cache ends', () => {
    expect(cacheBadge(last(), AT + 54 * MINUTE).kind).toBe('warm');
    const badge = cacheBadge(last(), AT + 55 * MINUTE);
    expect(badge.kind).toBe('expiring');
    expect(badge.sentence).toBe('Prompt cache expires in 5 min');
    expect(badge.status).toBe('Expires in 5 min');
  });

  it('starts expiring in the last minute of a 5-minute cache', () => {
    const short = last({ ttlSeconds: 300 });
    expect(cacheBadge(short, AT + 3 * MINUTE).kind).toBe('warm');
    expect(cacheBadge(short, AT + 4 * MINUTE).sentence).toBe('Prompt cache expires in 1 min');
    expect(cacheBadge(short, AT).left).toBe(1);
  });

  it('says what the next message re-writes once the lifetime is over', () => {
    const badge = cacheBadge(last(), AT + 60 * MINUTE);
    expect(badge.kind).toBe('expired');
    expect(badge.left).toBe(0);
    expect(badge.status).toBe('Expired');
    expect(badge.sentence).toBe(
      'Prompt cache expired, next message re-writes ~182K tokens (~$1.46)',
    );
  });

  it('is expired at once when Claude Code reported it on resume', () => {
    expect(cacheBadge(last({ expired: true }), AT).kind).toBe('expired');
  });

  it('only says when the cache was last used when the lifetime is unknown', () => {
    const badge = cacheBadge(last({ ttlSeconds: null }), AT + 12 * MINUTE);
    expect(badge.kind).toBe('unknown');
    expect(badge.status).toBe('Last used 12 min ago');
    expect(badge.sentence).toBe('Prompt cache last used 12 min ago');
    expect(cacheBadge(last({ ttlSeconds: null }), AT).status).toBe('Last used just now');
  });
});
