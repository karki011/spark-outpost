import { describe, expect, it } from 'vitest';
import type { RemoteDevice } from '@spark-outpost/contracts';
import { daysUntilUnused, deviceSummary, lastSeenLine, stopsWorkingLine } from './device-copy.ts';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function device(change: Partial<RemoteDevice>): RemoteDevice {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Kitchen phone',
    createdAt: '2026-09-01T10:00:00Z',
    lastSeenAt: new Date(NOW - DAY).toISOString(),
    revokedAt: null,
    replacedBy: null,
    duplicateOf: null,
    expired: false,
    connected: false,
    passkeys: [],
    ...change,
  };
}

describe('days until a device stops working', () => {
  it('is quiet until the device is within five days of the 30-day cutoff', () => {
    expect(daysUntilUnused(device({}), NOW)).toBeNull();
    expect(
      daysUntilUnused(device({ lastSeenAt: new Date(NOW - 24 * DAY).toISOString() }), NOW),
    ).toBeNull();
  });

  it('counts the days left, rounding up', () => {
    const seen = (days: number) => device({ lastSeenAt: new Date(NOW - days * DAY).toISOString() });
    expect(daysUntilUnused(seen(25), NOW)).toBe(5);
    expect(daysUntilUnused(seen(26), NOW)).toBe(4);
    expect(daysUntilUnused(seen(29.5), NOW)).toBe(1);
  });

  it('says nothing for a connected, expired or already past device', () => {
    const old = new Date(NOW - 27 * DAY).toISOString();
    expect(daysUntilUnused(device({ lastSeenAt: old, connected: true }), NOW)).toBeNull();
    expect(daysUntilUnused(device({ lastSeenAt: old, expired: true }), NOW)).toBeNull();
    expect(
      daysUntilUnused(device({ lastSeenAt: new Date(NOW - 31 * DAY).toISOString() }), NOW),
    ).toBeNull();
  });

  it('words the warning in singular and plural', () => {
    expect(stopsWorkingLine(1)).toBe('Stops working in 1 day unless used');
    expect(stopsWorkingLine(4)).toBe('Stops working in 4 days unless used');
  });
});

describe('device lines', () => {
  it('says when a device was last seen, or not seen since for an old duplicate', () => {
    expect(lastSeenLine(device({}), NOW)).toMatch(/^Last seen /);
    expect(
      lastSeenLine(device({ duplicateOf: '22222222-2222-4222-8222-222222222222' }), NOW),
    ).toMatch(/^Not seen since /);
  });

  it('summarises the date added and the passkeys', () => {
    expect(deviceSummary(device({}))).toMatch(/^Added .* · No passkey$/);
    expect(
      deviceSummary(
        device({
          passkeys: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              label: null,
              synced: false,
              createdAt: '2026-10-06T10:00:00',
              lastUsedAt: null,
            },
          ],
        }),
      ),
    ).toMatch(/^Added .* · 1 passkey · added /);
  });
});
