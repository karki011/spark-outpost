import { describe, expect, it } from 'vitest';
import { browserHistoryEventSchema, historySince, historyUrl } from './browser-history.ts';

describe('browser history addresses', () => {
  it('keeps web addresses and hides secret-looking query values', () => {
    expect(historyUrl('https://docs.example.com/deploy?tab=cli#step-2')).toBe(
      'https://docs.example.com/deploy?tab=cli#step-2',
    );
    expect(historyUrl('https://app.example.com/callback?code=abc123&state=x')).toBe(
      'https://app.example.com/callback?code=[redacted]&state=[redacted]',
    );
    expect(historyUrl('https://example.com/login#access_token=secret')).toBe(
      'https://example.com/login#access_token=[redacted]',
    );
  });

  it('keeps no local file, Spark page or address with a login in it', () => {
    expect(historyUrl('file:///Users/me/notes.html')).toBeNull();
    expect(historyUrl('about:blank')).toBeNull();
    expect(historyUrl('https://me:pw@example.com/')).toBeNull();
    expect(historyUrl('not an address')).toBeNull();
  });

  it('refuses an event whose address still holds a secret', () => {
    const event = { kind: 'visit', profile: 'personal', title: 'Sign in' };
    expect(
      browserHistoryEventSchema.safeParse({ ...event, url: 'https://a.example/?token=1' }).success,
    ).toBe(false);
    expect(
      browserHistoryEventSchema.safeParse({ ...event, url: 'https://a.example/?q=deploy' }).success,
    ).toBe(true);
  });

  it('turns a range into the moment it starts', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(historySince('hour', now)?.toISOString()).toBe('2026-10-23T11:00:00.000Z');
    expect(historySince('week', now)?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(historySince('all', now)).toBeNull();
  });
});
