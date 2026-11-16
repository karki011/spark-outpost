import { describe, expect, it } from 'vitest';
import type { RemoteAuditEntry } from '@spark-outpost/contracts';
import { activitySummary } from './activity-summary.ts';

const NOW = new Date(2026, 10, 15, 14, 0).getTime();

function entry(action: RemoteAuditEntry['action'], at: Date): RemoteAuditEntry {
  return {
    id: crypto.randomUUID(),
    at: at.toISOString(),
    action,
    deviceId: null,
    deviceName: 'Kitchen phone',
    method: null,
    path: null,
    status: null,
    detail: {},
  };
}

describe('activitySummary', () => {
  it('counts only today and picks out refusals', () => {
    const entries = [
      entry('request', new Date(2026, 10, 15, 9, 0)),
      entry('refused', new Date(2026, 10, 15, 10, 0)),
      entry('passkey_sign_in_failed', new Date(2026, 10, 15, 0, 5)),
      entry('refused', new Date(2026, 10, 14, 23, 59)),
    ];
    expect(activitySummary(entries, NOW)).toEqual({ today: 3, refused: 2 });
  });

  it('is empty for a quiet day', () => {
    expect(activitySummary([], NOW)).toEqual({ today: 0, refused: 0 });
  });
});
