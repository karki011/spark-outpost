import ts from 'typescript';

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

export function checkSource(file: string, text: string): SourceViolation[] {
  const violations: SourceViolation[] = [];
  const lines = lineCount(text);
  if (lines > MAX_LINES) {
    violations.push({ file, line: MAX_LINES + 1, message: `${lines} lines exceeds ${MAX_LINES}` });
  }
  if (/\.(ts|tsx|js|mjs)$/.test(file)) violations.push(...findTsComments(file, text));
  if (file.startsWith('apps/web/') && file.endsWith('.tsx')) {
    violations.push(...findNativeSelects(file, text));
  }
  if (file.endsWith('.css')) violations.push(...findBlockComments(file, text, /\/\*[\s\S]*?\*\//g));
  if (file.endsWith('.sql')) violations.push(...findBlockComments(file, text, /^\s*--.*$/gm));
  if (file.endsWith('.sh')) violations.push(...findBlockComments(file, text, /^\s*#(?!!).*$/gm));
  return violations;
}
