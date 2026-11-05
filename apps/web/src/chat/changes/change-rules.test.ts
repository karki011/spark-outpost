import { describe, expect, it } from 'vitest';
import type { ChangeEntry } from '@spark-outpost/contracts';
import {
  diffStatBar,
  fileView,
  formatBytes,
  formatCount,
  formatLines,
  formatTotal,
  isGenerated,
  runTotals,
} from './change-rules.ts';

function file(overrides: Partial<ChangeEntry>): ChangeEntry {
  return {
    runId: '00000000-0000-4000-8000-00000000000a',
    path: 'src/app.ts',
    change: 'modified',
    added: 3,
    removed: 1,
    shown: 'text',
    bytes: 120,
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
  it('shows ordinary text diffs', () => {
    expect(fileView(file({ added: 20_000 }))).toBe('text');
  });

  it('marks binary files before anything else', () => {
    expect(fileView(file({ path: 'dist/logo.png', shown: 'binary' }))).toBe('binary');
  });

  it('collapses generated files', () => {
    expect(fileView(file({ path: 'pnpm-lock.yaml' }))).toBe('generated');
  });

  it('collapses files over 1 MB and refuses ones too big to load', () => {
    expect(fileView(file({ bytes: 1024 * 1024 + 1 }))).toBe('huge');
    expect(fileView(file({ shown: 'too-large' }))).toBe('huge');
    expect(fileView(file({ bytes: 17 * 1024 * 1024 }))).toBe('oversized');
  });
});

describe('formatBytes and formatTotal', () => {
  it('writes sizes and totals people can read', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(24 * 1024)).toBe('24 KB');
    expect(formatBytes(3.25 * 1024 * 1024)).toBe('3.3 MB');
    expect(formatTotal(2550)).toBe('2,550');
    expect(formatTotal(250_400)).toBe('250k');
  });
});

describe('runTotals and diffStatBar', () => {
  it('sums the counts of several runs', () => {
    expect(
      runTotals([
        { files: 2, added: 40, removed: 7 },
        { files: 1, added: 3, removed: 1 },
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
