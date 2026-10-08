import type { FileContents } from './change-list.ts';
import type { SetEntry } from './change-sets.ts';
import { countChangedLines, type LineCounts } from './line-counts.ts';

export type EntryContents = (entry: SetEntry) => Promise<FileContents>;

export interface ChangeTotals extends LineCounts {
  files: number;
}

function sameContent(before: Buffer | null, after: Buffer | null): boolean {
  if (before === null || after === null) return before === after;
  return before.equals(after);
}

function entriesByFile(entries: readonly SetEntry[]): SetEntry[][] {
  const groups = new Map<string, SetEntry[]>();
  for (const entry of entries) {
    const key = `${entry.root}\0${entry.listed.file.path}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()];
}

async function netCounts(
  changes: readonly SetEntry[],
  contents: EntryContents,
): Promise<LineCounts | null> {
  const first = changes[0]!;
  if (changes.length === 1) {
    return { added: first.listed.file.added ?? 0, removed: first.listed.file.removed ?? 0 };
  }
  const [{ before }, { after }] = await Promise.all([contents(first), contents(changes.at(-1)!)]);
  return sameContent(before, after) ? null : countChangedLines(before, after);
}

export async function netTotals(
  entries: readonly SetEntry[],
  contents: EntryContents,
): Promise<ChangeTotals> {
  const totals: ChangeTotals = { files: 0, added: 0, removed: 0 };
  for (const changes of entriesByFile(entries)) {
    const counts = await netCounts(changes, contents);
    if (!counts) continue;
    totals.files++;
    totals.added += counts.added;
    totals.removed += counts.removed;
  }
  return totals;
}
