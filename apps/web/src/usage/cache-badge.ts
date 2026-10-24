import type { PromptCacheLast } from '@spark-outpost/contracts';
import { cacheView, lastUsedText, rewriteSentence } from './cache-view.ts';

const MINUTE_MS = 60_000;

export type CacheBadgeKind = 'warm' | 'expiring' | 'expired' | 'unknown';

export interface CacheBadge {
  kind: CacheBadgeKind;
  left: number;
  status: string;
  sentence: string;
  tip: string;
}

function expiringFrom(ttlSeconds: number): number {
  return ttlSeconds === 3600 ? 5 : 1;
}

function minutesLeft(last: PromptCacheLast, ttlSeconds: number, now: number): number {
  const expiry = Date.parse(last.at) + ttlSeconds * 1000;
  return Math.min(Math.ceil((expiry - now) / MINUTE_MS), ttlSeconds / 60);
}

function liveBadge(
  last: PromptCacheLast,
  ttlSeconds: number,
  now: number,
  tip: string,
): CacheBadge {
  const minutes = minutesLeft(last, ttlSeconds, now);
  const left = minutes / (ttlSeconds / 60);
  if (minutes <= expiringFrom(ttlSeconds)) {
    const status = `Expires in ${minutes} min`;
    return {
      kind: 'expiring',
      left,
      status,
      sentence: `Prompt cache expires in ${minutes} min`,
      tip,
    };
  }
  const status = `Warm · ${minutes} min left`;
  return { kind: 'warm', left, status, sentence: `Prompt cache warm · ${minutes} min left`, tip };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function cacheBadge(last: PromptCacheLast, now: number): CacheBadge {
  const view = cacheView(last, now);
  if (view.state === 'cold') {
    const sentence = `Prompt cache expired, ${rewriteSentence(last)}`;
    return { kind: 'expired', left: 0, status: 'Expired', sentence, tip: view.tip };
  }
  if (view.state === 'unknown') {
    const used = lastUsedText(last, now);
    return {
      kind: 'unknown',
      left: 0,
      status: capitalized(used),
      sentence: `Prompt cache ${used}`,
      tip: view.tip,
    };
  }
  return liveBadge(last, last.ttlSeconds!, now, view.tip);
}
