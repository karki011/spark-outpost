import { diffLines } from 'diff';
import type { ChangedFile } from '@spark-outpost/contracts';

const MIN_SIMILARITY = 0.5;
const MAX_PAIRS = 400;
const COMPARE_TIMEOUT_MS = 20;

interface Comparison {
  similarity: number;
  added: number;
  removed: number;
}

function lines(text: string): number {
  if (text === '') return 0;
  const count = text.split('\n').length;
  return text.endsWith('\n') ? count - 1 : count;
}

function compare(oldText: string, newText: string): Comparison | null {
  const parts = diffLines(oldText, newText, { timeout: COMPARE_TIMEOUT_MS });
  if (!parts) return null;
  let same = 0;
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.count;
    else if (part.removed) removed += part.count;
    else same += part.count;
  }
  const total = Math.max(lines(oldText), lines(newText));
  return { similarity: total === 0 ? 0 : same / total, added, removed };
}

function sizesClose(a: string, b: string): boolean {
  const small = Math.min(a.length, b.length);
  const large = Math.max(a.length, b.length);
  return large > 0 && small / large >= MIN_SIMILARITY;
}

function isText(file: ChangedFile, text: string | null): text is string {
  return file.shown === 'text' && text !== null && text !== '';
}

function bestMatch(
  gone: ChangedFile,
  candidates: readonly ChangedFile[],
  taken: ReadonlySet<ChangedFile>,
): { file: ChangedFile; comparison: Comparison } | null {
  let best: { file: ChangedFile; comparison: Comparison } | null = null;
  const oldText = gone.oldText ?? '';
  for (const fresh of candidates) {
    const newText = fresh.newText ?? '';
    if (taken.has(fresh) || !sizesClose(oldText, newText)) continue;
    const comparison = compare(oldText, newText);
    if (!comparison || comparison.similarity < MIN_SIMILARITY) continue;
    if (!best || comparison.similarity > best.comparison.similarity) {
      best = { file: fresh, comparison };
    }
  }
  return best;
}

export function pairRenames(files: readonly ChangedFile[]): ChangedFile[] {
  const deleted = files.filter((file) => file.change === 'deleted' && isText(file, file.oldText));
  const added = files.filter((file) => file.change === 'added' && isText(file, file.newText));
  if (deleted.length === 0 || added.length === 0 || deleted.length * added.length > MAX_PAIRS) {
    return [...files];
  }
  const taken = new Set<ChangedFile>();
  const gone = new Set<ChangedFile>();
  const renamed = new Map<ChangedFile, ChangedFile>();
  for (const file of deleted) {
    const match = bestMatch(file, added, taken);
    if (!match) continue;
    taken.add(match.file);
    gone.add(file);
    renamed.set(match.file, {
      path: match.file.path,
      oldPath: file.path,
      change: 'modified',
      added: match.comparison.added,
      removed: match.comparison.removed,
      oldText: file.oldText,
      newText: match.file.newText,
      shown: 'text',
    });
  }
  return files.filter((file) => !gone.has(file)).map((file) => renamed.get(file) ?? file);
}
