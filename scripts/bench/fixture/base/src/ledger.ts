import { roundTo } from './invoice.ts';

export interface Entry {
  category: string;
  cents: number;
}

export function categories(entries: Entry[]): string[] {
  return [...new Set(entries.map((entry) => entry.category))].sort();
}

export function totalFor(entries: Entry[], category: string): number {
  return entries
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + entry.cents, 0);
}

export function averageCents(entries: Entry[]): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return roundTo(total / entries.length, 2);
}
