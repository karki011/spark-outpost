import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';

export function rankedFile(index: number, overrides: Partial<RankedFile> = {}): RankedFile {
  return {
    path: `libs/ui/src/lib/part-${index}/part-${index}.tsx`,
    score: 1 - index / 1000,
    matches: 3,
    termsMatched: 1,
    references: 12,
    lines: 140,
    symbols: 6,
    churn: 2,
    package: index % 2 === 0 ? 'ui' : 'web',
    uncommitted: false,
    hasTest: index % 3 === 0,
    reasons: ['text match'],
    ...overrides,
  };
}

export function scanReport(count: number): ScanReport {
  return {
    index: 'ready',
    indexedFiles: 5443,
    partial: false,
    timings: {},
    terms: { paths: [], fileNames: [], identifiers: ['KpiCard'], phrases: [], words: [] },
    candidates: Array.from({ length: count }, (_, index) => rankedFile(index)),
    summary: {
      packagesTouched: ['ui', 'web'],
      ownersTouched: 1,
      namedSymbols: [{ name: 'KpiCard', definedIn: 1, referencedBy: 40 }],
      uncommitted: 2,
      instructions: ['AGENTS.md'],
      tools: ['nx', 'pnpm'],
    },
  };
}
