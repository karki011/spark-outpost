// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { missedSearches, recordMissedSearch } from './missed-searches.ts';

beforeEach(() => localStorage.clear());

describe('missed Docs searches', () => {
  it('keeps the finished query, not each prefix typed on the way', () => {
    recordMissedSearch('kube');
    recordMissedSearch('kubernetes');
    recordMissedSearch('Kubernetes ');
    expect(missedSearches()).toEqual(['kubernetes']);
  });

  it('ignores very short queries and keeps only the newest thirty', () => {
    recordMissedSearch('ab');
    for (let index = 0; index < 35; index += 1) recordMissedSearch(`zz${index}zz`);
    const kept = missedSearches();
    expect(kept).toHaveLength(30);
    expect(kept.at(-1)).toBe('zz34zz');
    expect(kept).not.toContain('ab');
  });

  it('reads nothing from a broken store', () => {
    localStorage.setItem('spark-outpost.docs.missed-searches', '{nope');
    expect(missedSearches()).toEqual([]);
  });
});
