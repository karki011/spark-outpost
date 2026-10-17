import { describe, expect, it } from 'vitest';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { cacheHitText, cacheView, nextCacheChange, rebuildText } from './cache-view.ts';

const AT = Date.parse('2026-10-17T12:00:00Z');
const MINUTE = 60_000;

const last = (extra: Partial<PromptCacheLast> = {}): PromptCacheLast => ({
  at: new Date(AT).toISOString(),
  contextTokens: 182_000,
  ttlSeconds: 3600,
  rewriteUsd: 3.64,
  expired: null,
  estimateBy: 'spark',
  ...extra,
});

describe('cacheView', () => {
  it('counts down whole minutes from the last request', () => {
    expect(cacheView(last(), AT + 18 * MINUTE).text).toBe('Cache warm · 42 min left');
    expect(cacheView(last(), AT + 59 * MINUTE + 30_000).text).toBe('Cache warm · 1 min left');
    expect(cacheView(last({ ttlSeconds: 300 }), AT).text).toBe('Cache warm · 5 min left');
  });

  it('never shows more than the lifetime when the clocks disagree', () => {
    expect(cacheView(last(), AT - 5 * MINUTE).text).toBe('Cache warm · 60 min left');
  });

  it('turns cold at the lifetime and prices the re-write', () => {
    const view = cacheView(last(), AT + 60 * MINUTE);
    expect(view.state).toBe('cold');
    expect(view.text).toBe('Cache cold · next message re-writes ~182K tokens (~$3.64)');
    expect(view.tip).toContain('1 hour');
  });

  it('is cold at once when Claude Code said the resumed cache had expired', () => {
    const view = cacheView(
      last({ ttlSeconds: null, expired: true, estimateBy: 'claude-code' }),
      AT,
    );
    expect(view.state).toBe('cold');
    expect(view.tip).toContain('Claude Code’s estimate');
  });

  it('shows only when the cache was last used when the lifetime is unknown', () => {
    const unknown = last({ ttlSeconds: null, rewriteUsd: null });
    expect(cacheView(unknown, AT + 12 * MINUTE + 5_000)).toMatchObject({
      state: 'unknown',
      text: 'Cache last used 12 min ago',
    });
    expect(cacheView(unknown, AT + 10_000).text).toBe('Cache last used just now');
    expect(cacheView(unknown, AT + 600 * MINUTE).state).toBe('unknown');
  });

  it('leaves the price out when there is none', () => {
    expect(cacheView(last({ rewriteUsd: null }), AT + 61 * MINUTE).text).toBe(
      'Cache cold · next message re-writes ~182K tokens',
    );
  });
});

describe('nextCacheChange', () => {
  it('wakes once a minute at the boundaries, then at expiry, then never', () => {
    expect(nextCacheChange(last(), AT + 18 * MINUTE + 10_000)).toBe(AT + 19 * MINUTE);
    expect(nextCacheChange(last(), AT + 59 * MINUTE + 1)).toBe(AT + 60 * MINUTE);
    expect(nextCacheChange(last(), AT + 60 * MINUTE)).toBeNull();
    expect(nextCacheChange(last({ expired: true }), AT)).toBeNull();
  });

  it('wakes each minute after the last use when the lifetime is unknown', () => {
    expect(nextCacheChange(last({ ttlSeconds: null }), AT + 90_000)).toBe(AT + 2 * MINUTE);
  });
});

describe('texts', () => {
  it('words the rebuild note and the hit rate', () => {
    expect(rebuildText({ tokens: 182_000, usd: 3.64 })).toBe(
      'This turn re-wrote 182K tokens (~$3.64)',
    );
    expect(rebuildText({ tokens: 182_000, usd: null })).toBe('This turn re-wrote 182K tokens');
    expect(cacheHitText(0.944)).toBe('94%');
  });
});
