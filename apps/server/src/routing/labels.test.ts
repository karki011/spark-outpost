import { describe, expect, it } from 'vitest';
import { atK } from './labels.ts';

describe('file prediction at k', () => {
  it('counts hits in the first five predictions against the files that changed', () => {
    expect(atK(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'f', 'g'])).toEqual({
      hits: 1,
      precision: 0.2,
      recall: 1 / 3,
    });
  });

  it('uses the predictions available when there are fewer than five', () => {
    expect(atK(['a', 'b'], ['b'])).toEqual({ hits: 1, precision: 0.5, recall: 1 });
  });

  it('has no ratio without predictions or changes', () => {
    expect(atK([], ['a'])).toEqual({ hits: 0, precision: null, recall: 0 });
    expect(atK(['a'], [])).toEqual({ hits: 0, precision: 0, recall: null });
  });
});
