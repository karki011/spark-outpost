import { describe, expect, it } from 'vitest';
import { firstReportedEffort, reportedEfforts } from './efforts.ts';

const option = (id: string) => ({ id, label: id, description: null });

describe('reported efforts', () => {
  it('uses what the agent reported, without its own default entry', () => {
    const reported = reportedEfforts('claude', [option('default'), option('low'), option('xhigh')]);
    expect(reported.map((effort) => effort.id)).toEqual(['low', 'xhigh']);
  });

  it('falls back to the catalog when nothing was reported', () => {
    expect(reportedEfforts('codex', null).map((effort) => effort.id)).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(reportedEfforts('claude', [option('default')]).map((effort) => effort.id)).toContain(
      'max',
    );
  });
});

describe('first reported effort', () => {
  it('takes the first source the provider reports', () => {
    expect(firstReportedEffort(['max', null, 'low'], ['low', 'high'])).toBe('low');
    expect(firstReportedEffort([null, undefined, ''], ['low'])).toBeNull();
    expect(firstReportedEffort(['max'], ['low'])).toBeNull();
  });

  it('accepts any source when the provider reports no efforts', () => {
    expect(firstReportedEffort([null, 'max'], [])).toBe('max');
  });
});
