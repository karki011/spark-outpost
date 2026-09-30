import { redactValue } from '../audit/redact.ts';

export const RESULT_MAX_CHARS = 20_000;

interface Limits {
  items: number;
  chars: number;
}

const FIRST_LIMITS: Limits = { items: 60, chars: 4_000 };
const FLOOR_LIMITS: Limits = { items: 3, chars: 120 };

function clipped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function compact(value: unknown, limits: Limits): unknown {
  if (typeof value === 'string') return clipped(value, limits.chars);
  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.items).map((item) => compact(item, limits));
    const more = value.length - kept.length;
    return more > 0 ? [...kept, `… ${more} more`] : kept;
  }
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    result[key] = compact(child, limits);
  }
  return result;
}

function tighter(limits: Limits): Limits {
  return {
    items: Math.max(FLOOR_LIMITS.items, Math.floor(limits.items / 2)),
    chars: Math.max(FLOOR_LIMITS.chars, Math.floor(limits.chars / 2)),
  };
}

function atFloor(limits: Limits): boolean {
  return limits.items === FLOOR_LIMITS.items && limits.chars === FLOOR_LIMITS.chars;
}

export function renderResult(value: unknown, maxChars = RESULT_MAX_CHARS): string {
  const safe = redactValue(value);
  let limits = FIRST_LIMITS;
  for (;;) {
    const text = JSON.stringify(compact(safe, limits));
    if (text.length <= maxChars) return text;
    if (atFloor(limits)) return clipped(text, maxChars);
    limits = tighter(limits);
  }
}

export function round(value: number | null | undefined, places = 4): number | null {
  if (value === null || value === undefined) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function page<T>(items: readonly T[], offset: number, limit: number) {
  const slice = items.slice(offset, offset + limit);
  const next = offset + slice.length;
  return {
    total: items.length,
    offset,
    items: slice,
    ...(next < items.length ? { nextOffset: next } : {}),
  };
}
