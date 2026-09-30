import type { DatabaseSync } from 'node:sqlite';
import { analyticsRows } from './analytics.ts';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function projectsCsv(db: DatabaseSync): string {
  const header = ['id', 'name', 'spent'];
  const lines = analyticsRows(db)
    .sort((a, b) => a.id - b.id)
    .map((row) => [row.id, row.name, row.spent].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}
