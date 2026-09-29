import {
  DIGEST_ITEM_MAX_LENGTH,
  DIGEST_ITEMS_MAX,
  type DigestItem,
} from '@spark-outpost/contracts';
import type { FlaggedItem } from '../persistence/attention-settings.ts';
import { ellipsize, oneLine } from './text.ts';

const KEYS = /\b[A-Z][A-Z0-9_]*-\d+\b/g;
const PULLS = /#(\d+)\b/g;
const DAYS = /\b(\d+)\s*(?:days?\b|d\b)/gi;

interface Allowed {
  keys: Set<string>;
  pulls: Set<number>;
  days: Set<number>;
}

function allowedFacts(flagged: readonly FlaggedItem[]): Allowed {
  return {
    keys: new Set(flagged.map((item) => item.key)),
    pulls: new Set(flagged.flatMap((item) => (item.pullRequest ? [item.pullRequest.number] : []))),
    days: new Set(flagged.flatMap((item) => item.flags.flatMap((flag) => flag.days ?? []))),
  };
}

export function mentionsUnknownFacts(text: string, allowed: Allowed): boolean {
  const keys = [...text.matchAll(KEYS)].map((match) => match[0]);
  const pulls = [...text.matchAll(PULLS)].map((match) => Number(match[1]));
  const days = [...text.matchAll(DAYS)].map((match) => Number(match[1]));
  return (
    keys.some((key) => !allowed.keys.has(key)) ||
    pulls.some((pull) => !allowed.pulls.has(pull)) ||
    days.some((day) => !allowed.days.has(day))
  );
}

export function briefItems(
  raw: readonly { itemId: string; text: string }[],
  flagged: readonly FlaggedItem[],
): DigestItem[] {
  const known = new Set(flagged.map((item) => item.itemId));
  const allowed = allowedFacts(flagged);
  const items: DigestItem[] = [];
  for (const entry of raw) {
    const text = ellipsize(oneLine(entry.text), DIGEST_ITEM_MAX_LENGTH);
    if (!known.has(entry.itemId) || !text) continue;
    if (items.some((kept) => kept.itemId === entry.itemId)) continue;
    if (mentionsUnknownFacts(text, allowed)) continue;
    if (items.length < DIGEST_ITEMS_MAX) items.push({ itemId: entry.itemId, text });
  }
  return items;
}
