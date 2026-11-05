import { describe, expect, it } from 'vitest';
import { rankedFile, scanReport } from '../codescan/scan-fixtures.ts';
import type { IndexedDeclaration } from '../codescan/scan-store.ts';
import { isUnder, leadFiles, leadLabel, pickDeclarations } from './leads.ts';

function declaration(name: string, startLine: number, refFiles = 0): IndexedDeclaration {
  return { name, kind: 'function', startLine, endLine: startLine + 4, refFiles };
}

describe('pickDeclarations', () => {
  const report = {
    ...scanReport(1),
    terms: { paths: [], fileNames: [], identifiers: ['KpiCard'], phrases: [], words: ['tooltip'] },
  };

  it('puts declarations the request names first, then the most referenced, then file order', () => {
    const picked = pickDeclarations(
      [
        declaration('formatValue', 5, 2),
        declaration('renderTooltip', 60, 0),
        declaration('KpiCard', 20, 40),
        declaration('useTrend', 40, 9),
        declaration('sparkline', 80, 9),
      ],
      report,
      4,
    );
    expect(picked.map((entry) => [entry.name, entry.matched])).toEqual([
      ['KpiCard', true],
      ['renderTooltip', true],
      ['useTrend', false],
      ['sparkline', false],
    ]);
  });

  it('writes a lead as name@start-end', () => {
    expect(leadLabel(declaration('KpiCard', 20))).toBe('KpiCard@20-24');
  });
});

describe('leadFiles', () => {
  const report = {
    ...scanReport(0),
    candidates: [
      rankedFile(0, { path: 'apps/web/src/card.tsx' }),
      rankedFile(1, { path: 'apps/web/.env.local' }),
      rankedFile(2, { path: 'apps/web/src/private/keys.ts' }),
      rankedFile(3, { path: 'apps/web-admin/src/card.tsx' }),
      rankedFile(4, { path: 'apps/web/dist/card.js' }),
      rankedFile(5, { path: 'apps/web/src/chart.tsx' }),
    ],
  };

  it('drops secret, ignored and skipped files and keeps to the folder asked for', () => {
    const files = leadFiles(report, { ignore: ['private/'], limit: 10, under: 'apps/web' });
    expect(files.map((file) => file.path)).toEqual([
      'apps/web/src/card.tsx',
      'apps/web/src/chart.tsx',
    ]);
  });

  it('keeps the scan order and the limit', () => {
    const files = leadFiles(report, { ignore: [], limit: 2 });
    expect(files.map((file) => file.path)).toEqual([
      'apps/web/src/card.tsx',
      'apps/web/src/private/keys.ts',
    ]);
  });

  it('matches a folder by whole path segments', () => {
    expect(isUnder('apps/web/src/a.ts', 'apps/web')).toBe(true);
    expect(isUnder('apps/web-admin/a.ts', 'apps/web')).toBe(false);
    expect(isUnder('apps/web', 'apps/web')).toBe(true);
    expect(isUnder('anything.ts', undefined)).toBe(true);
  });
});
