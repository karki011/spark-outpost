import type { Edit } from './md-format.ts';
import { lineAt, scanLines } from './md-lines.ts';

export type LineFormat = 'bullet' | 'numbered' | 'quote';

const PREFIXES: Record<LineFormat, RegExp> = {
  bullet: /^(\s*)[-*+] /,
  numbered: /^(\s*)\d{1,9}[.)] /,
  quote: /^ {0,3}> ?/,
};
const ANY_LIST = /^(\s*)(?:[-*+]|\d{1,9}[.)]) /;
const FENCE_LINE = '```';

interface LineRange {
  start: number;
  end: number;
}

function lineRange(text: string, start: number, end: number): LineRange {
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', last);
  return { start: from, end: newline === -1 ? text.length : newline };
}

function withPrefix(line: string, format: LineFormat, number: number): string {
  if (format === 'quote') return `> ${line}`;
  const marker = format === 'bullet' ? '- ' : `${number}. `;
  const listed = ANY_LIST.exec(line);
  if (listed) return `${listed[1]}${marker}${line.slice(listed[0].length)}`;
  return `${marker}${line}`;
}

function withoutPrefix(line: string, format: LineFormat): string {
  const match = PREFIXES[format].exec(line);
  if (!match) return line;
  return `${format === 'quote' ? '' : (match[1] ?? '')}${line.slice(match[0].length)}`;
}

export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  format: LineFormat,
): Edit {
  const range = lineRange(text, start, end);
  const lines = text.slice(range.start, range.end).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const remove = filled.length > 0 && filled.every((line) => PREFIXES[format].test(line));
  let number = 0;
  const insert = lines
    .map((line) => {
      if (remove) return withoutPrefix(line, format);
      if (line.trim() === '' && lines.length > 1) return line;
      number += 1;
      return withPrefix(line, format, number);
    })
    .join('\n');
  if (lines.length === 1 && start === end) {
    const caret = Math.max(range.start, start + insert.length - (range.end - range.start));
    return { ...range, insert, selectStart: caret, selectEnd: caret };
  }
  return { ...range, insert, selectStart: range.start, selectEnd: range.start + insert.length };
}

function enclosingFence(text: string, caret: number): LineRange | null {
  const lines = scanLines(text);
  const index = lineAt(lines, caret);
  const block = lines[index]?.block;
  if (block !== 'code' && block !== 'fence-open' && block !== 'fence-close') return null;
  let open = index;
  while (lines[open]!.block !== 'fence-open') open -= 1;
  let close = open + 1;
  while (close < lines.length && lines[close]!.block !== 'fence-close') close += 1;
  const last = lines[Math.min(close, lines.length - 1)]!;
  return { start: lines[open]!.start, end: last.start + last.text.length };
}

export function toggleCodeBlock(text: string, start: number, end: number): Edit {
  const fence = enclosingFence(text, start);
  if (fence) {
    const lines = text.slice(fence.start, fence.end).split('\n');
    const closed = lines.length > 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines.at(-1)!);
    const insert = lines.slice(1, closed ? -1 : undefined).join('\n');
    return { ...fence, insert, selectStart: fence.start, selectEnd: fence.start + insert.length };
  }
  const range = lineRange(text, start, end);
  const body = text.slice(range.start, range.end);
  const insert = `${FENCE_LINE}\n${body}\n${FENCE_LINE}`;
  const bodyStart = range.start + FENCE_LINE.length + 1;
  if (body === '') return { ...range, insert, selectStart: bodyStart, selectEnd: bodyStart };
  return { ...range, insert, selectStart: bodyStart, selectEnd: bodyStart + body.length };
}

export interface LinkTarget {
  start: number;
  end: number;
  label: string;
  url: string;
  existing: boolean;
}

const LINK = /\[([^\]\n]*)\]\(([^()\s]*)\)/g;
const WEB_ADDRESS = /^(https?:\/\/|mailto:)\S+$/i;

export function linkTarget(text: string, start: number, end: number): LinkTarget {
  const range = lineRange(text, start, start);
  const line = text.slice(range.start, range.end);
  for (const match of line.matchAll(LINK)) {
    const from = range.start + match.index;
    const to = from + match[0].length;
    if (from <= start && end <= to) {
      return { start: from, end: to, label: match[1] ?? '', url: match[2] ?? '', existing: true };
    }
  }
  const selected = text.slice(start, end);
  if (WEB_ADDRESS.test(selected)) return { start, end, label: '', url: selected, existing: false };
  return { start, end, label: selected.includes('\n') ? '' : selected, url: '', existing: false };
}

export function linkEdit(target: LinkTarget, label: string, url: string): Edit {
  const shown = label.trim() === '' ? url.trim() : label;
  const insert = `[${shown}](${url.trim()})`;
  const caret = target.start + insert.length;
  return { start: target.start, end: target.end, insert, selectStart: caret, selectEnd: caret };
}

export function unlinkEdit(target: LinkTarget): Edit {
  const caret = target.start + target.label.length;
  return {
    start: target.start,
    end: target.end,
    insert: target.label,
    selectStart: target.start,
    selectEnd: caret,
  };
}
