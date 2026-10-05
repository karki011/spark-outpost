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

  it('names every failing run once all of them have finished', () => {
    expect(
      ciStatus([
        run('lint', 'completed', 'success'),
        run('test', 'completed', 'failure'),
        run('e2e', 'completed', 'timed_out'),
      ]),
    ).toEqual({ state: 'failing', failing: ['test', 'e2e'] });
  });

  it('is pending while any run has not finished, even when another already failed', () => {
    expect(ciStatus([run('test', 'completed', 'failure'), run('build', 'queued', null)])).toEqual({
      state: 'pending',
    });
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
