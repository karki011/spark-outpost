import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitHubToken } from '../persistence/github-tokens.ts';
import { pushBranch, ShipGitError, type GitAccess, type Remote } from './git.ts';
import { appCovers, type GitHubDeps } from './github/access.ts';
import { appAccessToken } from './github/app-tokens.ts';
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

export type GitRoute = 'git' | 'app' | 'token';

interface RemoteToken {
  route: Exclude<GitRoute, 'git'>;
  token: string;
}

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

async function savedToken(deps: GitHubDeps, host: string): Promise<string | null> {
  const info = await gitHubToken(deps.db, deps.workspaceId);
  if (!info || info.host !== host) return null;
  return deps.secrets.get('github').catch(() => null);
}

export async function tokensForRemote(deps: GitHubDeps, url: string): Promise<RemoteToken[]> {
  if (!/^https:\/\//i.test(url.trim())) return [];
  const repo = parseRemoteUrl(url);
  if (!repo) return [];
  const app = (await appCovers(deps, repo)) ? await appAccessToken(deps) : null;
  const saved = await savedToken(deps, repo.host);
  return [
    ...(app ? [{ route: 'app' as const, token: app }] : []),
    ...(saved ? [{ route: 'token' as const, token: saved }] : []),
  ];
}

export async function loginEnv(deps: GitHubDeps): Promise<Record<string, string>> {
  const shell = await (deps.loginEnv?.() ?? Promise.resolve(null)).catch(() => null);
  const loginPath = await (deps.loginPath?.() ?? Promise.resolve(null)).catch(() => null);
  return { ...shell, ...(loginPath ? { PATH: loginPath } : {}) };
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
    return withSparkToken(await tokensForRemote(deps, remote.url), env, run, error);
  }
}

async function withSparkToken(
  tokens: RemoteToken[],
  env: Record<string, string>,
  run: (access: GitAccess) => Promise<void>,
  refused: ShipGitError,
): Promise<GitRoute> {
  let last = refused;
  for (const { route, token } of tokens) {
    try {
      await withTokenAccess(token, (access) => run({ ...access, env: { ...env, ...access.env } }));
      return route;
    } catch (error) {
      if (!isAuthFailure(error)) throw error;
      last = error;
    }
  }
  throw last;
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
      error.output,
    );
  }
}
