import type { ClipboardEvent } from 'react';
import { applyEdit } from './apply-edit.ts';
import { htmlToMarkdown } from './html-to-markdown.ts';

const EDITOR_TYPES = ['vscode-editor-data'];
const MARKDOWN_HINT =
  /(^|\n) {0,3}(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|```)|\*\*\S|~~\S|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`/;

export function pastedMarkdown(
  html: string,
  plain: string,
  types: readonly string[],
): string | null {
  if (html.trim() === '' || types.some((type) => EDITOR_TYPES.includes(type))) return null;
  if (MARKDOWN_HINT.test(plain)) return null;
  const converted = htmlToMarkdown(html);
  if (converted === '' || converted === plain.trim()) return null;
  return converted;
}

export function pasteMarkdown(event: ClipboardEvent<HTMLTextAreaElement>): void {
  if (event.defaultPrevented) return;
  const data = event.clipboardData;
  if (data.files.length > 0) return;
  const markdown = pastedMarkdown(
    data.getData('text/html'),
    data.getData('text/plain'),
    Array.from(data.types),
  );
  if (markdown === null) return;
  event.preventDefault();
  const textarea = event.currentTarget;
  const { selectionStart: start, selectionEnd: end } = textarea;
  const caret = start + markdown.length;
  applyEdit(textarea, { start, end, insert: markdown, selectStart: caret, selectEnd: caret });
}
