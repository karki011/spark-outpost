import type { GitHubAppState } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface AppConnection {
  login: string;
  state: Exclude<GitHubAppState, 'signed_out'>;
  generation: number;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  repos: string[];
  reposTruncated: boolean;
  checkedAt: Date;
}

interface Row {
  login: string;
  state: AppConnection['state'];
  generation: number;
  access_expires_at: Date | null;
  refresh_expires_at: Date | null;
  repos: string[];
  repos_truncated: boolean;
  checked_at: Date;
}

export interface TokenTimes {
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
}

export interface RepoList {
  repos: string[];
  truncated: boolean;
}

export async function appConnection(
  db: Queryable,
  workspaceId: string,
): Promise<AppConnection | null> {
  const { rows } = await db.query<Row>(
    `SELECT login, state, generation, access_expires_at, refresh_expires_at, repos,
       repos_truncated, checked_at
     FROM github_app_connections WHERE workspace_id = $1`,
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    login: row.login,
    state: row.state,
    generation: row.generation,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    repos: row.repos,
    reposTruncated: row.repos_truncated,
    checkedAt: row.checked_at,
  };
}

export async function saveAppConnection(
  db: Queryable,
  workspaceId: string,
  login: string,
  times: TokenTimes,
  list: RepoList,
): Promise<void> {
  await db.query(
    `INSERT INTO github_app_connections
       (workspace_id, login, access_expires_at, refresh_expires_at, repos, repos_truncated)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id) DO UPDATE SET login = EXCLUDED.login, state = 'connected',
       generation = github_app_connections.generation + 1,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at, repos = EXCLUDED.repos,
       repos_truncated = EXCLUDED.repos_truncated, checked_at = now(), signed_in_at = now()`,
    [
      workspaceId,
      login,
      times.accessExpiresAt,
      times.refreshExpiresAt,
      JSON.stringify(list.repos),
      list.truncated,
    ],
  );
}

export async function recordAppRefresh(
  db: Queryable,
  workspaceId: string,
  times: TokenTimes,
): Promise<void> {
  await db.query(
    `UPDATE github_app_connections SET generation = generation + 1, access_expires_at = $2,
       refresh_expires_at = $3
     WHERE workspace_id = $1`,
    [workspaceId, times.accessExpiresAt, times.refreshExpiresAt],
  );
}

export async function saveAppRepos(
  db: Queryable,
  workspaceId: string,
  list: RepoList,
): Promise<void> {
  await db.query(
    `UPDATE github_app_connections SET repos = $2, repos_truncated = $3, checked_at = now()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(list.repos), list.truncated],
  );
}

export async function markAppNeedsSignIn(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `UPDATE github_app_connections SET state = 'needs_sign_in' WHERE workspace_id = $1`,
    [workspaceId],
  );
}

export async function deleteAppConnection(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM github_app_connections WHERE workspace_id = $1', [workspaceId]);
}
