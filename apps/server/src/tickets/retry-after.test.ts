import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  DEFAULT_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MIN_BACKOFF_MS,
  parseRetryAfter,
} from './retry-after.ts';

const NOW = new Date('2026-03-02T09:00:00Z');

describe('Retry-After', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('30', NOW)).toBe(30_000);
    expect(parseRetryAfter(' 5 ', NOW)).toBe(5_000);
    expect(parseRetryAfter('Mon, 02 Mar 2026 09:01:30 GMT', NOW)).toBe(90_000);
  });

  it('gives nothing for a missing or unreadable value', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter('', NOW)).toBeNull();
    expect(parseRetryAfter('soon', NOW)).toBeNull();
    expect(parseRetryAfter('-4', NOW)).toBeNull();
  });

  it('waits the asked time, within a floor and a cap', () => {
    expect(backoffMs('45', NOW)).toBe(45_000);
    expect(backoffMs('0', NOW)).toBe(MIN_BACKOFF_MS);
    expect(backoffMs('Mon, 02 Mar 2026 08:59:00 GMT', NOW)).toBe(MIN_BACKOFF_MS);
    expect(backoffMs('86400', NOW)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs('Tue, 03 Mar 2026 09:00:00 GMT', NOW)).toBe(MAX_BACKOFF_MS);
  });

  it('waits a default time when the source says nothing usable', () => {
    expect(backoffMs(null, NOW)).toBe(DEFAULT_BACKOFF_MS);
    expect(backoffMs('later', NOW)).toBe(DEFAULT_BACKOFF_MS);
  });
});
