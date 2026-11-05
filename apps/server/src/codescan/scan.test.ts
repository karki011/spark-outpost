import { describe, expect, it } from 'vitest';
import { undefinedTerms } from './scan.ts';

describe('undefinedTerms', () => {
  it('keeps request names that no file defines under any spelling', () => {
    const named = new Map([
      ['useChartData', 1],
      ['SearchInput', 2],
      ['DatePicker', 3],
      ['nowhere', 4],
    ]);
    const stats = new Map([
      [1, { defFiles: 1, refFiles: 4 }],
      [2, { defFiles: 0, refFiles: 9 }],
      [3, { defFiles: 2, refFiles: 9 }],
      [4, { defFiles: 1, refFiles: 1 }],
    ]);
    expect(
      undefinedTerms(
        ['useChartData', 'SearchInput', 'date-picker', 'Nowhere', 'abc'],
        named,
        stats,
      ),
    ).toEqual(['SearchInput', 'Nowhere']);
  });
});
