import { describe, expect, it } from 'vitest';
import { flatRows, groupedRows, fileIndexAt, parentRow } from './file-rows.ts';
import { pagesInRange, revealScrollTop, visibleRange } from './virtual-window.ts';

describe('virtual window', () => {
  it('renders only the rows in view plus a small overscan', () => {
    const input = { scrollTop: 0, viewport: 600, rowHeight: 30, count: 5000, overscan: 5 };
    expect(visibleRange(input)).toEqual({ start: 0, end: 25 });
    expect(visibleRange({ ...input, scrollTop: 30 * 4000 })).toEqual({ start: 3995, end: 4025 });
    expect(visibleRange({ ...input, scrollTop: 30 * 5000 })).toEqual({ start: 4995, end: 5000 });
    expect(visibleRange({ ...input, count: 0 })).toEqual({ start: 0, end: 0 });
    expect(visibleRange({ ...input, scrollTop: -200 })).toEqual({ start: 0, end: 25 });
  });

  it('keeps the window small however far the list scrolls', () => {
    for (const scrollTop of [0, 12_345, 99_999, 149_400]) {
      const range = visibleRange({
        scrollTop,
        viewport: 900,
        rowHeight: 30,
        count: 5000,
        overscan: 8,
      });
      expect(range.end - range.start).toBeLessThanOrEqual(30 + 16 + 1);
    }
  });

  it('scrolls just enough to reveal a row', () => {
    expect(revealScrollTop(10, 30, 0, 600)).toBe(0);
    expect(revealScrollTop(30, 30, 0, 600)).toBe(330);
    expect(revealScrollTop(2, 30, 300, 600)).toBe(60);
  });

  it('asks only for the pages that hold visible files', () => {
    const model = flatRows(5000);
    expect(pagesInRange({ start: 190, end: 230 }, (row) => fileIndexAt(model, row), 200)).toEqual([
      0, 1,
    ]);
  });
});

describe('file rows', () => {
  const folders = [
    { path: 'docs', start: 0, count: 2 },
    { path: 'src/app', start: 2, count: 3 },
  ];

  it('puts folder rows above their files and maps files back to rows', () => {
    const model = groupedRows(folders, new Set());
    expect(model.count).toBe(7);
    expect(model.at(0)).toMatchObject({ kind: 'folder', path: 'docs', position: 1, setSize: 2 });
    expect(model.at(5)).toMatchObject({ kind: 'file', index: 3, level: 2, position: 2 });
    expect(model.rowOfFile(4)).toBe(6);
    expect(parentRow(model, 5)).toBe(3);
  });

  it('hides the files of a collapsed folder', () => {
    const model = groupedRows(folders, new Set(['docs']));
    expect(model.count).toBe(5);
    expect(model.at(0)).toMatchObject({ kind: 'folder', collapsed: true });
    expect(model.rowOfFile(0)).toBeNull();
    expect(fileIndexAt(model, 2)).toBe(2);
  });
});
