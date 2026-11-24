import { randomUUID } from 'node:crypto';
import { withTransaction, type Db, type Queryable } from '../../persistence/db.ts';
import { lockChoices, type ChoiceOwner } from '../store.ts';

export type CloudProvider = 'google' | 'microsoft';

export interface CloudAccountRow {
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

const TABLES: Record<CloudProvider, { accounts: string; column: string }> = {
  google: { accounts: 'calendar_google_accounts', column: 'google_account_id' },
  microsoft: { accounts: 'calendar_microsoft_accounts', column: 'microsoft_account_id' },
};

const rowOf = (row: Row): CloudAccountRow => ({
  id: row.id,
  subject: row.subject,
  email: row.email,
  needsSignIn: row.needs_sign_in,
  canEdit: row.can_edit,
});

export function cloudOwner(provider: CloudProvider, accountId: string): ChoiceOwner {
  return provider === 'google'
    ? { googleAccountId: accountId, microsoftAccountId: null }
    : { googleAccountId: null, microsoftAccountId: accountId };
}

export async function cloudAccounts(
  db: Queryable,
  provider: CloudProvider,
  workspaceId: string,
): Promise<CloudAccountRow[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, subject, email, needs_sign_in, can_edit FROM ${TABLES[provider].accounts}
     WHERE workspace_id = $1 ORDER BY created_at, email`,
    [workspaceId],
  );
  return rows.map(rowOf);
}

export async function saveCloudAccount(
  db: Queryable,
  provider: CloudProvider,
  workspaceId: string,
  account: { subject: string; email: string; canEdit: boolean },
): Promise<CloudAccountRow> {
  const { rows } = await db.query<Row>(
    `INSERT INTO ${TABLES[provider].accounts} (id, workspace_id, subject, email, can_edit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, subject)
       DO UPDATE SET email = EXCLUDED.email, needs_sign_in = false, can_edit = EXCLUDED.can_edit
     RETURNING id, subject, email, needs_sign_in, can_edit`,
    [randomUUID(), workspaceId, account.subject, account.email, account.canEdit],
  );
  return rowOf(rows[0]!);
}

export async function setCloudAgentsEdit(
  db: Db,
  provider: CloudProvider,
  workspaceId: string,
  account: CloudAccountRow,
  editCalendar: string | null,
): Promise<{ turnedOff: boolean }> {
  const { column } = TABLES[provider];
  return withTransaction(db, async (client) => {
    await lockChoices(client, workspaceId, cloudOwner(provider, account.id));
    if (!account.canEdit) {
      const { rowCount } = await client.query(
        `UPDATE calendar_calendars SET agents_edit = false
         WHERE workspace_id = $1 AND ${column} = $2 AND agents_edit`,
        [workspaceId, account.id],
      );
      return { turnedOff: (rowCount ?? 0) > 0 };
    }
    if (editCalendar) {
      await client.query(
        `UPDATE calendar_calendars SET agents_edit = true
         WHERE workspace_id = $1 AND ${column} = $2 AND key = $3 AND writable`,
        [workspaceId, account.id, editCalendar],
      );
    }
    return { turnedOff: false };
  });
}

export async function cloudEditBlocked(
  db: Queryable,
  workspaceId: string,
  calendarKey: string,
): Promise<CloudProvider | null> {
  const { rows } = await db.query<{ google: boolean | null; microsoft: boolean | null }>(
    `SELECT google.can_edit AS google, microsoft.can_edit AS microsoft
     FROM calendar_calendars calendar
     LEFT JOIN calendar_google_accounts google ON google.id = calendar.google_account_id
     LEFT JOIN calendar_microsoft_accounts microsoft
       ON microsoft.id = calendar.microsoft_account_id
     WHERE calendar.workspace_id = $1 AND calendar.key = $2`,
    [workspaceId, calendarKey],
  );
  const row = rows[0];
  if (row?.google === false) return 'google';
  if (row?.microsoft === false) return 'microsoft';
  return null;
}

export async function markCloudSignIn(
  db: Queryable,
  provider: CloudProvider,
  workspaceId: string,
  accountId: string,
  needsSignIn: boolean,
): Promise<void> {
  await db.query(
    `UPDATE ${TABLES[provider].accounts} SET needs_sign_in = $3
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, accountId, needsSignIn],
  );
}

export async function deleteCloudAccount(
  db: Queryable,
  provider: CloudProvider,
  workspaceId: string,
  accountId: string,
): Promise<void> {
  await db.query(`DELETE FROM ${TABLES[provider].accounts} WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    accountId,
  ]);
}

export async function cloudSubjects(db: Queryable, provider: CloudProvider): Promise<string[]> {
  const { rows } = await db.query<{ subject: string }>(
    `SELECT subject FROM ${TABLES[provider].accounts} ORDER BY subject`,
  );
  return rows.map((row) => row.subject);
}
