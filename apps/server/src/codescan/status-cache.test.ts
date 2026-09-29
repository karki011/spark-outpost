import { describe, expect, it } from 'vitest';
import { STATUS_TTL_MS, statusIsFresh } from './status-cache.ts';

describe('statusIsFresh', () => {
  const entry = { at: 1000, indexMtime: 5, changes: Promise.resolve([]) };

  it('reuses git status for a few seconds while the git index is unchanged', () => {
    expect(statusIsFresh(entry, 1000 + STATUS_TTL_MS - 1, 5)).toBe(true);
    expect(statusIsFresh(entry, 1000 + STATUS_TTL_MS, 5)).toBe(false);
    expect(statusIsFresh(entry, 1001, 6)).toBe(false);
    expect(statusIsFresh(undefined, 1001, 5)).toBe(false);
  });
});
