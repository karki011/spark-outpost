import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubDeps } from './github/access.ts';
import { pushWithCredentials } from './push.ts';
import { shipFailureMessage } from './failure-hint.ts';

let base: string;
let root: string;
let seen: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

const HOOK = `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$REGISTRY_LOGIN" "$npm_config_userconfig" "$HOME" "$PATH" > "$SEEN_FILE"
if [ -z "$REGISTRY_LOGIN" ] || [ -z "$npm_config_userconfig" ]; then
  echo "npm error your saved credentials are probably out of date" >&2
  echo "husky - pre-push script failed (code 1)" >&2
  exit 1
fi
`;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'spark-push-env-'));
  root = path.join(base, 'work');
  seen = path.join(base, 'seen');
  execFileSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  await writeFile(path.join(root, 'notes.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('remote', 'add', 'origin', path.join(base, 'remote.git'));
  git('checkout', '-qb', 'spark/notes');
  const hook = path.join(root, '.git', 'hooks', 'pre-push');
  await writeFile(hook, HOOK);
  await chmod(hook, 0o755);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const remote = () => ({ name: 'origin', url: path.join(base, 'remote.git') });

function deps(loginEnv: Record<string, string> | null): GitHubDeps {
  return { loginEnv: async () => loginEnv } as unknown as GitHubDeps;
}

describe('a push Spark runs itself', { timeout: 30_000 }, () => {
  it("gives the repository's pre-push hook the user's login-shell environment", async () => {
    const shell = {
      SEEN_FILE: seen,
      REGISTRY_LOGIN: 'from-the-login-shell',
      npm_config_userconfig: '/Users/me/.npmrc',
    };
    await pushWithCredentials(deps(shell), root, remote(), 'spark/notes');
    const [login, userconfig, home, pathValue] = (await readFile(seen, 'utf8')).trim().split('|');
    expect(login).toBe('from-the-login-shell');
    expect(userconfig).toBe('/Users/me/.npmrc');
    expect(home).toBe(process.env.HOME);
    expect(pathValue).toContain(process.env.PATH);
  });

  it('fails with the hook named in plain words when the hook exits 1, and pushes nothing', async () => {
    const failure = await pushWithCredentials(
      deps({ SEEN_FILE: seen }),
      root,
      remote(),
      'spark/notes',
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = shipFailureMessage(failure);
    expect(message).toContain("stopped by this repository's pre-push check");
    expect(message).toContain('saved credentials are probably out of date');
    const heads = execFileSync('git', ['-C', path.join(base, 'remote.git'), 'branch', '--list'], {
      encoding: 'utf8',
    });
    expect(heads).not.toContain('spark/notes');
  });
});
