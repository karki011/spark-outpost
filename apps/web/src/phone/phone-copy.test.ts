import { describe, expect, it } from 'vitest';
import type { RemoteAuditEntry, TailscaleState } from '@spark-outpost/contracts';
import { activityDetail, activityLine, statusCopy } from './phone-copy.ts';

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
      'Phone access turned on',
    );
    expect(activityLine(entry({ action: 'refused' }))).toBe('A phone was refused');
  });

  it('shows the request and its result when there is one', () => {
    expect(activityDetail(entry({ method: 'POST', path: '/api/reset', status: 403 }))).toBe(
      'POST /api/reset · 403',
    );
    expect(activityDetail(entry({ action: 'device_paired' }))).toBeNull();
  });
});
