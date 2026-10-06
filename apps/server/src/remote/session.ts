import { createHash, randomBytes } from 'node:crypto';
import { REMOTE_DEVICE_COOKIE } from '@spark-outpost/contracts';

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function secretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function deviceTokenOf(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== REMOTE_DEVICE_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function deviceCookie(token: string): string {
  return `${REMOTE_DEVICE_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
