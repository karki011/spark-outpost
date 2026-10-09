export type SignInRefusal =
  | 'switch_off'
  | 'challenge'
  | 'unknown_credential'
  | 'wrong_device'
  | 'device_revoked'
  | 'device_unused';

export interface SignInFacts {
  allowed: boolean;
  challengeFresh: boolean;
  credential: { deviceId: string; revoked: boolean; expired: boolean } | null;
  userHandleDeviceId: string | null;
}

export function signInRefusal(facts: SignInFacts): SignInRefusal | null {
  if (!facts.allowed) return 'switch_off';
  if (!facts.challengeFresh) return 'challenge';
  const { credential } = facts;
  if (!credential) return 'unknown_credential';
  if (facts.userHandleDeviceId !== null && facts.userHandleDeviceId !== credential.deviceId) {
    return 'wrong_device';
  }
  if (credential.revoked) return 'device_revoked';
  return credential.expired ? 'device_unused' : null;
}

export interface CounterOutcome {
  regressed: boolean;
  next: number;
}

export function counterOutcome(stored: number, reported: number): CounterOutcome {
  const counted = stored > 0 || reported > 0;
  return { regressed: counted && reported <= stored, next: Math.max(stored, reported) };
}
