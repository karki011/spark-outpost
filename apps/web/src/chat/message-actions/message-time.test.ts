import { describe, expect, it } from 'vitest';
import { messageTime } from './message-time.ts';

const now = Date.parse('2026-09-25T12:00:00');

describe('messageTime', () => {
  it('describes the last minute as just now, including small clock skew', () => {
    expect(messageTime('2026-09-25T11:59:30', now)).toBe('just now');
    expect(messageTime('2026-09-25T12:00:05', now)).toBe('just now');
  });

  it('counts minutes, hours and days in words', () => {
    expect(messageTime('2026-09-25T11:59:00', now)).toBe('1 minute ago');
    expect(messageTime('2026-09-25T11:57:00', now)).toBe('3 minutes ago');
    expect(messageTime('2026-09-25T10:30:00', now)).toBe('1 hour ago');
    expect(messageTime('2026-09-25T02:00:00', now)).toBe('10 hours ago');
    expect(messageTime('2026-09-24T09:00:00', now)).toBe('yesterday');
    expect(messageTime('2026-09-21T12:00:00', now)).toBe('4 days ago');
  });

  it('shows a date for older messages, with the year only when it differs', () => {
    expect(messageTime('2026-09-02T12:00:00', now)).toBe('Sep 2');
    expect(messageTime('2025-12-30T12:00:00', now)).toBe('Dec 30, 2025');
  });
});
