import { sign, verify } from './crypto.ts';

const FRAME_TTL_MS = 60_000;
const UNLOCK_TTL_SECONDS = 43_200;

const FRAME_TOKEN = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/;
const UNLOCK_VALUE = /^([A-Za-z0-9_-]{22,43})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

function unlockCookieName(id: string): string {
  return `__Secure-spark-share-${id}`;
}

export async function frameToken(secret: string, id: string, now: number): Promise<string> {
  const expiry = now + FRAME_TTL_MS;
  return `${expiry}.${await sign(secret, `frame:${id}:${expiry}`)}`;
}

export async function validFrameToken(secret: string, id: string, token: string, now: number) {
  const match = FRAME_TOKEN.exec(token);
  if (!match) return false;
  const expiry = Number(match[1]);
  if (expiry <= now || expiry > now + FRAME_TTL_MS) return false;
  return verify(secret, `frame:${id}:${expiry}`, match[2]!);
}

export async function unlockCookie(secret: string, id: string, now: number): Promise<string> {
  const expiry = now + UNLOCK_TTL_SECONDS * 1000;
  const signature = await sign(secret, `unlock:${id}.${expiry}`);
  return [
    `${unlockCookieName(id)}=${id}.${expiry}.${signature}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Path=/a/${id}`,
    `Max-Age=${UNLOCK_TTL_SECONDS}`,
  ].join('; ');
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export async function hasUnlockCookie(
  secret: string,
  id: string,
  cookieHeader: string | null,
  now: number,
) {
  const value = cookieValue(cookieHeader ?? '', unlockCookieName(id));
  const match = value === null ? null : UNLOCK_VALUE.exec(value);
  if (!match || match[1] !== id) return false;
  const expiry = Number(match[2]);
  if (expiry <= now || expiry > now + UNLOCK_TTL_SECONDS * 1000) return false;
  return verify(secret, `unlock:${id}.${expiry}`, match[3]!);
}
