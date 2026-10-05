import type { LineEdit, Span } from '../word-spans.ts';

const WORD_CLASS = 'dd-word';

function splitChild(child: ChildNode, offset: number): ChildNode {
  if (child instanceof Text) return child.splitText(offset);
  const text = child.firstChild;
  if (!(child instanceof Element) || !(text instanceof Text)) return child;
  const tail = child.cloneNode(false) as Element;
  tail.append(text.splitText(offset));
  child.after(tail);
  return tail;
}

function childAt(row: Element, offset: number): ChildNode | null {
  let at = 0;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    const size = (child.textContent ?? '').length;
    if (offset === at && size > 0) return child;
    if (offset < at + size) return splitChild(child, offset - at);
    at += size;
  }
  return null;
}

function wrapSpan(row: Element, span: Span): void {
  const end = childAt(row, span.to);
  const start = childAt(row, span.from);
  if (!start) return;
  const word = document.createElement('span');
  word.className = WORD_CLASS;
  start.before(word);
  let node: ChildNode | null = start;
  while (node && node !== end) {
    const next: ChildNode | null = node.nextSibling;
    word.append(node);
    node = next;
  }
}

export function markRemovedWords(chunk: Element, edits: readonly (LineEdit | null)[]): void {
  const rows = chunk.querySelectorAll(':scope > .cm-deletedLine > del');
  edits.forEach((edit, index) => {
    const row = rows[index];
    if (!row || !edit) return;
    for (const span of [...edit.before].reverse()) wrapSpan(row, span);
  });
}

export function rowHeights(chunk: Element): number[] {
  return Array.from(
    chunk.querySelectorAll(':scope > .cm-deletedLine'),
    (row) => row.getBoundingClientRect().height,
  );
}
