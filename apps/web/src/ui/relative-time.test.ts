import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time.ts';

const now = Date.parse('2026-09-25T12:00:00Z');

describe('relativeTime', () => {
  it('describes recent times in plain words', () => {
    expect(relativeTime('2026-09-25T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-09-25T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-09-25T09:00:00Z', now)).toBe('3 h ago');
  });

  it('treats clock skew into the future as just now', () => {
    expect(relativeTime('2026-09-25T12:00:05Z', now)).toBe('just now');
  });
});
