import { ANCHOR_CONTEXT_LENGTH, type TextAnchor } from '@spark-outpost/contracts';

interface Located {
  start: number;
  end: number;
  score: number;
}

function textBefore(root: Node, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return range.toString().length;
}

export function createAnchor(root: Element, range: Range): TextAnchor {
  const text = root.textContent ?? '';
  const exact = range.toString();
  const start = textBefore(root, range.startContainer, range.startOffset);
  const end = start + exact.length;
  return {
    exact,
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT_LENGTH),
    start,
    end,
  };
}

function sharedSuffix(a: string, b: string): number {
  let count = 0;
  const last = Math.min(a.length, b.length);
  while (count < last && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count += 1;
  }
  return count;
}

function sharedPrefix(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

export function locateAnchor(text: string, anchor: TextAnchor): Located | null {
  if (!anchor.exact) return null;
  let best: Located | null = null;
  for (let at = text.indexOf(anchor.exact); at !== -1; at = text.indexOf(anchor.exact, at + 1)) {
    const end = at + anchor.exact.length;
    const context =
      sharedSuffix(text.slice(Math.max(0, at - anchor.prefix.length), at), anchor.prefix) +
      sharedPrefix(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    const nearness = 1 / (1 + Math.abs(at - anchor.start));
    const score = context + nearness;
    if (!best || score > best.score) best = { start: at, end, score };
  }
  return best;
}

function rangeFromOffsets(root: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (!started && start < seen + length) {
      range.setStart(node, start - seen);
      started = true;
    }
    if (started && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}

export function resolveAnchor(roots: readonly Element[], anchor: TextAnchor): Range | null {
  let best: { root: Element; located: Located } | null = null;
  for (const root of roots) {
    const located = locateAnchor(root.textContent ?? '', anchor);
    if (located && (!best || located.score > best.located.score)) best = { root, located };
  }
  return best ? rangeFromOffsets(best.root, best.located.start, best.located.end) : null;
}
