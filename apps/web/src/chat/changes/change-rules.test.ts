import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '@spark-outpost/contracts';
import {
  changeTotals,
  diffStatBar,
  fileView,
  formatCount,
  formatLines,
  isGenerated,
} from './change-rules.ts';

function file(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    path: 'src/app.ts',
    change: 'modified',
    added: 3,
    removed: 1,
    oldText: 'a\n',
    newText: 'b\n',
    shown: 'text',
    ...overrides,
  };
}

describe('formatCount', () => {
  it('keeps small counts exact and shortens large ones', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(340)).toBe('340');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1240)).toBe('1.2k');
    expect(formatCount(12_345)).toBe('12.3k');
    expect(formatCount(250_400)).toBe('250k');
    expect(formatCount(1_250_000)).toBe('1.3M');
  });

  it('writes line counts with separators', () => {
    expect(formatLines(1)).toBe('1 line');
    expect(formatLines(1240)).toBe('1,240 lines');
  });
});

describe('isGenerated', () => {
  it('spots lockfiles, build output and minified files', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'apps/web/package-lock.json',
      'Cargo.lock',
      'deps.lock',
      'dist/index.js',
      'packages/ui/build/app.css',
      'public/vendor.min.js',
      'styles/site.min.css',
    ]) {
      expect(isGenerated(path), path).toBe(true);
    }
  });

  it('leaves ordinary source alone', () => {
    for (const path of ['src/lock.ts', 'distance.ts', 'docs/build-notes.md', 'README.md']) {
      expect(isGenerated(path), path).toBe(false);
    }
  });
});

describe('fileView', () => {
  it('shows ordinary text diffs inline', () => {
    expect(fileView(file({}))).toEqual({ kind: 'text' });
  });

  it('marks binary files before anything else', () => {
    expect(fileView(file({ path: 'dist/logo.png', shown: 'binary' }))).toEqual({ kind: 'binary' });
  });

  it('collapses generated files', () => {
    expect(fileView(file({ path: 'pnpm-lock.yaml' }))).toEqual({ kind: 'generated' });
  });

  it('collapses files over 800 changed lines', () => {
    expect(fileView(file({ added: 800, removed: 0 }))).toEqual({ kind: 'text' });
    expect(fileView(file({ added: 900, removed: 340 }))).toEqual({ kind: 'large', lines: 1240 });
  });

  it('collapses diffs over 200 KB even with few changed lines', () => {
    const big = 'x'.repeat(210 * 1024);
    expect(fileView(file({ oldText: big, newText: `${big}y` }))).toEqual({
      kind: 'large',
      lines: 4,
    });
  });

  it('keeps the true line count when the server left the text out', () => {
    expect(
      fileView(file({ shown: 'too-large', oldText: null, newText: null, added: 30_000 })),
    ).toEqual({ kind: 'truncated', lines: 30_001 });
  });
});

describe('changeTotals and diffStatBar', () => {
  it('sums counts, treating unknown counts as zero', () => {
    expect(
      changeTotals([
        file({ added: 40, removed: 7 }),
        file({ added: null, removed: null }),
        file({}),
      ]),
    ).toEqual({ files: 3, added: 43, removed: 8 });
  });

  it('splits five blocks by the share of added and removed lines', () => {
    expect(diffStatBar(42, 17)).toEqual({ add: 4, remove: 1, empty: 0 });
    expect(diffStatBar(0, 12)).toEqual({ add: 0, remove: 5, empty: 0 });
    expect(diffStatBar(1, 1)).toEqual({ add: 1, remove: 1, empty: 3 });
    expect(diffStatBar(1000, 1)).toEqual({ add: 4, remove: 1, empty: 0 });
    expect(diffStatBar(0, 0)).toEqual({ add: 0, remove: 0, empty: 5 });
  });
});
