import { roundTo, titleCase } from './invoice.ts';
import { totalFor, type Entry } from './ledger.ts';
import { formatCents } from './money.ts';

export function categoryShare(entries: Entry[], category: string): number {
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  if (total === 0) return 0;
  return roundTo(totalFor(entries, category) / total, 4);
}

export function reportLine(entries: Entry[], category: string): string {
  return `${titleCase(category)}: ${formatCents(totalFor(entries, category))}`;
}
