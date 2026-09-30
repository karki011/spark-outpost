import { describe, expect, it } from 'vitest';
import { ciStatus, pagesCovering } from './pull-reads.ts';

const run = (name: string, status: string, conclusion: string | null) => ({
  name,
  status,
  conclusion,
});

describe('ciStatus', () => {
  it('is none without check runs', () => {
    expect(ciStatus([])).toEqual({ state: 'none' });
  });

  it('names every failing run even while others are still running', () => {
    expect(
      ciStatus([
        run('lint', 'completed', 'success'),
        run('test', 'completed', 'failure'),
        run('e2e', 'completed', 'timed_out'),
        run('build', 'in_progress', null),
      ]),
    ).toEqual({ state: 'failing', failing: ['test', 'e2e'] });
  });

  it('is pending while a run has not finished and none failed', () => {
    expect(ciStatus([run('lint', 'completed', 'success'), run('test', 'queued', null)])).toEqual({
      state: 'pending',
    });
  });

  it('passes when every run finished without failing, skipped and neutral included', () => {
    expect(
      ciStatus([
        run('lint', 'completed', 'success'),
        run('docs', 'completed', 'skipped'),
        run('info', 'completed', 'neutral'),
      ]),
    ).toEqual({ state: 'passing' });
  });
});

describe('pagesCovering', () => {
  it('reads one GitHub page when the range fits inside it', () => {
    expect(pagesCovering({ offset: 0, limit: 30 })).toEqual([1]);
    expect(pagesCovering({ offset: 100, limit: 100 })).toEqual([2]);
  });

  it('reads two pages when the range crosses a page boundary', () => {
    expect(pagesCovering({ offset: 90, limit: 20 })).toEqual([1, 2]);
    expect(pagesCovering({ offset: 199, limit: 2 })).toEqual([2, 3]);
  });
});
