import { randomBytes } from 'node:crypto';
import { PASSKEY_CHALLENGE_TTL_MS } from '@spark-outpost/contracts';

interface Entry {
  binding: string;
  expiresAt: number;
}

export function deviceBinding(deviceId: string): string {
  return `device:${deviceId}`;
}

export function ticketBinding(ticketHash: string): string {
  return `ticket:${ticketHash}`;
}

export class PasskeyChallenges {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(binding: string): string {
    this.dropExpired();
    for (const [challenge, entry] of this.entries) {
      if (entry.binding === binding) this.entries.delete(challenge);
    }
    const challenge = randomBytes(32).toString('base64url');
    this.entries.set(challenge, { binding, expiresAt: this.now() + PASSKEY_CHALLENGE_TTL_MS });
    return challenge;
  }

  consume(challenge: string, binding: string): boolean {
    const entry = this.entries.get(challenge);
    if (!entry) return false;
    this.entries.delete(challenge);
    return entry.binding === binding && entry.expiresAt > this.now();
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [challenge, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(challenge);
    }
  }
}
