export interface WindowRange {
  start: number;
  end: number;
}

export interface WindowInput {
  scrollTop: number;
  viewport: number;
  rowHeight: number;
  count: number;
  overscan: number;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

export function visibleRange(input: WindowInput): WindowRange {
  const { scrollTop, viewport, rowHeight, count, overscan } = input;
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewport)) / rowHeight);
  return { start: clamp(first - overscan, count), end: clamp(last + overscan, count) };
}

export function revealScrollTop(
  index: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport);
  return scrollTop;
}

export function pagesInRange(
  range: WindowRange,
  fileAt: (row: number) => number | null,
  pageSize: number,
): number[] {
  const pages = new Set<number>();
  for (let row = range.start; row < range.end; row++) {
    const file = fileAt(row);
    if (file !== null) pages.add(Math.floor(file / pageSize));
  }
  return [...pages].sort((a, b) => a - b);
}
