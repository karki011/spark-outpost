import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../persistence/db.ts';

export interface GoogleAccountRow {
  id: string;
  subject: string;
  email: string;
  needsSignIn: boolean;
}

interface Row {
  id: string;
  subject: string;
  email: string;
  needs_sign_in: boolean;
}

const rowOf = (row: Row): GoogleAccountRow => ({
  id: row.id,
  subject: row.subject,
  email: row.email,
  needsSignIn: row.needs_sign_in,
});

export async function googleAccounts(db: Queryable, workspaceId: string) {
  const { rows } = await db.query<Row>(
    `SELECT id, subject, email, needs_sign_in FROM calendar_google_accounts
     WHERE workspace_id = $1 ORDER BY created_at, email`,
    [workspaceId],
  );
  return rows.map(rowOf);
}

export async function saveGoogleAccount(
  db: Queryable,
  workspaceId: string,
  account: { subject: string; email: string },
): Promise<GoogleAccountRow> {
  const { rows } = await db.query<Row>(
    `INSERT INTO calendar_google_accounts (id, workspace_id, subject, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, subject)
       DO UPDATE SET email = EXCLUDED.email, needs_sign_in = false
     RETURNING id, subject, email, needs_sign_in`,
    [randomUUID(), workspaceId, account.subject, account.email],
  );
  return rowOf(rows[0]!);
}

export async function markGoogleSignIn(
  db: Queryable,
  workspaceId: string,
  accountId: string,
  needsSignIn: boolean,
): Promise<void> {
  await db.query(
    `UPDATE calendar_google_accounts SET needs_sign_in = $3
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, accountId, needsSignIn],
  );
}

export async function deleteGoogleAccount(
  db: Queryable,
  workspaceId: string,
  accountId: string,
): Promise<void> {
  await db.query('DELETE FROM calendar_google_accounts WHERE workspace_id = $1 AND id = $2', [
    workspaceId,
    accountId,
  ]);
}

export async function googleSubjects(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ subject: string }>(
    'SELECT subject FROM calendar_google_accounts ORDER BY subject',
  );
  return rows.map((row) => row.subject);
}
