import { createHash, randomBytes } from 'node:crypto';
import {
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_TICKET_COOKIE,
  REMOTE_DEVICE_COOKIE,
} from '@spark-outpost/contracts';

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function secretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function tokenIn(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function deviceTokenOf(cookieHeader: string | undefined): string | null {
  return tokenIn(cookieHeader, REMOTE_DEVICE_COOKIE);
}

export function deviceCookie(token: string): string {
  return `${REMOTE_DEVICE_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function passkeyTicketOf(cookieHeader: string | undefined): string | null {
  return tokenIn(cookieHeader, PASSKEY_TICKET_COOKIE);
}

export function passkeyTicketCookie(ticket: string | null): string {
  const maxAge = ticket ? PASSKEY_CHALLENGE_TTL_MS / 1000 : 0;
  return `${PASSKEY_TICKET_COOKIE}=${ticket ?? ''}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
