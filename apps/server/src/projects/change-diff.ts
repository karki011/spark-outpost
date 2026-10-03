import { DIFF_MAX_BYTES, type ChangeDiff, type ChangeEntry } from '@spark-outpost/contracts';
import type { FileContents } from './change-list.ts';
import { lineCount } from './line-counts.ts';

interface LinesCut {
  text: string;
  cut: boolean;
}

export function firstLines(text: string, limit: number | undefined): LinesCut {
  if (limit === undefined) return { text, cut: false };
  let end = -1;
  for (let line = 0; line < limit; line++) {
    end = text.indexOf('\n', end + 1);
    if (end < 0) return { text, cut: false };
  }
  return { text: text.slice(0, end + 1), cut: end + 1 < text.length };
}

export function canShowText(entry: ChangeEntry): boolean {
  return entry.shown !== 'binary' && (entry.bytes ?? 0) <= DIFF_MAX_BYTES;
}

export function changeDiff(
  entry: ChangeEntry,
  contents: FileContents | null,
  limit: number | undefined,
): ChangeDiff {
  const oldLines = lineCount(contents?.before ?? null);
  const newLines = lineCount(contents?.after ?? null);
  if (!contents || !canShowText(entry)) {
    return { ...entry, oldText: null, newText: null, oldLines, newLines, limited: false };
  }
  const before =
    contents.before === null ? null : firstLines(contents.before.toString('utf8'), limit);
  const after = firstLines(contents.after?.toString('utf8') ?? '', limit);
  return {
    ...entry,
    oldText: before?.text ?? null,
    newText: after.text,
    oldLines,
    newLines,
    limited: Boolean(before?.cut) || after.cut,
  };
}
