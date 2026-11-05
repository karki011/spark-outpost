import {
  GITHUB_APP_SIGNED_OUT,
  type GitHubAppProject,
  type GitHubAppStatus,
  type GitHubConnectionStatus,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import {
  appConnection,
  deleteAppConnection,
  saveAppRepos,
  type AppConnection,
  type RepoList,
} from '../../persistence/github-app.ts';
import {
  deleteGitHubToken,
  gitHubToken,
  saveGitHubToken,
} from '../../persistence/github-tokens.ts';
import { listProjects } from '../../projects/projects.ts';
import type { RunCommand } from '../../setup/command.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import { pickRemote } from '../git.ts';
import { apiBaseFor, parseRemoteUrl, repoSlug, type RemoteRepo } from '../remote.ts';
import { GITHUB_APP_HOST, installUrl, type GitHubAppConfig } from './app-config.ts';
import { coversRepo, reachableRepos } from './app-repos.ts';
import { appRequest, appTokensSaved, forgetAppTokens } from './app-tokens.ts';
import { restConnection, type GitHubConnection, type GitHubRequest } from './connection.ts';
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
  loginPath?: () => Promise<string | null>;
  loginEnv?: () => Promise<Record<string, string> | null>;
  app?: GitHubAppConfig | null | undefined;
  now?: (() => number) | undefined;
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

async function ghLoggedIn(deps: GitHubDeps, host: string): Promise<GitHubConnection | null> {
  const cli = await ghCli(deps, host);
  return cli?.login ? ghConnection(deps, cli.path, host) : null;
}

async function signedInApp(deps: GitHubDeps): Promise<AppConnection | null> {
  if (!deps.app) return null;
  const row = await appConnection(deps.db, deps.workspaceId);
  return row?.state === 'connected' ? row : null;
}

function appApiRequest(deps: GitHubDeps): GitHubRequest {
  return appRequest(deps, apiBaseFor(GITHUB_APP_HOST, deps.apiUrl));
}

function appApi(deps: GitHubDeps): GitHubConnection {
  return restConnection('app', GITHUB_APP_HOST, appApiRequest(deps));
}

export async function connectedAppRepos(deps: GitHubDeps): Promise<RepoList | null> {
  const row = await signedInApp(deps);
  if (!row || !(await appTokensSaved(deps))) return null;
  return { repos: row.repos, truncated: row.reposTruncated };
}

export async function accountConnection(deps: GitHubDeps): Promise<GitHubConnection | null> {
  const token = await gitHubToken(deps.db, deps.workspaceId);
  return (
    (token ? await tokenConnection(deps, token.host) : null) ??
    (await ghLoggedIn(deps, DEFAULT_GITHUB_HOST))
  );
}

export async function appCovers(deps: GitHubDeps, repo: RemoteRepo): Promise<boolean> {
  const row = await signedInApp(deps);
  return row !== null && coversRepo(row.repos, repo);
}

async function appConnectionFor(
  deps: GitHubDeps,
  repo: RemoteRepo,
): Promise<GitHubConnection | null> {
  return (await appCovers(deps, repo)) ? appApi(deps) : null;
}

export async function connectionsFor(
  deps: GitHubDeps,
  repo: RemoteRepo,
): Promise<GitHubConnection[]> {
  const found = await Promise.all([
    appConnectionFor(deps, repo),
    tokenConnection(deps, repo.host),
    ghLoggedIn(deps, repo.host),
  ]);
  return found.filter((connection): connection is GitHubConnection => connection !== null);
}

export async function connectionFor(
  deps: GitHubDeps,
  repo: RemoteRepo,
): Promise<GitHubConnection | null> {
  return (
    (await appConnectionFor(deps, repo)) ??
    (await tokenConnection(deps, repo.host)) ??
    (await ghLoggedIn(deps, repo.host))
  );
}

async function projectCoverage(deps: GitHubDeps, repos: readonly string[]) {
  const projects: GitHubAppProject[] = [];
  for (const project of await listProjects(deps.db, deps.workspaceId)) {
    const remote = await pickRemote(project.rootPath, null).catch(() => null);
    const repo = remote ? parseRemoteUrl(remote.url) : null;
    if (repo?.host !== GITHUB_APP_HOST) continue;
    projects.push({
      project: project.name,
      repo: repoSlug(repo),
      covered: coversRepo(repos, repo),
    });
  }
  return projects;
}

async function appStatus(deps: GitHubDeps): Promise<GitHubAppStatus> {
  if (!deps.app) return GITHUB_APP_SIGNED_OUT;
  const available = { ...GITHUB_APP_SIGNED_OUT, available: true, installUrl: installUrl(deps.app) };
  const row = await appConnection(deps.db, deps.workspaceId);
  if (!row) return available;
  const usable = row.state === 'connected' && (await appTokensSaved(deps));
  return {
    ...available,
    state: usable ? 'connected' : 'needs_sign_in',
    login: row.login,
    repos: row.repos,
    reposTruncated: row.reposTruncated,
    projects: await projectCoverage(deps, row.repos),
    checkedAt: row.checkedAt.toISOString(),
  };
}

async function savedToken(deps: GitHubDeps) {
  const token = await gitHubToken(deps.db, deps.workspaceId);
  const saved = token !== null && (await deps.secrets.get('github').catch(() => null)) !== null;
  return saved ? token : null;
}

export async function gitHubStatus(deps: GitHubDeps): Promise<GitHubConnectionStatus> {
  const token = await savedToken(deps);
  const cli = await ghCli(deps, DEFAULT_GITHUB_HOST);
  const app = await appStatus(deps);
  const fallback = token ? 'token' : cli?.login ? 'gh_cli' : null;
  return {
    active: app.state === 'connected' ? 'app' : fallback,
    ghCli: { installed: cli !== null, host: DEFAULT_GITHUB_HOST, login: cli?.login ?? null },
    token,
    app,
  };
}

export async function recheckAppRepos(deps: GitHubDeps): Promise<GitHubConnectionStatus> {
  if (await signedInApp(deps)) {
    await saveAppRepos(deps.db, deps.workspaceId, await reachableRepos(appApiRequest(deps)));
  }
  return gitHubStatus(deps);
}

export async function disconnectApp(deps: GitHubDeps): Promise<GitHubConnectionStatus> {
  await deleteAppConnection(deps.db, deps.workspaceId);
  await deps.secrets.delete('github-app').catch(() => undefined);
  forgetAppTokens(deps.workspaceId);
  return gitHubStatus(deps);
}

async function projectRepos(deps: GitHubDeps, host: string): Promise<RemoteRepo[]> {
  const repos = new Map<string, RemoteRepo>();
  for (const project of await listProjects(deps.db, deps.workspaceId)) {
    const remote = await pickRemote(project.rootPath, null).catch(() => null);
    const repo = remote ? parseRemoteUrl(remote.url) : null;
    if (repo?.host === host) repos.set(repoSlug(repo), repo);
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
