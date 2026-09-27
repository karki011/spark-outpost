import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_TOKEN_ENV } from '@spark-outpost/contracts';
import { launchTokenCheck, takeLaunchToken } from './launch-token.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launch-token-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('takeLaunchToken', () => {
  it('creates a fresh token each launch and writes it for the owner only', () => {
    const file = join(dir, 'run', 'api-token');
    const first = takeLaunchToken({}, file);
    expect(readFileSync(file, 'utf8')).toBe(first);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(first.length).toBeGreaterThanOrEqual(43);

    const second = takeLaunchToken({}, file);
    expect(second).not.toBe(first);
    expect(readFileSync(file, 'utf8')).toBe(second);
  });

  it('replaces a readable leftover file with an owner-only one', () => {
    const file = join(dir, 'api-token');
    writeFileSync(file, 'stale', { mode: 0o644 });
    takeLaunchToken({}, file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('uses a token passed by the launcher, removes it from the environment and writes no file', () => {
    const file = join(dir, 'api-token');
    const token = 'launcher-token-0123456789abcdefghijklmnop';
    const env: NodeJS.ProcessEnv = { [API_TOKEN_ENV]: token, KEEP: 'yes' };
    expect(takeLaunchToken(env, file)).toBe(token);
    expect(env).toEqual({ KEEP: 'yes' });
    expect(() => statSync(file)).toThrow();
  });

  it('rejects a short launcher token', () => {
    expect(() => takeLaunchToken({ [API_TOKEN_ENV]: 'short' }, join(dir, 'api-token'))).toThrow(
      /at least 32/,
    );
  });
});

describe('launchTokenCheck', () => {
  const matches = launchTokenCheck('the-launch-token-0123456789abcdefghijkl');

  it('accepts only the exact token', () => {
    expect(matches('the-launch-token-0123456789abcdefghijkl')).toBe(true);
    expect(matches('the-launch-token-0123456789abcdefghijkm')).toBe(false);
    expect(matches('the-launch-token')).toBe(false);
    expect(matches('')).toBe(false);
    expect(matches(undefined)).toBe(false);
    expect(matches(['the-launch-token-0123456789abcdefghijkl'])).toBe(false);
  });
});
