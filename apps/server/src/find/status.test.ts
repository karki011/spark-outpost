import { describe, expect, it } from 'vitest';
import { scanReport } from '../codescan/scan-fixtures.ts';
import type { ScanOutcome } from '../codescan/scanner.ts';
import type { CodeLeads } from './leads.ts';
import { findIssues, findStatus } from './status.ts';

function outcome(overrides: Partial<ScanOutcome> = {}): ScanOutcome {
  return {
    status: 'done',
    report: scanReport(2),
    error: null,
    elapsedMs: 5,
    queuedMs: 0,
    ...overrides,
  };
}

const lead = {
  path: 'a.ts',
  score: 1,
  reasons: [],
  package: 'app',
  lines: 3,
  area: 'App',
  kind: 'other' as const,
  declarations: [],
};
const found: CodeLeads = { leads: [lead], withoutRanges: 0, onMap: true };

describe('find status', () => {
  it('is complete only when the scan finished on a ready index with line ranges', () => {
    expect(findStatus(outcome(), found)).toBe('complete');
    expect(findIssues(outcome(), found)).toEqual([]);
  });

  it('says the index is building instead of passing text matches off as complete', () => {
    for (const index of ['missing', 'building'] as const) {
      const scan = outcome({ report: { ...scanReport(2), index } });
      expect(findStatus(scan, found)).toBe('index_building');
      expect(findIssues(scan, found).join(' ')).toMatch(/index/);
    }
  });

  it('is partial when the scan ran out of time, failed, or rows have no line ranges', () => {
    const late = outcome({ status: 'partial', report: { ...scanReport(2), partial: true } });
    expect(findStatus(late, found)).toBe('partial');
    expect(findIssues(late, found)).toEqual([
      'The search ran out of time; some matches may be missing.',
    ]);

    const nothing = outcome({ status: 'timed_out', report: null });
    expect(findStatus(nothing, { ...found, leads: [] })).toBe('partial');

    const failed = outcome({ status: 'failed', report: null, error: 'rg exited with 2' });
    expect(findIssues(failed, { ...found, leads: [] })).toEqual([
      'The search failed: rg exited with 2',
    ]);

    const old = { ...found, withoutRanges: 3 };
    expect(findStatus(outcome(), old)).toBe('partial');
    expect(findIssues(outcome(), old)).toEqual(['3 files have no declaration line ranges yet.']);
  });

  it('notes missing areas without calling the result partial', () => {
    const unplaced = { ...found, onMap: false };
    expect(findStatus(outcome(), unplaced)).toBe('complete');
    expect(findIssues(outcome(), unplaced).join(' ')).toMatch(/Map/);
  });
});
