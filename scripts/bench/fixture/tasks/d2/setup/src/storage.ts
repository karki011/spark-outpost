import type { Entry } from './ledger.ts';
import { parseCents } from './money.ts';

function category(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text || 'uncategorized';
}

function fromV1(rows: unknown[]): Entry[] {
  return rows.map((row) => {
    const { category: name, amount } = row as { category?: unknown; amount?: unknown };
    if (typeof amount !== 'string') throw new Error('An amount is missing.');
    return { category: category(name), cents: parseCents(amount) };
  });
}

function fromV2(data: { version?: unknown; entries?: unknown }): Entry[] {
  if (data.version !== 2 || !Array.isArray(data.entries)) throw new Error('Unknown ledger format.');
  return data.entries.map((row) => {
    const { category: name, cents } = row as { category?: unknown; cents?: unknown };
    if (typeof cents !== 'number') throw new Error('A cents value is missing.');
    return { category: category(name), cents };
  });
}

export function loadLedger(text: string): Entry[] {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return fromV1(data);
  if (data && typeof data === 'object') return fromV2(data);
  throw new Error('Unknown ledger format.');
}

export function saveLedger(entries: Entry[]): string {
  return JSON.stringify({ version: 2, entries });
}

export function migrateLedger(text: string): string {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    loadLedger(text);
    return text;
  }
  return saveLedger(fromV1(data));
}
