import { describe, expect, it } from 'vitest';
import { staleAmong } from './plan-staleness.ts';

describe('staleAmong', () => {
  it('matches named files against changed paths, by full path or by suffix', () => {
    expect(
      staleAmong(
        ['src/export.ts', 'report.tsx', 'README.md'],
        ['apps/web/src/export.ts', 'report.tsx'],
      ),
    ).toEqual(['src/export.ts', 'report.tsx']);
  });

  it('does not match a different file with the same ending', () => {
    expect(staleAmong(['port.ts'], ['src/export.ts'])).toEqual([]);
  });
});
