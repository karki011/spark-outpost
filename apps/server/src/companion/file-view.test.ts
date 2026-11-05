import { describe, expect, it } from 'vitest';
import { FILE_VIEW_LINES, FILE_VIEW_LINE_CHARS, type FileFocus } from '@spark-outpost/contracts';
import { fileWindow } from './file-view.ts';

const text = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
const focus = (patch: Partial<FileFocus> = {}): FileFocus => ({
  path: '/repo/a.ts',
  line: null,
  limit: null,
  action: 'read',
  ...patch,
});

describe('the lines the island shows for a file', () => {
  it('shows the top of the file when the read has no line', () => {
    const window = fileWindow(text(100), focus());
    expect(window.firstLine).toBe(1);
    expect(window.lines).toHaveLength(FILE_VIEW_LINES);
    expect(window.totalLines).toBe(100);
    expect(window.focus).toBeNull();
  });

  it('starts three lines above a read and marks its range', () => {
    const window = fileWindow(text(200), focus({ line: 50, limit: 10 }));
    expect(window.firstLine).toBe(47);
    expect(window.lines[0]).toBe('line 47');
    expect(window.focus).toEqual({ from: 50, to: 59 });
  });

  it('clips the range to the lines shown and to the file', () => {
    expect(fileWindow(text(200), focus({ line: 50, limit: 500 })).focus).toEqual({
      from: 50,
      to: 86,
    });
    expect(fileWindow(text(12), focus({ line: 10 })).focus).toEqual({ from: 10, to: 12 });
    expect(fileWindow(text(12), focus({ line: 400, limit: 5 })).focus).toBeNull();
  });

  it('marks one line for an edit and keeps long lines short', () => {
    expect(fileWindow(text(30), focus({ action: 'edit', line: 8 })).focus).toEqual({
      from: 8,
      to: 8,
    });
    const long = fileWindow(`${'x'.repeat(1000)}\nshort\n`, focus());
    expect(long.lines[0]).toHaveLength(FILE_VIEW_LINE_CHARS);
    expect(long.lines[0]!.endsWith('…')).toBe(true);
    expect(long.lines).toEqual([long.lines[0], 'short']);
    expect(fileWindow('', focus()).lines).toEqual([]);
  });
});
