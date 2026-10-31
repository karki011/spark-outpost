import { clockText } from '../status/status-text.ts';
import { groupSummary } from './group-summary.ts';
import type { GroupedItem, Row, TurnRowPart } from './turn-rows.ts';

function answerIndex(parts: readonly TurnRowPart[]): number {
  return parts.findLastIndex((part) => part.kind === 'text');
}

export function foldedPart(parts: readonly TurnRowPart[], index: number, open = false): boolean {
  const part = parts[index];
  if (part?.kind === 'rows') return true;
  if (part?.kind === 'cards') return open && index < answerIndex(parts);
  return part?.kind === 'text' && index !== answerIndex(parts);
}

export function canFold(parts: readonly TurnRowPart[]): boolean {
  return parts.some((_, index) => foldedPart(parts, index));
}

function groupedItems(row: Row): GroupedItem[] {
  if (row.kind === 'group') return row.items;
  if (row.kind === 'todo') return [];
  return [row];
}

export function foldSummary(parts: readonly TurnRowPart[]): string {
  const items = parts.flatMap((part) =>
    part.kind === 'rows' ? part.rows.flatMap(groupedItems) : [],
  );
  const summary = groupSummary({ kind: 'group', key: 'fold', items, live: null });
  return summary.charAt(0).toLowerCase() + summary.slice(1);
}

export function foldLead(seconds: number | null): string {
  return seconds ? `Worked for ${clockText(seconds * 1000)}` : 'Worked';
}
