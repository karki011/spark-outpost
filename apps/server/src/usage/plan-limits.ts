import {
  limitStatusSchema,
  planLimitName,
  planWindowIdSchema,
  resetPhrase,
  type ExtraUsage,
  type PlanUsage,
  type PlanWindow,
  type ProviderId,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import {
  UsageLimitError,
  type ExtraUsageReading,
  type PlanReading,
  type PlanReport,
} from '../providers/provider.ts';

const PLAN_PROVIDER: ProviderId = 'claude';

const SAME_SIGN_IN = `
  JOIN provider_model_access a ON a.workspace_id = l.workspace_id AND a.provider = l.provider
  JOIN provider_connections c ON c.workspace_id = l.workspace_id AND c.provider = l.provider
  WHERE l.workspace_id = $1 AND l.provider = $2
    AND c.disconnected_at IS NULL AND c.method = 'cli'
    AND a.account_kind = 'account' AND a.account_label IS NOT DISTINCT FROM l.account_label`;

interface WindowRow {
  plan_window: string;
  used: number;
  resets_at: Date;
  limited: boolean;
  observed_at: Date;
}

interface ExtraRow {
  status: string;
  in_use: boolean;
  disabled_reason: string | null;
  limit_scope: string | null;
  resets_at: Date | null;
  observed_at: Date;
}

async function subscriptionLabel(
  db: Queryable,
  workspaceId: string,
  provider: string,
): Promise<{ label: string | null } | null> {
  const { rows } = await db.query<{ account_label: string | null }>(
    `SELECT account_label FROM provider_model_access
     WHERE workspace_id = $1 AND provider = $2 AND account_kind = 'account'`,
    [workspaceId, provider],
  );
  return rows[0] ? { label: rows[0].account_label } : null;
}

async function saveWindow(
  db: Queryable,
  key: readonly [string, string, string | null],
  reading: PlanReading,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_plan_limits
       (workspace_id, provider, account_label, plan_window, used, resets_at, limited, observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, provider, plan_window) DO UPDATE SET
       account_label = EXCLUDED.account_label, used = EXCLUDED.used,
       resets_at = EXCLUDED.resets_at, limited = EXCLUDED.limited,
       observed_at = EXCLUDED.observed_at
     WHERE provider_plan_limits.observed_at <= EXCLUDED.observed_at`,
    [...key, reading.window, reading.used, reading.resetsAt, reading.limited, now],
  );
}

async function saveExtraUsage(
  db: Queryable,
  key: readonly [string, string, string | null],
  extra: ExtraUsageReading,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_extra_usage
       (workspace_id, provider, account_label, status, in_use, disabled_reason, limit_scope,
        resets_at, observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       account_label = EXCLUDED.account_label, status = EXCLUDED.status,
       in_use = EXCLUDED.in_use, disabled_reason = EXCLUDED.disabled_reason,
       limit_scope = EXCLUDED.limit_scope,
       resets_at = EXCLUDED.resets_at, observed_at = EXCLUDED.observed_at
     WHERE provider_extra_usage.observed_at <= EXCLUDED.observed_at`,
    [
      ...key,
      extra.status,
      extra.inUse,
      extra.disabledReason,
      extra.limitScope,
      extra.resetsAt,
      now,
    ],
  );
}

export async function recordPlanReport(
  db: Queryable,
  workspaceId: string,
  provider: string,
  report: PlanReport,
  now: Date = new Date(),
): Promise<void> {
  if (provider !== PLAN_PROVIDER) return;
  const account = await subscriptionLabel(db, workspaceId, provider);
  if (!account) return;
  const key = [workspaceId, provider, account.label] as const;
  for (const reading of report.windows) await saveWindow(db, key, reading, now);
  if (report.extraUsage) await saveExtraUsage(db, key, report.extraUsage, now);
}

function toWindow(row: WindowRow): PlanWindow | null {
  const window = planWindowIdSchema.safeParse(row.plan_window);
  if (!window.success) return null;
  return {
    window: window.data,
    usedPercent: row.used * 100,
    resetsAt: row.resets_at.toISOString(),
    limited: row.limited,
    observedAt: row.observed_at.toISOString(),
  };
}

function toExtraUsage(row: ExtraRow | undefined): ExtraUsage | null {
  const status = limitStatusSchema.safeParse(row?.status);
  if (!row || !status.success) return null;
  return {
    status: status.data,
    inUse: row.in_use,
    disabledReason: row.disabled_reason,
    limitScope: row.limit_scope,
    resetsAt: row.resets_at?.toISOString() ?? null,
    observedAt: row.observed_at.toISOString(),
  };
}

export async function planUsage(
  db: Queryable,
  workspaceId: string,
  now: Date = new Date(),
): Promise<PlanUsage[]> {
  const params = [workspaceId, PLAN_PROVIDER, now];
  const [windowRows, extraRows] = await Promise.all([
    db.query<WindowRow>(
      `SELECT l.plan_window, l.used, l.resets_at, l.limited, l.observed_at
       FROM provider_plan_limits l ${SAME_SIGN_IN} AND l.resets_at > $3
       ORDER BY array_position(ARRAY['five_hour', 'seven_day'], l.plan_window), l.plan_window`,
      params,
    ),
    db.query<ExtraRow>(
      `SELECT l.status, l.in_use, l.disabled_reason, l.limit_scope, l.resets_at, l.observed_at
       FROM provider_extra_usage l ${SAME_SIGN_IN} AND (l.resets_at IS NULL OR l.resets_at > $3)`,
      params,
    ),
  ]);
  const windows = windowRows.rows
    .map(toWindow)
    .filter((found): found is PlanWindow => found !== null);
  const extraUsage = toExtraUsage(extraRows.rows[0]);
  if (windows.length === 0 && !extraUsage) return [];
  return [{ provider: PLAN_PROVIDER, windows, extraUsage }];
}

async function limitedWindow(
  db: Queryable,
  workspaceId: string,
  provider: string,
  now: Date,
): Promise<PlanWindow | null> {
  if (provider !== PLAN_PROVIDER) return null;
  const windows = (await planUsage(db, workspaceId, now)).flatMap((plan) => plan.windows);
  const full = windows.filter((window) => window.limited || window.usedPercent >= 100);
  return full.sort((a, b) => b.resetsAt.localeCompare(a.resetsAt))[0] ?? null;
}

export async function withResetTime(
  db: Queryable,
  workspaceId: string,
  provider: string,
  error: unknown,
  message: string,
  now: Date = new Date(),
): Promise<string> {
  if (!(error instanceof UsageLimitError)) return message;
  const window = await limitedWindow(db, workspaceId, provider, now);
  if (!window) return message;
  const reset = resetPhrase(new Date(window.resetsAt), now);
  return `${error.agentName} has reached this account's ${planLimitName(window.window)}. It resets ${reset}.`;
}

export async function recordPlan(
  db: Queryable,
  target: { workspaceId: string; provider: string },
  report: PlanReport,
): Promise<void> {
  await recordPlanReport(db, target.workspaceId, target.provider, report).catch((error: unknown) =>
    console.error('Could not save the plan usage reading', error),
  );
}

export async function forgetPlanUsage(
  db: Queryable,
  workspaceId: string,
  provider: string,
): Promise<void> {
  await db.query('DELETE FROM provider_plan_limits WHERE workspace_id = $1 AND provider = $2', [
    workspaceId,
    provider,
  ]);
  await db.query('DELETE FROM provider_extra_usage WHERE workspace_id = $1 AND provider = $2', [
    workspaceId,
    provider,
  ]);
}
