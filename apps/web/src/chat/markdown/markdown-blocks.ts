const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function startsNewBlock(line: string, current: readonly string[]): boolean {
  if (isBlank(line) || /^\s/.test(line)) return false;
  const first = current.find((candidate) => !isBlank(candidate)) ?? '';
  return !(LIST_ITEM.test(line) && LIST_ITEM.test(first));
}

function closesFence(line: string, fence: string): boolean {
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
  for (const line of text.split('\n')) {
    if (fence === null && afterBlank && startsNewBlock(line, current)) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
    if (fence === null) fence = FENCE.exec(line)?.[1] ?? null;
    else if (closesFence(line, fence)) fence = null;
    afterBlank = fence === null && isBlank(line);
  }
  blocks.push(current.join('\n'));
  return blocks;
}
