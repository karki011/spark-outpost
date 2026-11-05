import { z } from 'zod';
import type { TokenUsage } from './usage.ts';

const tokenCount = z.number().int().nonnegative();

export const cacheTtlSecondsSchema = z.union([z.literal(300), z.literal(3600)]);
export type CacheTtlSeconds = z.infer<typeof cacheTtlSecondsSchema>;

export const promptCacheLastSchema = z.object({
  at: z.string(),
  contextTokens: tokenCount,
  ttlSeconds: cacheTtlSecondsSchema.nullable(),
  rewriteUsd: z.number().nonnegative().nullable(),
  expired: z.boolean().nullable(),
  estimateBy: z.enum(['spark', 'claude-code']),
});
export type PromptCacheLast = z.infer<typeof promptCacheLastSchema>;

export const cacheRebuildSchema = z.object({
  tokens: tokenCount,
  usd: z.number().nonnegative().nullable(),
});
export type CacheRebuild = z.infer<typeof cacheRebuildSchema>;

export const promptCacheSchema = z.object({
  last: promptCacheLastSchema.nullable(),
  rebuilds: z.record(z.string(), cacheRebuildSchema),
  subagentsWorking: tokenCount,
});
export type PromptCache = z.infer<typeof promptCacheSchema>;

const CACHE_OUTSIDE_INPUT = new Set(['claude', 'zai', 'custom']);

export function countsCacheOutsideInput(provider: string): boolean {
  return CACHE_OUTSIDE_INPUT.has(provider);
}

export interface CacheHitCounts {
  read: number;
  input: number;
}

type CachedTokens = Pick<TokenUsage, 'input' | 'cachedRead' | 'cachedWrite'>;

export function cacheHitCounts(provider: string, tokens: CachedTokens): CacheHitCounts {
  const read = tokens.cachedRead ?? 0;
  if (!countsCacheOutsideInput(provider)) return { read, input: tokens.input };
  return { read, input: tokens.input + read + (tokens.cachedWrite ?? 0) };
}

export function cacheHitRate(counts: readonly CacheHitCounts[]): number | null {
  const read = counts.reduce((total, entry) => total + entry.read, 0);
  const input = counts.reduce((total, entry) => total + entry.input, 0);
  if (input <= 0) return null;
  return Math.min(1, read / input);
}
