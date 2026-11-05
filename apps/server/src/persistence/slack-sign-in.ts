import type { Queryable } from './db.ts';

export interface SlackTokenTimes {
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
}

export interface SlackSignInIdentity {
  teamId: string;
  teamName: string;
  teamUrl: string;
  member: { id: string; name: string };
  userScopes: string[];
  times: SlackTokenTimes;
}

export async function saveSlackSignIn(
  db: Queryable,
  workspaceId: string,
  identity: SlackSignInIdentity,
): Promise<void> {
  await db.query(
    `INSERT INTO slack_connections
       (workspace_id, method, team_id, team_name, team_url, bot_user_id, bot_name, member_id,
        member_name, user_scopes, access_expires_at, refresh_expires_at)
     VALUES ($1, 'sign_in', $2, $3, $4, '', '', $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id) DO UPDATE SET
       method = 'sign_in', state = 'connected',
       generation = slack_connections.generation + 1,
       team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name, team_url = EXCLUDED.team_url,
       bot_user_id = '', bot_name = '',
       member_id = EXCLUDED.member_id, member_name = EXCLUDED.member_name,
       user_scopes = EXCLUDED.user_scopes,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       problem = NULL, problem_at = NULL, validated_at = now()`,
    [
      workspaceId,
      identity.teamId,
      identity.teamName,
      identity.teamUrl,
      identity.member.id,
      identity.member.name,
      identity.userScopes,
      identity.times.accessExpiresAt,
      identity.times.refreshExpiresAt,
    ],
  );
}

export async function recordSlackRefresh(
  db: Queryable,
  workspaceId: string,
  times: SlackTokenTimes,
): Promise<void> {
  await db.query(
    `UPDATE slack_connections SET generation = generation + 1, access_expires_at = $2,
       refresh_expires_at = $3
     WHERE workspace_id = $1 AND method = 'sign_in'`,
    [workspaceId, times.accessExpiresAt, times.refreshExpiresAt],
  );
}

export async function markSlackNeedsSignIn(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `UPDATE slack_connections SET state = 'needs_sign_in'
     WHERE workspace_id = $1 AND method = 'sign_in'`,
    [workspaceId],
  );
}
