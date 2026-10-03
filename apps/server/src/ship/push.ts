import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitHubToken } from '../persistence/github-tokens.ts';
import { pushBranch, ShipGitError, type GitAccess, type Remote } from './git.ts';
import type { GitHubDeps } from './github/access.ts';
import { parseRemoteUrl } from './remote.ts';

export const GIT_AUTH =
  /authentication failed|could not read username|permission denied|could not read from remote|403/i;

export const TOKEN_ENV = 'SPARK_GIT_TOKEN';

const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' x-access-token ;;
  *) printf '%s\\n' "$${TOKEN_ENV}" ;;
esac
`;

export type GitRoute = 'git' | 'token';

export async function withTokenAccess<T>(
  token: string,
  work: (access: Required<GitAccess>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-askpass-'));
  const script = path.join(dir, 'askpass.sh');
  try {
    await writeFile(script, ASKPASS_SCRIPT, { mode: 0o700 });
    return await work({
      env: { GIT_ASKPASS: script, [TOKEN_ENV]: token, GIT_TERMINAL_PROMPT: '0' },
      config: ['-c', 'credential.helper='],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function tokenForRemote(deps: GitHubDeps, url: string): Promise<string | null> {
  if (!/^https:\/\//i.test(url.trim())) return null;
  const repo = parseRemoteUrl(url);
  if (!repo) return null;
  const info = await gitHubToken(deps.db, deps.workspaceId);
  if (!info || info.host !== repo.host) return null;
  return deps.secrets.get('github').catch(() => null);
}

export async function loginEnv(deps: GitHubDeps): Promise<Record<string, string>> {
  const loginPath = await (deps.loginPath?.() ?? Promise.resolve(null)).catch(() => null);
  return loginPath ? { PATH: loginPath } : {};
}

function quoted(value: string): string {
  return /^[\w./@:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function pushCommand(root: string, remote: string, branch: string): string {
  return `git -C ${quoted(root)} push --set-upstream ${quoted(remote)} ${quoted(branch)}`;
}

export function isAuthFailure(error: unknown): error is ShipGitError {
  return error instanceof ShipGitError && GIT_AUTH.test(error.message);
}

export async function withCredentials(
  deps: GitHubDeps,
  remote: Remote,
  run: (access: GitAccess) => Promise<void>,
): Promise<GitRoute> {
  const env = await loginEnv(deps);
  try {
    await run({ env });
    return 'git';
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    const token = await tokenForRemote(deps, remote.url);
    if (!token) throw error;
    await withTokenAccess(token, (access) => run({ ...access, env: { ...env, ...access.env } }));
    return 'token';
  }
}

export async function pushWithCredentials(
  deps: GitHubDeps,
  root: string,
  remote: Remote,
  branch: string,
): Promise<GitRoute> {
  try {
    return await withCredentials(deps, remote, (access) =>
      pushBranch(root, remote.name, branch, access),
    );
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    throw new ShipGitError(
      `${error.message} Run \`${pushCommand(root, remote.name, branch)}\` in a terminal to see what git needs, or connect GitHub in Settings → Connectors.`,
    );
  }
}
