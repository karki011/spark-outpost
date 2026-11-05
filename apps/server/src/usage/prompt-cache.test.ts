import { describe, expect, it } from 'vitest';
import type { ModelPrice } from './prices.ts';
import {
  buildPromptCache,
  cacheTtlOf,
  cacheWriteUsd,
  isCacheRebuild,
  type RunCacheRow,
  type SessionCache,
} from './prompt-cache.ts';

const PRICE: ModelPrice = {
  provider: 'claude',
  model: 'claude-opus-5-5',
  inputPerMillion: 10,
  cachedInputPerMillion: 1,
  outputPerMillion: 50,
  cacheOutsideInput: true,
  cacheWritePerMillion: 12.5,
};
const priceFor = () => PRICE;
const AT = new Date('2026-10-17T12:00:00Z');

const row = (runId: string, extra: Partial<RunCacheRow> = {}): RunCacheRow => ({
  runId,
  provider: 'claude',
  model: 'claude-opus-5-5',
  firstWrite: 1_000,
  lastContext: 100_000,
  lastAt: AT,
  ttlSeconds: null,
  ...extra,
});

describe('cacheTtlOf', () => {
  it('reads the lifetime from the bucket the write used', () => {
    expect(cacheTtlOf({ short: 0, long: 500 })).toBe(3600);
    expect(cacheTtlOf({ short: 500, long: 0 })).toBe(300);
  });

  it('takes 5 minutes when a write used both buckets, since that part expires first', () => {
    expect(cacheTtlOf({ short: 1, long: 500 })).toBe(300);
  });

  it('knows nothing from a request that wrote nothing or sent no buckets', () => {
    expect(cacheTtlOf({ short: 0, long: 0 })).toBeNull();
    expect(cacheTtlOf(null)).toBeNull();
  });
});

describe('isCacheRebuild', () => {
  it('counts a first write of at least half the previous context', () => {
    expect(isCacheRebuild(50_000, 100_000)).toBe(true);
    expect(isCacheRebuild(182_000, 182_400)).toBe(true);
  });

  it('ignores a smaller write and a turn with no previous context', () => {
    expect(isCacheRebuild(49_999, 100_000)).toBe(false);
    expect(isCacheRebuild(40_000, 0)).toBe(false);
  });
});

describe('cacheWriteUsd', () => {
  it('prices a write at the rate of its bucket', () => {
    expect(cacheWriteUsd(PRICE, 1_000_000, 300)).toBe(12.5);
    expect(cacheWriteUsd(PRICE, 1_000_000, 3600)).toBe(20);
  });

  it('gives no price without a known lifetime or a model price', () => {
    expect(cacheWriteUsd(PRICE, 1_000_000, null)).toBeNull();
    expect(cacheWriteUsd(null, 1_000_000, 3600)).toBeNull();
  });
});

describe('buildPromptCache', () => {
  it('marks a turn whose first request re-wrote the previous context', () => {
    const rows = [
      row('a', { firstWrite: 30_000, lastContext: 182_000, ttlSeconds: 3600 }),
      row('b', { firstWrite: 2_000, lastContext: 183_000 }),
      row('c', { firstWrite: 182_000, lastContext: 184_000 }),
    ];
    const cache = buildPromptCache(rows, null, 0, priceFor);
    expect(Object.keys(cache.rebuilds)).toEqual(['c']);
    expect(cache.rebuilds.c).toEqual({ tokens: 182_000, usd: 3.64 });
  });

  it('keeps the last known lifetime when the latest turn wrote nothing', () => {
    const rows = [row('a', { ttlSeconds: 3600 }), row('b', { lastContext: 182_000 })];
    expect(buildPromptCache(rows, null, 0, priceFor).last).toEqual({
      at: AT.toISOString(),
      contextTokens: 182_000,
      ttlSeconds: 3600,
      rewriteUsd: 3.64,
      expired: null,
      estimateBy: 'spark',
    });
  });

  it('shows no lifetime and no price when no request said which bucket it used', () => {
    const cache = buildPromptCache([row('a', { firstWrite: 0 }), row('b')], null, 0, priceFor);
    expect(cache.last).toMatchObject({ ttlSeconds: null, rewriteUsd: null });
    expect(cache.rebuilds).toEqual({});
  });

  it('uses Claude Code’s resume verdict and price when the session resumed after the last request', () => {
    const session: SessionCache = {
      provider: 'claude',
      model: 'claude-opus-5-5',
      ttlSeconds: null,
      resume: {
        at: AT.getTime() + 60_000,
        secondsSince: 1_245,
        contextTokens: 38_693,
        likelyExpired: false,
        estimatedWriteUsd: 0.0077,
      },
    };
    const cache = buildPromptCache([row('a')], session, 0, priceFor);
    expect(cache.last).toEqual({
      at: new Date(AT.getTime() + 60_000 - 1_245_000).toISOString(),
      contextTokens: 38_693,
      ttlSeconds: null,
      rewriteUsd: 0.0077,
      expired: false,
      estimateBy: 'claude-code',
    });
  });

  it('prefers a request made after the resume', () => {
    const session: SessionCache = {
      provider: 'claude',
      model: null,
      ttlSeconds: 300,
      resume: {
        at: AT.getTime() - 60_000,
        secondsSince: 10,
        contextTokens: 1,
        likelyExpired: true,
        estimatedWriteUsd: null,
      },
    };
    const cache = buildPromptCache([row('a')], session, 2, priceFor);
    expect(cache.last).toMatchObject({ contextTokens: 100_000, ttlSeconds: 300, expired: null });
    expect(cache.subagentsWorking).toBe(2);
  });
});
