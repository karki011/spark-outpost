import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { API_TOKEN_ENV } from '@spark-outpost/contracts';

const MIN_TOKEN_LENGTH = 32;

export function createLaunchToken(): string {
  return randomBytes(32).toString('base64url');
}

export function writeTokenFile(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const staged = `${file}.${process.pid}`;
  rmSync(staged, { force: true });
  writeFileSync(staged, token, { mode: 0o600, flag: 'wx' });
  renameSync(staged, file);
}

export function takeLaunchToken(env: NodeJS.ProcessEnv, tokenFile: string): string {
  const provided = env[API_TOKEN_ENV];
  delete env[API_TOKEN_ENV];
  if (provided !== undefined) {
    if (provided.length < MIN_TOKEN_LENGTH) {
      throw new Error(`${API_TOKEN_ENV} must be at least ${MIN_TOKEN_LENGTH} characters.`);
    }
    return provided;
  }
  const token = createLaunchToken();
  writeTokenFile(tokenFile, token);
  return token;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function launchTokenCheck(token: string) {
  const expected = digest(token);
  return (presented: string | string[] | undefined): boolean =>
    typeof presented === 'string' && timingSafeEqual(digest(presented), expected);
}
