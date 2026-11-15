const GRANT_TTL_MS = 2 * 60 * 1000;

export function stepUpBinding(deviceId: string, approvalId: string): string {
  return `step-up:${deviceId}:${approvalId}`;
}

export class StepUpGrants {
  private readonly grants = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  grant(deviceId: string, approvalId: string): void {
    this.dropExpired();
    this.grants.set(stepUpBinding(deviceId, approvalId), this.now() + GRANT_TTL_MS);
  }

  consume(deviceId: string, approvalId: string): boolean {
    const key = stepUpBinding(deviceId, approvalId);
    const expiresAt = this.grants.get(key);
    this.grants.delete(key);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.grants) {
      if (expiresAt <= now) this.grants.delete(key);
    }
  }
}
