import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type ProofRole = 'host' | 'client';

export function createSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hostProof(
  token: string,
  role: ProofRole,
  clientNonce: string,
  hostNonce: string,
): string {
  return createHmac('sha256', token)
    .update(JSON.stringify(['spark-session-host', role, clientNonce, hostNonce]))
    .digest('base64url');
}

export function sameProof(offered: string, expected: string): boolean {
  const left = Buffer.from(offered);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
