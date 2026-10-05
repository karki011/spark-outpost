import { z } from 'zod';
import { accountKindSchema, type ProviderAccount } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import {
  emptyAccess,
  mergeReport,
  withAccount,
  type RejectedModel,
  type ReportedAccess,
  type StoredAccess,
} from './access.ts';

interface AccessRow {
  provider: string;
  method: 'cli' | 'api_key';
  account_kind: string | null;
  account_label: string | null;
  account_plan: string | null;
  listed: unknown;
  unlisted: unknown;
  rejected: unknown;
  reported_at: Date | null;
}

const idsSchema = z.array(z.string()).catch([]);
const rejectedSchema = z
  .array(z.object({ id: z.string(), label: z.string(), at: z.string() }))
  .catch([]);

const COLUMNS = `provider, method, account_kind, account_label, account_plan, listed, unlisted,
  rejected, reported_at`;

function accountOf(row: AccessRow): ProviderAccount | null {
  const kind = accountKindSchema.safeParse(row.account_kind);
  if (!kind.success) return null;
  return { kind: kind.data, label: row.account_label ?? '', plan: row.account_plan };
}

function toAccess(row: AccessRow): StoredAccess {
  return {
    method: row.method,
    account: accountOf(row),
    listed: idsSchema.parse(row.listed),
    unlisted: idsSchema.parse(row.unlisted),
    rejected: rejectedSchema.parse(row.rejected),
    reportedAt: row.reported_at,
  };
}

export async function loadAccess(
  db: Queryable,
  workspaceId: string,
  provider: string,
): Promise<StoredAccess | null> {
  const { rows } = await db.query<AccessRow>(
    `SELECT ${COLUMNS} FROM provider_model_access WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  return rows[0] ? toAccess(rows[0]) : null;
}

export async function loadAllAccess(
  db: Queryable,
  workspaceId: string,
): Promise<Map<string, StoredAccess>> {
  const { rows } = await db.query<AccessRow>(
    `SELECT ${COLUMNS} FROM provider_model_access WHERE workspace_id = $1`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.provider, toAccess(row)]));
}

async function saveAccess(
  db: Queryable,
  workspaceId: string,
  provider: string,
  access: StoredAccess,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_model_access
       (workspace_id, provider, method, account_kind, account_label, account_plan, listed,
        unlisted, rejected, reported_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       method = EXCLUDED.method, account_kind = EXCLUDED.account_kind,
       account_label = EXCLUDED.account_label, account_plan = EXCLUDED.account_plan,
       listed = EXCLUDED.listed, unlisted = EXCLUDED.unlisted, rejected = EXCLUDED.rejected,
       reported_at = EXCLUDED.reported_at, updated_at = now()`,
    [
      workspaceId,
      provider,
      access.method,
      access.account?.kind ?? null,
      access.account?.label ?? null,
      access.account?.plan ?? null,
      JSON.stringify(access.listed),
      JSON.stringify(access.unlisted),
      JSON.stringify(access.rejected),
      access.reportedAt,
    ],
  );
}

async function connectionMethod(
  db: Queryable,
  workspaceId: string,
  provider: string,
): Promise<'cli' | 'api_key' | null> {
  const { rows } = await db.query<{ method: 'cli' | 'api_key' }>(
    `SELECT method FROM provider_connections
     WHERE workspace_id = $1 AND provider = $2 AND disconnected_at IS NULL`,
    [workspaceId, provider],
  );
  return rows[0]?.method ?? null;
}

export async function recordReportedAccess(
  db: Queryable,
  workspaceId: string,
  provider: string,
  report: ReportedAccess,
  reports: boolean,
  now: Date = new Date(),
): Promise<void> {
  const method = await connectionMethod(db, workspaceId, provider);
  if (!method) return;
  const stored = await loadAccess(db, workspaceId, provider);
  await saveAccess(db, workspaceId, provider, mergeReport(stored, method, report, reports, now));
}

export async function recordSnapshotAccess(
  db: Queryable,
  workspaceId: string,
  provider: string,
  models: readonly { id: string }[],
  reported: { reported: boolean; unlisted: readonly string[]; account?: ProviderAccount | null },
  now: Date = new Date(),
): Promise<void> {
  const unlisted = reported.unlisted;
  const listed = models.map((model) => model.id).filter((id) => !unlisted.includes(id));
  const report = { account: reported.account ?? null, listed, unlisted };
  await recordReportedAccess(db, workspaceId, provider, report, reported.reported, now);
}

export async function recordAccount(
  db: Queryable,
  workspaceId: string,
  provider: string,
  account: ProviderAccount,
): Promise<void> {
  const method = await connectionMethod(db, workspaceId, provider);
  if (!method) return;
  const stored = await loadAccess(db, workspaceId, provider);
  await saveAccess(db, workspaceId, provider, withAccount(stored, method, account));
}

export async function markModelRejected(
  db: Queryable,
  workspaceId: string,
  provider: string,
  model: Omit<RejectedModel, 'at'>,
  now: Date = new Date(),
): Promise<void> {
  const method = await connectionMethod(db, workspaceId, provider);
  if (!method) return;
  const stored = (await loadAccess(db, workspaceId, provider)) ?? emptyAccess(method);
  const others = stored.rejected.filter((entry) => entry.id !== model.id);
  await saveAccess(db, workspaceId, provider, {
    ...stored,
    method,
    rejected: [...others, { ...model, at: now.toISOString() }],
  });
}

export async function forgetRejectedModels(
  db: Queryable,
  workspaceId: string,
  provider: string,
): Promise<void> {
  await db.query(
    `UPDATE provider_model_access SET rejected = '[]'::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
}
