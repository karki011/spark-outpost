import { describe, expect, it } from 'vitest';
import type { RemoteAuditEntry, RemotePasskey, TailscaleState } from '@spark-outpost/contracts';
import {
  activityDetail,
  activityLine,
  passkeySummary,
  pushFailureLine,
  statusCopy,
} from './phone-copy.ts';

function state(change: Partial<TailscaleState>): TailscaleState {
  return { status: 'off', hostname: null, address: null, message: null, ...change };
}

function entry(change: Partial<RemoteAuditEntry>): RemoteAuditEntry {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    at: '2026-10-06T10:00:00Z',
    action: 'request',
    deviceId: null,
    deviceName: null,
    method: null,
    path: null,
    status: null,
    detail: {},
    ...change,
  };
}

describe('status copy', () => {
  it('gives one next step for every state that is not ready', () => {
    expect(statusCopy(state({ status: 'not_installed' })).step).toContain('Install Tailscale');
    expect(statusCopy(state({ status: 'signed_out' })).step).toContain('sign in');
    expect(statusCopy(state({ status: 'https_off' })).step).toContain('HTTPS Certificates');
    expect(statusCopy(state({ status: 'error', message: 'Serve drifted.' })).step).toBe(
      'Serve drifted.',
    );
    expect(statusCopy(state({ status: 'on' })).step).toBeNull();
  });

  it('says why phone access was turned off when the server did it', () => {
    expect(statusCopy(state({ message: 'Turned off at start.' })).step).toBe(
      'Turned off at start.',
    );
  });
});

describe('activity', () => {
  it('names the device and what happened', () => {
    expect(activityLine(entry({ action: 'device_paired', deviceName: 'Kitchen phone' }))).toBe(
      'Kitchen phone paired',
    );
    expect(
      activityLine(entry({ action: 'pairing_submitted', detail: { deviceName: 'Pixel' } })),
    ).toBe('Pixel asked to pair');
    expect(activityLine(entry({ action: 'hostname_changed', detail: { on: true } }))).toBe(
      'Remote control turned on',
    );
    expect(activityLine(entry({ action: 'refused' }))).toBe('A device was refused');
  });

  it('says a phone paired again and why one was shown the pairing page', () => {
    expect(
      activityLine(entry({ action: 'device_paired_again', deviceName: 'Kitchen phone' })),
    ).toBe('Kitchen phone paired again');
    const shown = (reason: string, deviceName: string | null = null) =>
      activityLine(entry({ action: 'pairing_page_shown', deviceName, detail: { reason } }));
    expect(shown('missing')).toBe('A device with no sign-in opened the pairing page');
    expect(shown('unknown')).toContain('paired before asked to pair again');
    expect(shown('revoked', 'Pixel')).toBe(
      'Pixel asked to pair again (it was removed on this Mac)',
    );
    expect(shown('unused', 'Pixel')).toBe('Pixel asked to pair again (not used for 30 days)');
  });

  it('says what happened with passkeys, and flags a use count that went backwards', () => {
    const line = (action: RemoteAuditEntry['action'], detail = {}, deviceName = 'Pixel') =>
      activityLine(entry({ action, deviceName, detail }));
    expect(line('device_passkey_added')).toBe('Pixel saved a passkey');
    expect(line('device_passkey_sign_in')).toBe('Pixel signed in with a passkey');
    expect(line('device_passkey_sign_in', { counter: 'regressed' })).toBe(
      'Pixel signed in with a passkey. Its use count went backwards: remove its passkeys if this was not you',
    );
    expect(line('device_passkeys_removed', { count: 2 })).toBe('Passkeys removed for Pixel');
    expect(line('passkey_sign_in_failed', { reason: 'verification' })).toBe(
      'A passkey sign-in for Pixel was refused',
    );
    expect(line('passkey_sign_in_failed', { reason: 'device_unused' })).toBe(
      'A passkey sign-in for Pixel was refused (not used for 30 days)',
    );
    expect(
      activityLine(
        entry({ action: 'passkey_sign_in_failed', detail: { reason: 'unknown_credential' } }),
      ),
    ).toBe('A passkey sign-in was refused');
  });

  it('says where a notification went and when one could not be delivered', () => {
    const line = (outcome: string) =>
      activityLine(
        entry({ action: 'notification_sent', deviceName: 'Pixel', detail: { outcome } }),
      );
    expect(line('sent')).toBe('Sent a notification to Pixel');
    expect(line('failed')).toBe('A notification to Pixel failed');
    expect(line('gone')).toBe('Pixel no longer takes notifications');
    expect(
      activityLine(
        entry({
          action: 'notification_sent',
          deviceName: 'iPhone',
          detail: { outcome: 'failed', reason: 'BadJwtToken' },
        }),
      ),
    ).toBe('A notification to iPhone failed: BadJwtToken');
  });

  it('explains a refused sender contact and names other failures by their code', () => {
    const failure = { at: '2026-10-14T10:00:00.000Z', deviceName: 'iPhone', status: 403 };
    expect(pushFailureLine({ ...failure, reason: 'BadJwtToken' })).toBe(
      'The last notification to iPhone was refused: the push service did not accept the sender contact. Set a contact you own.',
    );
    expect(pushFailureLine({ ...failure, reason: 'TooManyRequests', status: 429 })).toBe(
      'The last notification to iPhone could not be delivered (TooManyRequests).',
    );
    expect(pushFailureLine({ ...failure, reason: null, status: 500 })).toBe(
      'The last notification to iPhone could not be delivered (status 500).',
    );
    expect(pushFailureLine({ ...failure, deviceName: null, reason: null, status: null })).toBe(
      'The last notification to a device could not be delivered.',
    );
  });

  it('shows the request and its result when there is one', () => {
    expect(activityDetail(entry({ method: 'POST', path: '/api/reset', status: 403 }))).toBe(
      'POST /api/reset · 403',
    );
    expect(activityDetail(entry({ action: 'device_paired' }))).toBeNull();
  });
});

describe('a device passkeys line', () => {
  const passkey = (change: Partial<RemotePasskey>): RemotePasskey => ({
    id: '11111111-1111-4111-8111-111111111111',
    label: null,
    synced: false,
    createdAt: '2026-10-06T10:00:00',
    lastUsedAt: null,
    ...change,
  });

  it('is absent without a passkey', () => {
    expect(passkeySummary([])).toBeNull();
  });

  it('counts them, names the managers, dates the newest and says when one is synced', () => {
    expect(passkeySummary([passkey({})])).toMatch(/^1 passkey · added \S+ \S+$/);
    const two = passkeySummary([
      passkey({ label: 'Google Password Manager', synced: true }),
      passkey({ createdAt: '2026-10-08T10:00:00' }),
    ]);
    expect(two).toMatch(
      /^2 passkeys · Google Password Manager · added .*8.* · synced to other devices$/,
    );
  });
});
