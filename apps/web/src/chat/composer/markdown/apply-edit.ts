import type { Edit } from './md-format.ts';

function insertNatively(insert: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  try {
    return insert === ''
      ? document.execCommand('delete', false)
      : document.execCommand('insertText', false, insert);
  } catch {
    return false;
  }
}

export function applyEdit(textarea: HTMLTextAreaElement, edit: Edit): void {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(edit.start, edit.end);
  const unchanged = edit.start === edit.end && edit.insert === '';
  if (!unchanged && !insertNatively(edit.insert)) {
    textarea.setRangeText(edit.insert, edit.start, edit.end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
}
