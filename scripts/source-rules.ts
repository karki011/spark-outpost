import ts from 'typescript';
import { FONT_FLOOR_PX, findSmallFonts, isDecorative } from './font-floor.ts';

export const MAX_LINES = 500;

const ALLOWED_COMMENT =
  /^(\/\/|\/\*)\s*(eslint-|@ts-|prettier-ignore|#region|#endregion|@vitest-environment|SPDX-License-Identifier|Copyright)/;

export interface SourceViolation {
  file: string;
  line: number;
  message: string;
}

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

export function findTsComments(file: string, text: string): SourceViolation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const seen = new Set<number>();
  const violations: SourceViolation[] = [];
  const record = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      if (ALLOWED_COMMENT.test(text.slice(range.pos, range.end))) continue;
      const line = source.getLineAndCharacterOfPosition(range.pos).line + 1;
      violations.push({ file, line, message: 'Explanatory comment' });
    }
  };
  const visit = (node: ts.Node) => {
    const children = node.getChildren(source);
    if (children.length === 0) {
      record(ts.getLeadingCommentRanges(text, node.getFullStart()));
      record(ts.getTrailingCommentRanges(text, node.getEnd()));
    }
    if (ts.isJsxExpression(node) && !node.expression) {
      record(ts.getLeadingCommentRanges(text, node.getStart(source) + 1));
    }
    children.forEach(visit);
  };
  visit(source);
  return violations.sort((a, b) => a.line - b.line);
}

export function findBlockComments(file: string, text: string, pattern: RegExp): SourceViolation[] {
  const violations: SourceViolation[] = [];
  for (const match of text.matchAll(pattern)) {
    if (ALLOWED_COMMENT.test(match[0])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    violations.push({ file, line, message: 'Explanatory comment' });
  }
  return violations;
}

export function findNativeSelects(file: string, text: string): SourceViolation[] {
  return [...text.matchAll(/<select\b/g)].map((match) => ({
    file,
    line: text.slice(0, match.index).split('\n').length,
    message: 'Native <select>; use ui/ChoicePicker.tsx',
  }));
}

const PLAIN_LOADING = /(?<![\w-])Loading(?:\s[^'"`<>{}\n]*)?(?:…|\.\.\.)/g;

export function findPlainLoading(file: string, text: string): SourceViolation[] {
  return [...text.matchAll(PLAIN_LOADING)].map((match) => ({
    file,
    line: text.slice(0, match.index).split('\n').length,
    message: 'Plain loading text; use ui/loading Skeleton, LoadingBlob or QueryWait',
  }));
}

const PHONE_MEDIA = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';
const NOT_PHONE_MEDIA = 'not ((max-width: 640px) or ((max-height: 500px) and (pointer: coarse)))';
const PHONE_WIDTHS = /\b(6[0-9]{2}|7[0-9]{2}|800)px\b/;

export function findStrayPhoneQueries(file: string, text: string): SourceViolation[] {
  return [...text.matchAll(/@media\s+([^{]+)\{/g)]
    .filter((match) => {
      const rest = (match[1] ?? '').replace(NOT_PHONE_MEDIA, '').replace(PHONE_MEDIA, '');
      return PHONE_WIDTHS.test(rest);
    })
    .map((match) => ({
      file,
      line: text.slice(0, match.index).split('\n').length,
      message: 'Phone-width media query; use the phone query in docs/design/RESPONSIVE.md',
    }));
}

const REMOTE_FONT = /fonts\.(?:googleapis|gstatic)\.com/g;

export function findRemoteFonts(file: string, text: string): SourceViolation[] {
  return [...text.matchAll(REMOTE_FONT)].map((match) => ({
    file,
    line: text.slice(0, match.index).split('\n').length,
    message: 'Font fetched from the network; fonts ship in apps/web/bundled-fonts.ts',
  }));
}

export function findFontsBelowFloor(file: string, text: string): SourceViolation[] {
  return findSmallFonts(text)
    .filter((found) => !isDecorative(file, found.selector))
    .map((found) => ({
      file,
      line: found.line,
      message: `Font size ${found.px}px is below the ${FONT_FLOOR_PX}px floor (${found.selector}); see scripts/font-floor.ts`,
    }));
}

export function checkSource(file: string, text: string): SourceViolation[] {
  const violations: SourceViolation[] = [];
  const lines = lineCount(text);
  if (lines > MAX_LINES) {
    violations.push({ file, line: MAX_LINES + 1, message: `${lines} lines exceeds ${MAX_LINES}` });
  }
  if (/\.(ts|tsx|js|mjs)$/.test(file)) violations.push(...findTsComments(file, text));
  if (!file.includes('.test.')) violations.push(...findRemoteFonts(file, text));
  if (file.startsWith('apps/web/') && file.endsWith('.tsx')) {
    violations.push(...findNativeSelects(file, text));
    if (!file.includes('.test.')) violations.push(...findPlainLoading(file, text));
  }
  if (file.endsWith('.css')) violations.push(...findBlockComments(file, text, /\/\*[\s\S]*?\*\//g));
  if (file.startsWith('apps/web/') && file.endsWith('.css')) {
    violations.push(...findStrayPhoneQueries(file, text));
    violations.push(...findFontsBelowFloor(file, text));
  }
  if (file.endsWith('.sql')) violations.push(...findBlockComments(file, text, /^\s*--.*$/gm));
  if (file.endsWith('.sh')) violations.push(...findBlockComments(file, text, /^\s*#(?!!).*$/gm));
  return violations;
}
