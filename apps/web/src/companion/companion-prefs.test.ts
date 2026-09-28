import { describe, expect, it } from 'vitest';
import { parsePrefs, SEEN_ERRORS_LIMIT, withSeenErrors } from './companion-prefs.ts';

describe('companion prefs', () => {
  it('falls back to the bottom-right corner, shown, for missing or broken data', () => {
    const fallback = { corner: 'bottom-right', hidden: false, seenErrors: [] };
    expect(parsePrefs(null)).toEqual(fallback);
    expect(parsePrefs('{nope')).toEqual(fallback);
    expect(parsePrefs('{"corner":"middle","hidden":"yes","seenErrors":[1,"a"]}')).toEqual({
      ...fallback,
      seenErrors: ['a'],
    });
  });

  it('reads a saved corner and hidden flag', () => {
    expect(parsePrefs('{"corner":"top-left","hidden":true}')).toMatchObject({
      corner: 'top-left',
      hidden: true,
    });
  });

  it('remembers a bounded list of seen errors without duplicates', () => {
    expect(withSeenErrors(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: SEEN_ERRORS_LIMIT }, (_, index) => `k${index}`);
    const next = withSeenErrors(many, ['new']);
    expect(next).toHaveLength(SEEN_ERRORS_LIMIT);
    expect(next.at(-1)).toBe('new');
    expect(next[0]).toBe('k1');
  });
});
