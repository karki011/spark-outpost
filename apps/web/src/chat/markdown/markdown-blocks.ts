const CLARIFY_BLOCK = /\n*```clarify[\s\S]*?(?:\n```|$)\s*/g;

export function withoutClarifyBlock(text: string): string {
  return text.replace(CLARIFY_BLOCK, '\n').trimEnd();
}

export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
export const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const FOLD_OPEN = /<details(?=[\s>/])/gi;
const FOLD_CLOSE = /<\/details\s*>/gi;

function foldChange(line: string): number {
  const prose = line.replace(INLINE_CODE, '');
  return (prose.match(FOLD_OPEN)?.length ?? 0) - (prose.match(FOLD_CLOSE)?.length ?? 0);
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
  let folds = 0;
  for (const line of text.split('\n')) {
    if (fence === null && folds === 0 && afterBlank && startsNewBlock(line, current)) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
    if (fence === null) {
      folds = Math.max(0, folds + foldChange(line));
      fence = FENCE.exec(line)?.[1] ?? null;
    } else if (closesFence(line, fence)) fence = null;
    afterBlank = fence === null && isBlank(line);
  }
  blocks.push(current.join('\n'));
  return blocks;
}
