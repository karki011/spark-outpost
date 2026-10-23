import { closesFence, FENCE } from '../../markdown/markdown-blocks.ts';
import { inlineSpans, type Mark, type Span } from './md-inline.ts';

export type Block = 'text' | 'quote' | 'list' | 'heading' | 'fence-open' | 'fence-close' | 'code';

export interface Line {
  text: string;
  start: number;
  block: Block;
}

const QUOTE = /^( {0,3}>)( ?)/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/;
const HEADING = /^( {0,3}#{1,6})(\s+)/;

function textBlock(text: string): Block {
  if (QUOTE.test(text)) return 'quote';
  if (LIST.test(text)) return 'list';
  if (HEADING.test(text)) return 'heading';
  return 'text';
}

export function scanLines(text: string): Line[] {
  const lines: Line[] = [];
  let fence: string | null = null;
  let start = 0;
  for (const line of text.split('\n')) {
    let block: Block;
    if (fence !== null) {
      block = closesFence(line, fence) ? 'fence-close' : 'code';
      if (block === 'fence-close') fence = null;
    } else {
      fence = FENCE.exec(line)?.[1] ?? null;
      block = fence === null ? textBlock(line) : 'fence-open';
    }
    lines.push({ text: line, start, block });
    start += line.length + 1;
  }
  return lines;
}

function prefixed(text: string, pattern: RegExp, markerGroup: number, rest: Mark[] = []): Span[] {
  const match = pattern.exec(text);
  if (!match) return inlineSpans(text, rest);
  const groups = match.slice(1).map((group, index) => ({
    text: group,
    marks: index === markerGroup ? (['marker'] as const) : [],
  }));
  return [
    ...groups.filter((span) => span.text !== ''),
    ...inlineSpans(text.slice(match[0].length), rest),
  ];
}

export function lineSpans(text: string, block: Block): Span[] {
  if (text === '') return [];
  if (block === 'fence-open' || block === 'fence-close') return [{ text, marks: ['marker'] }];
  if (block === 'code') return [{ text, marks: [] }];
  if (block === 'quote') return prefixed(text, QUOTE, 0);
  if (block === 'list') return prefixed(text, LIST, 1);
  if (block === 'heading') return prefixed(text, HEADING, 0, ['strong']);
  return inlineSpans(text);
}

export function lineAt(lines: readonly Line[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lines[middle]!.start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function inCodeBlock(text: string, caret: number): boolean {
  const lines = scanLines(text);
  const block = lines[lineAt(lines, caret)]?.block;
  return block === 'code' || block === 'fence-open';
}

export function marksAt(text: string, offset: number): ReadonlySet<Mark> {
  const lines = scanLines(text);
  const line = lines[lineAt(lines, offset)]!;
  const local = offset - line.start;
  let from = 0;
  for (const span of lineSpans(line.text, line.block)) {
    const to = from + span.text.length;
    if (local > from && local <= to && !span.marks.includes('marker')) return new Set(span.marks);
    from = to;
  }
  return new Set();
}
