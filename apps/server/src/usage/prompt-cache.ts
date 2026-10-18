import type {
  CacheRebuild,
  CacheTtlSeconds,
  PromptCache,
  PromptCacheLast,
} from '@spark-outpost/contracts';
import { estimatedCost } from '../terminal/turn-usage.ts';
import { cardPriceFor, type ModelPrice } from './prices.ts';

const REBUILD_SHARE = 0.5;

type PriceFor = (provider: string, model: string | null) => ModelPrice | null;

export interface CacheBuckets {
  short: number;
  long: number;
}

export function cacheTtlOf(buckets: CacheBuckets | null): CacheTtlSeconds | null {
  if (!buckets) return null;
  if (buckets.short > 0) return 300;
  return buckets.long > 0 ? 3600 : null;
}

export interface RequestTokens {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
}

export function contextOf(tokens: RequestTokens): number {
  return tokens.input + tokens.cachedRead + tokens.cachedWrite + tokens.output;
}

export function isCacheRebuild(firstWrite: number, previousContext: number): boolean {
  return previousContext > 0 && firstWrite >= previousContext * REBUILD_SHARE;
}

export function cacheWriteUsd(
  price: ModelPrice | null,
  tokens: number,
  ttl: CacheTtlSeconds | null,
): number | null {
  if (!price || ttl === null) return null;
  return estimatedCost(price, {
    input: 0,
    output: 0,
    cachedRead: 0,
    cachedWrite: tokens,
    cachedWriteLong: ttl === 3600 ? tokens : 0,
    thought: 0,
  });
}

export interface RunCacheRow {
  runId: string;
  provider: string;
  model: string | null;
  firstWrite: number;
  lastContext: number;
  lastAt: Date;
  ttlSeconds: CacheTtlSeconds | null;
}

export interface CacheResume {
  at: number;
  secondsSince: number | null;
  contextTokens: number;
  likelyExpired: boolean | null;
  estimatedWriteUsd: number | null;
}

export interface SessionCache {
  provider: string;
  model: string | null;
  ttlSeconds: CacheTtlSeconds | null;
  resume: CacheResume | null;
}

function lastFromRun(
  row: RunCacheRow,
  ttl: CacheTtlSeconds | null,
  priceFor: PriceFor,
): PromptCacheLast {
  return {
    at: row.lastAt.toISOString(),
    contextTokens: row.lastContext,
    ttlSeconds: ttl,
    rewriteUsd: cacheWriteUsd(priceFor(row.provider, row.model), row.lastContext, ttl),
    expired: null,
    estimateBy: 'spark',
  };
}

function lastFromResume(
  session: SessionCache,
  resume: CacheResume,
  ttl: CacheTtlSeconds | null,
  priceFor: PriceFor,
): PromptCacheLast {
  const reported = resume.estimatedWriteUsd;
  const estimate = cacheWriteUsd(
    priceFor(session.provider, session.model),
    resume.contextTokens,
    ttl,
  );
  return {
    at: new Date(resume.at - (resume.secondsSince ?? 0) * 1000).toISOString(),
    contextTokens: resume.contextTokens,
    ttlSeconds: ttl,
    rewriteUsd: reported ?? estimate,
    expired: resume.likelyExpired,
    estimateBy: reported === null ? 'spark' : 'claude-code',
  };
}

export function buildPromptCache(
  rows: readonly RunCacheRow[],
  session: SessionCache | null,
  subagentsWorking: number,
  priceFor: PriceFor = cardPriceFor,
): PromptCache {
  const rebuilds: Record<string, CacheRebuild> = {};
  let ttl: CacheTtlSeconds | null = null;
  let previous: RunCacheRow | null = null;
  for (const row of rows) {
    ttl = row.ttlSeconds ?? ttl;
    const shownTtl = ttl ?? session?.ttlSeconds ?? null;
    if (previous && isCacheRebuild(row.firstWrite, previous.lastContext)) {
      const price = priceFor(row.provider, row.model);
      rebuilds[row.runId] = {
        tokens: row.firstWrite,
        usd: cacheWriteUsd(price, row.firstWrite, shownTtl),
      };
    }
    previous = row;
  }
  const currentTtl = ttl ?? session?.ttlSeconds ?? null;
  const resume = session?.resume ?? null;
  const resumedLater = resume && (!previous || resume.at > previous.lastAt.getTime());
  const last =
    session && resume && resumedLater
      ? lastFromResume(session, resume, currentTtl, priceFor)
      : previous
        ? lastFromRun(previous, currentTtl, priceFor)
        : null;
  return { last, rebuilds, subagentsWorking };
}
