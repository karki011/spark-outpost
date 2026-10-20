import { createHash } from 'node:crypto';

export type ConnectionKey = Readonly<Record<string, string>>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([name, field]) => [name, canonical(field)]));
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)) ?? 'undefined')
    .digest('hex');
}

export function connectionKey(parts: Readonly<Record<string, unknown>>): ConnectionKey {
  return Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, digest(value)]));
}

export function changedParts(before: ConnectionKey, after: ConnectionKey): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}
