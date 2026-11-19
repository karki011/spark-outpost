const CLARIFY_BLOCK = /\n*```clarify[\s\S]*?(?:\n```|$)\s*/g;

export function withoutClarifyBlock(text: string): string {
  return text.replace(CLARIFY_BLOCK, '\n').trimEnd();
}

export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
export const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const HTML_CONTAINERS = 'details|pre|table|div|blockquote|dl|ul|ol';
const HTML_BLOCK_START = new RegExp(`^ {0,3}<(?:${HTML_CONTAINERS})(?=[\\s>/]|$)`, 'i');
const HTML_OPEN = new RegExp(`<(?:${HTML_CONTAINERS})(?=[\\s>/]|$)`, 'gi');
const HTML_CLOSE = new RegExp(`</(?:${HTML_CONTAINERS})\\s*>`, 'gi');

function htmlDepthChange(line: string, depth: number): number {
  const prose = line.replace(INLINE_CODE, '');
  const opens =
    depth > 0 || HTML_BLOCK_START.test(prose) ? (prose.match(HTML_OPEN)?.length ?? 0) : 0;
  return opens - (prose.match(HTML_CLOSE)?.length ?? 0);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function startsNewBlock(line: string, current: readonly string[]): boolean {
  if (isBlank(line) || /^\s/.test(line)) return false;
  const first = current.find((candidate) => !isBlank(candidate)) ?? '';
  return !(LIST_ITEM.test(line) && LIST_ITEM.test(first));
}

export function closesFence(line: string, fence: string): boolean {
  const marker = FENCE.exec(line)?.[1];
  return (
    marker !== undefined &&
    marker[0] === fence[0] &&
    marker.length >= fence.length &&
    line.trim() === marker
  );
}

export function splitBlocks(text: string): string[] {
  if (REFERENCE_DEFINITION.test(text)) return [text];
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let afterBlank = false;
  let htmlDepth = 0;
  for (const line of text.split('\n')) {
    if (fence === null && htmlDepth === 0 && afterBlank && startsNewBlock(line, current)) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
    if (fence === null) {
      htmlDepth = Math.max(0, htmlDepth + htmlDepthChange(line, htmlDepth));
      fence = FENCE.exec(line)?.[1] ?? null;
    } else if (closesFence(line, fence)) fence = null;
    afterBlank = fence === null && isBlank(line);
  }
  blocks.push(current.join('\n'));
  return blocks;
}
