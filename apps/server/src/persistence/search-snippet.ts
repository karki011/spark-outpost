import type { SnippetPart } from '@spark-outpost/contracts';

const WORD = /[\p{L}\p{N}]+/gu;
const CONTEXT_BEFORE = 40;
const SNIPPET_LENGTH = 160;
const ELLIPSIS = '…';

export function searchWords(text: string): string[] {
  return [...new Set(text.match(WORD) ?? [])];
}

export function prefixQuery(words: readonly string[]): string {
  return words.map((word) => `'${word}':*`).join(' & ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher(words: readonly string[], phrase: string): RegExp {
  if (words.length === 0) return new RegExp(escapeRegExp(phrase), 'giu');
  const starts = words.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${starts})[\\p{L}\\p{N}]*`, 'giu');
}

function windowStart(text: string, at: number): number {
  const earliest = Math.min(at - CONTEXT_BEFORE, text.length - SNIPPET_LENGTH);
  if (earliest <= 0) return 0;
  const space = text.indexOf(' ', earliest);
  return space === -1 || space >= at ? at : space + 1;
}

function windowEnd(text: string, start: number): number {
  const limit = start + SNIPPET_LENGTH;
  if (limit >= text.length) return text.length;
  const space = text.lastIndexOf(' ', limit);
  return space > start ? space : limit;
}

function splitMarks(text: string, pattern: RegExp): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    if (found[0] === '') continue;
    if (found.index > last) parts.push({ text: text.slice(last, found.index), match: false });
    parts.push({ text: found[0], match: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

export function matchSnippet(content: string, query: string): SnippetPart[] {
  const text = content.replace(/\s+/g, ' ').trim();
  const pattern = matcher(searchWords(query), query.trim());
  const first = pattern.exec(text);
  pattern.lastIndex = 0;
  const start = windowStart(text, first?.index ?? 0);
  const end = windowEnd(text, start);
  const parts = splitMarks(text.slice(start, end), pattern);
  if (start > 0) parts.unshift({ text: ELLIPSIS, match: false });
  if (end < text.length) parts.push({ text: ELLIPSIS, match: false });
  return parts;
}

export function snippetText(parts: readonly SnippetPart[]): string {
  return parts.map((part) => part.text).join('');
}
