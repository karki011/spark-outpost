const QUOTE_SOURCE = '.bubble, .md';

interface MessageSelection {
  range: Range;
  source: Element;
}

function sourceOf(node: Node | null, root: Element): Element | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const source = element?.closest(QUOTE_SOURCE) ?? null;
  return source && root.contains(source) ? source : null;
}

function firstSourceIn(range: Range, root: Element): Element | null {
  return (
    Array.from(root.querySelectorAll(QUOTE_SOURCE)).find((source) =>
      range.intersectsNode(source),
    ) ?? null
  );
}

export function clampToMessage(selection: Selection, root: Element): MessageSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) && !range.intersectsNode(root)) return null;
  const source =
    sourceOf(selection.anchorNode, root) ??
    sourceOf(selection.focusNode, root) ??
    firstSourceIn(range, root);
  if (!source) return null;
  const clamped = range.cloneRange();
  if (!source.contains(range.startContainer)) clamped.setStart(source, 0);
  if (!source.contains(range.endContainer)) clamped.setEnd(source, source.childNodes.length);
  if (clamped.collapsed || clamped.toString().trim() === '') return null;
  return { range: clamped, source };
}

export function isSameRange(a: Range, b: Range): boolean {
  return (
    a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
    a.compareBoundaryPoints(Range.END_TO_END, b) === 0
  );
}

const USER_MESSAGE = 'data-message-id';
const ASSISTANT_MESSAGE = 'data-assistant-message-id';

export function messageIdOf(source: Element): string | null {
  if (source.matches('.bubble')) {
    return source.closest(`[${USER_MESSAGE}]`)?.getAttribute(USER_MESSAGE) || null;
  }
  return source.closest(`[${ASSISTANT_MESSAGE}]`)?.getAttribute(ASSISTANT_MESSAGE) || null;
}

export function sourcesFor(root: Element, messageId: string): Element[] {
  return Array.from(
    root.querySelectorAll(
      `[${USER_MESSAGE}="${messageId}"] .bubble, [${ASSISTANT_MESSAGE}="${messageId}"] .md`,
    ),
  );
}

export function userMessageElement(root: Element, messageId: string): Element | null {
  return root.querySelector(`[${USER_MESSAGE}="${messageId}"]`);
}
