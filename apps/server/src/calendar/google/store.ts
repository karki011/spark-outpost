import { randomUUID } from 'node:crypto';
import { withTransaction, type Db, type Queryable } from '../../persistence/db.ts';
import { lockChoices } from '../store.ts';

export interface GoogleAccountRow {
  id: string;
  subject: string;
  email: string;
  needsSignIn: boolean;
  canEdit: boolean;
}

interface Row {
  id: string;
  subject: string;
  email: string;
  needs_sign_in: boolean;
  can_edit: boolean;
}

const rowOf = (row: Row): GoogleAccountRow => ({
  id: row.id,
  subject: row.subject,
  email: row.email,
  needsSignIn: row.needs_sign_in,
  canEdit: row.can_edit,
});

export async function googleAccounts(db: Queryable, workspaceId: string) {
  const { rows } = await db.query<Row>(
    `SELECT id, subject, email, needs_sign_in, can_edit FROM calendar_google_accounts
     WHERE workspace_id = $1 ORDER BY created_at, email`,
    [workspaceId],
  );
  return rows.map(rowOf);
}

export async function saveGoogleAccount(
  db: Queryable,
  workspaceId: string,
  account: { subject: string; email: string; canEdit: boolean },
): Promise<GoogleAccountRow> {
  const { rows } = await db.query<Row>(
    `INSERT INTO calendar_google_accounts (id, workspace_id, subject, email, can_edit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, subject)
       DO UPDATE SET email = EXCLUDED.email, needs_sign_in = false, can_edit = EXCLUDED.can_edit
     RETURNING id, subject, email, needs_sign_in, can_edit`,
    [randomUUID(), workspaceId, account.subject, account.email, account.canEdit],
  );
  return rowOf(rows[0]!);
}

export async function setGoogleAgentsEdit(
  db: Db,
  workspaceId: string,
  account: GoogleAccountRow,
  editCalendar: string | null,
): Promise<{ turnedOff: boolean }> {
  return withTransaction(db, async (client) => {
    await lockChoices(client, workspaceId, { googleAccountId: account.id });
    if (!account.canEdit) {
      const { rowCount } = await client.query(
        `UPDATE calendar_calendars SET agents_edit = false
         WHERE workspace_id = $1 AND google_account_id = $2 AND agents_edit`,
        [workspaceId, account.id],
      );
      return { turnedOff: (rowCount ?? 0) > 0 };
    }
    if (editCalendar) {
      await client.query(
        `UPDATE calendar_calendars SET agents_edit = true
         WHERE workspace_id = $1 AND google_account_id = $2 AND key = $3 AND writable`,
        [workspaceId, account.id, editCalendar],
      );
    }
    return { turnedOff: false };
  });
}

export async function googleEditBlocked(
  db: Queryable,
  workspaceId: string,
  calendarKey: string,
): Promise<boolean> {
  const { rows } = await db.query<{ can_edit: boolean }>(
    `SELECT account.can_edit FROM calendar_calendars calendar
     JOIN calendar_google_accounts account ON account.id = calendar.google_account_id
     WHERE calendar.workspace_id = $1 AND calendar.key = $2`,
    [workspaceId, calendarKey],
  );
  return rows.length > 0 && !rows[0]!.can_edit;
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
