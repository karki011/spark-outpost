import { diffArrays } from 'diff';

export interface Span {
  from: number;
  to: number;
}

export interface LineEdit {
  before: Span[];
  after: Span[];
}

export const CHANGED_SHARE_LIMIT = 0.5;
export const HUNK_PAIR_LIMIT = 100;
export const MIDDLE_TOKEN_LIMIT = 160;
const MIDDLE_CHAR_LIMIT = 2000;
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\s\p{L}\p{N}_$]/gu;
const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const BLANK = /^\s*$/;

function isWordChar(text: string, index: number): boolean {
  return index >= 0 && index < text.length && WORD_CHAR.test(text[index]!);
}

function isHighSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function sharedPrefix(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let size = 0;
  while (size < limit && before.charCodeAt(size) === after.charCodeAt(size)) size++;
  if (size > 0 && isHighSurrogate(before, size - 1)) size--;
  while (
    size > 0 &&
    isWordChar(before, size - 1) &&
    (isWordChar(before, size) || isWordChar(after, size))
  ) {
    size--;
  }
  return size;
}

function sharedSuffix(before: string, after: string, prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let size = 0;
  while (
    size < limit &&
    before.charCodeAt(before.length - 1 - size) === after.charCodeAt(after.length - 1 - size)
  ) {
    size++;
  }
  if (size > 0 && isHighSurrogate(before, before.length - size - 1)) size--;
  while (
    size > 0 &&
    isWordChar(before, before.length - size) &&
    (isWordChar(before, before.length - size - 1) || isWordChar(after, after.length - size - 1))
  ) {
    size--;
  }
  return size;
}

function visibleLength(text: string, from = 0, to = text.length): number {
  let count = 0;
  for (let index = from; index < to; index++) {
    const code = text.charCodeAt(index);
    if (code !== 32 && code !== 9 && code !== 160) count++;
  }
  return count;
}

function tokens(text: string): string[] | null {
  if (text.length > MIDDLE_CHAR_LIMIT) return null;
  const found = text.match(TOKEN) ?? [];
  return found.length > MIDDLE_TOKEN_LIMIT ? null : found;
}

interface Mark {
  size: number;
  changed: boolean;
  blank: boolean;
}

function wholeMiddle(text: string): Mark[] {
  return text === '' ? [] : [{ size: text.length, changed: true, blank: false }];
}

function middleMarks(before: string, after: string): [Mark[], Mark[]] {
  const beforeTokens = tokens(before);
  const afterTokens = tokens(after);
  const parts =
    beforeTokens && afterTokens
      ? diffArrays(beforeTokens, afterTokens, {
          maxEditLength: Math.ceil((beforeTokens.length + afterTokens.length) / 2) + 1,
        })
      : undefined;
  if (!parts) return [wholeMiddle(before), wholeMiddle(after)];
  const marks: [Mark[], Mark[]] = [[], []];
  for (const part of parts) {
    for (const value of part.value) {
      const mark = { size: value.length, changed: part.added || part.removed, blank: false };
      mark.blank = BLANK.test(value);
      if (!part.added) marks[0].push(mark);
      if (!part.removed) marks[1].push(mark);
    }
  }
  return marks;
}

function bridgeBlanks(marks: Mark[]): void {
  for (let index = 1; index < marks.length - 1; index++) {
    const mark = marks[index]!;
    if (mark.blank && !mark.changed && marks[index - 1]!.changed && marks[index + 1]!.changed) {
      mark.changed = true;
    }
  }
}

function trimmed(text: string, span: Span): Span | null {
  let { from, to } = span;
  while (from < to && BLANK.test(text[from]!)) from++;
  while (to > from && BLANK.test(text[to - 1]!)) to--;
  return from < to ? { from, to } : null;
}

function spansOf(text: string, offset: number, marks: Mark[]): Span[] {
  bridgeBlanks(marks);
  const spans: Span[] = [];
  let at = offset;
  let open: Span | null = null;
  const close = () => {
    const span = open && trimmed(text, open);
    if (span) spans.push(span);
    open = null;
  };
  for (const mark of marks) {
    if (!mark.changed) close();
    else if (open) open.to = at + mark.size;
    else open = { from: at, to: at + mark.size };
    at += mark.size;
  }
  close();
  return spans;
}

function changedShare(text: string, spans: Span[]): number {
  const total = visibleLength(text);
  if (total === 0) return 0;
  const changed = spans.reduce((sum, span) => sum + visibleLength(text, span.from, span.to), 0);
  return changed / total;
}

export function lineEdit(before: string, after: string): LineEdit | null {
  if (before === after) return null;
  const prefix = sharedPrefix(before, after);
  const suffix = sharedSuffix(before, after, prefix);
  const [beforeMarks, afterMarks] = middleMarks(
    before.slice(prefix, before.length - suffix),
    after.slice(prefix, after.length - suffix),
  );
  const edit = {
    before: spansOf(before, prefix, beforeMarks),
    after: spansOf(after, prefix, afterMarks),
  };
  if (edit.before.length + edit.after.length === 0) return null;
  if (changedShare(before, edit.before) > CHANGED_SHARE_LIMIT) return null;
  if (changedShare(after, edit.after) > CHANGED_SHARE_LIMIT) return null;
  return edit;
}

export function hunkEdits(
  removed: readonly string[],
  added: readonly string[],
): (LineEdit | null)[] | null {
  const pairs = Math.min(removed.length, added.length);
  if (pairs === 0 || pairs > HUNK_PAIR_LIMIT) return null;
  const edits: (LineEdit | null)[] = [];
  let edited = 0;
  for (let index = 0; index < pairs; index++) {
    if ((edited + pairs - index) * 2 < pairs) return null;
    const edit = lineEdit(removed[index]!, added[index]!);
    if (edit) edited++;
    edits.push(edit);
  }
  return edited > 0 ? edits : null;
}
