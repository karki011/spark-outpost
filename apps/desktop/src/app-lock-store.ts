import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseAppLockRecord,
  serializeAppLockRecord,
  type AppLockRecord,
  type StoredCode,
} from './app-lock-state.ts';

const SALT_BYTES = 16;
const HASH_BYTES = 64;

export function appLockFile(userData: string): string {
  return path.join(userData, 'app-lock.json');
}

export function readAppLockRecord(file: string): AppLockRecord {
  try {
    return parseAppLockRecord(readFileSync(file, 'utf8'));
  } catch {
    return parseAppLockRecord(null);
  }
}

export async function saveAppLockRecord(file: string, record: AppLockRecord): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, serializeAppLockRecord(record), { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function derive(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(code, salt, HASH_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashCode(code: string): Promise<StoredCode> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(code, salt);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export async function codeMatches(code: string, stored: StoredCode): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'hex');
  const given = await derive(code, Buffer.from(stored.salt, 'hex'));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
