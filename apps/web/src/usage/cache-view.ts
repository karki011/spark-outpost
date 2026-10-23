import type { CacheRebuild, PromptCacheLast } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { formatCost } from './format.ts';

const MINUTE_MS = 60_000;

export const CACHE_EXPIRED = 'Prompt cache expired';

export type CacheState = 'warm' | 'cold' | 'unknown';

export interface CacheView {
  state: CacheState;
  text: string;
  tip: string;
}

function expiresAt(last: PromptCacheLast): number | null {
  if (last.ttlSeconds === null) return null;
  return Date.parse(last.at) + last.ttlSeconds * 1000;
}

function lifetimeText(last: PromptCacheLast): string {
  return last.ttlSeconds === 3600 ? '1 hour' : '5 minutes';
}

function tokensText(tokens: number, usd: number | null): string {
  const cost = usd === null ? '' : ` (${formatCost(usd, 'estimated')})`;
  return `${formatTokens(tokens)} tokens${cost}`;
}

function rewriteText(tokens: number, usd: number | null): string {
  return `~${tokensText(tokens, usd)}`;
}

function estimateNote(last: PromptCacheLast): string {
  if (last.rewriteUsd === null) return '';
  return last.estimateBy === 'claude-code'
    ? ' The price is Claude Code’s estimate.'
    : ' The price is about tokens × the list cache-write price.';
}

function knownTip(last: PromptCacheLast): string {
  const lifetime =
    last.ttlSeconds === null
      ? 'Claude Code reported that the cache had likely expired when this session resumed.'
      : `The provider keeps the prompt cache for ${lifetimeText(last)} after the last request.`;
  return `${lifetime} Send before then and the context is read from the cache. After that, the next message writes about ${tokensText(last.contextTokens, last.rewriteUsd)} again.${estimateNote(last)} Spark only shows this; it changes nothing.`;
}

const UNKNOWN_TIP =
  'Spark could not tell how long this provider keeps the prompt cache, so it shows only when the cache was last used. Spark only shows this; it changes nothing.';

export function rewriteSentence(last: PromptCacheLast): string {
  return `next message re-writes ${rewriteText(last.contextTokens, last.rewriteUsd)}`;
}

export function lastUsedText(last: PromptCacheLast, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(last.at)) / MINUTE_MS);
  return minutes < 1 ? 'last used just now' : `last used ${minutes} min ago`;
}

function coldView(last: PromptCacheLast): CacheView {
  return { state: 'cold', text: `Cache cold · ${rewriteSentence(last)}`, tip: knownTip(last) };
}

export function cacheView(last: PromptCacheLast, now: number): CacheView {
  if (last.expired === true) return coldView(last);
  const expiry = expiresAt(last);
  if (expiry === null) {
    return { state: 'unknown', text: `Cache ${lastUsedText(last, now)}`, tip: UNKNOWN_TIP };
  }
  if (now >= expiry) return coldView(last);
  const left = Math.min(Math.ceil((expiry - now) / MINUTE_MS), last.ttlSeconds! / 60);
  return { state: 'warm', text: `Cache warm · ${left} min left`, tip: knownTip(last) };
}

export function nextCacheChange(last: PromptCacheLast, now: number): number | null {
  if (last.expired === true) return null;
  const expiry = expiresAt(last);
  if (expiry === null) {
    const at = Date.parse(last.at);
    const minutes = Math.floor(Math.max(0, now - at) / MINUTE_MS);
    return at + (minutes + 1) * MINUTE_MS;
  }
  if (now >= expiry) return null;
  const left = Math.ceil((expiry - now) / MINUTE_MS);
  return expiry - (left - 1) * MINUTE_MS;
}

export function cacheHitText(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function rebuildText(rebuild: CacheRebuild): string {
  return `This turn re-wrote ${tokensText(rebuild.tokens, rebuild.usd)}`;
}

export const REBUILD_TIP =
  'The first request of this turn wrote at least half of the previous turn’s context to the prompt cache again, usually because the cache had expired or the model changed. The price is about tokens × the list cache-write price.';
