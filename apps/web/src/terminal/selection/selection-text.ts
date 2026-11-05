import { blockquote, normalizeQuote } from '../../chat/quotes/quote-text.ts';

export type InsertKind = 'add' | 'ask' | 'comment';

const UNSAFE_CONTROLS = /[^\P{Cc}\n\t]/gu;

function stripControls(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(UNSAFE_CONTROLS, '');
}

export function cleanSelection(raw: string): string {
  return normalizeQuote(stripControls(raw));
}

export function insertText(kind: InsertKind, selected: string, note = ''): string {
  const text = cleanSelection(selected);
  if (!text) return '';
  if (kind === 'add') return text;
  const typed = kind === 'comment' ? stripControls(note).replace(/\s+/g, ' ').trim() : '';
  if (kind === 'comment' && !typed) return text;
  return `${blockquote(text)}\n\n${typed}`;
}

export function pasteText(text: string, bracketedPaste: boolean): string {
  return bracketedPaste ? text : text.replace(/\s*\n\s*/g, ' ');
}

export function newChatDraft(selected: string): string {
  const text = cleanSelection(selected);
  return text ? `${blockquote(text)}\n\n` : '';
}
