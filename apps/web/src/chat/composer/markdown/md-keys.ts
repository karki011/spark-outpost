import type { InlineFormat } from './md-format.ts';
import { inCodeBlock } from './md-lines.ts';

export type FormatAction = InlineFormat | 'link';

export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface Shortcut {
  code: string;
  shift: boolean;
  label: string;
}

export const FORMAT_SHORTCUTS: Partial<Record<FormatAction, Shortcut>> = {
  bold: { code: 'KeyB', shift: false, label: 'B' },
  italic: { code: 'KeyI', shift: false, label: 'I' },
  strike: { code: 'KeyX', shift: true, label: 'X' },
};

export function formatShortcut(press: KeyPress, mac: boolean): FormatAction | null {
  const modifier = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  if (!modifier || press.altKey) return null;
  const entries = Object.entries(FORMAT_SHORTCUTS) as [FormatAction, Shortcut][];
  const found = entries.find(
    ([, shortcut]) => shortcut.code === press.code && shortcut.shift === press.shiftKey,
  );
  return found?.[0] ?? null;
}

export function shortcutLabel(action: FormatAction, mac: boolean): string | null {
  const shortcut = FORMAT_SHORTCUTS[action];
  if (!shortcut) return null;
  const shift = shortcut.shift ? (mac ? '⇧' : 'Shift+') : '';
  return `${mac ? '⌘' : 'Ctrl+'}${shift}${shortcut.label}`;
}

export function ariaShortcut(action: FormatAction, mac: boolean): string | undefined {
  const shortcut = FORMAT_SHORTCUTS[action];
  if (!shortcut) return undefined;
  return `${mac ? 'Meta' : 'Control'}+${shortcut.shift ? 'Shift+' : ''}${shortcut.label}`;
}

export type CodeEnter = 'newline' | 'send' | null;

export function codeBlockEnter(
  press: KeyPress,
  textarea: Pick<HTMLTextAreaElement, 'value' | 'selectionStart'>,
): CodeEnter {
  if (press.key !== 'Enter' || press.shiftKey || press.altKey) return null;
  if (!inCodeBlock(textarea.value, textarea.selectionStart)) return null;
  return press.metaKey || press.ctrlKey ? 'send' : 'newline';
}
