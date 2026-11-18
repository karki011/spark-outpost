const encoder = new TextEncoder();

export const PASSCODE_ITERATIONS = 100_000;
export const PASSCODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PASSCODE_LENGTH = 8;
export const PASSCODE = new RegExp(`^[${PASSCODE_ALPHABET}]{${PASSCODE_LENGTH}}$`);

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export function randomToken(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return base64url(new Uint8Array(digest));
}

export function sameText(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function hashPasscode(code: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function sign(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(message),
  );
  return base64url(new Uint8Array(signature));
}

export async function verify(secret: string, message: string, signature: string) {
  const bytes = fromBase64url(signature);
  if (!bytes) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, encoder.encode(message));
}
