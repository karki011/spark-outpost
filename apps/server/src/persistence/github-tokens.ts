import type { GitHubRepoAccess, GitHubTokenInfo } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface TokenRow {
  host: string;
  login: string;
  scopes: string[];
  expires_at: Date | null;
  repos: GitHubRepoAccess[];
  validated_at: Date;
}

export async function gitHubToken(
  db: Queryable,
  workspaceId: string,
): Promise<GitHubTokenInfo | null> {
  const { rows } = await db.query<TokenRow>(
    'SELECT host, login, scopes, expires_at, repos, validated_at FROM github_tokens WHERE workspace_id = $1',
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    host: row.host,
    login: row.login,
    scopes: row.scopes,
    expiresAt: row.expires_at?.toISOString() ?? null,
    validatedAt: row.validated_at.toISOString(),
    repos: row.repos,
  };
}

export async function saveGitHubToken(
  db: Queryable,
  workspaceId: string,
  info: Omit<GitHubTokenInfo, 'validatedAt'>,
): Promise<void> {
  await db.query(
    `INSERT INTO github_tokens (workspace_id, host, login, scopes, expires_at, repos)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id) DO UPDATE SET host = EXCLUDED.host, login = EXCLUDED.login,
       scopes = EXCLUDED.scopes, expires_at = EXCLUDED.expires_at, repos = EXCLUDED.repos,
       validated_at = now()`,
    [workspaceId, info.host, info.login, info.scopes, info.expiresAt, JSON.stringify(info.repos)],
  );
}

export async function deleteGitHubToken(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM github_tokens WHERE workspace_id = $1', [workspaceId]);
}
