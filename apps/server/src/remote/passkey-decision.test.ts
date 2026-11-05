import { describe, expect, it } from 'vitest';
import { counterOutcome, signInRefusal, type SignInFacts } from './passkey-decision.ts';

const DEVICE = '0198c0de-0000-7000-8000-000000000001';
const OTHER = '0198c0de-0000-7000-8000-000000000002';

function facts(change: Partial<SignInFacts> = {}): SignInFacts {
  return {
    allowed: true,
    challengeFresh: true,
    credential: { deviceId: DEVICE, revoked: false, expired: false },
    userHandleDeviceId: DEVICE,
    ...change,
  };
}

describe('what a passkey sign-in may do', () => {
  it('allows a known passkey of a device that can connect', () => {
    expect(signInRefusal(facts())).toBeNull();
    expect(signInRefusal(facts({ userHandleDeviceId: null }))).toBeNull();
  });

  it('refuses when the switch is off, before looking at anything else', () => {
    expect(signInRefusal(facts({ allowed: false }))).toBe('switch_off');
    expect(signInRefusal(facts({ allowed: false, credential: null }))).toBe('switch_off');
  });

  it('refuses a stale, reused or foreign challenge', () => {
    expect(signInRefusal(facts({ challengeFresh: false }))).toBe('challenge');
  });

  it('refuses a passkey this Mac does not know', () => {
    expect(signInRefusal(facts({ credential: null }))).toBe('unknown_credential');
  });

  it('refuses a passkey whose user handle names another device', () => {
    expect(signInRefusal(facts({ userHandleDeviceId: OTHER }))).toBe('wrong_device');
    expect(signInRefusal(facts({ userHandleDeviceId: 'unreadable' }))).toBe('wrong_device');
  });

  it('refuses a removed device and one not used for 30 days', () => {
    const credential = { deviceId: DEVICE, revoked: false, expired: false };
    expect(signInRefusal(facts({ credential: { ...credential, revoked: true } }))).toBe(
      'device_revoked',
    );
    expect(signInRefusal(facts({ credential: { ...credential, expired: true } }))).toBe(
      'device_unused',
    );
    expect(
      signInRefusal(facts({ credential: { ...credential, revoked: true, expired: true } })),
    ).toBe('device_revoked');
  });
});

describe('sign counter', () => {
  it('accepts a synced passkey that always reports zero', () => {
    expect(counterOutcome(0, 0)).toEqual({ regressed: false, next: 0 });
  });

  it('accepts a counter that rises', () => {
    expect(counterOutcome(0, 1)).toEqual({ regressed: false, next: 1 });
    expect(counterOutcome(4, 9)).toEqual({ regressed: false, next: 9 });
  });

  it('flags a counter that repeats or falls, and keeps the higher value', () => {
    expect(counterOutcome(5, 5)).toEqual({ regressed: true, next: 5 });
    expect(counterOutcome(5, 3)).toEqual({ regressed: true, next: 5 });
    expect(counterOutcome(5, 0)).toEqual({ regressed: true, next: 5 });
  });
});
