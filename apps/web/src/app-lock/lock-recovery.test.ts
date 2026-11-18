import { describe, expect, it } from 'vitest';
import type { AppLockStatus, DesktopAppLock } from '../desktop/desktop-bridge.ts';
import { canRecover, recoveryOutcome } from './lock-recovery.ts';

const STATUS: AppLockStatus = {
  enabled: true,
  locked: true,
  hasCode: true,
  idleMinutes: 5,
  onSleep: true,
  touchId: false,
  touchIdAvailable: false,
  hideNotifications: true,
  retryAt: null,
};

const recover = async () => ({ ok: true });

describe('recoveryOutcome', () => {
  it('treats a cancelled dialog as a quiet step back', () => {
    expect(recoveryOutcome({ ok: false, reason: 'cancelled' })).toBe('cancelled');
  });

  it('reports every other refusal as a failure', () => {
    expect(recoveryOutcome({ ok: false, reason: 'failed' })).toBe('failed');
    expect(recoveryOutcome({ ok: false, reason: 'unavailable' })).toBe('failed');
    expect(recoveryOutcome({ ok: false })).toBe('failed');
  });

  it('is recovered only when the Mac confirmed', () => {
    expect(recoveryOutcome({ ok: true })).toBe('recovered');
  });
});

describe('canRecover', () => {
  it('needs both the status flag and the bridge call', () => {
    const withCall = { recover } as unknown as DesktopAppLock;
    const without = {} as DesktopAppLock;
    expect(canRecover(withCall, { ...STATUS, recoveryAvailable: true })).toBe(true);
    expect(canRecover(withCall, STATUS)).toBe(false);
    expect(canRecover(withCall, { ...STATUS, recoveryAvailable: false })).toBe(false);
    expect(canRecover(without, { ...STATUS, recoveryAvailable: true })).toBe(false);
  });
});
