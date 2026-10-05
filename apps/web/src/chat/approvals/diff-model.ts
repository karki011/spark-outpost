import { diffArrays } from 'diff';
import { hunkEdits, type Span } from '../../diff/word-spans.ts';
import type { CodeToken } from '../markdown/highlighter.ts';

export type DiffKind = 'same' | 'add' | 'remove';

export interface WordPart {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  kind: DiffKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
  words: WordPart[] | null;
}

export type DiffBlock = { type: 'rows'; rows: DiffRow[] } | { type: 'fold'; rows: DiffRow[] };

export interface DiffModel {
  rows: DiffRow[];
  added: number;
  removed: number;
}

export interface Segment {
  text: string;
  color: string | undefined;
  changed: boolean;
}

const MAX_EDIT_LENGTH = 2000;
const FOLD_CONTEXT = 3;
const FOLD_MIN_HIDDEN = 4;

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function lineChanges(before: string[], after: string[]) {
  return (
    diffArrays(before, after, { maxEditLength: MAX_EDIT_LENGTH }) ?? [
      { value: before, removed: true, added: false, count: before.length },
      { value: after, removed: false, added: true, count: after.length },
    ]
  );
}

function wordParts(text: string, spans: readonly Span[]): WordPart[] | null {
  if (spans.length === 0) return null;
  const parts: WordPart[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) parts.push({ text: text.slice(at, span.from), changed: false });
    parts.push({ text: text.slice(span.from, span.to), changed: true });
    at = span.to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), changed: false });
  return parts;
}

function pairWords(removed: DiffRow[], added: DiffRow[]): void {
  const edits = hunkEdits(
    removed.map((row) => row.text),
    added.map((row) => row.text),
  );
  edits?.forEach((edit, index) => {
    if (!edit) return;
    const before = removed[index]!;
    const after = added[index]!;
    before.words = wordParts(before.text, edit.before);
    after.words = wordParts(after.text, edit.after);
  });
}

export function buildDiff(oldText: string | null, newText: string): DiffModel {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let pendingRemoved: DiffRow[] = [];
  for (const change of lineChanges(splitLines(oldText ?? ''), splitLines(newText))) {
    const kind: DiffKind = change.added ? 'add' : change.removed ? 'remove' : 'same';
    const block = change.value.map((text): DiffRow => {
      const row: DiffRow = {
        kind,
        text,
        oldNo: kind === 'add' ? null : oldNo,
        newNo: kind === 'remove' ? null : newNo,
        words: null,
      };
      if (kind !== 'add') oldNo++;
      if (kind !== 'remove') newNo++;
      return row;
    });
    if (kind === 'add') pairWords(pendingRemoved, block);
    pendingRemoved = kind === 'remove' ? block : [];
    rows.push(...block);
  }
  return {
    rows,
    added: rows.filter((row) => row.kind === 'add').length,
    removed: rows.filter((row) => row.kind === 'remove').length,
  };
}

function pushRows(blocks: DiffBlock[], rows: DiffRow[]): void {
  if (rows.length === 0) return;
  const last = blocks.at(-1);
  if (last?.type === 'rows') last.rows.push(...rows);
  else blocks.push({ type: 'rows', rows: [...rows] });
}

function foldRun(blocks: DiffBlock[], run: DiffRow[], first: boolean, last: boolean): void {
  const head = first ? 0 : FOLD_CONTEXT;
  const tail = last ? 0 : FOLD_CONTEXT;
  if (run.length - head - tail < FOLD_MIN_HIDDEN) {
    pushRows(blocks, run);
    return;
  }
  pushRows(blocks, run.slice(0, head));
  blocks.push({ type: 'fold', rows: run.slice(head, run.length - tail) });
  pushRows(blocks, run.slice(run.length - tail));
}

export function foldRows(rows: readonly DiffRow[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    const same = rows[start]!.kind === 'same';
    while (end < rows.length && (rows[end]!.kind === 'same') === same) end++;
    const run = rows.slice(start, end);
    if (same) foldRun(blocks, run, start === 0, end === rows.length);
    else pushRows(blocks, run);
    start = end;
  }
  return blocks;
}

export type ShownItem =
  { type: 'row'; row: DiffRow } | { type: 'fold'; index: number; count: number };

export interface ShownRows {
  items: ShownItem[];
  hidden: number;
}

export function shownRows(
  blocks: readonly DiffBlock[],
  opened: ReadonlySet<number>,
  limit: number,
): ShownRows {
  const items: ShownItem[] = [];
  let shown = 0;
  let hidden = 0;
  blocks.forEach((block, index) => {
    if (block.type === 'fold' && !opened.has(index)) {
      if (shown < limit) items.push({ type: 'fold', index, count: block.rows.length });
      return;
    }
    for (const row of block.rows) {
      if (shown < limit) items.push({ type: 'row', row });
      else hidden++;
      shown++;
    }
  });
  return { items, hidden };
}

function tokensFor(text: string, tokens: readonly CodeToken[] | null): readonly CodeToken[] {
  const joined = tokens?.map((token) => token.content).join('');
  return tokens && joined === text ? tokens : [{ content: text, color: undefined }];
}

export function paintLine(
  text: string,
  tokens: readonly CodeToken[] | null,
  words: readonly WordPart[] | null,
): Segment[] {
  const colored = tokensFor(text, tokens);
  const marks = words ?? [{ text, changed: false }];
  const segments: Segment[] = [];
  let tokenIndex = 0;
  let tokenOffset = 0;
  let markIndex = 0;
  let markOffset = 0;
  while (tokenIndex < colored.length && markIndex < marks.length) {
    const token = colored[tokenIndex]!;
    const mark = marks[markIndex]!;
    const size = Math.min(token.content.length - tokenOffset, mark.text.length - markOffset);
    if (size > 0) {
      segments.push({
        text: token.content.slice(tokenOffset, tokenOffset + size),
        color: token.color,
        changed: mark.changed,
      });
    }
    tokenOffset += size;
    markOffset += size;
    if (tokenOffset >= token.content.length) {
      tokenIndex++;
      tokenOffset = 0;
    }
    if (markOffset >= mark.text.length) {
      markIndex++;
      markOffset = 0;
    }
  }
  return segments;
}
