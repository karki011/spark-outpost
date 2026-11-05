import { lineAt, scanLines } from './md-lines.ts';

const COPIED_STYLES = [
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStretch',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'fontVariantLigatures',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'textIndent',
  'textTransform',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

export function copyTextareaStyles(textarea: HTMLTextAreaElement, mirror: HTMLElement): void {
  const style = getComputedStyle(textarea);
  for (const property of COPIED_STYLES) mirror.style[property] = style[property];
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const scrollbar = Math.max(0, textarea.offsetWidth - textarea.clientWidth - borders);
  mirror.style.paddingRight = `${parseFloat(style.paddingRight) + scrollbar}px`;
  mirror.scrollTop = textarea.scrollTop;
}

function pointIn(line: Element, local: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let left = local;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) return { node, offset: left };
    left -= length;
    last = node as Text;
  }
  return last ? { node: last, offset: last.length } : null;
}

function offsetRect(mirror: HTMLElement, text: string, offset: number): DOMRect | null {
  const lines = scanLines(text);
  const index = lineAt(lines, offset);
  const element = mirror.children[index];
  if (!element) return null;
  const point = pointIn(element, offset - lines[index]!.start);
  if (!point) return element.getBoundingClientRect();
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  return range.getClientRects()[0] ?? element.getBoundingClientRect();
}

export interface Anchor {
  left: number;
  bottom: number;
  width: number;
}

export function anchorPoint(
  box: HTMLElement,
  mirror: HTMLElement,
  text: string,
  offset: number,
  gap: number,
): Anchor | null {
  const rect = offsetRect(mirror, text, offset);
  if (!rect) return null;
  const outer = box.getBoundingClientRect();
  return {
    left: rect.left - outer.left,
    bottom: outer.bottom - rect.top + gap,
    width: outer.width,
  };
}
