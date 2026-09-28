import type { GitHubConnectionStatus } from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import {
  deleteGitHubToken,
  gitHubToken,
  saveGitHubToken,
} from '../../persistence/github-tokens.ts';
import { listProjects } from '../../projects/projects.ts';
import type { RunCommand } from '../../setup/command.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import { pickRemote } from '../git.ts';
import { apiBaseFor, parseRemoteUrl, type RemoteRepo } from '../remote.ts';
import { restConnection, type GitHubConnection } from './connection.ts';
import { validateToken } from './token.ts';
import { ghCliRequest, tokenRequest } from './transports.ts';

export const DEFAULT_GITHUB_HOST = 'github.com';
const STATUS_TIMEOUT_MS = 10_000;

export interface GitHubDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  runCommand: RunCommand;
  locateGh: () => Promise<string | null>;
  fetch: typeof fetch;
  apiUrl?: string | undefined;
}

interface GhCli {
  path: string;
  login: string | null;
}

const ACCOUNT = /account (\S+)/;

async function ghCli(deps: GitHubDeps, host: string): Promise<GhCli | null> {
  const path = await deps.locateGh();
  if (!path) return null;
  const status = await deps.runCommand(
    path,
    ['auth', 'status', '--hostname', host],
    STATUS_TIMEOUT_MS,
  );
  if (status.code !== 0) return { path, login: null };
  const shown = ACCOUNT.exec(`${status.stdout}\n${status.stderr}`)?.[1];
  if (shown) return { path, login: shown };
  const { login } = await ghConnection(deps, path, host)
    .whoami()
    .catch(() => ({ login: host }));
  return { path, login };
}

function ghConnection(deps: GitHubDeps, path: string, host: string): GitHubConnection {
  return restConnection('gh_cli', host, ghCliRequest(path, host, deps.runCommand));
}

async function tokenConnection(deps: GitHubDeps, host: string): Promise<GitHubConnection | null> {
  const info = await gitHubToken(deps.db, deps.workspaceId);
  if (!info || info.host !== host) return null;
  const token = await deps.secrets.get('github').catch(() => null);
  if (!token) return null;
  return restConnection(
    'token',
    host,
    tokenRequest(apiBaseFor(host, deps.apiUrl), token, deps.fetch),
  );
}

export async function connectionFor(
  deps: GitHubDeps,
  host: string,
): Promise<GitHubConnection | null> {
  const cli = await ghCli(deps, host);
  if (cli?.login) return ghConnection(deps, cli.path, host);
  return tokenConnection(deps, host);
}

export async function gitHubStatus(deps: GitHubDeps): Promise<GitHubConnectionStatus> {
  const token = await gitHubToken(deps.db, deps.workspaceId);
  const tokenSaved =
    token !== null && (await deps.secrets.get('github').catch(() => null)) !== null;
  const cli = await ghCli(deps, DEFAULT_GITHUB_HOST);
  return {
    active: cli?.login ? 'gh_cli' : tokenSaved ? 'token' : null,
    ghCli: { installed: cli !== null, host: DEFAULT_GITHUB_HOST, login: cli?.login ?? null },
    token: tokenSaved ? token : null,
    app: { available: false },
  };
}

async function projectRepos(deps: GitHubDeps, host: string): Promise<RemoteRepo[]> {
  const repos = new Map<string, RemoteRepo>();
  for (const project of await listProjects(deps.db, deps.workspaceId)) {
    const remote = await pickRemote(project.rootPath, null).catch(() => null);
    const repo = remote ? parseRemoteUrl(remote.url) : null;
    if (repo?.host === host) repos.set(`${repo.owner}/${repo.name}`, repo);
  }
  return [...repos.values()];
}

export async function saveToken(
  deps: GitHubDeps,
  rawToken: string,
  host = DEFAULT_GITHUB_HOST,
): Promise<GitHubConnectionStatus> {
  const token = rawToken.trim();
  const request = tokenRequest(apiBaseFor(host, deps.apiUrl), token, deps.fetch);
  const info = await validateToken(host, request, await projectRepos(deps, host));
  await deps.secrets.set('github', token);
  await saveGitHubToken(deps.db, deps.workspaceId, info);
  return gitHubStatus(deps);
}

export async function removeToken(deps: GitHubDeps): Promise<GitHubConnectionStatus> {
  await deleteGitHubToken(deps.db, deps.workspaceId);
  await deps.secrets.delete('github').catch(() => undefined);
  return gitHubStatus(deps);
}
