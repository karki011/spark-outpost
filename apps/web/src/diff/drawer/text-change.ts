import type { ChangeSpec } from '@codemirror/state';

export function changedRange(current: string, next: string): ChangeSpec | null {
  if (current === next) return null;
  const shorter = Math.min(current.length, next.length);
  let from = 0;
  while (from < shorter && current.charCodeAt(from) === next.charCodeAt(from)) from++;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > from &&
    nextEnd > from &&
    current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd--;
    nextEnd--;
  }
  return { from, to: currentEnd, insert: next.slice(from, nextEnd) };
}
